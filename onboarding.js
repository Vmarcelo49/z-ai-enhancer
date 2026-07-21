/* onboarding.js
 * i18n + language selector for the onboarding/welcome page.
 * Loaded as external script (CSP-compliant — no inline scripts).
 */
(function () {
  function detectLocale() {
    const nav = (navigator.language || "pt-BR").toLowerCase();
    if (nav.startsWith("pt")) return "pt-BR";
    if (nav.startsWith("en")) return "en-US";
    if (nav.startsWith("zh")) return "zh-CN";
    if (nav.startsWith("es")) return "es";
    return "pt-BR";
  }

  let currentLocale = detectLocale();

  function applyI18n() {
    const i18n = window.__zaiI18n;
    if (!i18n) return;
    // Apply translations to all [data-i18n] elements
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      el.textContent = i18n.t(key);
    });
    // Update lang select
    const sel = document.getElementById("langSelect");
    if (sel) sel.value = i18n.getLocale();
    document.documentElement.lang = i18n.getLocale();
  }

  // Language selector
  document.getElementById("langSelect").addEventListener("change", async (e) => {
    currentLocale = e.target.value;
    try { await browser.storage.local.set({ zai_locale: currentLocale }); } catch (_) {}
    location.reload();
  });

  // On load: check storage for saved locale, then load i18n.js and apply
  browser.storage.local.get(["zai_locale"]).then((p) => {
    if (p.zai_locale) currentLocale = p.zai_locale;

    // Inject the version from the manifest (never hardcode it again)
    try {
      const ver = browser.runtime.getManifest().version;
      const verEl = document.getElementById("version");
      if (verEl && ver) verEl.textContent = `v${ver}`;
    } catch (_) {}

    // Load i18n.js as a script tag to get access to window.__zaiI18n
    const script = document.createElement("script");
    script.src = browser.runtime.getURL("content/i18n.js");
    script.onload = () => {
      const i18n = window.__zaiI18n;
      if (!i18n) return;
      if (p.zai_locale) i18n.setLocale(p.zai_locale);
      applyI18n();
    };
    document.head.appendChild(script);
  });
})();
