# Contributing to Z.ai Enhancer

Thanks for your interest in improving Z.ai Enhancer! This is a small project — contribution flow is intentionally lightweight.

## Quick start

```bash
git clone https://github.com/Vmarcelo49/z-ai-enhancer.git
cd z-ai-enhancer
npx web-ext lint         # should be 0 errors, 0 warnings
npx web-ext run          # launch Firefox with the extension loaded
```

Open `https://chat.z.ai/` in the launched Firefox — you should see the FAB in the bottom-right corner.

## Code style

- **Vanilla JS, no build step.** No bundler, no transpiler, no minifier, no TypeScript. Reviewers need to be able to read the source as-is (Mozilla AMO requirement).
- **ES modules in content scripts are NOT used** — content scripts share an isolated world and run in declaration order. Each file is an IIFE that registers itself on `window.__zaiBus` or `window.__zai<PascalCase>`.
- **No `innerHTML` with dynamic values.** Use `createElement` / `appendChild` / `textContent`. Mozilla's linter flags `UNSAFE_VAR_ASSIGNMENT`.
- **2-space indentation, semicolons, double quotes for strings.** Match the surrounding code.
- **No `eval`, no `new Function()`, no `setTimeout(string, ...)`.** Auto-reject on AMO.

## Architecture (10-second tour)

```
event-bus.js  ──►  window.__zaiBus  (pub/sub shared by all modules)
                          ▲
                          │
   ┌──────────────────────┼──────────────────────┐
   │                      │                      │
detectors.js        prompts.js             autosend.js
(emits agent:*)     (CRUD + applyToChat)   (queue motor)
   │
   ▼
panel.js  ◄── reads/writes via window.__zai* APIs
(FAB + panel UI + modals)

page-hook.js  ──►  injected into MAIN world via <script> tag
                  (overrides window.fetch, posts stream-start/end
                   messages back to isolated world via postMessage)
```

## Testing your change

1. **Lint clean:** `npx web-ext lint` must report 0 errors, 0 warnings.
2. **Manual test on chat.z.ai:**
   - Sign in
   - Send a message — confirm sound + toast fire when agent finishes
   - Add a prompt, click it — confirm it sends to chat
   - Add 2 items to auto-send queue, start it — confirm both send sequentially
3. **Reload test:** reload the page mid-queue — confirm queue pauses with a notice (doesn't auto-resume).
4. **Dark mode test:** toggle Firefox to dark theme — confirm panel adapts.

## Submitting a PR

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit with a clear message: `feat: add cronômetro during generation`
4. Open a PR explaining **what** changed and **why**

If your change touches permissions or adds a new feature, mention it explicitly in the PR description — it affects AMO review.

## Reporting bugs

Open an issue with:

- Firefox version
- Steps to reproduce
- Expected vs actual behavior
- Console output from `about:debugging → Z.ai Enhancer → Inspect` (if there are errors)

## Code of conduct

Be kind. Be patient with new contributors. Assume good faith.
