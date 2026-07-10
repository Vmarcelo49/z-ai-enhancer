# Changelog

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
