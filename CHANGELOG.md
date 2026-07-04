# Changelog

## v0.10.2 — 2026-07-04 (remoção do toggle de previews)
- **Removed:** Toggle "Ocultar previews de arquivos" da guia Configurações
  - A abordagem via CSS não funcionava bem — o espaço do preview continuava ocupado e aparecia um "buraco branco" no dark mode
  - Não conseguimos reproduzir o cenário de teste de forma confiável pra validar a abordagem alternativa (clicar no botão X nativo do z.ai)
  - Removido: arquivo `content/artifacts.js`
  - Removida: seção "Arquivos gerados" da guia Configurações
  - Removida: entrada `artifacts.js` do `manifest.json`
  - Storage key `artifactsHidden` (se já foi setada por algum usuário) é ignorada — não causa erro, só fica órfã

## v0.10.0 — 2026-07-04 (toggle de previews + aba Anotações)
- **Feat:** Nova aba "Anotações" (4ª guia na sidebar)
  - Textarea livre pra anotações rápidas
  - Persiste em `storage.local` com debounce de 500ms
  - Sincroniza entre abas
  - Status em tempo real: contagem de palavras, caracteres e linhas
  - Botão "Limpar" com confirmação
- **UI:** Sidebar agora tem 4 guias: Auto-Send, Prompts, Anotações, Config.

## v0.9.0 — 2026-07-04 (limpeza da UI + fonte maior + delay movido)
- **Removed:** Aviso fixo "ℹ A fila envia automaticamente..." (redundante)
- **Refactor:** "Delay entre mensagens" movido de Auto-Send pra Configurações
- **Visual:** Aumento geral de fonte pra combinar com z.ai (sidebar 15px, labels 14px, sections 12px)

## v0.8.0 — 2026-07-04 (sidebar com guias)
- **Feat:** Sidebar agora tem 3 guias (Auto-Send, Prompts, Configurações)
- **Feat:** Botão "Limpar fila" inline com status pill + confirmação

## v0.7.0 — 2026-07-04 (visual redesign to match z.ai)
- **Visual:** Refactor de todo CSS pra usar design tokens do z.ai (Geist font, paleta monocromática, 6/8/12px radii)
- **Dark mode fix:** Suporte à classe `.dark` no `<html>` do z.ai
- **FAB redesign:** Menor (40×40), ícone SVG, sem roxo

## v0.6.0 — 2026-07-04 (sidebar layout + always-on queue)
- **Feat:** Sidebar fixa do lado direito (360px, full height)
- **Feat:** Auto-send queue ALWAYS-ON

## v0.5.0 — 2026-07-04 (AMO-ready release)
- **Manifest:** AMO-compliant (data_collection_permissions, gecko_android, strict_min_version 140/142)
- **Feat:** Keyboard shortcuts (Ctrl+Shift+Z, Alt+Shift+S, Alt+Shift+X)
- **Feat:** Onboarding page on first install
- **Docs:** README, PRIVACY, CONTRIBUTING, issue templates
- **Lint:** 0 errors, 0 warnings, 0 notices

## v0.4.0 — 2026-07-04 (biblioteca de prompts)
- **Feat:** Prompts com variáveis {{mustache}}, import .txt/.md, export .md

## v0.3.0 — 2026-07-04 (auto-send + in-page panel)
- **Feat:** Auto-Send Queue + Painel flutuante + Estatísticas

## v0.2.0 — 2026-07-04 (build limpo)
- **Fix:** toast.js sem innerHTML / popup.js sem executeScript

## v0.1.0 — 2026-07-03 (release inicial)
- Detecção de fim de resposta em 3 camadas + Som + Toast + Notificação nativa
