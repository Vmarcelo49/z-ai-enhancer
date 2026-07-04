/* content/stats.js
 * Tiny stats collector — keeps last 50 agent:done events in storage.local.
 * Exposed on window.__zaiStats.getRecent().
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) return;

  const STORAGE_KEY = "stats_history";
  const MAX = 50;
  let cache = [];

  async function load() {
    try {
      const p = await browser.storage.local.get(STORAGE_KEY);
      cache = p[STORAGE_KEY] || [];
    } catch (_) {}
  }

  async function push(entry) {
    cache.push(entry);
    if (cache.length > MAX) cache = cache.slice(-MAX);
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: cache });
    } catch (_) {}
  }

  bus.on("agent:done", (evt) => {
    push({
      ts: evt.endedAt || Date.now(),
      durationMs: evt.durationMs || 0,
      textLen: evt.textLen || 0,
      userStopped: !!evt.userStopped,
      url: evt.url || null
    });
  });

  window.__zaiStats = {
    getRecent: () => [...cache],
    clear: async () => {
      cache = [];
      try { await browser.storage.local.set({ [STORAGE_KEY]: [] }); } catch (_) {}
    }
  };

  load();
  console.debug("[zai-enhancer] stats ready");
})();
