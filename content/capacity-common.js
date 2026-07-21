/* content/capacity-common.js
 * Shared utilities for detecting the "Model is at capacity" dialog.
 * Used by both dialog-killer.js (soft retry) and refresh-retry.js (hard retry)
 * so they always agree on what counts as a capacity dialog.
 *
 * Public API on window.__zaiCapacity:
 *   PHRASES                       — array of capacity phrases (lowercase)
 *   isCapacityDialog(dialog, m)   — check if a dialog element matches
 *                                   (m = "substring" | "exact", default "substring")
 *   findCapacityDialog(root, m)   — find first visible capacity dialog in root
 *   setupObserver(onFound)        — MutationObserver that fires onFound(dialog)
 *                                   when a capacity dialog is added to the DOM.
 *                                   Returns a disconnect function.
 *
 * Phrases matched (case-insensitive substring by default):
 *   - "peak hours"
 *   - "currently in peak"
 *   - "model is currently at capacity"
 *   - "intensifying the coordination of resources"
 *   - "switch to glm-5-turbo"
 *   - "switch to glm-4.7"
 */
(function () {
  if (window.__zaiCapacity) return; // idempotent

  const PHRASES = [
    "peak hours",
    "currently in peak",
    "model is currently at capacity",
    "intensifying the coordination of resources",
    "switch to glm-5-turbo",
    "switch to glm-4.7",
  ];

  function isCapacityDialog(dialog, matchMode = "substring") {
    if (!dialog) return false;
    const text = (dialog.innerText || "").toLowerCase().trim();
    if (!text) return false;
    if (matchMode === "exact") {
      return PHRASES.includes(text);
    }
    return PHRASES.some((p) => text.includes(p));
  }

  function findCapacityDialog(root, matchMode = "substring") {
    if (!root || !root.querySelectorAll) return null;
    const candidates = root.querySelectorAll('[role="dialog"][aria-modal="true"]');
    for (const dialog of candidates) {
      const rect = dialog.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (!isCapacityDialog(dialog, matchMode)) continue;
      return dialog;
    }
    return null;
  }

  function setupObserver(onFound) {
    if (typeof onFound !== "function") return () => {};

    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Direct match: the added node itself is a capacity dialog
          if (node.matches?.('[role="dialog"]') && isCapacityDialog(node)) {
            onFound(node);
            return;
          }

          // Descendant match: the added node contains a capacity dialog
          const inner = node.querySelector?.('[role="dialog"][aria-modal="true"]');
          if (inner && isCapacityDialog(inner)) {
            onFound(inner);
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    return function disconnect() {
      try { observer.disconnect(); } catch (_) {}
    };
  }

  window.__zaiCapacity = {
    PHRASES,
    isCapacityDialog,
    findCapacityDialog,
    setupObserver,
  };

  console.debug("[zai-enhancer] capacity-common ready");
})();
