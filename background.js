/* background.js
 * Firefox MV3 background event page.
 *
 * Responsibilities:
 *   1. Receive "agent-done" from content script → fire native OS notification
 *   2. Handle keyboard commands (open-panel, toggle-sound, trigger-stop)
 *   3. Open onboarding page on first install
 */

const DEFAULT_ICON = browser.runtime.getURL("icons/icon-96.png");

// ---------- i18n (inline, since background can't access content script's window.__zaiI18n) ----------
const BG_I18N = {
  "pt-BR": {
    done_title: "Z.ai — resposta concluída",
    stopped_title: "Z.ai — agente interrompido",
    stopped_msg: "Você parou a geração manualmente.",
    error_title: "Z.ai — erro no stream",
    error_msg: "A resposta falhou — verifique o console.",
    done_default: "O agente terminou de responder.",
    sound_toggle: "Som ao concluir: {state}",
    sound_on: "ON",
    sound_off: "OFF"
  },
  "en-US": {
    done_title: "Z.ai — response complete",
    stopped_title: "Z.ai — agent interrupted",
    stopped_msg: "You stopped generation manually.",
    error_title: "Z.ai — stream error",
    error_msg: "The response failed — check the console.",
    done_default: "The agent finished responding.",
    sound_toggle: "Completion sound: {state}",
    sound_on: "ON",
    sound_off: "OFF"
  },
  "zh-CN": {
    done_title: "Z.ai — 回复完成",
    stopped_title: "Z.ai — 代理已中断",
    stopped_msg: "您手动停止了生成。",
    error_title: "Z.ai — 流式传输错误",
    error_msg: "响应失败 — 请查看控制台。",
    done_default: "代理已完成回复。",
    sound_toggle: "完成声音：{state}",
    sound_on: "开",
    sound_off: "关"
  },
  "es": {
    done_title: "Z.ai — respuesta completada",
    stopped_title: "Z.ai — agente interrumpido",
    stopped_msg: "Detuviste la generación manualmente.",
    error_title: "Z.ai — error en el stream",
    error_msg: "La respuesta falló — revisa la consola.",
    done_default: "El agente terminó de responder.",
    sound_toggle: "Sonido de completado: {state}",
    sound_on: "ON",
    sound_off: "OFF"
  }
};

function getI18nMessages() {
  const uiLang = (browser.i18n?.getUILanguage?.() || "pt-BR").toLowerCase();
  let locale = "pt-BR";
  if (uiLang.startsWith("en")) locale = "en-US";
  else if (uiLang.startsWith("zh")) locale = "zh-CN";
  else if (uiLang.startsWith("es")) locale = "es";
  return BG_I18N[locale] || BG_I18N["pt-BR"];
}

// ---------- install / update lifecycle ----------
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // Open onboarding page on first install
    try {
      await browser.tabs.create({ url: browser.runtime.getURL("onboarding.html") });
    } catch (_) {}
  }
});

// ---------- native notification on agent-done ----------
async function getPrefs() {
  try {
    const p = await browser.storage.local.get([
      "nativeEnabled",
      "nativeOnlyWhenUnfocused"
    ]);
    return {
      nativeEnabled: p.nativeEnabled !== false,
      nativeOnlyWhenUnfocused: p.nativeOnlyWhenUnfocused !== false
    };
  } catch (_) {
    return { nativeEnabled: true, nativeOnlyWhenUnfocused: true };
  }
}

async function isChatTabFocused() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return false;
    const t = tabs[0];
    if (!t.url || !t.url.startsWith("https://chat.z.ai/")) return false;
    return !!t.active;
  } catch (_) {
    return false;
  }
}

async function notifyDone({ userStopped, error, durationMs, textLen }) {
  const prefs = await getPrefs();
  if (!prefs.nativeEnabled) return;
  if (prefs.nativeOnlyWhenUnfocused) {
    const focused = await isChatTabFocused();
    if (focused) return;
  }

  const msgs = getI18nMessages();
  let title, message;
  if (userStopped) {
    title = msgs.stopped_title;
    message = msgs.stopped_msg;
  } else if (error) {
    title = msgs.error_title;
    message = msgs.error_msg;
  } else {
    title = msgs.done_title;
    const parts = [];
    if (textLen) parts.push(`${textLen.toLocaleString()} chars`);
    if (durationMs) {
      const s = Math.round(durationMs / 1000);
      parts.push(s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
    }
    message = parts.length ? parts.join(" · ") : msgs.done_default;
  }

  try {
    await browser.notifications.create({
      type: "basic",
      iconUrl: DEFAULT_ICON,
      title,
      message,
      priority: 2
    });
  } catch (e) {
    console.warn("[zai-enhancer] notification failed", e);
  }
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "agent-done") return;
  notifyDone({
    userStopped: msg.userStopped,
    error: msg.error,
    durationMs: msg.durationMs,
    textLen: msg.textLen
  });
  return Promise.resolve({ ok: true });
});

// Clicking the notification focuses the chat tab
browser.notifications.onClicked.addListener(async (notifId) => {
  try {
    const tabs = await browser.tabs.query({ url: "https://chat.z.ai/*" });
    if (tabs.length) {
      const t = tabs[0];
      await browser.tabs.update(t.id, { active: true });
      await browser.windows.update(t.windowId, { focused: true });
    }
  } catch (_) {}
  browser.notifications.clear(notifId);
});

// ---------- keyboard commands ----------
async function findChatTab() {
  try {
    const tabs = await browser.tabs.query({ url: "https://chat.z.ai/*" });
    return tabs[0] || null;
  } catch (_) {
    return null;
  }
}

browser.commands.onCommand.addListener(async (command) => {
  if (command === "open-panel") {
    const tab = await findChatTab();
    if (!tab) {
      // No chat.z.ai tab — open one
      try { await browser.tabs.create({ url: "https://chat.z.ai/" }); } catch (_) {}
      return;
    }
    try {
      await browser.tabs.sendMessage(tab.id, { type: "open-panel" });
    } catch (_) {}
  } else if (command === "toggle-sound") {
    // Toggle soundEnabled in storage.local
    try {
      const p = await browser.storage.local.get("soundEnabled");
      const next = p.soundEnabled === false; // default true
      await browser.storage.local.set({ soundEnabled: next });
      // Send a small notification so the user knows what changed
      try {
        await browser.notifications.create({
          type: "basic",
          iconUrl: DEFAULT_ICON,
          title: "Z.ai Enhancer",
          message: getI18nMessages().sound_toggle.replace("{state}", next ? getI18nMessages().sound_on : getI18nMessages().sound_off)
        });
      } catch (_) {}
    } catch (_) {}
  } else if (command === "trigger-stop") {
    // Ask content script to click the Stop button if visible
    const tab = await findChatTab();
    if (!tab) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: "click-stop" });
    } catch (_) {}
  }
});

console.debug("[zai-enhancer] background event page ready");
