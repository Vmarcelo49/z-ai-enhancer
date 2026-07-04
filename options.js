/* options.js
 * Lives alongside popup.js (loaded after it). Adds the toastAutoDismissMs
 * field binding. popup.js already handles the rest.
 */
const $ = (id) => document.getElementById(id);

(async function () {
  const DEFAULTS = { toastAutoDismissMs: 4000 };
  let prefs;
  try {
    prefs = { ...DEFAULTS, ...(await browser.storage.local.get(Object.keys(DEFAULTS))) };
  } catch (_) {
    prefs = { ...DEFAULTS };
  }

  const el = $("toastAutoDismissMs");
  if (el) {
    el.value = Number(prefs.toastAutoDismissMs) || 4000;
    el.addEventListener("change", (e) => {
      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
      browser.storage.local.set({ toastAutoDismissMs: v });
    });
  }
})();
