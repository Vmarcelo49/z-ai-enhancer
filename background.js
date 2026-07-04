/* background.js
 * Firefox MV3 background event page.
 *
 * Responsibilities:
 *   1. Receive "agent-done" from content script → fire native OS notification
 *   2. Handle keyboard commands (open-panel, toggle-sound, trigger-stop)
 *   3. Open onboarding page on first install
 */

const DEFAULT_ICON = browser.runtime.getURL("icons/icon-96.png");

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

async function notifyDone({ userStopped, durationMs, textLen }) {
  const prefs = await getPrefs();
  if (!prefs.nativeEnabled) return;
  if (prefs.nativeOnlyWhenUnfocused) {
    const focused = await isChatTabFocused();
    if (focused) return;
  }

  const title = userStopped ? "Z.ai — agent interrupted" : "Z.ai — response complete";
  const parts = [];
  if (textLen) parts.push(`${textLen.toLocaleString()} chars`);
  if (durationMs) {
    const s = Math.round(durationMs / 1000);
    parts.push(s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
  }
  const message = userStopped
    ? "You stopped generation manually."
    : (parts.length ? parts.join(" · ") : "The agent finished responding.");

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
          message: `Completion sound: ${next ? "ON" : "OFF"}`
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
