/* content/page-hook.js
 * Injected into the MAIN world (the page's own JS context) via a <script> tag.
 * It overrides window.fetch so we can observe the streaming request to
 * /api/v2/chat/completions and report start / end to the isolated-world
 * content script via window.postMessage.
 *
 * Communication contract (postMessage):
 *   { source: 'zai-enhancer', type: 'stream-start', url, ts }
 *   { source: 'zai-enhancer', type: 'stream-end',   url, ts, error? }
 *   { source: 'zai-enhancer', type: 'stream-chunk', url, ts, size }
 *   { source: 'zai-enhancer', type: 'last-user-message', text, ts }
 *
 * v0.13.0 addition:
 *   Captures the last user message from the request body (cloned before send)
 *   and stores it on window.__zaiLastUserMessage so dialog-killer.js can
 *   re-send it when the "capacity" dialog appears.
 */
(function () {
  if (window.__zaiHookInstalled) return;
  window.__zaiHookInstalled = true;

  const COMPLETION_URL_HINT = "/api/v2/chat/completions";
  const SOURCE = "zai-enhancer";

  const post = (type, payload) =>
    window.postMessage({ source: SOURCE, type, ...payload }, location.origin);

  // ---------- last user message capture (for retry-on-capacity) ----------
  // Reads a request body (string | Blob | ArrayBuffer | ReadableStream) and
  // returns parsed JSON. Returns null on any failure.
  async function readBodyAsJSON(body) {
    if (!body) return null;
    try {
      if (typeof body === "string") return JSON.parse(body);
      if (body instanceof Blob) return JSON.parse(await body.text());
      if (body instanceof ArrayBuffer) {
        return JSON.parse(new TextDecoder().decode(body));
      }
      if (body instanceof ReadableStream) {
        const reader = body.getReader();
        const chunks = [];
        let totalLen = 0;
        // Cap at 1MB to avoid runaway reads
        while (totalLen < 1024 * 1024) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalLen += value.byteLength;
        }
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.byteLength;
        }
        return JSON.parse(new TextDecoder().decode(merged));
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function extractLastUserMessage(parsed) {
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    for (let i = parsed.messages.length - 1; i >= 0; i--) {
      const m = parsed.messages[i];
      if (m?.role !== "user") continue;
      const content = m.content;
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter((c) => c?.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n");
      }
      if (text) return text;
    }
    return null;
  }

  // Called in parallel (does not block the actual fetch).
  async function captureLastUserMessage(req, init, requestUrl) {
    try {
      let bodyToRead = null;
      if (typeof req === "string") {
        bodyToRead = init?.body;
      } else if (req instanceof Request) {
        // CLONE the Request so the original body is still readable by the
        // real fetch call below.
        try {
          const clone = req.clone();
          bodyToRead = clone.body;
        } catch (_) {
          return;
        }
      } else if (req && typeof req === "object") {
        bodyToRead = req.body || init?.body;
      }

      const parsed = await readBodyAsJSON(bodyToRead);
      if (!parsed) return;

      const text = extractLastUserMessage(parsed);
      if (!text) return;

      window.__zaiLastUserMessage = {
        text,
        ts: Date.now(),
        url: requestUrl,
      };
      // Notify content scripts (text truncated for privacy in postMessage)
      post("last-user-message", { text: text.slice(0, 200), ts: Date.now() });
    } catch (e) {
      console.debug("[zai-enhancer] captureLastUserMessage failed:", e.message);
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function zaiFetch(...args) {
    const req = args[0];
    const init = args[1] || {};
    const url =
      typeof req === "string"
        ? req
        : req instanceof Request
          ? req.url
          : (init.url || String(req));

    const isCompletion = typeof url === "string" && url.includes(COMPLETION_URL_HINT);
    if (!isCompletion) return origFetch.apply(this, args);

    // Capture last user message in parallel — DOES NOT await before fetch.
    // The clone is independent, so reading it does not consume the original.
    captureLastUserMessage(req, init, url);

    post("stream-start", { url, ts: Date.now() });

    let response;
    try {
      response = await origFetch.apply(this, args);
    } catch (err) {
      post("stream-end", { url, ts: Date.now(), error: String(err) });
      throw err;
    }

    // Clone the Response so the page still gets the body uninterrupted, while
    // we independently drain our clone to detect when the stream actually ends.
    (async () => {
      try {
        const cloneForObservation = response.clone();
        const reader = cloneForObservation.body?.getReader();
        if (!reader) {
          post("stream-end", { url, ts: Date.now() });
          return;
        }
        for (;;) {
          const { done, error } = await reader.read();
          if (error) {
            post("stream-end", { url, ts: Date.now(), error: String(error) });
            return;
          }
          if (done) {
            post("stream-end", { url, ts: Date.now() });
            return;
          }
        }
      } catch (e) {
        post("stream-end", { url, ts: Date.now(), error: String(e) });
      }
    })();

    return response;
  };

  // Also catch EventSource-style SSE if Z.ai ever switches to it.
  const OrigEventSource = window.EventSource;
  if (OrigEventSource) {
    window.EventSource = class ZaiEventSource extends OrigEventSource {
      constructor(url, config) {
        super(url, config);
        if (typeof url === "string" && url.includes(COMPLETION_URL_HINT)) {
          post("stream-start", { url, ts: Date.now() });
          this.addEventListener("error", (e) =>
            post("stream-end", { url, ts: Date.now(), error: "EventSource error" })
          );
          this.addEventListener("close", () =>
            post("stream-end", { url, ts: Date.now() })
          );
        }
      }
    };
    window.EventSource.prototype = OrigEventSource.prototype;
  }

  console.debug("[zai-enhancer] page-hook installed (fetch + EventSource + last-msg capture)");
})();
