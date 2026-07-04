/* content/send-utils.js
 * Shared utility for programmatic message sending to chat.z.ai.
 * Used by both autosend.js and prompts.js — avoids code duplication.
 *
 * Proven method (from research):
 *   1. Set textarea value via native setter (bypasses Svelte's reactive proxy)
 *   2. Dispatch InputEvent('input', {bubbles:true}) so Svelte updates the Send button
 *   3. Call form.requestSubmit() — Z.ai's own JS handles the rest
 *
 * Public API on window.__zaiSend:
 *   sendMessage(text) → Promise<{ok: true} | {ok: false, reason: string}>
 */
(function () {
  window.__zaiSend = {
    async sendMessage(text) {
      const ta = document.getElementById("chat-input");
      if (!ta) return { ok: false, reason: "no_textarea" };
      if (document.querySelector('[aria-label="Stop"]')) {
        return { ok: false, reason: "agent_running" };
      }

      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      setter.call(ta, text);
      ta.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "x"
        })
      );

      const form = ta.closest("form");
      if (!form) return { ok: false, reason: "no_form" };

      return new Promise((resolve) => {
        setTimeout(() => {
          try {
            form.requestSubmit();
            resolve({ ok: true });
          } catch (e) {
            resolve({ ok: false, reason: "submit_failed", error: String(e) });
          }
        }, 60);
      });
    }
  };
  console.debug("[zai-enhancer] send-utils ready");
})();
