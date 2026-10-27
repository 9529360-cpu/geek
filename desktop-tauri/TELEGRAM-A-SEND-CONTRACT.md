# Telegram Web A send boundary

## Decision and evidence scope

Web A has a production Worker protocol that can correlate a staged message with its
server acknowledgement. Its current text sender also unconditionally clears the
destination's server draft. The latter prevents using that sender for Geek's
draft-preserving interactive translation or background broadcast contract.

This finding is separate from automatic incoming translation, whose document-start
observer only reads production events. No account, message, payment, draft mutation
or live Telegram send was used for this investigation.

The page composer path is shipped anyway, matching the original Electron client, and
it does clear the synced cloud draft. The recheck below records why that clear cannot
be removed without a hack. WhatsApp and Telegram K keep their existing draft behavior.

Official source is fixed to Ajaxy/telegram-tt commit
`f67a40879a7d78c2683ec5a296cf55bc22417d56`. This establishes the source contract;
it does not identify the exact asset revision deployed to every Telegram session.

| Official file | Git blob |
| --- | --- |
| [worker/connector.ts][connector] | `acc17b37d0bd4f7626e1cab6574cb85b0286c627` |
| [worker/worker.ts][worker] | `2a8291c59336ec3b2e234f5d6204a0dd91dbcb7e` |
| [methods/init.ts][init] | `3039d95f0778318a96ad1b4ba12e8983272166e4` |
| [methods/messages.ts][messages] | `159063f02f3580c00ed3bbabdfff8ec8bb238ff4` |
| [methods/index.ts][methods] | `17dfbb1336f3f7d5ab68d5446a78dadf1e30a780` |
| [methods/client.ts][client] | `9d68171cf6bd7c994ceafb54d017978d83eadf47` |
| [types/index.ts][types] | `31d667fab1480564c5a56cbe1f3bc3c0488b7bb0` |
| [gramjsBuilders/index.ts][builders] | `179e27b429ec47102228cafb1d1f4b60d1ce6bae` |
| [composer/hooks/useDraft.ts][draft-hook] | `d75f0cc6a63cb607bcbe3d314c3f7d82bf7ba426` |
| [apiUpdaters/chats.ts][chat-updater] | `65f9cb2502215c2545e5cee5ed3ef391928d9d0f` |
| [actions/api/messages.ts][actions] | `ab245255c58f04e46b527f2d289baf141bf07f44` |
| [common/Composer.tsx][composer] | `248b109fb314e9b7664f9ba1d6a3cd2b039041ea` |

## Proven production message path

1. `connector.ts::callApiLocal` sends a `callMethod` envelope to the real module
   Worker. Its request `messageId` identifies a `methodResponse`.
   `worker.ts` dispatches through `methods/init.ts::callApi` and returns the method's
   response or error. These paths are not gated by `DEBUG`.
2. `messages.ts::sendMessageLocal` (lines 375–427) creates the official local message,
   publishes `newMessage`, and returns that message with its actual local ID.
   It already mutates Telegram's local message list, so it must not run in a
   read-only catalog, translation, or pre-commit preparation phase.
3. `sendMessage` (676–685) accepts that exact message as `params.localMessage` and
   passes it to `sendApiMessage`. This avoids identifying a new local row by its
   text, timing, or position. The target is the genuine `ApiChat`; user/channel sends
   consume its `accessHash` in `buildInputPeer` (builders lines 95–113).
4. `sendApiMessage` creates its own MTProto random ID. Its ordinary text branch
   awaits the real server request. `handleLocalMessageUpdate` (3047–3132) converts
   `UpdateShortSentMessage` or `UpdateMessageID` into `updateMessageSendSucceeded`,
   carrying the original `chatId`, exact `localId`, and resulting server message ID.
5. The send method's fulfilled response is **not an acknowledgement**: its async body
   has no success value, and its catch emits `updateMessageSendFailed` without
   rethrowing. A fulfilled `methodResponse` alone cannot mark a job successful.
   Missing acknowledgement, connection loss, or an unclassified error after the
   network boundary must remain uncertain and must not cause automatic resending.

## The draft-preservation gap

`messages.ts::sendApiMessage` sets `clearDraft: true` in shared send arguments at
line 603. `SendMessageParams` (types lines 850–891) has no corresponding override.
`wasDrafted` describes local UI handling; it does not control this flag.
The [official Telegram draft contract][draft-api] states that a send with
`clear_draft` clears the destination draft. Draft updates synchronize devices.

The Web A UI does not provide a substitute compare-and-swap guarantee:

- `apiUpdaters/chats.ts` handles `draftMessage` by replacing the chat/thread draft
  (497–507), without comparing a frozen source text or draft version.
- `useDraft.ts` protects the current editor from an empty draft while `isTouched`
  is true (127). A clean, synchronized draft has no such protection; the next
  branch can clear the editor when the draft disappears. This local hook does not
  preserve the server draft or drafts on other devices.
- `actions/api/messages.ts::saveDraft` updates local state and then saves remotely.
  Its local reference check only protects completion of that save. Restoring a
  captured draft after send would be a new write without server-side version
  comparison and could replace a newer draft. That is not a safe compensation.

Consequently, checking that the composer is unchanged or currently empty cannot
prove that background sending will preserve the destination's synchronized draft.
This is a contract-level limitation; no real-account loss was deliberately induced.

## Checked alternatives

