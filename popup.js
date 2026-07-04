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
      $("status").textContent = "Abra https://chat.z.ai/ primeiro.";
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
      $("status").textContent = "Abrindo chat.z.ai…";
    } else {
      $("status").textContent = "Painel aberto no site ✓";
      window.close();
    }
  });

  $("testSound").addEventListener("click", async () => {
    $("status").textContent = "Tocando som…";
    await sendToChatTab({ source: "zai-enhancer-ui", type: "test-sound" });
    setTimeout(() => ($("status").textContent = ""), 1500);
  });
  $("testToast").addEventListener("click", async () => {
    $("status").textContent = "Mostrando toast…";
    await sendToChatTab({ source: "zai-enhancer-ui", type: "test-toast" });
    setTimeout(() => ($("status").textContent = ""), 1500);
  });
})();
