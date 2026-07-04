/* content/autosend.js
 * Auto-send queue motor — ALWAYS-ON model (v0.6.0+).
 *
 * If items.length > 0, the queue is "running" — there is no start/pause/active flag.
 * - When the agent is NOT currently generating AND queue has items → send the next one immediately.
 * - When agent:done fires AND queue still has items → send the next one after delayMs.
 * - When user clicks Stop manually → drop the current pending cycle (next add re-triggers).
 * - When stream errors → drop the current pending cycle.
 * - When user navigates to a different chat URL → drop the current pending cycle.
 *
 * Persistence (browser.storage.local.autosend_queue):
 *   { items, delayMs, maxItems, maxCharsPerMsg }
 *   On page reload: items are preserved and resume sending immediately.
 *
 * Public API on window.__zaiAutosend:
 *   getState(), addItem, removeItem, updateItem, moveItem, clear,
 *   setDelay, setMaxItems, importFromTextarea
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) { console.warn("[zai-enhancer] autosend: no bus"); return; }

  const STORAGE_KEY = "autosend_queue";
  const DEFAULTS = {
    items: [],
    delayMs: 2000,
    maxItems: 50,
    maxCharsPerMsg: 10000
  };

  let state = { ...DEFAULTS };
  let sendInProgress = false;
  let pendingTimeout = null;
  let lastSentAt = 0;
  let waitingForAgent = false; // true when we just sent and are waiting for agent:done

  // ---------- persistence ----------
  async function load() {
    try {
      const p = await browser.storage.local.get(STORAGE_KEY);
      state = { ...DEFAULTS, ...(p[STORAGE_KEY] || {}) };
    } catch (_) {}
    emitChange();
    // After load, if we have items and agent is idle, kick off the queue
    setTimeout(() => maybeSendNext(), 500);
  }

  async function save() {
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: state });
    } catch (_) {}
    emitChange();
  }

  function emitChange() {
    bus.emit("queue:changed", { ...state });
  }

  // ---------- programmatic send (shared utility) ----------
  async function sendMessage(text) {
    if (!window.__zaiSend) return { ok: false, reason: "no_send_utils" };
    const r = await window.__zaiSend.sendMessage(text);
    if (r.ok) lastSentAt = Date.now();
    return r;
  }

  // ---------- core motor ----------
  async function maybeSendNext() {
    if (sendInProgress) return;
    if (state.items.length === 0) return;

    // If agent is currently generating, wait for agent:done
    if (document.querySelector('[aria-label="Stop"]')) {
      waitingForAgent = true;
      return;
    }

    // If we just sent and are waiting for agent:done, don't double-send
    if (waitingForAgent) return;

    // Respect delay between sends
    if (pendingTimeout) return;

    sendInProgress = true;
    const next = state.items[0];
    const result = await sendMessage(next);
    sendInProgress = false;

    if (result.ok) {
      state.items = state.items.slice(1);
      await save();
      waitingForAgent = true;
      bus.emit("queue:item-sent", {
        text: next,
        remaining: state.items.length,
        ts: Date.now()
      });
    } else {
      if (result.reason === "agent_running") {
        // Agent just started (race) — wait for done
        waitingForAgent = true;
        return;
      }
      // Hard error — drop the item so queue doesn't get stuck, but emit error
      lastErrorAt = Date.now();
      bus.emit("queue:item-error", {
        text: next,
        reason: result.reason,
        ts: Date.now()
      });
      // Don't drop the item on transient errors — let user decide.
      // But schedule a retry in 5s
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        maybeSendNext();
      }, 5000);
    }
  }

  // ---------- bus listeners ----------
  bus.on("agent:done", (evt) => {
    waitingForAgent = false;

    // If user manually stopped, drop the queue cycle (user intervention)
    if (evt.userStopped) {
      bus.emit("queue:paused", { reason: "user_stopped_agent", ts: Date.now() });
      // Don't actually pause — just don't send immediately. Next agent:done (when
      // user sends manually) or next add will resume. Actually for always-on model,
      // we should keep going if there are more items. But if user stopped, they
      // probably want to intervene. Let's give a 3s grace before resuming.
      if (state.items.length > 0) {
        if (pendingTimeout) clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(() => {
          pendingTimeout = null;
          maybeSendNext();
        }, 3000);
      }
      return;
    }

    // If stream errored, same as user stop — short grace then resume
    if (evt.error) {
      bus.emit("queue:paused", { reason: "stream_error", ts: Date.now() });
      if (state.items.length > 0) {
        if (pendingTimeout) clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(() => {
          pendingTimeout = null;
          maybeSendNext();
        }, 3000);
      }
      return;
    }

    // Normal completion — if queue has more items, schedule next send
    if (state.items.length === 0) {
      bus.emit("queue:completed", { ts: Date.now() });
      return;
    }

    if (pendingTimeout) clearTimeout(pendingTimeout);
    pendingTimeout = setTimeout(() => {
      pendingTimeout = null;
      maybeSendNext();
    }, state.delayMs);
  });

  // Detect URL changes (z.ai creates /c/{uuid} on first send — that's expected,
  // but real user navigation should drop the cycle).
  // v0.11.0: replaced setInterval(1000) with popstate + pushState/replaceState hooks.
  let lastUrl = location.href;
  const NAV_IGNORE_WINDOW_MS = 5000;

  function handleUrlChange() {
    if (location.href === lastUrl) return;
    const changedAt = Date.now();
    const sinceSend = changedAt - lastSentAt;
    lastUrl = location.href;
    if (waitingForAgent && sinceSend > NAV_IGNORE_WINDOW_MS) {
      waitingForAgent = false;
      bus.emit("queue:paused", { reason: "navigation", ts: changedAt });
      setTimeout(() => maybeSendNext(), 500);
    }
  }

  // Native navigation (back/forward)
  window.addEventListener("popstate", handleUrlChange);
  // SPA navigation (pushState/replaceState)
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    const r = origPushState.apply(this, args);
    setTimeout(handleUrlChange, 0);
    return r;
  };
  history.replaceState = function (...args) {
    const r = origReplaceState.apply(this, args);
    setTimeout(handleUrlChange, 0);
    return r;
  };

  // ---------- public API ----------
  window.__zaiAutosend = {
    getState: () => ({ ...state, waitingForAgent }),

    async addItem(text) {
      text = String(text || "").trim();
      if (!text) return { ok: false, reason: "empty" };
      if (state.items.length >= state.maxItems)
        return { ok: false, reason: "max_items_reached" };
      if (text.length > state.maxCharsPerMsg)
        return { ok: false, reason: "too_long" };
      state.items.push(text);
      await save();
      // Adding an item triggers the motor (will send immediately if agent is idle)
      setTimeout(() => maybeSendNext(), 50);
      return { ok: true, index: state.items.length - 1 };
    },

    async removeItem(index) {
      if (index < 0 || index >= state.items.length) return;
      state.items.splice(index, 1);
      await save();
    },

    async updateItem(index, text) {
      if (index < 0 || index >= state.items.length) return;
      text = String(text || "");
      if (text.length > state.maxCharsPerMsg) return;
      state.items[index] = text;
      await save();
    },

    async moveItem(from, to) {
      if (from < 0 || from >= state.items.length) return;
      if (to < 0 || to >= state.items.length) return;
      if (from === to) return;
      const [item] = state.items.splice(from, 1);
      state.items.splice(to, 0, item);
      await save();
    },

    async clear() {
      state.items = [];
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
      }
      waitingForAgent = false;
      await save();
    },

    async setDelay(ms) {
      state.delayMs = Math.max(500, Math.min(60000, Number(ms) || 2000));
      await save();
    },

    async setMaxItems(n) {
      state.maxItems = Math.max(1, Math.min(100, Number(n) || 50));
      await save();
    },

    // Bulk import: split by "---" separator on its own line
    async importText(blob) {
      const parts = String(blob || "")
        .split(/^\s*---\s*$/m)
        .map((s) => s.trim())
        .filter(Boolean);
      let added = 0;
      for (const p of parts) {
        const r = await this.addItem(p);
        if (r.ok) added++;
      }
      return { ok: true, added, total: state.items.length };
    }
  };

  // Live-update when storage changes from other contexts
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes[STORAGE_KEY]) return;
      state = { ...DEFAULTS, ...changes[STORAGE_KEY].newValue };
      emitChange();
      // If items were added from another context, kick the motor
      setTimeout(() => maybeSendNext(), 100);
    });
  } catch (_) {}

  load();
  console.debug("[zai-enhancer] autosend ready (always-on model)");
})();
