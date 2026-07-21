/* popup.js
 * Toolbar popup with i18n + language selector.
 * Uses inline i18n (can't access content script's window.__zaiI18n).
 *
 * Version is pulled dynamically from the extension manifest
 * (browser.runtime.getManifest().version) so the popup never shows a
 * stale hardcoded version string.
 */

const POPUP_I18N = {
  "pt-BR": {
    open_panel: "🚀 Abrir painel no site",
    hint: "Use o botão flutuante no canto direito de chat.z.ai (verticalmente centralizado) — não precisa mais abrir este popup.",
    no_tab: "Abra https://chat.z.ai/ primeiro.",
    opening: "Abrindo chat.z.ai…",
    panel_opened: "Painel aberto no site ✓",
    testing_sound: "Tocando som…",
    testing_toast: "Mostrando toast…",
    sound_on_complete: "Som ao concluir",
    toast_visual: "Toast visual",
    notif_native: "Notificação nativa",
    volume: "Volume",
    test_sound: "🔊 Testar som",
    test_toast: "🔔 Testar toast",
    lang_label: "Idioma"
  },
  "en-US": {
    open_panel: "🚀 Open panel on site",
    hint: "Use the floating button on the right side of chat.z.ai (vertically centered) — no need to open this popup.",
    no_tab: "Open https://chat.z.ai/ first.",
    opening: "Opening chat.z.ai…",
    panel_opened: "Panel opened on site ✓",
    testing_sound: "Playing sound…",
    testing_toast: "Showing toast…",
    sound_on_complete: "Sound on completion",
    toast_visual: "Visual toast",
    notif_native: "Native notification",
    volume: "Volume",
    test_sound: "🔊 Test sound",
    test_toast: "🔔 Test toast",
    lang_label: "Language"
  },
  "zh-CN": {
    open_panel: "🚀 在网站上打开面板",
    hint: "使用 chat.z.ai 右侧的浮动按钮（垂直居中） — 无需打开此弹窗。",
    no_tab: "请先打开 https://chat.z.ai/。",
    opening: "正在打开 chat.z.ai…",
    panel_opened: "面板已在网站上打开 ✓",
    testing_sound: "正在播放声音…",
    testing_toast: "正在显示提示…",
    sound_on_complete: "完成时声音",
    toast_visual: "视觉提示",
    notif_native: "原生通知",
    volume: "音量",
    test_sound: "🔊 测试声音",
    test_toast: "🔔 测试提示",
    lang_label: "语言"
  },
  "es": {
    open_panel: "🚀 Abrir panel en el sitio",
    hint: "Usa el botón flotante en el lado derecho de chat.z.ai (centrado verticalmente) — no necesitas abrir este popup.",
    no_tab: "Abre https://chat.z.ai/ primero.",
    opening: "Abriendo chat.z.ai…",
    panel_opened: "Panel abierto en el sitio ✓",
    testing_sound: "Reproduciendo sonido…",
    testing_toast: "Mostrando toast…",
    sound_on_complete: "Sonido al completar",
    toast_visual: "Toast visual",
    notif_native: "Notificación nativa",
    volume: "Volumen",
    test_sound: "🔊 Probar sonido",
    test_toast: "🔔 Probar toast",
    lang_label: "Idioma"
  }
};

function detectLocale() {
  const nav = (browser.i18n?.getUILanguage?.() || "pt-BR").toLowerCase();
  if (nav.startsWith("pt")) return "pt-BR";
  if (nav.startsWith("en")) return "en-US";
  if (nav.startsWith("zh")) return "zh-CN";
  if (nav.startsWith("es")) return "es";
  return "pt-BR";
}

let currentLocale = detectLocale();
const $ = (id) => document.getElementById(id);

function applyI18n() {
  const msgs = POPUP_I18N[currentLocale] || POPUP_I18N["pt-BR"];
  // Apply to all [data-i18n] elements
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (msgs[key]) el.textContent = msgs[key];
  });
  // Set lang select value
  $("langSelect").value = currentLocale;
}

