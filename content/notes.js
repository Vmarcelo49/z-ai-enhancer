/* content/notes.js
 * Simple notes feature — user can write free-form notes that persist
 * across sessions in browser.storage.local.
 *
 * Storage key: notes_content (string, default "")
 *
 * Public API on window.__zaiNotes:
 *   get(), set(text), clear()
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) { console.warn("[zai-enhancer] notes: no bus"); return; }

  const STORAGE_KEY = "notes_content";
  let content = "";
  let saveTimer = null;

  async function load() {
    try {
      const p = await browser.storage.local.get(STORAGE_KEY);
      content = p[STORAGE_KEY] || "";
    } catch (_) {}
    bus.emit("notes:loaded", { content });
  }

  async function save() {
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: content });
    } catch (_) {}
    bus.emit("notes:saved", { content, ts: Date.now() });
  }

  // Debounced save — don't write to storage on every keystroke
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, 500);
  }

  window.__zaiNotes = {
    get: () => content,

    set(text) {
      content = String(text || "");
      scheduleSave();
    },

    async clear() {
      content = "";
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await save();
    }
  };

  // Live update from other contexts (e.g. multiple tabs)
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes[STORAGE_KEY]) return;
      const newContent = changes[STORAGE_KEY].newValue || "";
      if (newContent !== content) {
        content = newContent;
        bus.emit("notes:loaded", { content });
      }
    });
  } catch (_) {}

  load();
  console.debug("[zai-enhancer] notes ready");
})();
