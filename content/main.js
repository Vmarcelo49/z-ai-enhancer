/* content/main.js
 * Boot orchestrator. Injects page-hook.js into the MAIN world so it can
 * override window.fetch on the page side, then wires the bus events to the
 * background script (for native Firefox notifications).
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) { console.warn("[zai-enhancer] no bus"); return; }

  // ---------- 1. inject page-hook into MAIN world ----------
  function injectPageHook() {
    if (document.getElementById("zai-enhancer-page-hook")) return;
    const s = document.createElement("script");
    s.id = "zai-enhancer-page-hook";
    s.src = browser.runtime.getURL("content/page-hook.js");
    s.async = false;
    s.onload = function () {
      // Remove the node after exec — the hook already installed itself.
      s.remove();
    };
    (document.head || document.documentElement).appendChild(s);
  }
  injectPageHook();
  // Re-inject after full page load in case SPAs replace head/scripts
  document.addEventListener("DOMContentLoaded", injectPageHook, { once: true });

  // ---------- 2. forward events to background (for native notifications) ----------
  let nativeEnabled = true;
  let lastNotificationAt = 0;

  try {
    browser.storage?.local?.get(["nativeEnabled"]).then((p) => {
      if (p.nativeEnabled === false) nativeEnabled = false;
    });
  } catch (_) {}
  try {
    browser.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.nativeEnabled) nativeEnabled = changes.nativeEnabled.newValue !== false;
    });
  } catch (_) {}

  bus.on("agent:done", (evt) => {
    if (!nativeEnabled) return;
    // Throttle: don't fire more than 1 native notification per 1.5s
    const now = Date.now();
    if (now - lastNotificationAt < 1500) return;
    lastNotificationAt = now;
    try {
      browser.runtime.sendMessage({
        type: "agent-done",
        userStopped: !!evt.userStopped,
        durationMs: evt.durationMs || 0,
        textLen: evt.textLen || 0
      }).catch(() => {}); // background may be asleep — ignore
    } catch (_) {}
  });

  // ---------- 3. health log ----------
  console.debug("[zai-enhancer] main boot complete @", location.href);

  // ---------- 4. listen for messages from popup (test buttons / open panel) ----------
  try {
    browser.runtime.onMessage.addListener((msg, sender) => {
      if (!msg) return;
      // UI test messages (from popup "Testar som" / "Testar toast" buttons)
      if (msg.source === "zai-enhancer-ui") {
        window.postMessage(
          { source: "zai-enhancer-ui", type: msg.type },
          location.origin
        );
        return Promise.resolve({ ok: true });
      }
      // Open panel command (from popup "Abrir painel no site" button or keyboard shortcut)
      if (msg.type === "open-panel") {
        window.dispatchEvent(new CustomEvent("zai-enhancer:open-panel"));
        return Promise.resolve({ ok: true });
      }
      // Click the Stop button if visible (from keyboard shortcut Alt+Shift+X)
      if (msg.type === "click-stop") {
        const stop = document.querySelector('[aria-label="Stop"]');
        if (stop) {
          stop.click();
          return Promise.resolve({ ok: true, clicked: true });
        }
        return Promise.resolve({ ok: true, clicked: false });
      }
    });
  } catch (_) {}
})();
