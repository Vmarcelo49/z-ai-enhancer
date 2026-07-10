/* options.js
 * Lives alongside popup.js (loaded after it). Adds the toastAutoDismissMs
 * field binding, the dialog-killer settings, and the retry settings.
 * popup.js already handles the rest of the notification prefs.
 */
const $ = (id) => document.getElementById(id);

(async function () {
  const DEFAULTS = {
    toastAutoDismissMs: 4000,
    dialogKillerEnabled: true,
    dialogKillerMatchMode: "substring",
    dialogKillerRetry: true,
    dialogKillerRetryDelayMs: 4000,
    dialogKillerRetryMaxAttempts: 3,
    dialogKillerRetryWatchWindowMs: 8000,
  };
  let prefs;
  try {
    prefs = { ...DEFAULTS, ...(await browser.storage.local.get(Object.keys(DEFAULTS))) };
  } catch (_) {
    prefs = { ...DEFAULTS };
  }

  // ---------- toast auto-dismiss ----------
  const toastEl = $("toastAutoDismissMs");
  if (toastEl) {
    toastEl.value = Number(prefs.toastAutoDismissMs) || 4000;
    toastEl.addEventListener("change", (e) => {
      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
      browser.storage.local.set({ toastAutoDismissMs: v });
    });
  }

  // ---------- dialog killer (auto-dismiss capacity dialogs) ----------
  const dkEnabled = $("dialogKillerEnabled");
  if (dkEnabled) {
    dkEnabled.checked = prefs.dialogKillerEnabled !== false;
    dkEnabled.addEventListener("change", (e) => {
      browser.storage.local.set({ dialogKillerEnabled: e.target.checked });
    });
  }

  const dkMode = $("dialogKillerMatchMode");
  if (dkMode) {
    dkMode.value = prefs.dialogKillerMatchMode || "substring";
    dkMode.addEventListener("change", (e) => {
      browser.storage.local.set({ dialogKillerMatchMode: e.target.value });
    });
  }

  // ---------- retry settings ----------
  const dkRetry = $("dialogKillerRetry");
  if (dkRetry) {
    dkRetry.checked = prefs.dialogKillerRetry !== false;
    dkRetry.addEventListener("change", (e) => {
      browser.storage.local.set({ dialogKillerRetry: e.target.checked });
    });
  }

  const dkRetryDelay = $("dialogKillerRetryDelayMs");
  if (dkRetryDelay) {
    dkRetryDelay.value = Number(prefs.dialogKillerRetryDelayMs) || 4000;
    dkRetryDelay.addEventListener("change", (e) => {
      const v = Math.max(500, parseInt(e.target.value, 10) || 4000);
      browser.storage.local.set({ dialogKillerRetryDelayMs: v });
    });
  }

  const dkRetryMax = $("dialogKillerRetryMaxAttempts");
  if (dkRetryMax) {
    dkRetryMax.value = Number(prefs.dialogKillerRetryMaxAttempts) || 3;
    dkRetryMax.addEventListener("change", (e) => {
      const v = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 3));
      browser.storage.local.set({ dialogKillerRetryMaxAttempts: v });
    });
  }

  const dkRetryWatch = $("dialogKillerRetryWatchWindowMs");
  if (dkRetryWatch) {
    dkRetryWatch.value = Number(prefs.dialogKillerRetryWatchWindowMs) || 8000;
    dkRetryWatch.addEventListener("change", (e) => {
      const v = Math.max(1000, parseInt(e.target.value, 10) || 8000);
      browser.storage.local.set({ dialogKillerRetryWatchWindowMs: v });
    });
  }
})();
