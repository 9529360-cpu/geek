# WhatsApp SendIntent real-client smoke

This runbook covers the WhatsApp interactive text-send SendIntent path without treating uncontrolled real chats as an automated test fixture.

## What the default preflight proves

Run:

```powershell
node scripts/whatsapp-send-intent-real-client-smoke.cjs
```

The command is read-only. It checks the currently active WhatsApp account and reports only bounded booleans/state codes for:

- the account/WebView binding;
- WA-JS readiness and populated chat-list availability;
- whether a current chat actually exists;
- whether the composer exists and, separately, whether it is empty;
- the translation bridge;
- the v9 direct-composer controller and shared trusted-submit/SendIntent runtime.

It does not click a chat, mark a customer conversation read, insert text, create a submit permit, dispatch Enter, or send a message. In particular, `CHAT_LIST_READY_NO_ACTIVE_CHAT` means the account and chat list are healthy but there is no current conversation, so no composer should exist.

The output intentionally excludes recipient IDs, chat titles, message bodies, credentials, QR data, and other user content.

## Repository-controlled synthetic Electron proof

The Windows WhatsApp runtime E2E uses the isolated `geek-e2e-*` profile and a disposable synthetic chat/composer. It validates the real runtime chain:

`native WebView input -> trusted preload observation -> guest bridge -> shared SendIntent owner -> WebView IPC commit guard -> native Enter -> terminal sent classification`

The synthetic page behavior only completes after the real `data-geek-native-submit-commit` marker is present. The test restores the unauthenticated runtime afterward and asserts that no real chat was opened.

This is strong mechanism evidence, but it is not authenticated WhatsApp delivery evidence.

## Authenticated send evidence

Authenticated delivery is deliberately separate. Use only a maintainer-controlled WhatsApp test account and test conversation. Do not automate a random row from a real customer chat list.

The maintained acceptance matrix remains `docs/translation-real-client-smoke.md`. A real-send claim requires that matrix's controlled ordinary/translated evidence, including exactly-once native commit and confirmation from the authenticated WhatsApp surface.

Do not weaken this distinction because CI or the synthetic runtime E2E is green.
