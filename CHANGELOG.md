# Changelog

## v0.14.2 — 2026-07-21 (popup theme + onboarding language fix)
- **Fix (popup):** versão no header do popup agora é lida dinamicamente do manifest (`browser.runtime.getManifest().version`) — antes era hardcoded `v0.12.1` e nunca atualizava, dando a impressão de que o popup estava rodando uma versão velha.
- **Style (popup):** tema roxo clássico (`#7c3aed`) reforçado e documentado como intencional no `popup.css` — distinto do painel in-page que segue os tokens do z.ai (`#9e77ed`). Adicionadas:
  - `--accent-hover` (`#6d28d9` light / `#c4b5fd` dark) para hover states mais profundos em vez de `filter: brightness(1.1)`
  - `--accent-soft` para backgrounds sutis
  - `box-shadow` roxo no logo e botão primário pra destacar a marca
  - Dark mode agora usa roxo mais claro (`#a78bfa`) pra legibilidade
- **Fix (onboarding):** seletor de idioma movido do canto superior direito (absoluto, fácil de não ver) para uma seção `<section class="language">` logo após o hero, com:
  - Título "Idioma" / "Language" / "语言" / "Idioma"
  - Descrição explicando o que a configuração afeta
  - Select maior e estilizado, com focus ring roxo
- **Fix (onboarding):** versão do rodapé agora também é dinâmica (antes era `v0.12.1` hardcoded).
- **i18n:** adicionadas chaves `onboarding.language_title` e `onboarding.language_desc` em pt-BR, en-US, zh-CN, es.
- **i18n:** `popup.hint` e `onboarding.how_2` atualizados em todas as 4 línguas — antes diziam "canto inferior direito" / "bottom-right corner" (posição antiga do FAB); agora dizem "canto direito (verticalmente centralizado)" / "right side (vertically centered)" pra refletir a nova posição do FAB introduzida no v0.14.0.

## v0.14.1 — 2026-07-21 (refactor + Agent-mode bugfix)
- **Fix (crítico):** refresh-retry não cria mais chats novos em conversas ativas.
  - Antes: após o refresh, sempre clicava no botão "Agent" — em URLs `https://chat.z.ai/c/{uuid}` isso criava um chat novo, perdendo o contexto da conversa
  - Agora: só clica em "Agent" se a URL for a raiz (`https://chat.z.ai/`). Em chat ativo, apenas recarrega a URL e reenvia — o modo Agent já está preservado pelo chat existente
  - Logs e toasts agora indicam se o ciclo está em "root URL" ou "active chat" para facilitar o debug
- **Refactor:** código compartilhado entre `dialog-killer.js` e `refresh-retry.js` extraído para `content/capacity-common.js`.
  - Frases de capacidade, `isCapacityDialog()`, `findCapacityDialog()`, `setupObserver()` agora vivem em um único lugar
  - Os dois módulos sempre concordam no que é um dialog de capacidade — antes cada um tinha sua cópia da lista de frases
  - API pública em `window.__zaiCapacity` para uso futuro
- **Docs:** README simplificado — removida a lista detalhada de features e o roadmap. Fica só Why/Install/How it works/Privacy/Permissions/Layout/Development/License.
- **Manifest:** `capacity-common.js` carregado antes de `dialog-killer.js` e `refresh-retry.js` (dependência).

## v0.14.0 — 2026-07-21 (refresh-retry: hard retry on capacity dialog)
- **Feat:** New "hard retry" mode for the capacity dialog — when the "Model is at capacity" dialog appears, the extension now copies the textarea text, refreshes the page, clicks the "Agent" mode button, and resends the message. It keeps doing this until the message succeeds (or max attempts is reached).
  - New content script `content/refresh-retry.js` — self-contained MutationObserver that detects the same capacity phrases as `dialog-killer.js` and triggers the refresh-retry flow
  - Pending retry is persisted to `browser.storage.local` (`refreshRetry_pending` key) so it survives the page reload
  - On page load, restores the message, finds the "Agent" mode button via multiple strategies (aria-label, role=tab, button text, data-mode, title), clicks it if not already active, then sets the textarea value and clicks send
  - Success is detected via `agent:done` event without error — clears the pending retry
  - Failure (dialog reappears) triggers another refresh cycle, up to `refreshRetryMaxAttempts` (default 10)
  - Stale retries (older than 1 hour) are auto-dropped on next page load
  - Cooldown (`refreshRetryCooldownMs`, default 3000ms) prevents infinite refresh loops
  - Toasts at every step so the user knows what's happening ("Model at capacity — retrying (1/10)", "Resuming retry…", "Message sent successfully!")
  - Public API on `window.__zaiRefreshRetry`: `getPending()`, `isEnabled()`, `clear()`, `triggerNow()`, `scanNow()`
  - Emits bus events: `refresh-retry:kicked-off`, `refresh-retry:resumed`, `refresh-retry:resent`, `refresh-retry:success`, `refresh-retry:giveup`, `refresh-retry:timeout`
