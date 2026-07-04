/* content/sound.js
 * Synthesized chime via WebAudio — no asset files needed.
 * Plays a soft ascending arpeggio (A5 → C#6 → E6) on agent:done.
 *
 * AudioContext is created lazily and resumed on first user gesture
 * (Firefox blocks autoplay until interaction).
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) return;

  let ctx = null;
  let enabled = true;
  let volume = 0.6;

  // Load prefs
  try {
    browser.storage?.local?.get(["soundEnabled", "soundVolume"]).then((p) => {
      if (p.soundEnabled === false) enabled = false;
      if (typeof p.soundVolume === "number") volume = Math.max(0, Math.min(1, p.soundVolume));
    });
  } catch (_) {}

  // Listen for pref changes live
  try {
    browser.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.soundEnabled) enabled = changes.soundEnabled.newValue !== false;
      if (changes.soundVolume) volume = Math.max(0, Math.min(1, changes.soundVolume.newValue));
    });
  } catch (_) {}

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    // Resume if suspended (Firefox autoplay policy — requires user gesture,
    // but agent:done only fires after user has interacted with the page to send a message)
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function playChime() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    // Major triad arpeggio: A5, C#6, E6
    const notes = [880.0, 1108.73, 1318.51];
    const stepDelay = 0.09;
    const dur = 0.55;
    notes.forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * stepDelay;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume * 0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
    // Soft sub-bass thump at the start for "completion" feel
    const sub = c.createOscillator();
    const subGain = c.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(220, now);
    sub.frequency.exponentialRampToValueAtTime(110, now + 0.18);
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(volume * 0.18, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    sub.connect(subGain).connect(c.destination);
    sub.start(now);
    sub.stop(now + 0.3);
  }

  // Also a tiny "start" tick (optional, off by default)
  function playStartTick() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume * 0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  bus.on("agent:done", (evt) => {
    // Skip the chime if the user manually stopped the agent
    if (evt.userStopped) return;
    playChime();
  });
  bus.on("agent:start", () => {
    // Disabled by default to avoid noise; flip via storage if desired
    // playStartTick();
  });

  // Test endpoint (used by popup/options "Test sound" button)
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    if (ev.data?.source === "zai-enhancer-ui" && ev.data?.type === "test-sound") {
      playChime();
    }
  });

  console.debug("[zai-enhancer] sound module ready");
})();
