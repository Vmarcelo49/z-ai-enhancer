/* content/dialog-killer.js
 * Auto-dismiss the "Currently in peak hours" / "Model is at capacity" dialog
 * that chat.z.ai shows when GLM-5.2 is overloaded — AND optionally retry
 * sending the last user message after the dialog is dismissed (soft retry,
 * no page reload).
 *
 * Capacity-detection logic lives in capacity-common.js (shared with
 * refresh-retry.js). This module owns:
 *   - Dismissing the dialog (clicking the X / Cancel button)
 *   - Soft retry: re-sending the last user message in-place
 *
 * Retry flow:
 *   1. dialog appears → capacity-common observer fires
 *   2. dismissDialog() clicks [data-dialog-close]
 *   3. retryLastMessage() waits `retryDelayMs` (default 4000ms)
 *   4. checks if agent is currently generating (looks for [aria-label="Stop"])
 *      — if generating, abort retry (the previous attempt may have succeeded
 *        just before the dialog appeared)
 *   5. sets the textarea value to the last captured user message
 *      (window.__zaiLastUserMessage, populated by page-hook.js)
 *   6. clicks #send-message-button
 *   7. records the attempt; if the dialog re-appears within
 *      `retryWatchWindowMs` (default 8000ms), counts as a failed attempt
 *   8. max `retryMaxAttempts` (default 3) before giving up
 *
 * Settings (storage.local):
 *   - dialogKillerEnabled       (default: true)
 *   - dialogKillerMatchMode     "exact" | "substring" (default: "substring")
 *   - dialogKillerRetry         (default: true)         — retry sending on capacity?
 *   - dialogKillerRetryDelayMs  (default: 4000)         — wait before retry
 *   - dialogKillerRetryMaxAttempts (default: 3)         — give up after N
 *   - dialogKillerRetryWatchWindowMs (default: 8000)    — window to detect re-appearance
 */
