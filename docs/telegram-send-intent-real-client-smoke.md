# Telegram SendIntent real-client smoke

This is a maintainer-only validation of the Telegram translated-send path at the current repository revision. It does not change production send behavior or replace GitHub-hosted CI.

## Before running

Use a test Telegram account and a chat that the maintainer controls. In the Geek window, manually select that account and chat, confirm outgoing translation is enabled for that chat, and leave the composer empty. Do not use a customer conversation. The script never chooses accounts or chats.

Run the read-only preflight first:

```powershell
node .\scripts\telegram-send-intent-real-client-smoke.cjs --preflight
```

With no arguments, the script also defaults to preflight. It checks the active Telegram account, WebView, translation bridge, SendIntent runtime, current chat, outgoing-translation setting, and empty composer. It does not insert text, create a submit permit, dispatch a gesture, or send a message.

## One-message execution

Execution is blocked whenever the `CI` environment variable exists, including an empty value. On the maintainer machine, set the exact confirmation and invoke `--execute`:

```powershell
$env:GEEK_TELEGRAM_SEND_INTENT_SMOKE_CONFIRM='I_CONFIRM_ONE_TEST_MESSAGE_TO_ACTIVE_MAINTAINER_CONTROLLED_TELEGRAM_CHAT'
node .\scripts\telegram-send-intent-real-client-smoke.cjs --execute
Remove-Item Env:GEEK_TELEGRAM_SEND_INTENT_SMOKE_CONFIRM
```

The script generates one fixed-format test message. It prepares that text in the currently selected composer, installs temporary result observation, then waits for the maintainer to press Enter or click Send in the Geek window. It never uses CDP to create a trusted gesture or call the send transport. The production submit-permit, SendIntent executor, composer rebind, commit guard, native send, and outcome classifier remain the owners of the send.

The production commit guard rechecks account, partition, platform, WebView generation, conversation, composer generation, and composer text immediately before the native send. The harness itself does not attempt another send after any owner result. If the context changes or CDP observation is lost after the operator prompt, the result is reported as ambiguous with an unknown commit count; inspect Telegram manually before taking any action. The script may clear its exact staged text only after a stable observation window ends without a request and the same account, chat, and exact text are still active. The summary includes a cleanupComplete boolean. When the smoke can safely clear staged text, this is true only if the observer was removed and the composer was verified clear; if false, close or reload the test client before another smoke run.

## Evidence and receipt

The script prints a fixed-shape JSON summary containing booleans, enums, and a timing bucket. It does not save an evidence file or emit account/chat identifiers, partition, username, URLs, tokens, message text, profile paths, or raw errors. Preserve only that sanitized summary if evidence is needed.

`recipientReceipt` remains `manual-pending` until the recipient side is checked separately. Record only pass/fail; do not copy message content or identifiers into evidence. A green automated test or preflight is not a real-send result.