- **Feat (toast API):** Exposed `window.__zaiToast.show({title, message, icon, accent, durationMs})` so other content scripts can fire custom toasts without going through the bus.
- **Settings:** New options under "Reenvio com refresh (hard retry)":
  - "Ativar reenvio com refresh" (default: ON)
  - "Máximo de tentativas" (default: 10, max 100)
  - "Esperar página carregar (ms)" (default: 3000)
  - "Esperar após clicar em Agent (ms)" (default: 1000)
  - "Cooldown entre refreshes (ms)" (default: 3000)

## v0.13.0 — 2026-07-10 (auto-dismiss capacity dialog + auto-retry)
- **Feat:** Auto-dismiss do dialog "Currently in peak hours" / "Model is at capacity" que o chat.z.ai mostra quando o GLM-5.2 está em overload.
  - Novo content script `content/dialog-killer.js` monitora a página via `MutationObserver` (childList + subtree, sem attributes — overhead mínimo)
  - Quando detecta um `[role=dialog][aria-modal=true]` cujo texto contém frases como "peak hours", "intensifying the coordination of resources", "switch to glm-5-turbo", clica automaticamente no botão `[data-dialog-close]` (o X no canto)
  - Detecta também via scan inicial (caso o dialog já esteja aberto quando a extensão carrega)
  - Stats disponíveis em `window.__zaiDialogKiller.stats` (total fechado, último timestamp)
  - Emite eventos `dialog:dismissed`, `dialog:retry-sent`, `dialog:retry-giveup`, `dialog:retry-aborted` no `__zaiBus`

- **Feat:** Auto-retry — após fechar o dialog de capacidade, espera e reenvia automaticamente a última mensagem do usuário.
  - `content/page-hook.js` agora captura o body do POST `/api/v2/chat/completions` (antes de enviar, via `Request.clone()`), extrai a última mensagem com `role=user` e guarda em `window.__zaiLastUserMessage`
  - Suporta formatos OpenAI-compatible: `content` pode ser string ou array de `{type:"text", text:"..."}`
  - Quando o dialog é fechado, `dialog-killer.js` espera `retryDelayMs` (default 4000ms) e:
    1. Verifica se o agente não está gerando (sem `[aria-label="Stop"]` visível) — se estiver, aborta (a request pode ter chegado a tempo)
    2. Seta o valor do `textarea[placeholder="Send a Message"]` via native setter + dispatch `input` event (necessário pro Svelte reagir)
    3. Clica no `#send-message-button`
  - Limita a `retryMaxAttempts` (default 3) tentativas por mensagem
  - Dedupe: não reenvia a mesma mensagem capturada duas vezes no mesmo turno
  - Reseta o contador quando uma NOVA mensagem é capturada (turno novo)

- **Settings:** Novas opções em `about:addons` → Configurações:
  - "Auto-fechar dialog de capacidade" (default: ON)
  - "Modo de match" → Substring (recomendado) ou Exato (estrito)
  - "Reenviar mensagem após capacity" (default: ON)
  - "Esperar antes de reenviar (ms)" (default: 4000)
  - "Máximo de tentativas" (default: 3, max 20)
  - "Janela de observação (ms)" (default: 8000)

- **Phrases matcheadas (case-insensitive substring):**
  - `peak hours`
  - `currently in peak`
  - `model is currently at capacity`
  - `intensifying the coordination of resources`
  - `switch to glm-5-turbo`
  - `switch to glm-4.7` (fallback caso troquem o modelo sugerido)

## v0.12.3 — 2026-07-08 (fix Android + fix detecção)
- **Fix (crítico):** Detecção de fim de mensagem quebrada desde v0.11.0
  - `page-hook.js` linha 52 referenciava `cloneForObservation` que nunca era definido — `ReferenceError` síncrono fazia `stream-end` disparar com erro imediatamente após `stream-start`
  - Sintoma: som/toast/fila só funcionavam quando o stream falhava dentro da janela de confirmação de 2.5s (respostas curtas ou com erro)
  - Corrigido: agora `response.clone()` é chamado e o stream-end dispara quando o body do clone é totalmente drenado
  - `detectors.js` agora propaga `error` do `stream-end` até o evento `agent:done` (o handler de erro em `autosend.js` estava morto)
  - `toast.js`, `sound.js`, `background.js` distinguem erro de sucesso (toast âmbar, sem chime, notificação nativa diferente)
- **Fix (Android):** FAB (botão flutuante) no Android agora fica no canto superior direito em vez de inferior direito
  - No Android o botão de envio do chat fica no canto inferior direito, sobrepondo o FAB
  - Detectado via `navigator.userAgent` (regex `/Android/i`), adiciona classe `zai-mobile` ao `<html>`
  - CSS move o FAB para `top: 12px; right: 12px` e o esconde (`top: -50px`) quando o painel está aberto
- **UI:** Removido o label "LANGUAGE" / "Language" antes do seletor de idioma (estava quebrando em larguras apertadas, exibindo "langua [select] ge")
