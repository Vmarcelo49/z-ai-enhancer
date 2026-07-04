/* content/toast.js
 * In-page toast shown on agent:done (and agent:stop-button).
 * Lives inside the page DOM (isolated-world script can write to DOM).
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) return;
  const t = window.__zaiI18n.t;

  let host = null;
  let enabled = true;
  let autoDismissMs = 4000;

  try {
    browser.storage?.local?.get(["toastEnabled", "toastAutoDismissMs"]).then((p) => {
      if (p.toastEnabled === false) enabled = false;
      if (typeof p.toastAutoDismissMs === "number") autoDismissMs = p.toastAutoDismissMs;
    });
  } catch (_) {}
  try {
    browser.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.toastEnabled) enabled = changes.toastEnabled.newValue !== false;
      if (changes.toastAutoDismissMs) autoDismissMs = Number(changes.toastAutoDismissMs.newValue) || 4000;
    });
  } catch (_) {}

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement("div");
    host.id = "zai-enhancer-toast-host";
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function show({ title, message, icon: iconChar = "✓", accent = "#7c3aed", durationMs }) {
    if (!enabled) return;
    const h = ensureHost();
    const el = document.createElement("div");
    el.className = "zai-toast";
    el.style.borderLeftColor = accent;

    const iconEl = document.createElement("div");
    iconEl.className = "zai-toast__icon";
    iconEl.style.background = accent;
    iconEl.textContent = iconChar;

    const body = document.createElement("div");
    body.className = "zai-toast__body";

    const titleEl = document.createElement("p");
    titleEl.className = "zai-toast__title";
    titleEl.textContent = title;

    const msgEl = document.createElement("p");
    msgEl.className = "zai-toast__msg";
    msgEl.textContent = message;

    body.appendChild(titleEl);
    body.appendChild(msgEl);

    const close = document.createElement("button");
    close.className = "zai-toast__close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";

    el.appendChild(iconEl);
    el.appendChild(body);
    el.appendChild(close);
    h.appendChild(el);
    // Trigger enter animation
    requestAnimationFrame(() => el.classList.add("visible"));

    const dismiss = () => {
      el.classList.remove("visible");
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector(".zai-toast__close").addEventListener("click", dismiss);
    if (durationMs !== 0) {
      setTimeout(dismiss, durationMs ?? autoDismissMs);
    }
    return el;
  }

  function fmtDuration(ms) {
    if (!ms || ms < 0) return "";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  bus.on("agent:done", (evt) => {
    if (evt.userStopped) {
      show({
        title: t("toast.stopped_title"),
        message: t("toast.stopped_msg"),
        icon: "■",
        accent: "#ef4444",
        durationMs: 3000
      });
      return;
    }
    const dur = fmtDuration(evt.durationMs);
    const parts = [];
    if (evt.textLen) parts.push(`${evt.textLen.toLocaleString()} chars`);
    if (dur) parts.push(dur);
    show({
      title: t("toast.done_title"),
      message: parts.length ? parts.join(" · ") : t("toast.done_default"),
      icon: "✓",
      accent: "#10b981"
    });
  });

  bus.on("agent:start", () => {
    // Subtle "started" pill — only if user opted in (off by default)
    // Disabled for v1 to keep things quiet.
  });

  // Test endpoint (popup/options "Test toast")
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    if (ev.data?.source === "zai-enhancer-ui" && ev.data?.type === "test-toast") {
      show({
        title: t("toast.done_title"),
        message: t("toast.test_msg"),
        icon: "✓",
        accent: "#10b981",
        durationMs: 3000
      });
    }
  });

  console.debug("[zai-enhancer] toast module ready");
})();
