/* content/panel.js
 * In-page floating panel + FAB. Primary UI for Z.ai Enhancer.
 * Replaces the need to click the toolbar icon.
 *
 * Sections:
 *   1. Notifications (sound / toast / native / volume / test buttons)
 *   2. Auto-Send Queue (status, list editor, controls, delay)
 *   3. Stats (last durations)
 */
(function () {
  const bus = window.__zaiBus;
  if (!bus) { console.warn("[zai-enhancer] panel: no bus"); return; }
  const t = window.__zaiI18n.t;
  const plural = window.__zaiI18n.plural;

  // ---------- prefs cache ----------
  const prefs = {
    soundEnabled: true,
    toastEnabled: true,
    nativeEnabled: true,
    nativeOnlyWhenUnfocused: true,
    soundVolume: 0.6
  };

  async function loadPrefs() {
    try {
      const p = await browser.storage.local.get(Object.keys(prefs));
      Object.assign(prefs, p);
    } catch (_) {}
    renderPrefs();
  }

  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const k of Object.keys(prefs)) {
        if (changes[k]) prefs[k] = changes[k].newValue;
      }
      renderPrefs();
    });
  } catch (_) {}

  // ---------- DOM helpers ----------
  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
      else if (k.startsWith("on") && typeof v === "function") {
        e.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "dataset") Object.assign(e.dataset, v);
      else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }

  // ---------- state ----------
  let fabEl = null;
  let sidebarEl = null;
  let badgeEl = null;
  let visible = false;
  let queueState = { items: [], delayMs: 2000, maxItems: 50, maxCharsPerMsg: 10000 };
  let agentRunning = false; // cached from detectors via bus (avoids DOM query on each render)
  let lastNotice = null;

  // ---------- init ----------
  function init() {
    if (!document.body) return setTimeout(init, 30);
    if (document.getElementById("zai-fab")) return;

    // Detect Android Firefox so we can move the FAB out of the way of the
    // chat's send button (which sits at the bottom-right on mobile).
    // On desktop the FAB is vertically centered on the right side; on Android
    // it moves to top-right (via the zai-mobile class in panel.css).
    if (/Android/i.test(navigator.userAgent)) {
      document.documentElement.classList.add("zai-mobile");
    }

    buildFAB();
    buildSidebar();
    wireBus();
    loadPrefs();
    refreshQueueState();
  }

  function buildFAB() {
    fabEl = el("button", {
      id: "zai-fab",
      type: "button",
      title: t("fab.title"),
      "aria-label": t("fab.aria"),
      onclick: () => toggle()
    });
    // SVG icon (panel/sidebar shape) — built via createElementNS to avoid innerHTML
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.style.pointerEvents = "none";

    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", "3");
    rect.setAttribute("y", "3");
    rect.setAttribute("width", "18");
    rect.setAttribute("height", "18");
    rect.setAttribute("rx", "2");
    svg.appendChild(rect);

    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", "15");
    line.setAttribute("y1", "3");
    line.setAttribute("x2", "15");
    line.setAttribute("y2", "21");
    svg.appendChild(line);

    fabEl.appendChild(svg);
    badgeEl = el("span", { id: "zai-queue-badge", class: "hidden" });
    fabEl.appendChild(badgeEl);
    document.body.appendChild(fabEl);
  }

  function buildSidebar() {
    sidebarEl = el("div", { id: "zai-sidebar", role: "dialog", "aria-label": "Z.ai Enhancer" });

    // Header
    const header = el("div", { class: "zai-header" }, [
      el("div", { class: "zai-header-title" }, [
        el("div", { class: "zai-header-logo" }, [
          (() => {
            // Small SVG icon (matching FAB) instead of letter Z
            const svgNS = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(svgNS, "svg");
            svg.setAttribute("width", "12");
            svg.setAttribute("height", "12");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "2.5");
            svg.setAttribute("stroke-linecap", "round");
            svg.setAttribute("stroke-linejoin", "round");
            const rect = document.createElementNS(svgNS, "rect");
            rect.setAttribute("x", "3"); rect.setAttribute("y", "3");
            rect.setAttribute("width", "18"); rect.setAttribute("height", "18");
            rect.setAttribute("rx", "2");
            svg.appendChild(rect);
            const line = document.createElementNS(svgNS, "line");
            line.setAttribute("x1", "15"); line.setAttribute("y1", "3");
            line.setAttribute("x2", "15"); line.setAttribute("y2", "21");
            svg.appendChild(line);
            return svg;
          })()
        ]),
        el("span", { text: t("header.title") })
      ]),
      el("button", {
        class: "zai-close",
        type: "button",
        "aria-label": t("header.close"),
        text: "×",
        onclick: () => toggle(false)
      })
    ]);
    sidebarEl.appendChild(header);

    // Tab bar
    const tabBar = el("div", { class: "zai-tabbar", role: "tablist" });
    const tabs = [
      { id: "autosend", label: t("tab.autosend") },
      { id: "prompts", label: t("tab.prompts") },
      { id: "notes", label: t("tab.notes") },
      { id: "settings", label: t("tab.settings") }
    ];
    const tabButtons = {};
    tabs.forEach((t) => {
      const btn = el("button", {
        class: "zai-tab" + (t.id === "autosend" ? " active" : ""),
        type: "button",
        role: "tab",
        "aria-selected": t.id === "autosend" ? "true" : "false",
        text: t.label,
        onclick: () => switchTab(t.id)
      });
      tabButtons[t.id] = btn;
      tabBar.appendChild(btn);
    });
    sidebarEl.appendChild(tabBar);

    // Tab panels (only one visible at a time)
    const panels = {
      autosend: el("div", { class: "zai-tabpanel active", role: "tabpanel" }),
      prompts: el("div", { class: "zai-tabpanel", role: "tabpanel", style: { display: "none" } }),
      notes: el("div", { class: "zai-tabpanel", role: "tabpanel", style: { display: "none" } }),
      settings: el("div", { class: "zai-tabpanel", role: "tabpanel", style: { display: "none" } })
    };
    panels.autosend.appendChild(buildAutosendSection());
    panels.prompts.appendChild(buildPromptsSection());
    panels.notes.appendChild(buildNotesSection());
    panels.settings.appendChild(buildLanguageSection());
    panels.settings.appendChild(buildNotificationsSection());
    panels.settings.appendChild(buildAutosendSettingsSection());
    panels.settings.appendChild(buildStatsSection());

    const body = el("div", { class: "zai-body" });
    body.appendChild(panels.autosend);
    body.appendChild(panels.prompts);
    body.appendChild(panels.notes);
    body.appendChild(panels.settings);
    sidebarEl.appendChild(body);

    document.body.appendChild(sidebarEl);

    // Save references for switchTab
    panelState.tabButtons = tabButtons;
    panelState.panels = panels;
  }

  // ---------- tab switching ----------
  const panelState = { tabButtons: {}, panels: {} };
  function switchTab(id) {
    for (const tabId of Object.keys(panelState.tabButtons)) {
      const isActive = tabId === id;
      panelState.tabButtons[tabId].classList.toggle("active", isActive);
      panelState.tabButtons[tabId].setAttribute("aria-selected", isActive ? "true" : "false");
      const panel = panelState.panels[tabId];
      if (panel) {
        panel.style.display = isActive ? "" : "none";
        panel.classList.toggle("active", isActive);
      }
    }
    // Re-render content of the now-visible tab
    if (id === "prompts") renderPrompts();
    if (id === "autosend") refreshQueueState();
    if (id === "notes") refreshNotes();
    if (id === "settings") renderStats();
  }

  // ---------- Language section (in Config. tab) ----------
  function buildLanguageSection() {
    const section = el("div", { class: "zai-section" });

    const locales = window.__zaiI18n?.getAvailableLocales?.() || [];
    const select = el("select", {
      style: { width: "100%", padding: "5px 8px", borderRadius: "var(--zai-radius-md)",
               border: "1px solid var(--zai-border)", background: "var(--zai-bg)",
               color: "var(--zai-fg)", fontSize: "14px", fontFamily: "var(--zai-font)" },
      onchange: (e) => window.__zaiI18n?.setLocale(e.target.value)
    });
    locales.forEach((locale) => {
      const opt = el("option", { value: locale, text: t("lang." + locale) });
      if (locale === window.__zaiI18n?.getLocale?.()) opt.selected = true;
      select.appendChild(opt);
    });

    section.appendChild(select);
    return section;
  }

  // ---------- Notifications section ----------
  function buildNotificationsSection() {
    const section = el("div", { class: "zai-section" });
    section.appendChild(el("div", { class: "zai-section-title", text: t("section.notifications") }));

    section.appendChild(rowToggle(t("notif.sound_on_complete"), "soundEnabled"));
    section.appendChild(rowToggle(t("notif.toast"), "toastEnabled"));
    section.appendChild(rowToggle(t("notif.native"), "nativeEnabled"));
    section.appendChild(rowToggle(t("notif.native_unfocused"), "nativeOnlyWhenUnfocused"));

    // Volume slider
    const volumeRow = el("label", { class: "zai-row" }, [
      el("span", { class: "zai-row-label", text: t("notif.volume") }),
      el("input", {
        type: "range",
        min: "0",
        max: "1",
        step: "0.05",
        oninput: (e) => savePref("soundVolume", parseFloat(e.target.value))
      })
    ]);
    section.appendChild(volumeRow);

    // Test buttons
    const actions = el("div", { class: "zai-actions" }, [
      el("button", {
        class: "zai-btn zai-btn-ghost",
        type: "button",
        text: t("notif.test_sound"),
        onclick: () => sendToPage({ type: "test-sound" })
      }),
      el("button", {
        class: "zai-btn zai-btn-ghost",
        type: "button",
        text: t("notif.test_toast"),
        onclick: () => sendToPage({ type: "test-toast" })
      })
    ]);
    section.appendChild(actions);
    return section;
  }

  function rowToggle(labelText, prefKey) {
    const toggle = el("label", { class: "zai-toggle" }, [
      el("input", {
        type: "checkbox",
        onchange: (e) => savePref(prefKey, e.target.checked)
      })
    ]);
    return el("label", { class: "zai-row" }, [
      el("span", { class: "zai-row-label", text: labelText }),
      toggle
    ]);
  }

  // ---------- Prompts section ----------
  let promptsList, promptsSearch, promptsNotice, promptsFileInput;
  let promptsFilterText = "";
  let promptsSearchTimer = null; // debounce for search input
  let editingPromptId = null;

  function buildPromptsSection() {
    const section = el("div", { class: "zai-section" });
    section.appendChild(el("div", { class: "zai-section-title", text: t("section.prompts") }));

    // Search + filter row (v0.11.0: debounced to avoid re-render on every keystroke)
    const searchRow = el("div", { class: "zai-prompts-search" });
    promptsSearch = el("input", {
      type: "text",
      placeholder: t("prompts.search_placeholder"),
      oninput: (e) => {
        promptsFilterText = e.target.value.toLowerCase().trim();
        if (promptsSearchTimer) clearTimeout(promptsSearchTimer);
        promptsSearchTimer = setTimeout(() => {
          promptsSearchTimer = null;
          renderPrompts();
        }, 150);
      }
    });
    searchRow.appendChild(promptsSearch);
    section.appendChild(searchRow);

    // Prompts list
    promptsList = el("div", { class: "zai-prompts-list" });
    section.appendChild(promptsList);

    // Notice (dynamic feedback)
    promptsNotice = el("div", { class: "zai-notice", style: { display: "none" } });
    section.appendChild(promptsNotice);

    // Add new prompt button + file import
    const actions = el("div", { class: "zai-actions" }, [
      el("button", {
        class: "zai-btn",
        type: "button",
        text: t("prompts.new"),
        onclick: () => openPromptEditor(null)
      }),
      el("button", {
        class: "zai-btn zai-btn-ghost",
        type: "button",
        text: t("prompts.import"),
        onclick: () => promptsFileInput?.click()
      }),
      el("button", {
        class: "zai-btn zai-btn-ghost",
        type: "button",
        text: t("prompts.export"),
        onclick: exportPromptsMd
      })
    ]);
    section.appendChild(actions);

    // Hidden file input for import
    promptsFileInput = el("input", {
      type: "file",
      accept: ".txt,.md,text/plain,text/markdown",
      style: { display: "none" },
      onchange: (e) => {
        const f = e.target.files?.[0];
        if (f) importPromptFile(f);
        e.target.value = ""; // reset so same file can be re-selected
      }
    });
    section.appendChild(promptsFileInput);

    // Drag & drop zone
    const dropZone = el("div", {
      class: "zai-dropzone",
      text: t("prompts.dropzone")
    });
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag");
      const files = Array.from(e.dataTransfer?.files || []);
      for (const f of files) {
        if (/\.(txt|md)$/i.test(f.name)) await importPromptFile(f);
      }
    });
    section.appendChild(dropZone);

    return section;
  }

  function renderPrompts() {
    if (!promptsList) return;
    promptsList.replaceChildren();
    const all = window.__zaiPrompts?.getAll?.() || [];

    // Build category list for filter chips
    const cats = new Set(["Todos"]);
    all.forEach((p) => p.category && cats.add(p.category));

    const filtered = all.filter((p) => {
      if (promptsFilterText) {
        const hay = [
          p.title,
          p.category || "",
          (p.tags || []).join(" "),
          p.body.slice(0, 200)
        ].join(" ").toLowerCase();
        if (!hay.includes(promptsFilterText)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      promptsList.appendChild(
        el("div", {
          class: "zai-prompts-empty",
          text: all.length === 0
            ? t("prompts.empty")
            : t("prompts.no_match")
        })
      );
      return;
    }

    filtered.forEach((p) => {
      const card = el("div", { class: "zai-prompt-card", dataset: { id: p.id } });

      // Header: title + actions
      const head = el("div", { class: "zai-prompt-head" });
      head.appendChild(
        el("div", { class: "zai-prompt-title", text: p.title, title: p.title })
      );
      const headActions = el("div", { class: "zai-prompt-actions" });
      headActions.appendChild(
        el("button", {
          type: "button",
          class: "zai-prompt-btn",
          title: t("prompts.edit"),
          text: "✏",
          onclick: (e) => { e.stopPropagation(); openPromptEditor(p.id); }
        })
      );
      headActions.appendChild(
        el("button", {
          type: "button",
          class: "zai-prompt-btn zai-prompt-btn-danger",
          title: t("prompts.delete"),
          text: "🗑",
          onclick: (e) => {
            e.stopPropagation();
            if (confirm(t("misc.confirm_delete_prompt", {title: p.title}))) {
              window.__zaiPrompts?.remove(p.id);
            }
          }
        })
      );
      head.appendChild(headActions);
      card.appendChild(head);

      // Body preview (first ~120 chars)
      const preview = p.body.slice(0, 140).replace(/\n/g, " ");
      card.appendChild(
        el("div", { class: "zai-prompt-preview", text: preview + (p.body.length > 140 ? "…" : "") })
      );

      // Meta: category + tags + use count + vars
      const meta = el("div", { class: "zai-prompt-meta" });
      if (p.category) {
        meta.appendChild(el("span", { class: "zai-chip", text: p.category }));
      }
      const vars = window.__zaiPrompts?.extractVars?.(p.body) || [];
      if (vars.length) {
        vars.forEach((v) =>
          meta.appendChild(el("span", { class: "zai-chip zai-chip-var", text: `{{${v}}}` }))
        );
      }
      if (p.usedCount > 0) {
        meta.appendChild(
          el("span", { class: "zai-prompt-used", text: `usado ${p.usedCount}×` })
        );
      }
      card.appendChild(meta);

      // Click → apply (with var form if needed)
      card.addEventListener("click", () => applyPromptWithVars(p.id));

      promptsList.appendChild(card);
    });
  }

  function showPromptsNotice(text, type = "info") {
    if (!promptsNotice) return;
    promptsNotice.textContent = text;
    promptsNotice.className = `zai-notice ${type}`;
    promptsNotice.style.display = "block";
    clearTimeout(showPromptsNotice._t);
    showPromptsNotice._t = setTimeout(() => {
      promptsNotice.style.display = "none";
    }, 4000);
  }

  async function importPromptFile(file) {
    showPromptsNotice(t("prompts.notice.importing", {name: file.name}), "info");
    const r = await window.__zaiPrompts?.importFile(file);
    if (r?.ok) {
      showPromptsNotice(t("prompts.notice.imported", {added: r.added, total: r.total}), "success");
    } else {
      showPromptsNotice(t("prompts.notice.import_error", {reason: r?.reason || t("misc.unknown")}), "error");
    }
  }

  function exportPromptsMd() {
    const md = window.__zaiPrompts?.exportMarkdown?.() || "";
    if (!md.trim()) {
      showPromptsNotice(t("prompts.notice.export_empty"), "warning");
      return;
    }
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zai-prompts-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showPromptsNotice(t("prompts.notice.exported"), "success");
  }

  // ---------- prompt editor modal ----------
  let promptModal = null;
  function openPromptEditor(promptId) {
    editingPromptId = promptId;
    const p = promptId ? window.__zaiPrompts?.get?.(promptId) : null;

    if (promptModal) promptModal.remove();
    promptModal = el("div", { id: "zai-prompt-modal", class: "zai-modal-overlay" });

    const card = el("div", { class: "zai-modal-card" });
    card.appendChild(
      el("div", { class: "zai-modal-header" }, [
        el("h3", { text: p ? "Editar prompt" : "Novo prompt" }),
        el("button", {
          type: "button",
          class: "zai-close",
          text: "×",
          "aria-label": t("header.close"),
          onclick: () => closePromptEditor()
        })
      ])
    );

    const form = el("div", { class: "zai-modal-body" });
    form.appendChild(el("label", { class: "zai-field-label", text: t("prompts.editor.title_label") }));
    const titleInput = el("input", {
      type: "text",
      placeholder: t("prompts.editor.title_placeholder"),
      value: p?.title || "",
      style: { width: "100%", marginBottom: "10px" }
    });
    form.appendChild(titleInput);

    form.appendChild(el("label", { class: "zai-field-label", text: t("prompts.editor.category_label") }));
    const catInput = el("input", {
      type: "text",
      placeholder: t("prompts.editor.category_placeholder"),
      value: p?.category || "",
      style: { width: "100%", marginBottom: "10px" }
    });
    form.appendChild(catInput);

    form.appendChild(
      el("label", { class: "zai-field-label", text: t("prompts.editor.body_label") })
    );
    form.appendChild(
      el("div", {
        class: "zai-field-hint",
        text: t("prompts.editor.body_hint")
      })
    );
    const bodyInput = el("textarea", {
      placeholder: t("prompts.editor.body_placeholder"),
      style: { width: "100%", minHeight: "140px", resize: "vertical", fontFamily: "monospace", fontSize: "12px" }
    });
    bodyInput.value = p?.body || "";
    form.appendChild(bodyInput);

    // Live var preview
    const varPreview = el("div", { class: "zai-field-hint", style: { marginTop: "6px" } });
    const updateVarPreview = () => {
      const vars = window.__zaiPrompts?.extractVars?.(bodyInput.value) || [];
      varPreview.textContent = vars.length
        ? t("prompts.editor.vars_detected", {vars: vars.map((v) => `{{${v}}}`).join(", ")})
        : t("prompts.editor.no_vars");
    };
    bodyInput.addEventListener("input", updateVarPreview);
    updateVarPreview();
    form.appendChild(varPreview);

    card.appendChild(form);

    // Footer
    const footer = el("div", { class: "zai-modal-footer" });
    footer.appendChild(
      el("button", {
        type: "button",
        class: "zai-btn zai-btn-ghost",
        text: t("prompts.editor.cancel"),
        onclick: () => closePromptEditor()
      })
    );
    footer.appendChild(
      el("button", {
        type: "button",
        class: "zai-btn",
        text: p ? t("prompts.editor.save") : t("prompts.editor.create"),
        onclick: async () => {
          const title = titleInput.value.trim();
          const body = bodyInput.value;
          const category = catInput.value.trim() || "Geral";
          if (!title) {
            showPromptsNotice(t("prompts.editor.title_required"), "error");
            return;
          }
          if (!body.trim()) {
            showPromptsNotice(t("prompts.editor.body_required"), "error");
            return;
          }
          if (p) {
            await window.__zaiPrompts?.update(p.id, { title, body, category });
            showPromptsNotice("Prompt atualizado.", "success");
          } else {
            const r = await window.__zaiPrompts?.add({ title, body, category });
            if (r?.ok) showPromptsNotice("Prompt criado.", "success");
          }
          closePromptEditor();
        }
      })
    );
    card.appendChild(footer);

    promptModal.appendChild(card);
    document.body.appendChild(promptModal);

    // Close on overlay click
    promptModal.addEventListener("click", (e) => {
      if (e.target === promptModal) closePromptEditor();
    });
    // Esc to close
    const escHandler = (e) => {
      if (e.key === "Escape") {
        closePromptEditor();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);

    titleInput.focus();
  }

  function closePromptEditor() {
    if (promptModal) {
      promptModal.remove();
      promptModal = null;
    }
    editingPromptId = null;
  }

  // ---------- variable-fill modal ----------
  let varModal = null;
  async function applyPromptWithVars(promptId) {
    const p = window.__zaiPrompts?.get?.(promptId);
    if (!p) return;
    const vars = window.__zaiPrompts?.extractVars?.(p.body) || [];
    if (vars.length === 0) {
      // No vars — send directly
      const r = await window.__zaiPrompts?.applyToChat(promptId, {});
      if (r?.ok) {
        showPromptsNotice(`"${p.title}" enviado ao chat.`, "success");
        toggle(false); // close panel so user sees the chat
      } else {
        showPromptsNotice(`Erro: ${r?.reason || "desconhecido"}`, "error");
      }
      return;
    }

    // Has vars — open modal to collect them
    if (varModal) varModal.remove();
    varModal = el("div", { id: "zai-var-modal", class: "zai-modal-overlay" });
    const card = el("div", { class: "zai-modal-card" });
    card.appendChild(
      el("div", { class: "zai-modal-header" }, [
        el("h3", { text: t("prompts.var_modal.title", {title: p.title}) }),
        el("button", {
          type: "button",
          class: "zai-close",
          text: "×",
          onclick: () => { varModal?.remove(); varModal = null; }
        })
      ])
    );

    const body = el("div", { class: "zai-modal-body" });
    // Show prompt preview (truncated)
    body.appendChild(
      el("div", {
        class: "zai-var-preview",
        text: p.body.length > 280 ? p.body.slice(0, 280) + "…" : p.body
      })
    );

    const inputs = {};
    vars.forEach((name) => {
      body.appendChild(el("label", { class: "zai-field-label", text: `{{${name}}}` }));
      const isLong = /code|texto|text|content|código/i.test(name);
      const input = isLong
        ? el("textarea", {
            placeholder: `Valor para ${name}…`,
            style: { width: "100%", minHeight: "80px", resize: "vertical", fontFamily: "monospace", fontSize: "12px" }
          })
        : el("input", {
            type: "text",
            placeholder: `Valor para ${name}…`,
            style: { width: "100%", marginBottom: "10px" }
          });
      inputs[name] = input;
      body.appendChild(input);
    });
    card.appendChild(body);

    // Footer
    const footer = el("div", { class: "zai-modal-footer" });
    footer.appendChild(
      el("button", {
        type: "button",
        class: "zai-btn zai-btn-ghost",
        text: t("prompts.editor.cancel"),
        onclick: () => { varModal?.remove(); varModal = null; }
      })
    );
    footer.appendChild(
      el("button", {
        type: "button",
        class: "zai-btn zai-btn-success",
        text: t("prompts.var_modal.send"),
        onclick: async () => {
          const values = {};
          for (const name of vars) {
            values[name] = inputs[name].value;
          }
          const r = await window.__zaiPrompts?.applyToChat(promptId, values);
          if (r?.ok) {
            showPromptsNotice(`"${p.title}" enviado ao chat.`, "success");
            varModal?.remove();
            varModal = null;
            toggle(false); // close panel
          } else if (r?.reason === "missing_vars") {
            showPromptsNotice(t("prompts.var_modal.missing", {vars: r.missing.join(", ")}), "warning");
          } else {
            showPromptsNotice(`Erro: ${r?.reason || "desconhecido"}`, "error");
          }
        }
      })
    );
    card.appendChild(footer);

    varModal.appendChild(card);
    document.body.appendChild(varModal);
    varModal.addEventListener("click", (e) => {
      if (e.target === varModal) { varModal.remove(); varModal = null; }
    });

    // Focus first input
    const firstVar = vars[0];
    if (firstVar) inputs[firstVar].focus();
  }

  // ---------- Auto-send section ----------
  let statusPill, queueList, addTextarea, noticeEl;

  function buildAutosendSection() {
    const section = el("div", { class: "zai-section" });
    section.appendChild(el("div", { class: "zai-section-title", text: t("section.autosend") }));

    // Status row: status pill + clear button (inline, side by side)
    statusPill = el("div", { class: "zai-status idle" }, [
      el("span", { class: "zai-status-dot" }),
      el("span", { class: "zai-status-text", text: t("queue.status_idle") })
    ]);
    const clearBtn = el("button", {
      class: "zai-btn zai-btn-ghost zai-clear-btn",
      type: "button",
      title: t("queue.clear_title"),
      text: t("queue.clear"),
      onclick: () => {
        const count = window.__zaiAutosend?.getState?.().items.length || 0;
        if (count === 0) {
          showNotice(t("queue.clear_empty"), "info");
          return;
        }
        if (confirm(t("queue.clear_confirm", {n: count, plural: count === 1 ? "" : "s"}))) {
          window.__zaiAutosend?.clear().then(() => {
            showNotice(t("queue.clear_done"), "success");
          });
        }
      }
    });
    const statusRow = el("div", { class: "zai-status-row" }, [statusPill, clearBtn]);
    section.appendChild(statusRow);

    // Queue list
    queueList = el("ul", { class: "zai-queue-list" });
    section.appendChild(queueList);

    // Add new item
    const addWrap = el("div", { class: "zai-queue-add" });
    addTextarea = el("textarea", {
      placeholder: t("queue.add_placeholder"),
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          addItemFromTextarea();
        }
      }
    });
    addWrap.appendChild(addTextarea);
    addWrap.appendChild(
      el("div", { class: "zai-actions" }, [
        el("button", {
          class: "zai-btn",
          type: "button",
          text: t("queue.add_btn"),
          onclick: addItemFromTextarea
        }),
        el("button", {
          class: "zai-btn zai-btn-ghost",
          type: "button",
          text: t("queue.from_textarea"),
          onclick: importFromChatTextarea,
          title: t("queue.from_textarea_title")
        })
      ])
    );
    section.appendChild(addWrap);

    // Notice (dynamic)
    noticeEl = el("div", { class: "zai-notice", style: { display: "none" } });
    section.appendChild(noticeEl);

    // Meta info
    section.appendChild(
      el("div", { class: "zai-queue-meta" }, [
        el("span", { text: t("queue.meta_hint") }),
        el("span", { class: "zai-queue-count", text: "0 / 50" })
      ])
    );

    return section;
  }

  function addItemFromTextarea() {
    const text = addTextarea.value.trim();
    if (!text) return;
    window.__zaiAutosend?.addItem(text).then((r) => {
      if (r.ok) {
        addTextarea.value = "";
        showNotice(t("prompts.notice.added"), "success");
      } else {
        showNotice(t("prompts.notice.error", {reason: r.reason}), "error");
      }
    });
  }

  async function importFromChatTextarea() {
    const ta = document.getElementById("chat-input");
    if (!ta || !ta.value.trim()) {
      showNotice(t("prompts.notice.chat_empty"), "warning");
      return;
    }
    const r = await window.__zaiAutosend?.addItem(ta.value);
    if (r?.ok) {
      showNotice(t("prompts.notice.imported_chat"), "success");
    } else {
      showNotice(t("prompts.notice.error", {reason: r?.reason || t("misc.unknown")}), "error");
    }
  }

  function showNotice(text, type = "info") {
    if (!noticeEl) return;
    noticeEl.textContent = text;
    noticeEl.className = `zai-notice ${type}`;
    noticeEl.style.display = "block";
    clearTimeout(showNotice._t);
    showNotice._t = setTimeout(() => {
      noticeEl.style.display = "none";
    }, 4000);
  }

  // ---------- Notes section (Anotações tab) ----------
  let notesTextarea, notesStatus, notesClearBtn;

  function buildNotesSection() {
    const section = el("div", { class: "zai-section zai-notes-section" });
    section.appendChild(el("div", { class: "zai-section-title", text: t("tab.notes") }));

    // Hint
    section.appendChild(
      el("div", {
        class: "zai-row-hint",
        text: t("notes.hint"),
        style: { marginBottom: "10px" }
      })
    );

    // Textarea
    notesTextarea = el("textarea", {
      class: "zai-notes-textarea",
      placeholder: t("notes.placeholder"),
      oninput: (e) => {
        window.__zaiNotes?.set(e.target.value);
        updateNotesStatus();
      }
    });
    section.appendChild(notesTextarea);

    // Status + clear button
    notesStatus = el("span", { class: "zai-notes-status", text: "" });
    notesClearBtn = el("button", {
      class: "zai-btn zai-btn-ghost zai-notes-clear",
      type: "button",
      text: t("queue.clear"),
      onclick: async () => {
        if (!notesTextarea.value.trim()) return;
        if (confirm(t("notes.clear_confirm"))) {
          await window.__zaiNotes?.clear();
          refreshNotes();
        }
      }
    });
    const footer = el("div", { class: "zai-notes-footer" }, [notesStatus, notesClearBtn]);
    section.appendChild(footer);

    return section;
  }

  function refreshNotes() {
    if (!notesTextarea) return;
    const content = window.__zaiNotes?.get?.() || "";
    // Only update if value changed externally (don't overwrite user typing)
    if (document.activeElement !== notesTextarea || notesTextarea.value !== content) {
      notesTextarea.value = content;
    }
    updateNotesStatus();
  }

  function updateNotesStatus() {
    if (!notesStatus) return;
    const content = notesTextarea.value || "";
    const chars = content.length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const lines = content ? content.split("\n").length : 0;
    notesStatus.textContent = t("notes.stats", {words, plural_w: plural(words), chars, plural_c: plural(chars), lines, plural_l: plural(lines)});
    // Enable clear button only when there's content
    if (notesClearBtn) {
      notesClearBtn.disabled = !content.trim();
    }
  }

  // ---------- Auto-send settings section (in Config. tab) ----------
  function buildAutosendSettingsSection() {
    const section = el("div", { class: "zai-section" });
    section.appendChild(el("div", { class: "zai-section-title", text: t("settings.autosend") }));

    // Delay row
    const delayRow = el("div", { class: "zai-row" }, [
      el("div", {}, [
        el("div", { class: "zai-row-label", text: t("settings.delay_label") }),
        el("div", { class: "zai-row-hint", text: t("settings.delay_hint") })
      ]),
      el("div", { style: { display: "flex", gap: "4px", alignItems: "center" } }, [
        el("input", {
          type: "number",
          min: "1",
          max: "60",
          step: "0.5",
          onchange: (e) =>
            window.__zaiAutosend?.setDelay(parseFloat(e.target.value) * 1000)
        }),
        el("span", { text: t("unit.seconds"), style: { fontSize: "13px", color: "var(--zai-fg-secondary)" } })
      ])
    ]);
    section.appendChild(delayRow);

    return section;
  }

  // ---------- Stats section ----------
  let statsList;
  function buildStatsSection() {
    const section = el("div", { class: "zai-section" });
    section.appendChild(el("div", { class: "zai-section-title", text: t("section.stats") }));
    statsList = el("div", { class: "zai-stats-list", text: t("stats.empty") });
    section.appendChild(statsList);
    return section;
  }

  function renderStats() {
    if (!statsList) return;
    const durations = window.__zaiStats?.getRecent?.() || [];
    if (!durations.length) {
      statsList.textContent = t("stats.empty");
      return;
    }
    const avg = durations.reduce((a, b) => a + b.durationMs, 0) / durations.length;
    statsList.replaceChildren();
    statsList.appendChild(
      el("div", { class: "zai-stat-row", style: { marginBottom: "6px", fontWeight: "600" } }, [
        el("span", { text: t("stats.avg", {sec: (avg / 1000).toFixed(1)}) }),
        el("span", { text: ` · ` }),
        el("span", { text: t("stats.responses", {n: durations.length}) })
      ])
    );
    durations.slice(0, 5).forEach((d) => {
      statsList.appendChild(
        el("div", {
          class: "zai-stat-row",
          style: { display: "flex", justifyContent: "space-between", fontSize: "11.5px", color: "var(--zai-muted)" }
        }, [
          el("span", { text: new Date(d.ts).toLocaleTimeString() }),
          el("span", { text: `${(d.durationMs / 1000).toFixed(1)}s · ${d.textLen || 0} chars` })
        ])
      );
    });
  }

  // ---------- render prefs into UI ----------
  function renderPrefs() {
    if (!sidebarEl) return;
    const checks = sidebarEl.querySelectorAll('input[type="checkbox"]');
    const keys = ["soundEnabled", "toastEnabled", "nativeEnabled", "nativeOnlyWhenUnfocused"];
    checks.forEach((cb, i) => {
      if (i < keys.length) cb.checked = !!prefs[keys[i]];
    });
    const range = sidebarEl.querySelector('input[type="range"]');
    if (range) range.value = prefs.soundVolume;
  }

  function savePref(key, value) {
    prefs[key] = value;
    try {
      browser.storage.local.set({ [key]: value });
    } catch (_) {}
  }

  // ---------- queue rendering ----------
  function refreshQueueState() {
    if (!window.__zaiAutosend) return;
    queueState = window.__zaiAutosend.getState();
    renderQueue();
  }

  function renderQueue() {
    if (!queueList || !statusPill) return;
    renderQueueList();
    renderQueueStatus();
    updateBadge();
  }

  function renderQueueList() {
    if (!queueList) return;
    queueList.replaceChildren();

    if (queueState.items.length === 0) {
      queueList.appendChild(
        el("li", { class: "zai-queue-empty", text: t("queue.empty") })
      );
      return;
    }
    queueState.items.forEach((text, i) => {
      const item = el("li", { class: "zai-queue-item" });
      item.appendChild(
        el("div", { class: "zai-queue-index", text: String(i + 1) })
      );
      const ta = el("textarea", {
        class: "zai-queue-text",
        onchange: (e) => window.__zaiAutosend?.updateItem(i, e.target.value)
      });
      ta.value = text;
      ta.rows = Math.min(6, Math.max(1, text.split("\n").length));
      item.appendChild(ta);

      const controls = el("div", { class: "zai-queue-controls" });
      controls.appendChild(
        el("button", {
          type: "button", title: t("queue.move_up"), text: "▲",
          onclick: () => window.__zaiAutosend?.moveItem(i, i - 1)
        })
      );
      controls.appendChild(
        el("button", {
          type: "button", title: t("queue.move_down"), text: "▼",
          onclick: () => window.__zaiAutosend?.moveItem(i, i + 1)
        })
      );
      controls.appendChild(
        el("button", {
          type: "button", title: t("queue.remove"), text: "×",
          style: { color: "var(--zai-danger)" },
          onclick: () => window.__zaiAutosend?.removeItem(i)
        })
      );
      item.appendChild(controls);
      queueList.appendChild(item);
    });
  }

  function renderQueueStatus() {
    if (!statusPill) return;
    const statusText = statusPill.querySelector(".zai-status-text");
    const itemCount = queueState.items.length;
    // v0.11.0: use cached agentRunning instead of DOM query on every render
    if (itemCount > 0 && agentRunning) {
      statusPill.className = "zai-status waiting";
      statusText.textContent = t("queue.status_waiting", {n: itemCount});
    } else if (itemCount > 0) {
      statusPill.className = "zai-status active";
      statusText.textContent = t("queue.status_active", {n: itemCount, plural: plural(itemCount)});
    } else {
      statusPill.className = "zai-status idle";
      statusText.textContent = t("queue.status_idle");
    }

    const clearBtn = sidebarEl?.querySelector(".zai-clear-btn");
    if (clearBtn) {
      clearBtn.classList.toggle("has-items", itemCount > 0);
      clearBtn.disabled = itemCount === 0;
    }

    const delayInputs = sidebarEl?.querySelectorAll('input[type="number"]');
    delayInputs?.forEach((inp) => {
      if (!inp.matches(":focus")) {
        inp.value = (queueState.delayMs / 1000).toFixed(1);
      }
    });

    const countMeta = sidebarEl?.querySelector(".zai-queue-count");
    if (countMeta) countMeta.textContent = `${itemCount} / ${queueState.maxItems}`;
  }

  function updateBadge() {
    if (!badgeEl || !fabEl) return;
    if (queueState.items.length === 0) {
      badgeEl.classList.add("hidden");
      fabEl.classList.remove("zai-queue-active");
    } else {
      badgeEl.classList.remove("hidden");
      badgeEl.textContent = String(queueState.items.length);
      // Pulse whenever there are queued items (always-on model)
      fabEl.classList.add("zai-queue-active");
    }
  }

  // ---------- bus wiring ----------
  // v0.11.0: reasons map is module-level constant (was re-created on every event)
  const QUEUE_PAUSED_REASONS = {
    user_stopped_agent: t("queue.paused.user_stopped"),
    stream_error: t("queue.paused.stream_error"),
    navigation: t("queue.paused.navigation")
  };

  function wireBus() {
    bus.on("queue:changed", () => {
      // v0.11.0: only re-render list when items actually change
      refreshQueueState();
    });
    bus.on("queue:item-sent", (evt) => {
      showNotice(t("queue.sent", {n: evt.remaining}), "success");
      // Only update status (item count changed), not full list re-render
      renderQueueStatus();
      updateBadge();
    });
    bus.on("queue:paused", (evt) => {
      showNotice(QUEUE_PAUSED_REASONS[evt.reason] || t("queue.paused.unknown", {reason: evt.reason}), "warning");
    });
    bus.on("queue:item-error", (evt) => {
      showNotice(t("queue.error", {reason: evt.reason}), "error");
    });
    bus.on("queue:completed", () => {
      showNotice(t("queue.completed"), "success");
    });
    // v0.11.0: cache agentRunning from detectors (no DOM query needed)
    bus.on("agent:running-changed", (evt) => {
      agentRunning = evt.running;
      renderQueueStatus(); // only status pill, not full list
      updateBadge();
    });
    bus.on("agent:done", () => {
      renderStats();
      renderQueueStatus(); // only status, not full list
    });
    bus.on("agent:start", () => {
      renderQueueStatus(); // only status, not full list
    });
    bus.on("prompts:changed", () => {
      renderPrompts();
    });
    // v0.12.1: re-build entire sidebar on locale change
    bus.on("i18n:locale-changed", () => {
      // Destroy and rebuild sidebar + FAB with new locale
      if (sidebarEl) { sidebarEl.remove(); sidebarEl = null; }
      if (fabEl) { fabEl.remove(); fabEl = null; }
      visible = false;
      buildFAB();
      buildSidebar();
      wireBus();
      loadPrefs();
      refreshQueueState();
      toggle(true);
    });
  }

  // ---------- toggle ----------
  // The sidebar slides in from the right. We push the entire page left by
  // applying padding-right to <html> (or <body>). This is more robust than
  // trying to target specific chat.z.ai containers because the layout is
  // Svelte-rendered with nested absolute positioning.
  function applyLayoutShift(open) {
    const SIDEBAR_WIDTH = 360;
    if (open) {
      document.documentElement.classList.add("zai-sidebar-open");
      if (!document.getElementById("zai-layout-shift")) {
        const style = document.createElement("style");
        style.id = "zai-layout-shift";
        style.textContent = `
          html.zai-sidebar-open {
            padding-right: ${SIDEBAR_WIDTH}px !important;
            box-sizing: border-box;
            transition: padding-right 0.22s cubic-bezier(0.4, 0, 0.2, 1);
          }
          html.zai-sidebar-open body {
            width: calc(100vw - ${SIDEBAR_WIDTH}px) !important;
            transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
          }
          @media (max-width: 600px) {
            html.zai-sidebar-open {
              padding-right: 0 !important;
            }
            html.zai-sidebar-open body {
              width: 100vw !important;
            }
          }
        `;
        document.head.appendChild(style);
      }
    } else {
      document.documentElement.classList.remove("zai-sidebar-open");
    }
  }

  function toggle(force) {
    visible = typeof force === "boolean" ? force : !visible;
    if (visible) {
      sidebarEl.classList.add("visible");
      fabEl.classList.add("zai-open");
      applyLayoutShift(true);
      refreshQueueState();
      renderPrompts();
      renderStats();
    } else {
      sidebarEl.classList.remove("visible");
      fabEl.classList.remove("zai-open");
      applyLayoutShift(false);
    }
  }

  // ---------- messaging bridge (for test buttons) ----------
  function sendToPage(message) {
    window.postMessage(
      { source: "zai-enhancer-ui", type: message.type },
      location.origin
    );
  }

  // ---------- boot ----------
  // Listen for "open panel" requests from popup (via main.js)
  window.addEventListener("zai-enhancer:open-panel", () => toggle(true));

  init();
  console.debug("[zai-enhancer] panel ready");
})();
