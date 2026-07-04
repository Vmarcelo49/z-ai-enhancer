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
 */
(function () {
  if (window.__zaiHookInstalled) return;
  window.__zaiHookInstalled = true;

  const COMPLETION_URL_HINT = "/api/v2/chat/completions";
  const SOURCE = "zai-enhancer";

  const post = (type, payload) =>
    window.postMessage({ source: SOURCE, type, ...payload }, location.origin);

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

    post("stream-start", { url, ts: Date.now() });

    let response;
    try {
      response = await origFetch.apply(this, args);
    } catch (err) {
      post("stream-end", { url, ts: Date.now(), error: String(err) });
      throw err;
    }

    // Clone so the page still gets the body uninterrupted.
    // v0.11.0: we no longer consume stream chunks (no listener for stream-chunk),
    // so we don't need to read the body at all. Just detect stream-end via
    // the response promise settling.
    (async () => {
      try {
        const reader = cloneForObservation.body?.getReader();
        if (!reader) {
          post("stream-end", { url, ts: Date.now() });
          return;
        }
        // Drain the body to detect when it ends — but don't post per-chunk
        // (was creating thousands of postMessages for long responses).
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

  console.debug("[zai-enhancer] page-hook installed (fetch + EventSource)");
})();
