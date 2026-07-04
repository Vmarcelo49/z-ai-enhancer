/* content/prompts.js
 * Prompt library — collection of reusable prompts.
 * Stored in browser.storage.local as:
 *   prompts_library = {
 *     items: [
 *       { id, title, body, category?, tags?: [], createdAt, updatedAt, usedCount }
 *     ],
 *     nextId: 1
 *   }
 *
 * A prompt "body" supports variables in {{mustache}} format that are
 * interpolated at apply time:
 *   "Traduza {{text}} para {{lang}}"
 * At apply time, the panel.js will open a small prompt form to fill the vars.
 *
 * Public API on window.__zaiPrompts:
 *   getAll(), get(id), add({title, body, category}), update(id, patch),
 *   remove(id), incrementUse(id), importText(blob), importMarkdown(md),
 *   exportMarkdown(), clearAll(), applyToChat(id)
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) { console.warn("[zai-enhancer] prompts: no bus"); return; }
  const t = window.__zaiI18n.t;

  const STORAGE_KEY = "prompts_library";
  const DEFAULTS = { items: [], nextId: 1 };

  let state = { ...DEFAULTS };

  async function load() {
    try {
      const p = await browser.storage.local.get(STORAGE_KEY);
      state = { ...DEFAULTS, ...(p[STORAGE_KEY] || {}) };
    } catch (_) {}
    // Seed with a few useful defaults on first run
    if (state.items.length === 0 && state.nextId === 1) {
      seedDefaults();
    }
    emitChange();
  }

  async function save() {
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: state });
    } catch (_) {}
    emitChange();
  }

  function emitChange() {
    // v0.11.0: emit signal only (no payload) — panel calls getAll() to fetch
    // current state. Avoids cloning large state objects on every operation.
    bus.emit("prompts:changed");
  }

  function uid() {
    return String(state.nextId++);
  }

  function now() { return Date.now(); }

  function seedDefaults() {
    const defaults = [
      {
        id: uid(),
        title: t("prompt.default.explain_5"),
        body: t("prompt.default.explain_5_body"),
        category: "Aprendizado",
        tags: ["explicar", "simples"],
        createdAt: now(),
        updatedAt: now(),
        usedCount: 0
      },
      {
        id: uid(),
        title: t("prompt.default.review_code"),
        body: t("prompt.default.review_code_body"),
        category: "Dev",
        tags: ["código", "review"],
        createdAt: now(),
        updatedAt: now(),
        usedCount: 0
      },
      {
        id: uid(),
        title: t("prompt.default.summarize"),
        body: t("prompt.default.summarize_body"),
        category: "Produtividade",
        tags: ["resumo", "bullets"],
        createdAt: now(),
        updatedAt: now(),
        usedCount: 0
      },
      {
        id: uid(),
        title: t("prompt.default.translate"),
        body: t("prompt.default.translate_body"),
        category: "Idiomas",
        tags: ["tradução", "inglês"],
        createdAt: now(),
        updatedAt: now(),
        usedCount: 0
      }
    ];
    state.items = defaults;
  }

  // ---------- variable extraction ----------
  function extractVars(body) {
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    const vars = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(body)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        vars.push(m[1]);
      }
    }
    return vars;
  }

  function interpolate(body, values) {
    return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, name) => {
      const v = values?.[name];
      if (v === undefined || v === null || v === "") return full; // leave placeholder
      return String(v);
    });
  }

  // ---------- send to chat (shared utility) ----------
  async function sendToChat(text) {
    if (!window.__zaiSend) return { ok: false, reason: "no_send_utils" };
    return window.__zaiSend.sendMessage(text);
  }

  // ---------- public API ----------
  window.__zaiPrompts = {
    getState: () => ({ ...state }),

    getAll: () => [...state.items],

    get: (id) => state.items.find((p) => p.id === String(id)) || null,

    async add({ title, body, category = "Geral", tags = [] }) {
      title = String(title || "").trim();
      body = String(body || "");
      if (!title) return { ok: false, reason: "no_title" };
      if (!body.trim()) return { ok: false, reason: "no_body" };
      const item = {
        id: uid(),
        title,
        body,
        category,
        tags: tags.map(String),
        createdAt: now(),
        updatedAt: now(),
        usedCount: 0
      };
      state.items.push(item);
      await save();
      return { ok: true, id: item.id };
    },

    async update(id, patch) {
      const idx = state.items.findIndex((p) => p.id === String(id));
      if (idx === -1) return { ok: false, reason: "not_found" };
      const cur = state.items[idx];
      const next = {
        ...cur,
        ...patch,
        id: cur.id, // never change id
        updatedAt: now()
      };
      if (patch.tags) next.tags = patch.tags.map(String);
      state.items[idx] = next;
      await save();
      return { ok: true };
    },

    async remove(id) {
      const before = state.items.length;
      state.items = state.items.filter((p) => p.id !== String(id));
      if (state.items.length !== before) {
        await save();
        return { ok: true };
      }
      return { ok: false, reason: "not_found" };
    },

    async incrementUse(id) {
      const idx = state.items.findIndex((p) => p.id === String(id));
      if (idx === -1) return;
      state.items[idx].usedCount = (state.items[idx].usedCount || 0) + 1;
      await save();
    },

    async clearAll() {
      state.items = [];
      state.nextId = 1;
      await save();
    },

    extractVars,
    interpolate,

    // ---------- apply (send) a prompt ----------
    async applyToChat(id, varValues = {}) {
      const p = this.get(id);
      if (!p) return { ok: false, reason: "not_found" };
      const vars = extractVars(p.body);
      // If body has unfilled vars, return them so caller (UI) can prompt user
      const missing = vars.filter((v) => varValues[v] === undefined || varValues[v] === "");
      if (missing.length) {
        return { ok: false, reason: "missing_vars", missing, vars };
      }
      const finalText = interpolate(p.body, varValues);
      const r = await sendToChat(finalText);
      if (r.ok) {
        await this.incrementUse(id);
        bus.emit("prompt:sent", { id, ts: Date.now() });
      } else {
        bus.emit("prompt:error", { id, reason: r.reason, ts: Date.now() });
      }
      return r;
    },

    // ---------- import / export ----------
    // Plain text: split by lines that are only "---" or "===" separators.
    // Optional: first line of each block becomes title if prefixed with "# "
    async importText(blob) {
      const text = String(blob || "");
      const blocks = text
        .split(/^\s*(?:---|===)\s*$/m)
        .map((s) => s.replace(/^\s+|\s+$/g, ""))
        .filter(Boolean);
      let added = 0;
      for (const b of blocks) {
        let title, body;
        const m = b.match(/^#\s+(.+?)\n+([\s\S]*)$/);
        if (m) {
          title = m[1].trim();
          body = m[2];
        } else {
          // Use first line as title
          const lines = b.split("\n");
          title = lines[0].slice(0, 60);
          body = b;
        }
        const r = await this.add({ title, body, category: "Importado" });
        if (r.ok) added++;
      }
      return { ok: true, added, total: state.items.length };
    },

    // Markdown: each "# Heading" starts a new prompt; body until next heading.
    // Front-matter (--- at top) is supported as: title / category / tags
    async importMarkdown(md) {
      const text = String(md || "");
      const prompts = [];
      // Split on top-level "# " headings (level 1 only)
      const parts = text.split(/^#\s+/m).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const nlIdx = part.indexOf("\n");
        if (nlIdx === -1) continue;
        const title = part.slice(0, nlIdx).trim();
        const body = part.slice(nlIdx + 1).trim();
        if (!title) continue;
        prompts.push({ title, body });
      }
      // Fallback: if no headings, try the "---" separator format
      if (prompts.length === 0) {
        return this.importText(text);
      }
      let added = 0;
      for (const p of prompts) {
        const r = await this.add({ ...p, category: "Importado" });
        if (r.ok) added++;
      }
      return { ok: true, added, total: state.items.length };
    },

    // File handler — auto-detect format by extension/content
    async importFile(file) {
      if (!file) return { ok: false, reason: "no_file" };
      const name = file.name || "";
      const text = await file.text();
      if (name.endsWith(".md")) return this.importMarkdown(text);
      if (name.endsWith(".txt")) return this.importText(text);
      // Auto-detect: if has "# " headings, treat as md
      if (/^#\s+/m.test(text)) return this.importMarkdown(text);
      return this.importText(text);
    },

    exportMarkdown() {
      const lines = [];
      for (const p of state.items) {
        lines.push(`# ${p.title}`);
        lines.push("");
        if (p.category) lines.push(`> Categoria: ${p.category}`);
        if (p.tags?.length) lines.push(`> Tags: ${p.tags.join(", ")}`);
        lines.push("");
        lines.push(p.body);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      return lines.join("\n");
    }
  };

  // Live-update when storage changes from other contexts
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes[STORAGE_KEY]) return;
      state = { ...DEFAULTS, ...(changes[STORAGE_KEY].newValue || {}) };
      emitChange();
    });
  } catch (_) {}

  load();
  console.debug("[zai-enhancer] prompts ready");
})();
