/* popup.js — v0.3.0
 * Simplified: primary UI is now the in-page panel on chat.z.ai.
 * This popup is just a quick-toggle shortcut + "open panel" launcher.
 */
const DEFAULTS = {
  soundEnabled: true,
  toastEnabled: true,
  nativeEnabled: true,
  nativeOnlyWhenUnfocused: true,
  soundVolume: 0.6
};

const $ = (id) => document.getElementById(id);

// ---------- i18n ----------
const POPUP_I18N = {
  "pt-BR": {
    open_panel: "🚀 Abrir painel no site",
    hint: "Use o botão flutuante no canto inferior direito de chat.z.ai — não precisa mais abrir este popup.",
    no_tab: "Abra https://chat.z.ai/ primeiro.",
    opening: "Abrindo chat.z.ai…",
    panel_opened: "Painel aberto no site ✓",
    testing_sound: "Tocando som…",
    testing_toast: "Mostrando toast…",
    sound_on_complete: "Som ao concluir",
    toast_visual: "Toast visual",
    notif_native: "Notificação nativa",
    volume: "Volume"
  },
  "en-US": {
    open_panel: "🚀 Open panel on site",
    hint: "Use the floating button in the bottom-right of chat.z.ai — no need to open this popup.",
    no_tab: "Open https://chat.z.ai/ first.",
    opening: "Opening chat.z.ai…",
    panel_opened: "Panel opened on site ✓",
    testing_sound: "Playing sound…",
    testing_toast: "Showing toast…",
    sound_on_complete: "Sound on completion",
    toast_visual: "Visual toast",
    notif_native: "Native notification",
    volume: "Volume"
  },
  "zh-CN": {
    open_panel: "🚀 在网站上打开面板",
    hint: "使用 chat.z.ai 右下角的浮动按钮 — 无需打开此弹窗。",
    no_tab: "请先打开 https://chat.z.ai/。",
    opening: "正在打开 chat.z.ai…",
    panel_opened: "面板已在网站上打开 ✓",
    testing_sound: "正在播放声音…",
    testing_toast: "正在显示提示…",
    sound_on_complete: "完成时声音",
    toast_visual: "视觉提示",
    notif_native: "原生通知",
    volume: "音量"
  },
  "es": {
    open_panel: "🚀 Abrir panel en el sitio",
    hint: "Usa el botón flotante en la esquina inferior derecha de chat.z.ai — no necesitas abrir este popup.",
    no_tab: "Abre https://chat.z.ai/ primero.",
    opening: "Abriendo chat.z.ai…",
    panel_opened: "Panel abierto en el sitio ✓",
    testing_sound: "Reproduciendo sonido…",
    testing_toast: "Mostrando toast…",
    sound_on_complete: "Sonido al completar",
    toast_visual: "Toast visual",
    notif_native: "Notificación nativa",
    volume: "Volumen"
  }
};

function getPopupI18n() {
  const uiLang = (browser.i18n?.getUILanguage?.() || "pt-BR").toLowerCase();
  let locale = "pt-BR";
  if (uiLang.startsWith("en")) locale = "en-US";
  else if (uiLang.startsWith("zh")) locale = "zh-CN";
  else if (uiLang.startsWith("es")) locale = "es";
  return POPUP_I18N[locale] || POPUP_I18N["pt-BR"];
}
const pti18n = getPopupI18n();

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
      $("status").textContent = pti18n.no_tab;
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
  const prefs = await loadPrefs();

  $("soundEnabled").checked = prefs.soundEnabled;
  $("toastEnabled").checked = prefs.toastEnabled;
  $("nativeEnabled").checked = prefs.nativeEnabled;
  $("soundVolume").value = prefs.soundVolume;

  $("soundEnabled").addEventListener("change", (e) => savePref("soundEnabled", e.target.checked));
  $("toastEnabled").addEventListener("change", (e) => savePref("toastEnabled", e.target.checked));
  $("nativeEnabled").addEventListener("change", (e) => savePref("nativeEnabled", e.target.checked));
  $("soundVolume").addEventListener("change", (e) => savePref("soundVolume", parseFloat(e.target.value)));

  $("openPanel").addEventListener("click", async () => {
    const ok = await sendToChatTab({ type: "open-panel" });
    if (!ok) {
      // No chat.z.ai tab — open one
      await browser.tabs.create({ url: "https://chat.z.ai/" });
      $("status").textContent = pti18n.opening;
    } else {
      $("status").textContent = pti18n.panel_opened;
      window.close();
    }
  });

  $("testSound").addEventListener("click", async () => {
    $("status").textContent = pti18n.testing_sound;
    await sendToChatTab({ source: "zai-enhancer-ui", type: "test-sound" });
    setTimeout(() => ($("status").textContent = ""), 1500);
  });
  $("testToast").addEventListener("click", async () => {
    $("status").textContent = pti18n.testing_toast;
    await sendToChatTab({ source: "zai-enhancer-ui", type: "test-toast" });
    setTimeout(() => ($("status").textContent = ""), 1500);
  });
})();
