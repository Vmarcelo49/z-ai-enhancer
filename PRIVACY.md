# Privacy Policy — Z.ai Enhancer

_Last updated: 2026-07-04_

## Summary

**Z.ai Enhancer does not collect, transmit, sell, or share any personal data.** All data stays on your device, in Firefox's local extension storage. Nothing is sent to the extension developer or any third party.

This extension works on `https://chat.z.ai/*` and adds a floating panel with notifications, an auto-send queue, and a prompt library. Your prompts, queue, and stats are stored locally and never leave your browser.

---

## What data the extension stores (locally, on your device)

All data is kept in `browser.storage.local`, which is scoped to this extension only and can be cleared at any time via `about:addons → Remove` or from the extension's options page.

| Storage key | What it contains | Purpose |
|---|---|---|
| `soundEnabled`, `toastEnabled`, `nativeEnabled`, `nativeOnlyWhenUnfocused`, `soundVolume`, `toastAutoDismissMs` | User preferences (booleans, numbers) | Persist UI toggle state between sessions |
| `autosend_queue` | Array of message strings + settings | Persistent auto-send queue |
| `prompts_library` | Array of prompt objects (title, body, category, tags, timestamps, use count) | Persistent prompt library |
| `stats_history` | Array of `{ts, durationMs, textLen, userStopped}` for the last 50 responses | Local statistics display |

**No sensitive content (passwords, payment info, personal identifiers) is ever stored.** The extension never reads or stores the contents of your Z.ai account, your authentication token, or your Z.ai chat history beyond what is needed to display the in-page panel.

## What the extension reads from chat.z.ai (in your browser, never transmitted)

To detect when the agent finishes responding and to send queued messages, the extension observes the following DOM elements **in your local browser only**:

- `[aria-label="Stop"]` — to know when the agent is generating
- `[aria-label="Copy"]` and `[aria-label="Regenerate"]` — to know when the agent finished
- `#chat-input` (textarea) — to programmatically set queued message text and submit the form
- Network requests to `/api/v2/chat/completions` — to detect stream start/end (only the URL and timing are observed; **the request body and response content are never read**)

**The extension does not read, store, or transmit the contents of your conversations with the Z.ai agent.** Network observation is limited to URL pattern matching and stream-end timing only.

## What the extension sends over the network

**Nothing.** The extension has no `fetch()` calls to any external server. It does not phone home, does not check for updates beyond Firefox's built-in add-on updater, and does not report usage telemetry.

The only network operations the extension performs are:

1. **Programmatic form submission** on `chat.z.ai` — when you click a prompt or queue item, the extension fills the `#chat-input` textarea and calls `form.requestSubmit()`. This is identical to you typing and pressing Enter yourself; the request goes directly from your browser to Z.ai's servers, exactly as it would without the extension.
2. **Cloudflare Tunnel usage by the Z.ai site itself** — not initiated by this extension.

## Third-party services

This extension does **not** use any third-party service, analytics SDK, error reporter, or external library loaded from a CDN. All code is bundled inside the extension package.

## Permissions and why each is needed

| Permission | Why it's needed |
|---|---|
| `storage` | Save your prompts, queue, stats, and preferences locally |
| `notifications` | Show a native Firefox notification when the agent finishes (only if you enabled it, and only when the chat.z.ai tab is not focused) |
| `host_permissions: https://chat.z.ai/*` | Inject the floating panel and observe DOM/network on `chat.z.ai` only |

No `<all_urls>`, no `tabs`, no `webRequest`, no `clipboardRead`, no `cookies`, no `history`. The extension cannot read or modify any site other than `chat.z.ai`.

## Data deletion

To delete all data stored by this extension:

1. Go to `about:addons` in Firefox
2. Find "Z.ai Enhancer" → click **Remove**
3. All `storage.local` data is wiped immediately

You can also clear individual data from the extension's options page (`about:addons → Z.ai Enhancer → ⋯ → Preferences`).

## Children's privacy

The extension is intended for general audiences using Z.ai. It does not knowingly collect any data from anyone, including children under 13. No age-gating is performed because no data is collected.

## Changes to this policy

Any future changes to this policy will be documented in this file, dated, and shipped with a new version of the extension. Mozilla's add-on review process must approve any update before it reaches users.

## Contact

For privacy questions or data deletion requests, open an issue at:  
**https://github.com/Vmarcelo49/z-ai-enhancer/issues**

(Please do not include private information in public issues. For sensitive matters, mark the issue as a security advisory.)
