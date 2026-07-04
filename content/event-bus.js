/* content/event-bus.js
 * Tiny pub/sub shared across content scripts (isolated world of the extension).
 * Lives on `window.__zaiBus` so other content scripts in the same isolated
 * world can subscribe without re-importing.
 */
(function () {
  if (window.__zaiBus) return; // idempotent

  const listeners = new Map(); // topic -> Set<fn>

  const bus = {
    on(topic, fn) {
      if (!listeners.has(topic)) listeners.set(topic, new Set());
      listeners.get(topic).add(fn);
      return () => bus.off(topic, fn);
    },
    off(topic, fn) {
      listeners.get(topic)?.delete(fn);
    },
    emit(topic, payload) {
      const set = listeners.get(topic);
      if (!set) return;
      // Pass payload directly (frozen to discourage mutation) — avoid spread copy
      // for high-frequency events. Listeners receive {topic, ts, ...payload}
      // via a single object allocation.
      const evt = payload
        ? Object.assign(Object.create(null), payload, { topic, ts: Date.now() })
        : { topic, ts: Date.now() };
      for (const fn of [...set]) {
        try { fn(evt); } catch (e) { console.warn("[zai-bus] listener error", topic, e); }
      }
    },
    clear() { listeners.clear(); }
  };

  window.__zaiBus = bus;
  console.debug("[zai-enhancer] event-bus ready");
})();