| Candidate | Why it does not satisfy this contract |
| --- | --- |
| `sendMessage` or exported `sendApiMessage` | Both reach the same hard-coded draft-clearing arguments. |
| Add `clearDraft: false` to the request object | The function destructures known options and constructs its own arguments; the extra field is unused. |
| Raw `invokeRequest` through Worker RPC | `methods/index.ts` does not export it. `self.invoke` and `self.GramJs` are installed only inside `DEBUG` in `client.ts`. |
| `SendMultiMedia` or inline-bot sends | They also set draft clearing and are different message operations. |
| Forward, edit, or send a scheduled message | They operate on existing or scheduled messages and cannot substitute for a new arbitrary plain-text send. |
| Save and restore the draft around sending | There is no atomic draft-version check across the server send and the later restoration. |
| Fill the editor and synthesize submit | It changes the source draft, delegates to the same platform send, and does not provide an exact server receipt. |

No Worker text rewriting, debug-mode activation, fabricated platform update, general
method bridge, or authentication extraction is part of the proposed adapter.

## Shipped page path and 2026-10-27 recheck

Geek's Telegram A send translation and text broadcast do not call `sendApiMessage`.
`guest/page-input.js` selects the composer, runs `document.execCommand('insertText')`,
and clicks Telegram's own send control. That is the original Electron composer
replacement. Telegram saves the replacement into the synced draft, then its sender
clears that draft.

On 2026-10-27, current `Ajaxy/telegram-tt` `master` still hardcodes the clear. This
recheck is newer than the pinned commit above and was read from the public source;
it did not send a message or touch a draft:

- `src/api/gramjs/methods/messages.ts` line 603 sets `clearDraft: true` on the shared
  `sendApiMessage` arguments.
- The same file line 987 sets `clearDraft: true` for `messages.SendMultiMedia`.
- `src/types/index.ts` `SendMessageParams` (lines 862–903) still has no `clearDraft`
  field. `wasDrafted` (line 888) only describes local editor handling.

A fix is not feasible without a hack:

- An extra `clearDraft: false` on a request never reaches the hardcoded argument.
- Restoring the previous draft after send is a second remote write with no server
  version compare and can overwrite a newer draft from another device.
- `invokeRequest` and GramJS are installed only in Telegram's DEBUG build.
- Patching the page bundle, or synthesizing a different submit, still ends in the
  same sender.

The page path stays, with this known draft clear. It is not changed by this recheck.

## Original Electron active paths

The original files were inspected without modification. Their active mechanics do
not contain a reusable preserve-draft primitive:

- [ui/translation-adapters.js](../ui/translation-adapters.js),
  `installTelegramTranslation/translateAndSend`, intercepts Enter/send and requests
  `outgoing-send`. It blocks trusted `beforeinput` while its send lock is held.
- [ui/app.js](../ui/app.js), `executePlatformOutgoingSendIntent`, freezes the visible
  chat/body and invokes [send-intent-executor.js](../ui/send-intent-executor.js).
  The executor rewrites the composer with the translation, then calls `sendText`.
- [platform-host-adapters.js](../ui/platform-host-adapters.js), Telegram factory,
  uses Electron `insertText` after selecting the editor contents.
  [src/webview-ipc.cjs](../src/webview-ipc.cjs), `webview:commit-submit`, validates
  chat/body and issues native Enter. The adapter calls the result `SENT` after
  message count increases and the editor becomes empty; it does not track a
  Telegram local ID or server acknowledgement.
- [broadcast-runtime.js](../ui/broadcast-runtime.js) opens each target, replaces its
  composer text, and calls `sendText('')`. There is no destination-draft snapshot or
  restoration. In this inspected source the call also omits the expected chat/body
  required by the Telegram host adapter, so it cannot establish a reusable working
  direct-send contract merely because a legacy transport definition exists.
- Its attachment branch calls
  [src/telegram-native-attachments.cjs](../src/telegram-native-attachments.cjs),
  `sendTelegramAttachmentsViaCdp`: native file chooser, caption replacement, real
  click, and disappearance of the attachment editor. This is neither a server ACK
  nor an independent draft-preserving text transport.

## Minimum adapter after the missing capability exists

Keep the current Rust SendIntent and broadcast owners. A private document-start
capability may bind one real Worker, current Telegram user, and document generation;
retain only bounded, authoritative target metadata inside the guest. Raw Worker
handles, access hashes, arbitrary method names, and authentication data must not be
exposed through the shell or native IPC.

The finite text operation must accept a frozen target/body and single-use owner
permit, use the official local-message ID, and settle only the matching real ACK.
Replacements, reconnects, account changes, missing ACKs, and late responses must
invalidate or conservatively settle that operation. The current incoming observer
is read-only and does not already implement this sending capability.

The concrete next prerequisite for a draft-preserving send is a production-accessible
text-send method that preserves drafts, or an equally narrow platform seam with that
verified behavior. After that, validate the actual adapter against official-shaped
Worker responses: same-text concurrent messages, wrong local ID, failed send, missing
ACK, replacement Worker, and a newer draft while the original send is pending. The
page-script path above is already shipped and clears the cloud draft. A
draft-preserving Worker adapter must not be advertised before this boundary is
satisfied.

[connector]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/api/gramjs/worker/connector.ts
[worker]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/api/gramjs/worker/worker.ts
[init]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/api/gramjs/methods/init.ts
[messages]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/api/gramjs/methods/messages.ts
[methods]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/api/gramjs/methods/index.ts
[client]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/api/gramjs/methods/client.ts
[types]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/types/index.ts
[builders]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/api/gramjs/gramjsBuilders/index.ts
[draft-hook]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/components/middle/composer/hooks/useDraft.ts
[chat-updater]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/global/actions/apiUpdaters/chats.ts
[actions]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/global/actions/api/messages.ts
[composer]: https://github.com/Ajaxy/telegram-tt/blob/f67a40879a7d78c2683ec5a296cf55bc22417d56/src/components/common/Composer.tsx
[draft-api]: https://core.telegram.org/api/drafts
