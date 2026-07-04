/* content/detectors.js
 * Combines 3 layers of "agent finished" detection:
 *   L1 Network: postMessage from page-hook.js (stream-start / stream-end) — PRIMARY
 *   L2 Stop button: [aria-label="Stop"] check on demand (not via MutationObserver)
 *   L3 Action bar: [aria-label="Copy"] check on demand
 *
 * Emits on window.__zaiBus:
 *   agent:start        — agent began generating
 *   agent:stop-button  — user clicked Stop manually (best-effort)
 *   agent:done         — agent finished producing a message (confirmed)
 *   agent:maybe-done   — early signal (Stop button disappeared); use for low-latency UI
 *
 * Performance notes (v0.11.0):
 *   - Removed MutationObserver on body subtree + attributes (was firing hundreds of
 *     times per second during streaming due to Svelte class updates).
 *   - Replaced setTimeout polling in confirmDoneWithin with a single
 *     short-lived MutationObserver scoped to the last assistant message only,
 *     created on-demand and disconnected after confirm.
 *   - L1 (network) is the primary signal; L2/L3 are only checked when L1 fires.
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) { console.warn("[zai-enhancer] event-bus missing"); return; }

  const STOP_SEL = '[aria-label="Stop"]';
  const COPY_SEL = '[aria-label="Copy"]';
  const REGEN_SEL = '[aria-label="Regenerate"]';
  const ASSISTANT_SEL = ".chat-assistant";
  const MSG_CONTAINER_SEL = '[class*="message-"]:not(.user-message)';

  // ---------- state ----------
  const state = {
    generating: false,
    streamStartedAt: null,
    streamEndedAt: null,
    stopBtnVisible: false,
    lastStreamUrl: null,
    lastStartTs: 0,
    lastEndTs: 0,
    stopClickedTs: 0,
    firedDoneForUrl: new Set()
  };

  // Track agent running state (single source of truth, no DOM re-query)
  let agentRunning = false;
  function setAgentRunning(v) {
    if (agentRunning === v) return;
    agentRunning = v;
    bus.emit("agent:running-changed", { running: v });
  }

  // ---------- L1: network signals from page-hook ----------
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.source !== "zai-enhancer") return;

    if (data.type === "stream-start") {
      state.generating = true;
      state.streamStartedAt = data.ts;
      state.streamEndedAt = null;
      state.lastStreamUrl = data.url;
      state.lastStartTs = data.ts;
      state.firedDoneForUrl.delete(data.url);
      state.stopBtnVisible = true; // network says it started
      setAgentRunning(true);
      bus.emit("agent:start", { url: data.url, startedAt: data.ts });
    } else if (data.type === "stream-end") {
      state.streamEndedAt = data.ts;
      state.lastEndTs = data.ts;
      bus.emit("agent:maybe-done", {
        url: data.url, endedAt: data.ts, reason: "stream-end", error: data.error || null
      });
      confirmDoneWithin(2500, data.url);
    }
  });

  // ---------- L2: Stop button visibility (on-demand check, NOT observer) ----------
  function stopButtonVisible() {
    const el = document.querySelector(STOP_SEL);
    if (!el) return false;
    if (!el.offsetParent && el.getClientRects().length === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Capture stop-button clicks (user-initiated stop)
  document.addEventListener("click", (e) => {
    const target = e.target?.closest?.(STOP_SEL);
    if (target) {
      state.stopClickedTs = Date.now();
      bus.emit("agent:stop-button", { ts: state.stopClickedTs });
    }
  }, true);

  // ---------- L3: action bar appears in last assistant message ----------
  function lastAssistantMessage() {
    const all = document.querySelectorAll(ASSISTANT_SEL);
    return all[all.length - 1] || null;
  }

  function lastMessageDone() {
    const msg = lastAssistantMessage();
    if (!msg) return null;
    const copy = msg.querySelector(COPY_SEL);
    const regen = msg.querySelector(REGEN_SEL);
    if (!copy && !regen) return null;
    const container = msg.closest(MSG_CONTAINER_SEL);
    return {
      messageId: container?.id || container?.className?.match(/message-([a-f0-9-]+)/i)?.[1] || null,
      textLen: msg.textContent?.length || 0,
      hasCopy: !!copy,
      hasRegen: !!regen
    };
  }

  // ---------- confirmation logic (v0.11.0: scoped observer instead of polling) ----------
  let confirmObserver = null;
  let confirmFallbackTimer = null;

  function confirmDoneWithin(timeoutMs, url) {
    // Clean up any previous confirmation attempt
    if (confirmObserver) { confirmObserver.disconnect(); confirmObserver = null; }
    if (confirmFallbackTimer) { clearTimeout(confirmFallbackTimer); confirmFallbackTimer = null; }

    const checkOnce = () => {
      const info = lastMessageDone();
      const stopStillVisible = stopButtonVisible();
      if (info && !stopStillVisible) {
        fireDone({ url, reason: "dom-confirmed", ...info });
        return true;
      }
      return false;
    };

    // Try immediately
    if (checkOnce()) return;

    // Set up a scoped observer on the last assistant message only
    const target = lastAssistantMessage() || document.body;
    confirmObserver = new MutationObserver(() => {
      if (checkOnce()) {
        if (confirmObserver) { confirmObserver.disconnect(); confirmObserver = null; }
        if (confirmFallbackTimer) { clearTimeout(confirmFallbackTimer); confirmFallbackTimer = null; }
      }
    });
    // Only watch childList (new buttons appearing) — NOT attributes (class/style changes)
    confirmObserver.observe(target, { childList: true, subtree: true });

    // Fallback: after timeout, force-confirm if stream ended and stop is gone
    confirmFallbackTimer = setTimeout(() => {
      if (confirmObserver) { confirmObserver.disconnect(); confirmObserver = null; }
      const info = lastMessageDone();
      const stopStillVisible = stopButtonVisible();
      if (!stopStillVisible && state.streamEndedAt) {
        fireDone({ url, reason: "timeout-confirmed", textLen: info?.textLen ?? 0 });
      } else {
        bus.emit("agent:maybe-done", { url, reason: "timeout-still-streaming", endedAt: Date.now() });
      }
    }, timeoutMs);
  }

  function fireDone({ url, reason, messageId, textLen, hasCopy, hasRegen }) {
    if (url && state.firedDoneForUrl.has(url)) return;
    if (url) state.firedDoneForUrl.add(url);
    state.generating = false;
    state.stopBtnVisible = false;
    setAgentRunning(false);
    const userStoppedRecently = state.stopClickedTs && (Date.now() - state.stopClickedTs < 2000);
    bus.emit("agent:done", {
      url, messageId, textLen, reason,
      userStopped: userStoppedRecently,
      startedAt: state.streamStartedAt,
      endedAt: Date.now(),
      durationMs: state.streamStartedAt ? Date.now() - state.streamStartedAt : 0
    });
  }

  console.debug("[zai-enhancer] detectors ready (L1 network primary + L2/L3 on-demand)");
})();