async function loadSavedLocale() {
  try {
    const p = await browser.storage.local.get(["zai_locale"]);
    if (p.zai_locale && POPUP_I18N[p.zai_locale]) {
      currentLocale = p.zai_locale;
    }
  } catch (_) {}
  applyI18n();
}

const DEFAULTS = {
  soundEnabled: true,
  toastEnabled: true,
  nativeEnabled: true,
  nativeOnlyWhenUnfocused: true,
  soundVolume: 0.6
};

async function loadPrefs() {
  try {
    const p = await browser.storage.local.get(Object.keys(DEFAULTS));
    return { ...DEFAULTS, ...p };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

async function savePref(key, value) {
  try { await browser.storage.local.set({ [key]: value }); } catch (_) {}
}

async function sendToChatTab(message) {
  try {
    const tabs = await browser.tabs.query({ url: "https://chat.z.ai/*" });
    if (!tabs.length) {
      const msgs = POPUP_I18N[currentLocale] || POPUP_I18N["pt-BR"];
      $("status").textContent = msgs.no_tab;
      return false;
    }
    for (const t of tabs) {
      try { await browser.tabs.sendMessage(t.id, message); } catch (_) {}
    }
    return true;
  } catch (_) {
    return false;
  }
}

(async function init() {
  await loadSavedLocale();
  const prefs = await loadPrefs();
  const msgs = POPUP_I18N[currentLocale] || POPUP_I18N["pt-BR"];

  // Inject the version from the manifest (never hardcode it again)
  try {
    const ver = browser.runtime.getManifest().version;
    const verEl = $("version");
    if (verEl && ver) verEl.textContent = `v${ver}`;
  } catch (_) {}

  $("soundEnabled").checked = prefs.soundEnabled;
  $("toastEnabled").checked = prefs.toastEnabled;
  $("nativeEnabled").checked = prefs.nativeEnabled;
  $("soundVolume").value = prefs.soundVolume;

  $("soundEnabled").addEventListener("change", (e) => savePref("soundEnabled", e.target.checked));
  $("toastEnabled").addEventListener("change", (e) => savePref("toastEnabled", e.target.checked));
  $("nativeEnabled").addEventListener("change", (e) => savePref("nativeEnabled", e.target.checked));
  $("soundVolume").addEventListener("change", (e) => savePref("soundVolume", parseFloat(e.target.value)));

  // Language selector
  $("langSelect").addEventListener("change", async (e) => {
    currentLocale = e.target.value;
    try { await browser.storage.local.set({ zai_locale: currentLocale }); } catch (_) {}
    applyI18n();
  });

  $("openPanel").addEventListener("click", async () => {
    const ok = await sendToChatTab({ type: "open-panel" });
    if (!ok) {
      await browser.tabs.create({ url: "https://chat.z.ai/" });
      const msgs2 = POPUP_I18N[currentLocale] || POPUP_I18N["pt-BR"];
      $("status").textContent = msgs2.opening;
    } else {
      const msgs2 = POPUP_I18N[currentLocale] || POPUP_I18N["pt-BR"];
      $("status").textContent = msgs2.panel_opened;
      window.close();
    }
  });

  $("testSound").addEventListener("click", async () => {
    const msgs2 = POPUP_I18N[currentLocale] || POPUP_I18N["pt-BR"];
    $("status").textContent = msgs2.testing_sound;
    await sendToChatTab({ source: "zai-enhancer-ui", type: "test-sound" });
    setTimeout(() => ($("status").textContent = ""), 1500);
  });
  $("testToast").addEventListener("click", async () => {
    const msgs2 = POPUP_I18N[currentLocale] || POPUP_I18N["pt-BR"];
    $("status").textContent = msgs2.testing_toast;
    await sendToChatTab({ source: "zai-enhancer-ui", type: "test-toast" });
    setTimeout(() => ($("status").textContent = ""), 1500);
  });
})();
