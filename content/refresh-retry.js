/* content/refresh-retry.js
 * "Hard retry" on capacity dialog: refresh page → (optionally) switch to Agent
 * mode → resend. Loops until the agent responds successfully.
 *
 * Uses shared capacity-detection utilities from capacity-common.js.
 *
 * Agent-mode fix (v0.14.1):
 *   - If URL is the root (https://chat.z.ai/)  → click "Agent" mode button
 *     before sending (we're starting a new chat).
 *   - If URL is an active chat (/c/{uuid})     → DO NOT click "Agent" — that
 *     would create a new chat. Just reload the URL and resend; the chat
 *     already exists and its mode is preserved across reloads.
 *
 * Flow:
 *   1. capacity dialog appears → capacity-common observer fires
 *   2. captures the current textarea text (fallback to last captured user msg)
 *   3. persists it to browser.storage.local so it survives the reload
 *   4. location.reload()
 *   5. on page load: waits for textarea, optionally clicks Agent (root URL only),
 *      sets textarea value, clicks send
 *   6. listens for agent:done — if no error, success; if dialog re-appears,
 *      loops back to step 1 (up to maxAttempts)
 *
 * Settings (storage.local):
 *   - refreshRetryEnabled            (default: true)
 *   - refreshRetryMaxAttempts        (default: 10)
 *   - refreshRetryPageReadyMs        (default: 3000)  wait after textarea appears
 *   - refreshRetryAgentModeWaitMs    (default: 1000)  wait after clicking Agent mode (root URL only)
 *   - refreshRetryCooldownMs         (default: 3000)  min gap between refreshes
 *   - refreshRetrySuccessWatchMs     (default: 120000) watch window for agent:done
 *   - refreshRetryStaleMs            (default: 3600000) pending retry older than this is dropped
 *
 * Bus events emitted:
 *   - refresh-retry:kicked-off  { attempts, maxAttempts }
 *   - refresh-retry:resent      { attempts }
 *   - refresh-retry:success     { attempts }
 *   - refresh-retry:giveup      { attempts, reason }
 *
 * Public API on window.__zaiRefreshRetry:
 *   getPending()  → current pending retry object or null
 *   isEnabled()   → boolean
 *   clear()       → drop the pending retry (cancels the loop)
 *   triggerNow()  → manually kick off a refresh retry (for testing)
 */