(function () {
  const bus = window.__zaiBus;
  const cap = window.__zaiCapacity;
  if (!bus) { console.warn("[zai-enhancer] event-bus missing — dialog-killer.js cannot fire events"); }
  if (!cap) {
    console.warn("[zai-enhancer] capacity-common missing — dialog-killer.js cannot detect dialogs");
    return;
  }

  // ---------- settings (cached) ----------
  let enabled = true;
  let matchMode = "substring";
  let retryEnabled = true;
  let retryDelayMs = 4000;
  let retryMaxAttempts = 3;
  let retryWatchWindowMs = 8000;

  // ---------- retry state ----------
  // Per "conversation turn" — resets when a new user message is captured.
  let retryAttempts = 0;
  let retryTimer = null;
  let retryWatchTimer = null;
  let lastRetriedMessageTs = 0; // dedupes — don't retry the same message twice in same turn

  // ---------- stats ----------
  let stats = { dismissed: 0, retried: 0, retriesSucceeded: 0, lastDismissedAt: null };

  // ---------- restore prefs + listen for changes ----------
  try {
    browser.storage?.local?.get([
      "dialogKillerEnabled",
      "dialogKillerMatchMode",
      "dialogKillerRetry",
      "dialogKillerRetryDelayMs",
      "dialogKillerRetryMaxAttempts",
      "dialogKillerRetryWatchWindowMs",
    ]).then((p) => {
      if (p.dialogKillerEnabled === false) enabled = false;
      if (p.dialogKillerMatchMode === "exact") matchMode = "exact";
      if (p.dialogKillerRetry === false) retryEnabled = false;
      if (typeof p.dialogKillerRetryDelayMs === "number") retryDelayMs = p.dialogKillerRetryDelayMs;
      if (typeof p.dialogKillerRetryMaxAttempts === "number") retryMaxAttempts = p.dialogKillerRetryMaxAttempts;
      if (typeof p.dialogKillerRetryWatchWindowMs === "number") retryWatchWindowMs = p.dialogKillerRetryWatchWindowMs;
    });
  } catch (_) {}
  try {
    browser.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.dialogKillerEnabled) enabled = changes.dialogKillerEnabled.newValue !== false;
      if (changes.dialogKillerMatchMode) matchMode = changes.dialogKillerMatchMode.newValue || "substring";
      if (changes.dialogKillerRetry) retryEnabled = changes.dialogKillerRetry.newValue !== false;
      if (changes.dialogKillerRetryDelayMs) retryDelayMs = Number(changes.dialogKillerRetryDelayMs.newValue) || 4000;
      if (changes.dialogKillerRetryMaxAttempts) retryMaxAttempts = Number(changes.dialogKillerRetryMaxAttempts.newValue) || 3;
      if (changes.dialogKillerRetryWatchWindowMs) retryWatchWindowMs = Number(changes.dialogKillerRetryWatchWindowMs.newValue) || 8000;
    });
  } catch (_) {}

  // ---------- listen for new user messages (resets retry counter) ----------
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.source !== "zai-enhancer") return;
    if (data.type === "last-user-message") {
      // New message captured → reset retry state for the new turn
      retryAttempts = 0;
      lastRetriedMessageTs = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (retryWatchTimer) { clearTimeout(retryWatchTimer); retryWatchTimer = null; }
    }
  });

  // ---------- helpers ----------
  function findCloseButton(dialog) {
    let btn = dialog.querySelector("[data-dialog-close]");
    if (btn) return btn;
    const buttons = dialog.querySelectorAll("button");
    for (const b of buttons) {
      const t = (b.innerText || "").trim().toLowerCase();
      if (t === "cancel" || t === "close" || t === "×" || t === "x" || t === "dismiss") return b;
    }
    for (const b of buttons) {
      if (!b.innerText.trim() && b.querySelector("svg")) return b;
    }
    return null;
  }

  function dismissDialog(dialog, reason) {
    const btn = findCloseButton(dialog);
    if (!btn) {
      console.warn("[zai-enhancer] capacity dialog detected but no close button found");
      return false;
    }
    btn.click();
    stats.dismissed++;
    stats.lastDismissedAt = Date.now();
    console.debug("[zai-enhancer] dismissed capacity dialog:", reason);
    bus?.emit("dialog:dismissed", {
      reason,
      dismissedAt: stats.lastDismissedAt,
      totalDismissed: stats.dismissed,
    });
    return true;
  }

  // ---------- retry logic ----------
  function isAgentGenerating() {
    // The Stop button only appears when the agent is streaming a response.
    const stop = document.querySelector('[aria-label="Stop"]');
    if (!stop) return false;
    const rect = stop.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function setTextareaValue(text) {
    // chat.z.ai uses Svelte. To update state, we must use the native setter
    // and dispatch an `input` event — direct .value = ... won't trigger reactivity.
    const ta = document.querySelector('textarea[placeholder="Send a Message"]');
    if (!ta) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeSetter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    // Some frameworks (Svelte) also need a change event
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function clickSendButton() {
    const btn = document.getElementById("send-message-button");
    if (!btn) return false;
    btn.click();
    return true;
  }

  function getLastUserMessage() {
    // Populated by page-hook.js (MAIN world → content script via postMessage).
    // We re-read on demand so we always have the latest value.
    return window.__zaiLastUserMessage || null;
  }

  function retryLastMessage() {
    if (!retryEnabled) return;
    if (retryAttempts >= retryMaxAttempts) {
      console.warn(`[zai-enhancer] giving up after ${retryAttempts} retry attempts`);
      bus?.emit("dialog:retry-giveup", { attempts: retryAttempts });
      return;
    }

    const last = getLastUserMessage();
    if (!last || !last.text) {
      console.warn("[zai-enhancer] cannot retry — no last user message captured");
      return;
    }

    // Dedupe: don't retry the same captured message twice in the same turn
    if (lastRetriedMessageTs === last.ts) {
      console.debug("[zai-enhancer] already retried this message, skipping");
      return;
    }

    // If the agent is currently generating, abort — the previous attempt may
    // have actually succeeded just before the dialog appeared.
    if (isAgentGenerating()) {
      console.debug("[zai-enhancer] agent is generating — aborting retry (previous send may have succeeded)");
      bus?.emit("dialog:retry-aborted", { reason: "agent-generating" });
      return;
    }

    retryAttempts++;
    lastRetriedMessageTs = last.ts;
    stats.retried++;

    console.debug(`[zai-enhancer] retrying message (attempt ${retryAttempts}/${retryMaxAttempts}): "${last.text.slice(0, 80)}..."`);

    // Set the textarea value and click send
    const okFill = setTextareaValue(last.text);
    if (!okFill) {
      console.warn("[zai-enhancer] could not find textarea to retry");
      return;
    }

    // Small delay to let Svelte react before clicking send
    setTimeout(() => {
      const okSend = clickSendButton();
      if (!okSend) {
        console.warn("[zai-enhancer] could not find send button to retry");
        return;
      }
      bus?.emit("dialog:retry-sent", {
        attempt: retryAttempts,
        textPreview: last.text.slice(0, 80),
      });
      // Set a watch window — if the dialog re-appears within this window,
      // it counts as a failed attempt and the next retry will be scheduled
      // by the next mutation observer firing.
    }, 100);
  }

  function scheduleRetry() {
    if (!retryEnabled) return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    console.debug(`[zai-enhancer] scheduling retry in ${retryDelayMs}ms`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryLastMessage();
    }, retryDelayMs);
  }

  function onCapacityDialogFound(dialog) {
    if (!enabled) return;
    const dismissed = dismissDialog(dialog, "mutation-detected");
    if (dismissed) {
      // Schedule a retry of the last user message
      scheduleRetry();
    }
  }

  // ---------- initial scan ----------
  setTimeout(() => {
    if (!enabled) return;
    const dialog = cap.findCapacityDialog(document, matchMode);
    if (dialog) onCapacityDialogFound(dialog);
  }, 0);

  // ---------- MutationObserver via shared capacity-common ----------
  cap.setupObserver(onCapacityDialogFound);

  // ---------- public API ----------
  window.__zaiDialogKiller = {
    get stats() { return { ...stats, retryAttempts }; },
    get enabled() { return enabled; },
    get retryEnabled() { return retryEnabled; },
    scan: () => {
      const dialog = cap.findCapacityDialog(document, matchMode);
      if (dialog) onCapacityDialogFound(dialog);
      return !!dialog;
    },
    retryNow: () => retryLastMessage(),
    phrases: () => [...cap.PHRASES],
    getLastMessage: () => window.__zaiLastUserMessage || null,
  };

  console.debug("[zai-enhancer] dialog-killer ready (auto-dismiss + soft retry on capacity)");
})();
