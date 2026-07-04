# Z.ai Enhancer

> A floating panel for [chat.z.ai](https://chat.z.ai) that notifies you when the agent finishes responding, queues messages for auto-send, and lets you build a reusable prompt library.

[![Firefox](https://img.shields.io/badge/Firefox-%E2%89%A5140-blue)](https://www.mozilla.org/firefox/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.5.0-purple)](#)

## Why

Z.ai is a great AI chat, but two things are missing out of the box:

1. **You never know when a long response is done** — you have to keep checking the tab.
2. **Repeating the same prompt patterns is tedious** — copy-paste from your notes, every single time.

Z.ai Enhancer fixes both. It adds a small floating panel directly on `chat.z.ai` with sound + visual alerts, an auto-send queue, and a personal prompt library with `{{variables}}`.

## Features

### 🔔 Notifications
- **Sound chime** when the agent finishes (synthesized via WebAudio — no asset files)
- **Toast** in the bottom-right corner with char count and duration
- **Native Firefox notification** when you're in another tab (optional)
- Detects manual Stop clicks — message changes to "interrupted" instead of "complete"

### 📚 Prompt library
- Save reusable prompts with `{{variable}}` placeholders
- Click a prompt → fill in the variables → it goes straight to the chat
- Import `.txt` and `.md` files (drag-and-drop or file picker)
- Export your whole library as Markdown for backup
- Built-in search by title, category, tags, or body
- 4 starter prompts included (explain like I'm 5, code review, summarize in bullets, translate to English)
- Tracks how many times each prompt was used

### 📨 Auto-send queue
- Schedule a sequence of messages — the next one is sent automatically when the agent finishes
- Set the delay between sends (1s–60s, default 2s)
- Safety limits: max 50 items, max 10k chars per message
- Auto-pauses if you click Stop, if the stream errors, or if you navigate away
- State persists across reloads (but never auto-resumes — safety)

### 📊 Stats
- Tracks the last 50 response durations
- Shows the average and 5 most recent in the panel

### 🎛 In-page panel (no toolbar clicking required)
- A small purple FAB in the bottom-right corner of `chat.z.ai`
- Click to open the full panel — never have to dig into the Firefox toolbar
- Dark/light mode automatic
- Respects `prefers-reduced-motion`

### ⌨️ Keyboard shortcuts
| Action | Shortcut |
|---|---|
| Open the panel on chat.z.ai | `Ctrl+Shift+Z` (macOS: `Cmd+Ctrl+Shift+Z`) |
| Toggle completion sound | `Alt+Shift+S` |
| Click the Stop button | `Alt+Shift+X` |

Customize at `about:addons → ⚙ → Extension Shortcuts`.

## Install

### From Firefox Add-ons (recommended once published)
_Search for "Z.ai Enhancer" on [addons.mozilla.org](https://addons.mozilla.org) once approved._

### For testing (developer build)
1. Clone or download this repo
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…** and select `manifest.json`

For permanent install on Firefox Stable, the extension must be signed by Mozilla — submit via [AMO Developer Hub](https://addons.mozilla.org/developers/).

## How it works (technical)

The extension uses **3 layered detectors** to know when the agent finishes:

| Layer | Signal | Latency | Reliability |
|---|---|---|---|
| L1 | Fetch to `/api/v2/chat/completions` ends (intercepted via `window.fetch` override in MAIN world) | ~50ms | high |
| L2 | `[aria-label="Stop"]` button disappears from DOM | ~100-300ms | medium |
| L3 | `[aria-label="Copy"]` button appears in last `.chat-assistant` message | ~200ms | high (confirmation) |

Final `agent:done` only fires when L1 + L3 agree within a 2.5s window — avoids false positives when you switch chats mid-response.

Auto-send uses a proven programmatic method:
1. Set textarea value via native setter (bypasses Svelte's reactive proxy)
2. Dispatch `InputEvent('input', {bubbles:true})` so Svelte updates the Send button
3. Call `form.requestSubmit()` — Z.ai's own JS handles the rest

No fetch interception for send — the site does the POST itself, so the extension is resilient to backend changes.

## Privacy

**This extension collects no personal data.** All prompts, queue, stats, and preferences are stored locally in `browser.storage.local` and never leave your device. No analytics, no telemetry, no remote code loading.

See [PRIVACY.md](PRIVACY.md) for the full policy.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your prompts, queue, stats, and preferences locally |
| `notifications` | Show a native Firefox notification when the agent finishes (only if enabled, only when tab is unfocused) |
| `host_permissions: https://chat.z.ai/*` | Inject the panel and observe DOM/network on `chat.z.ai` only |

No `<all_urls>`, no `tabs`, no `webRequest`, no `clipboardRead`, no `cookies`, no `history`.

## Project layout

```
z-ai-enhancer/
├── manifest.json             Firefox MV3 (gecko id + data_collection_permissions)
├── background.js             Event page — notifications + commands + onboarding
├── onboarding.html/.css      Welcome page shown on first install
├── content/
│   ├── event-bus.js          Shared pub/sub
│   ├── page-hook.js          MAIN world — overrides window.fetch for stream detection
│   ├── detectors.js          L1+L2+L3 agent:done detection
│   ├── sound.js              WebAudio chime
│   ├── toast.js + .css       In-page toast
│   ├── prompts.js            Prompt library (CRUD + import/export)
│   ├── autosend.js           Auto-send queue motor
│   ├── panel.js + .css       Floating panel UI (FAB + sections + modals)
│   ├── stats.js              Duration stats collector
│   └── main.js               Boot — injects page-hook + wires bus
├── icons/                    48/96/128 PNG
├── popup.html/.css/.js       Toolbar popup (quick toggle shortcut)
├── options.html/.js          Preferences page
├── PRIVACY.md                Privacy policy
├── CHANGELOG.md              Release notes
├── LICENSE                   MIT
└── README.md                 This file
```

## Development

```bash
git clone https://github.com/Vmarcelo49/z-ai-enhancer.git
cd z-ai-enhancer

# Lint (uses Mozilla's official web-ext CLI)
npx web-ext lint

# Package as .zip
zip -r z-ai-enhancer.zip . -x "*.DS_Store"

# Run in Firefox with hot reload (recommended)
npx web-ext run
```

### Requirements
- Firefox ≥ 140 (Desktop) or ≥ 142 (Android)
- No build step — vanilla JS, no bundler, no transpiler
- All source code is plain and readable (no minification, no obfuscation)

## Roadmap

- [ ] Cronômetro visível durante geração
- [ ] Auto-save conversation as Markdown
- [ ] Custom sound upload
- [ ] Multi-tab monitoring (dedupe notifications across tabs)
- [ ] i18n (English + Portuguese + Chinese)

See [open issues](https://github.com/Vmarcelo49/z-ai-enhancer/issues) for the full list. PRs welcome!

## License

MIT © [Vmarcelo](https://github.com/Vmarcelo49)