(function () {
  const bus = window.__zaiBus;
  const cap = window.__zaiCapacity;
  if (!cap) {
    console.warn("[zai-enhancer] capacity-common missing — refresh-retry.js cannot detect dialogs");
    return;
  }

  const STORAGE_KEY = "refreshRetry_pending";

  // ---------- settings (cached) ----------
  let enabled = true;
  let maxAttempts = 10;
  let pageReadyMs = 3000;
  let agentModeWaitMs = 1000;
  let cooldownMs = 3000;
  let successWatchMs = 120000;
  let staleMs = 3600000;

  // ---------- in-memory state ----------
  let pendingRetry = null;
  let lastDialogAt = 0;
  let lastDialogText = "";
  let refreshArmed = false;        // prevents double-kick from repeated mutations
  let successWatchTimer = null;

  // ---------- load settings ----------
  try {
    browser.storage?.local?.get([
      "refreshRetryEnabled",
      "refreshRetryMaxAttempts",
      "refreshRetryPageReadyMs",
      "refreshRetryAgentModeWaitMs",
      "refreshRetryCooldownMs",
      "refreshRetrySuccessWatchMs",
      "refreshRetryStaleMs",
    ]).then((p) => {
      if (p.refreshRetryEnabled === false) enabled = false;
      if (typeof p.refreshRetryMaxAttempts === "number") maxAttempts = p.refreshRetryMaxAttempts;
      if (typeof p.refreshRetryPageReadyMs === "number") pageReadyMs = p.refreshRetryPageReadyMs;
      if (typeof p.refreshRetryAgentModeWaitMs === "number") agentModeWaitMs = p.refreshRetryAgentModeWaitMs;
      if (typeof p.refreshRetryCooldownMs === "number") cooldownMs = p.refreshRetryCooldownMs;
      if (typeof p.refreshRetrySuccessWatchMs === "number") successWatchMs = p.refreshRetrySuccessWatchMs;
      if (typeof p.refreshRetryStaleMs === "number") staleMs = p.refreshRetryStaleMs;
    });
  } catch (_) {}

  try {
    browser.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.refreshRetryEnabled) enabled = changes.refreshRetryEnabled.newValue !== false;
      if (changes.refreshRetryMaxAttempts) maxAttempts = Number(changes.refreshRetryMaxAttempts.newValue) || 10;
      if (changes.refreshRetryPageReadyMs) pageReadyMs = Number(changes.refreshRetryPageReadyMs.newValue) || 3000;
      if (changes.refreshRetryAgentModeWaitMs) agentModeWaitMs = Number(changes.refreshRetryAgentModeWaitMs.newValue) || 1000;
      if (changes.refreshRetryCooldownMs) cooldownMs = Number(changes.refreshRetryCooldownMs.newValue) || 3000;
      if (changes.refreshRetrySuccessWatchMs) successWatchMs = Number(changes.refreshRetrySuccessWatchMs.newValue) || 120000;
      if (changes.refreshRetryStaleMs) staleMs = Number(changes.refreshRetryStaleMs.newValue) || 3600000;
    });
  } catch (_) {}

  // ---------- URL helpers ----------
  // "Root" URL means https://chat.z.ai/ (no /c/{uuid} path) — i.e. we're
  // about to start a new chat. On root URL we DO click the Agent mode button
  // after reload. On an active chat URL we DO NOT — clicking Agent would
  // create a brand-new chat, losing the conversation context.
  function isRootUrl() {
    const path = location.pathname || "/";
    return path === "/" || path === "";
  }

  // ---------- DOM helpers ----------
  function getTextarea() {
    return (
      document.getElementById("chat-input") ||
      document.querySelector('textarea[placeholder="Send a Message"]') ||
      document.querySelector("textarea")
    );
  }

  function getTextareaValue() {
    const ta = getTextarea();
    return ta ? (ta.value || "") : "";
  }

  function setTextareaValue(text) {
    const ta = getTextarea();
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    setter.call(ta, text);
    ta.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "x",
      })
    );
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function clickSendButton() {
    const btn = document.getElementById("send-message-button");
    if (btn) {
      btn.click();
      return true;
    }
    // Fallback: submit the form directly (same method as send-utils.js)
    const ta = getTextarea();
    if (ta) {
      const form = ta.closest("form");
      if (form) {
        try {
          form.requestSubmit();
          return true;
        } catch (_) {}
      }
    }
    return false;
  }

  function findAgentModeButton() {
    // Strategy 1: aria-label containing "Agent" (case-insensitive)
    let btn = document.querySelector('[aria-label*="Agent" i]');
    if (btn) return btn;

    // Strategy 2: [role="tab"] whose text is "Agent"
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      const text = (tab.innerText || tab.textContent || "").trim().toLowerCase();
      if (text === "agent" || text.startsWith("agent")) return tab;
    }

    // Strategy 3: any button whose text is exactly "Agent"
    const buttons = document.querySelectorAll("button");
    for (const b of buttons) {
      const text = (b.innerText || b.textContent || "").trim().toLowerCase();
      if (text === "agent") return b;
    }

    // Strategy 4: data-mode="agent"
    btn = document.querySelector('[data-mode="agent"]');
    if (btn) return btn;

    // Strategy 5: title containing "Agent"
    btn = document.querySelector('[title*="Agent" i]');
    if (btn) return btn;

    return null;
  }

  function isButtonActive(btn) {
    if (!btn) return false;
    if (btn.getAttribute("aria-pressed") === "true") return true;
    if (btn.getAttribute("aria-selected") === "true") return true;
    if (btn.getAttribute("aria-current") === "true") return true;
    const cls = (typeof btn.className === "string" ? btn.className : "").toLowerCase();
    if (cls.includes("active") || cls.includes("selected") || cls.includes("current")) return true;
    return false;
  }

  async function switchToAgentMode() {
    const btn = findAgentModeButton();
    if (!btn) {
      console.debug("[zai-enhancer] refresh-retry: no Agent mode button found, skipping switch");
      return false;
    }
    if (isButtonActive(btn)) {
      console.debug("[zai-enhancer] refresh-retry: already in Agent mode");
      return true;
    }
    btn.click();
    console.debug("[zai-enhancer] refresh-retry: clicked Agent mode button");
    return true;
  }

  // ---------- toast helper (uses exposed API if available) ----------
  function showToast({ title, message, icon = "↻", accent = "#7c3aed", durationMs = 5000 }) {
    try {
      if (window.__zaiToast?.show) {
        window.__zaiToast.show({ title, message, icon, accent, durationMs });
      }
    } catch (_) {}
  }

  // ---------- pending retry persistence ----------
  async function savePendingRetry(data) {
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: data });
    } catch (e) {
      console.warn("[zai-enhancer] refresh-retry: failed to save pending retry", e);
    }
  }

  async function loadPendingRetry() {
    try {
      const p = await browser.storage.local.get(STORAGE_KEY);
      return p[STORAGE_KEY] || null;
    } catch (_) {
      return null;
    }
  }

  async function clearPendingRetry() {
    try {
      await browser.storage.local.remove(STORAGE_KEY);
    } catch (_) {}
  }

  // ---------- the core: kick off a refresh-retry cycle ----------
  async function kickoffRefreshRetry(dialog) {
    if (refreshArmed) return; // already about to refresh
    if (!enabled) return;

    // Dedupe: ignore the exact same dialog firing repeatedly within 5s
    const now = Date.now();
    const dialogText = (dialog.innerText || "").trim().slice(0, 200);
    if (now - lastDialogAt < 5000 && dialogText === lastDialogText) {
      return;
    }
    lastDialogAt = now;
    lastDialogText = dialogText;

    // Capture the message text — prefer live textarea value, fall back to
    // the last user message captured by page-hook.js (in case the dialog
    // already wiped the textarea).
    let text = getTextareaValue().trim();
    if (!text && window.__zaiLastUserMessage?.text) {
      text = window.__zaiLastUserMessage.text;
      console.debug("[zai-enhancer] refresh-retry: textarea empty, using last captured user message");
    }
    if (!text) {
      console.warn("[zai-enhancer] refresh-retry: no message text to retry, aborting cycle");
      return;
    }

    // Increment attempts (same message → continuation; new message → reset)
    let attempts = 1;
    let startedAt = now;
    let originalUrl = location.href;
    if (pendingRetry && pendingRetry.text === text) {
      attempts = (pendingRetry.attempts || 0) + 1;
      startedAt = pendingRetry.startedAt || now;
      originalUrl = pendingRetry.originalUrl || location.href;
    }

    if (attempts > maxAttempts) {
      console.warn(
        `[zai-enhancer] refresh-retry: max attempts (${maxAttempts}) reached, giving up`
      );
      showToast({
        title: "Refresh retry gave up",
        message: `Failed after ${maxAttempts} attempts. The model may still be at capacity — try again later.`,
        icon: "✗",
        accent: "#ef4444",
        durationMs: 8000,
      });
      bus?.emit("refresh-retry:giveup", { attempts, reason: "max_attempts" });
      await clearPendingRetry();
      pendingRetry = null;
      return;
    }

    // Persist so it survives the reload
    const data = {
      text,
      attempts,
      startedAt,
      lastAttemptAt: now,
      originalUrl,
    };
    await savePendingRetry(data);
    pendingRetry = data;

    const urlLabel = isRootUrl() ? "root URL — will click Agent after reload" : "active chat — will just resend";
    console.debug(
      `[zai-enhancer] refresh-retry: refreshing page (attempt ${attempts}/${maxAttempts}) [${urlLabel}]`
    );
    showToast({
      title: `Model at capacity — retrying (${attempts}/${maxAttempts})`,
      message: isRootUrl()
        ? "Refreshing page, switching to Agent mode, resending…"
        : "Refreshing chat and resending…",
      icon: "↻",
      accent: "#f59e0b",
      durationMs: 3000,
    });
    bus?.emit("refresh-retry:kicked-off", { attempts, maxAttempts });

    // Arm the refresh — small delay so the toast can render and the storage
    // write can settle before the page unloads.
    refreshArmed = true;
    setTimeout(() => {
      location.reload();
    }, 600);
  }

  // ---------- page load: resume pending retry ----------
  async function onPageLoad() {
    pendingRetry = await loadPendingRetry();
    if (!pendingRetry) return;

    if (!enabled) {
      console.debug("[zai-enhancer] refresh-retry: disabled, clearing pending retry");
      await clearPendingRetry();
      pendingRetry = null;
      return;
    }

    // Drop stale retries (older than staleMs)
    if (Date.now() - (pendingRetry.startedAt || 0) > staleMs) {
      console.warn("[zai-enhancer] refresh-retry: pending retry is stale, dropping");
      await clearPendingRetry();
      pendingRetry = null;
      return;
    }

    if (!pendingRetry.text) {
      console.warn("[zai-enhancer] refresh-retry: pending retry has empty text, dropping");
      await clearPendingRetry();
      pendingRetry = null;
      return;
    }

    console.debug("[zai-enhancer] refresh-retry: resuming pending retry", {
      attempts: pendingRetry.attempts,
      textPreview: pendingRetry.text.slice(0, 80),
      url: location.href,
      isRoot: isRootUrl(),
    });

    showToast({
      title: `Resuming retry (${pendingRetry.attempts}/${maxAttempts})`,
      message: isRootUrl()
        ? "Switching to Agent mode and resending…"
        : "Resending in active chat…",
      icon: "↻",
      accent: "#7c3aed",
      durationMs: 3000,
    });
    bus?.emit("refresh-retry:resumed", { attempts: pendingRetry.attempts });

    // Wait for the page to be ready (textarea exists)
    await waitForPageReady();

    // AGENT MODE FIX:
    // Only click "Agent" mode button if we're at the root URL (https://chat.z.ai/).
    // If we're in an active chat (/c/{uuid}), clicking "Agent" would create a
    // brand-new chat — we want to resend in the EXISTING chat instead.
    if (isRootUrl()) {
      await switchToAgentMode();
      await sleep(agentModeWaitMs);
    } else {
      console.debug(
        "[zai-enhancer] refresh-retry: active chat URL — skipping Agent mode click (would create new chat)"
      );
    }

    // Set textarea value
    const okFill = setTextareaValue(pendingRetry.text);
    if (!okFill) {
      console.warn("[zai-enhancer] refresh-retry: could not find textarea after page ready");
      // Schedule another refresh — maybe the page didn't load properly
      scheduleRecoveryRefresh();
      return;
    }

    // Small delay to let Svelte react before clicking send
    await sleep(150);

    const okSend = clickSendButton();
    if (!okSend) {
      console.warn("[zai-enhancer] refresh-retry: could not find send button");
      scheduleRecoveryRefresh();
      return;
    }

    console.debug("[zai-enhancer] refresh-retry: message resent, watching for outcome");
    bus?.emit("refresh-retry:resent", { attempts: pendingRetry.attempts });

    startSuccessWatch();
  }

  function scheduleRecoveryRefresh() {
    // If we couldn't send the message after page load, try refreshing again
    // after the cooldown — but only if we have a pending retry and attempts
    // haven't been exhausted.
    if (!pendingRetry) return;
    setTimeout(() => {
      if (!pendingRetry) return;
      // Re-trigger the cycle by simulating a dialog detection
      // (this increments attempts and refreshes)
      const fakeDialog = { innerText: "model is currently at capacity" };
      kickoffRefreshRetry(fakeDialog);
    }, cooldownMs);
  }

  function waitForPageReady() {
    return new Promise((resolve) => {
      const start = Date.now();
      function check() {
        if (getTextarea()) {
          // Wait a bit more for the page to fully settle (Svelte hydration,
          // button event listeners, etc.)
          setTimeout(resolve, pageReadyMs);
          return;
        }
        if (Date.now() - start > 30000) {
          console.warn("[zai-enhancer] refresh-retry: timeout waiting for page ready");
          resolve();
          return;
        }
        setTimeout(check, 300);
      }
      check();
    });
  }

  function startSuccessWatch() {
    if (successWatchTimer) clearTimeout(successWatchTimer);
    successWatchTimer = setTimeout(() => {
      console.debug(
        "[zai-enhancer] refresh-retry: success watch timed out — agent:done did not fire within " +
          successWatchMs +
          "ms. Keeping pending retry in case the dialog reappears."
      );
      bus?.emit("refresh-retry:timeout", { attempts: pendingRetry?.attempts });
    }, successWatchMs);
  }

  function clearSuccessWatch() {
    if (successWatchTimer) {
      clearTimeout(successWatchTimer);
      successWatchTimer = null;
    }
  }

  // ---------- success / failure listeners ----------
  bus?.on("agent:done", (evt) => {
    if (!pendingRetry) return;

    if (evt.userStopped) {
      console.debug(
        "[zai-enhancer] refresh-retry: user manually stopped — clearing pending retry"
      );
      clearSuccessWatch();
      clearPendingRetry();
      pendingRetry = null;
      return;
    }

    if (evt.error) {
      console.debug(
        "[zai-enhancer] refresh-retry: agent:done with error — keeping pending retry"
      );
      return;
    }

    // Success!
    console.debug(
      `[zai-enhancer] refresh-retry: message succeeded after ${pendingRetry.attempts} attempt(s)`
    );
    clearSuccessWatch();
    showToast({
      title: "Message sent successfully!",
      message: `Refresh retry succeeded after ${pendingRetry.attempts} attempt(s).`,
      icon: "✓",
      accent: "#10b981",
      durationMs: 4000,
    });
    bus?.emit("refresh-retry:success", { attempts: pendingRetry.attempts });
    clearPendingRetry();
    pendingRetry = null;
  });

  // If the user navigates away from chat.z.ai entirely, drop the pending retry.
  // (URL changes within chat.z.ai, like /c/{uuid} being created, are fine.)
  let lastUrl = location.href;
  window.addEventListener("popstate", handleNavigation);
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    const r = origPushState.apply(this, args);
    setTimeout(handleNavigation, 0);
    return r;
  };
  history.replaceState = function (...args) {
    const r = origReplaceState.apply(this, args);
    setTimeout(handleNavigation, 0);
    return r;
  };
  function handleNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    // Same origin (chat.z.ai) → keep pending retry (could be /c/{uuid} creation)
    if (/^https:\/\/chat\.z\.ai\//.test(location.href)) return;
    // Navigated away from chat.z.ai → drop
    if (pendingRetry) {
      console.debug("[zai-enhancer] refresh-retry: navigated away from chat.z.ai, dropping pending");
      clearSuccessWatch();
      clearPendingRetry();
      pendingRetry = null;
    }
  }

  // ---------- utils ----------
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---------- MutationObserver via shared capacity-common ----------
  cap.setupObserver((dialog) => {
    kickoffRefreshRetry(dialog);
  });

  // Initial scan (in case the dialog is already open when the script loads)
  setTimeout(() => {
    if (!enabled) return;
    const dialog = cap.findCapacityDialog(document);
    if (dialog) kickoffRefreshRetry(dialog);
  }, 0);

  // ---------- boot: check for pending retry on page load ----------
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(onPageLoad, 500);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(onPageLoad, 500));
  }

  // ---------- public API ----------
  window.__zaiRefreshRetry = {
    getPending: () => pendingRetry,
    isEnabled: () => enabled,
    clear: async function () {
      clearSuccessWatch();
      await clearPendingRetry();
      pendingRetry = null;
      console.debug("[zai-enhancer] refresh-retry: pending retry cleared manually");
    },
    triggerNow: function () {
      // Manually kick off a refresh retry (for testing — uses current textarea text)
      kickoffRefreshRetry({ innerText: "model is currently at capacity" });
    },
    scanNow: function () {
      const dialog = cap.findCapacityDialog(document);
      if (dialog) kickoffRefreshRetry(dialog);
      return !!dialog;
    },
  };

  console.debug("[zai-enhancer] refresh-retry ready (refresh + agent-mode-aware resend)");
})();
