# Telegram K finite send contract

This document records the production platform interface used by the Tauri K
adapter. It does not authorize a general Telegram RPC bridge. Interactive plain
text and whole-message plain-text replies remain in SendIntent/SendRunner;
broadcast text and files remain in the
existing Broadcast owner, checkpoint, scheduler and opaque attachment transfer.
No Telegram-specific persistent job document or second queue is introduced.

## Reviewed production source

The source below is fixed to the official `morethanwords/tweb` commit
`654ffd809aa402f31357db2a13c462b4e5b69a23`. Runtime projections fail closed if
the expected identity, method result or event shape is unavailable. The website
itself is not pinned by the application; a future upstream change requires
rechecking this contract.

| Source | Relevant evidence |
| --- | --- |
| [Bound manager factory][factory] | `createProxiedManagersForAccount`, lines 123–175 and 249–260: requests carry one explicit account number; the factory is mounted in the production page. |
| [Main-thread proxy][proxy] | Account-aware manager invocation and local history mirrors; the proxy is mounted on the page. |
| [Messages manager][messages] | `generateOutgoingMessage`, `beforeMessageSending`, file metadata/upload methods and the pending-to-final event sequence. |
| [File manager][files] | `upload`, lines 1088–1225; `cancelDownload`, lines 341–353, cancels matching upload promises as well as downloads. |
| [Document manager][documents] | `saveDoc`, lines 101–108, normalizes temporary document IDs to strings. |
| [Media UI][media-ui] | Media permissions, line 173 onward; live caption limit at line 311; video dimensions/duration at lines 1450–1495. |
| [API limits][limits] | `getLimit('caption')`, lines 366–402, selects the account's current default/premium caption limit. |
| [ChatInput][chat-input] | `getCurrentInputDraft`, lines 2551–2607; `initMessageReply`, lines 5659–5740; model-owned `replyElements` and `setTopInfo`, lines 5950–6022. |
| [Reply rendering][reply-render] | `ReplyContainer` renders the source message in its subtitle and the model-owned author title. |
| [Reply text][reply-text] / [preview cutoff][preview-cutoff] | `wrapMessageForReply` applies `limitSymbols(text, 100)`, whose default cutoff is 110 UTF-16 units. This is a whole-message preview, not a selected substring quote. |
| [PeerTitle][peer-title] | Constructor and `setOptions`, lines 82–121, expose the actual author's numeric identity through `data-peer-id`. |

The messages-manager blob is `f99649c8ce797ae070d1490a2b70c88b0834dc2a`;
file-manager blob `eff979f27ca000f07b79a9a116a9e0270dd2c019`; bound-factory blob
`9a1b0db9f5ea5fc4e46562a0b3636e50a3bfde95`; proxy blob
`7d1a12b4b252e33b90f566d113aed7e24a202e3d`.

## Ownership and target admission

Only an exact top-level `https://web.telegram.org/k/` document is admitted.
The broadcast adapter's first successful readiness/catalog capture freezes its
platform account, self identity, manager factory and event epoch. Changing the
internal Telegram account, including changing back, permanently retires that
bridge document. Native account UUID, view incarnation and generation continue
to fence every mailbox and source transfer.

Targets are canonical `tg:<peer>` IDs from real cached dialogs. Ordinary users,
basic groups and ordinary megagroups are admitted. Saved/self/service chats,
channels, forums, monoforums, migrated, paid, restricted, slow-mode and unknown
peer shapes are rejected. No chat is opened or focused to manufacture target
authority. The canonical broadcast safety guard remains in the active path.

Read-only preparation rechecks migration, bot-forum state, write permissions,
contact requirements, stars and the exact input peer. Text uses `send_plain`.
Media uses the specific `send_photos`, `send_videos` or `send_docs` right both
before upload and again before submission. Current caption permission is never
inferred from the text permission.

## Interactive whole-message text replies

The existing `SendContext::Reply { messageId, chatId }` is reused. For K,
`chatId` is the same canonical `tg:<peer>` as the outer intent, and `messageId`
is `tg:<peer>:<server-id>`. The server ID must be a positive signed 32-bit
integer. The local platform mid is not sent to native as a server ID.

Admission binds all of the following without changing the platform model:

- The actual active `ChatInput.replyToMsgId` equals the local mid in its current
  `draft.reply_to`, with no cross-chat, thread, monoforum, poll, story or partial
  quote option. `helperType` and `helperVisible` must identify an active reply.
- The account-bound proxy's exact `<peer>_history` mirror contains that same
  mid as an ordinary, already-sent message with a positive server ID. Its full
  text, model identity, author, date, edit version, flags and entities are frozen.
  The source must have no media, rich body, markup, pending/error/deleted state,
  ephemeral/TTL state or unknown special flags. Automatic ordinary emoji and
  line-break entities are admitted only when the preview retains passive text
  nodes and DIV/SPAN/BR elements with class/dir attributes. Image/canvas emoji,
  custom emoji and other rich preview DOM remain unavailable; other entities
  also fail closed.
- The input's own `replyElements.container/content` contains one visible reply
  region. Its subtitle agrees with the official text preview, and its actual
  `PeerTitle.data-peer-id` agrees with the history model's `fromId`. Every preview
  node identity is retained for comparison. An arbitrary matching DOM string
  or a fabricated reply ID cannot establish this binding.

An original message of at most 110 UTF-16 units has its complete trimmed text
in the preview. Longer messages display the first 100 units plus `...`, exactly
as the reviewed K renderer does. The complete source text remains in the proof;
changing only the invisible tail invalidates the old intent. This supports
replying to a whole ordinary text message. User-selected text quotes remain
unsupported. An already-edited, forwarded or replied plain-text source may be
the target: only that current same-chat message ID is referenced; its previous
forward/reply header is never copied into the new outgoing message.

Quote replacement, input/model/account changes and DOM mutation revoke the
snapshot. The official `message_edit`, `history_delete` and `dialog_flush`
events also advance its revision, including an edit that changes back before
the next read. Removing the authoritative source, replacing its model with an
equal-looking model or replacing an equal-looking preview cannot reuse a stale
permit. Opening an attachment or other modal also fences a prepared text send.

The readonly official `getInputReplyTo({ peerId, replyToMsgId })`, messages
manager lines 4798–4830, independently converts the frozen local mid into the
expected server int. It is checked in preparation and again before submission.
`generateOutgoingMessage(peer, { replyTo })` then creates the normal local reply
header through `generateReplyHeader`, lines 5189–5282. A finite projection keeps
only `{ _: 'messageReplyHeader', pFlags: {}, reply_to_msg_id: <local-mid> }` in
the pending message. Exactly one `messages.sendMessage` API call carries the
canonical `{ _: 'inputReplyToMessage', reply_to_msg_id: <server-id> }`, literal
translated body, empty entities and `clear_draft: false`. The high-level
`sendText`, composer mutation and draft-sync APIs are not invoked.

Final history messages normalize reply IDs back into local mids at messages
manager lines 7650–7668. The [message-ID manager][message-ids] strips an existing
offset before adding it, so the short-sent local-update path is idempotent for
megagroup mids. Exact pending append, sent-event temporary message, final
message and authoritative mirror must all retain the expected reply header.
Omitted, different, cross-peer, thread, partial, media or deleted-source reply
headers cannot confirm the intent. Plain text and broadcast media default to
explicitly requiring no reply at every one of these stages.

Confirmed interactive replies retain both the original composer text and its
reply helper. `draftCleared` remains false through the shared owner and native
outcome. The same unchanged source cannot be resent by a repeated gesture after
confirmation or an uncertain result. A proved zero-invocation preflight failure
can retain the same UUID and translated output for a new human attempt. The
existing SendIntent 50-second total deadline remains unchanged.

## Interactive attachment-caption boundary

K's interactive media popup is still unavailable for translated caption sends.
The fixed `showNewMediaPopup` is a Solid closure: `files`, `willAttach`, caption
`messageInputField`, media edit/conversion/scaled-file state and pending
`sendFileDetails` live inside it (media UI lines 196–274 and 305–307). Its public
handle, lines 2340–2347 and 2409, contains only `addFiles`, `setStarsAmount`,
`appendDrops` and `hide`; it does not expose the current authoritative selection
or caption model. Imported callers also retain their direct module reference,
so replacing the global function would not establish ownership of the current
popup and is not used.

There is a limited real File binding for document rows: `attachDocument`,
lines 1786–1869, creates a document with `file`, and [wrapDocument][document-wrapper],
lines 164–167, exposes that document as `docDiv.doc`. That fact does not expose
the popup's caption field model, the full current selection/order or its hidden
send/edit/conversion options. Ordinary photo/video previews lack this same
document-row File binding. This slice therefore cannot prove a complete
standard attachment-caption context without adding a second popup state owner.

The adapter does not recover source bytes from a blob URL, filename or image
preview, hook/replace the platform popup, or relax the native K attachment
guard. Broadcast files remain supported through their existing native-selected
immutable File transfer, which has a different, already explicit ownership
contract.

## Broadcast files and caption

The native selector explicitly classifies JPEG/PNG as images, MP4 as video and
other formats, including GIF/WebP/MP3, as documents. The UI displays this class.
The guest does not downgrade unsupported media silently. Original names, MIME
types and bytes remain unchanged. This slice does not implement photo resizing,
GIF conversion, audio messages, media editing, stickers or albums.

The existing limits remain ten selected files, 512 MiB per file and 1 GiB per
bundle. Empty files are rejected: the reviewed platform upload loop has no
completion for zero parts. The guest validates file metadata against the exact
immutable File produced by the native transfer, including name, MIME and size.

JPEG/PNG dimensions are read from at most the first 1 MiB of their real binary
headers, bounded to positive dimensions of at most 32768 per side. Unrecognized,
corrupt or unusually late JPEG headers fail before upload. MP4 dimensions and
duration come from a temporary HTMLVideoElement's `loadedmetadata` event, as in
the platform UI; errors/timeouts revoke the temporary URL. The original bytes
still have to satisfy Telegram's server media limits. This is not a transcoder
and does not claim that every file below the native size ceiling is accepted by
Telegram as a photo/video.

Files send serially in selection order. Only the final file carries the frozen,
expanded job text as its caption; earlier files use an empty caption. Empty
captions are allowed. Text is kept literally, with `entities: []`; Markdown is
not interpreted. The limit is the smaller of 1024 UTF-16 units and the current
`apiManager.getLimit('caption')` result. Native/UI enforce the 1024 ceiling and
the guest also checks the live platform limit before any upload. Ordinary text
continues to have its separate 4096-unit limit.

The whole bundle uses its existing target checkpoint. Its final `dispatch`
settles the last real attachment receipt without sending an extra text message.
There is no `sendMultiMedia`, dynamic recipient expansion or separate caption
owner. Tag-all and vcards remain unavailable for K.

## Exact platform submission sequence

1. `generateOutgoingMessage(peer, {})` creates the platform's fractional
   temporary message ID and random ID, without sending a message.
2. `makeDocumentAndMetaForSendingFile`, lines 3910–4117, creates its temporary
   media model and metadata. The adapter retains an explicit ordinary
   photo/document projection. Document uploads carry only filename attributes;
   MP4 additionally carries the verified ordinary video attribute.
3. `uploadMediaFile`, lines 2743–2804, uploads the selected File and returns an
   InputMedia value. It does not submit a chat message. No callback, function,
   URL, path or native filesystem capability is passed to that worker method.
4. After upload, permissions, identity and cancellation are checked again.
   `beforeMessageSending`, lines 4919–5051, stages one plain pending message in
   the original account. `invokeVoid` avoids returning the complete history map.
5. Exactly one `apiManager.invokeApiAfter('messages.sendMedia', ...)` invocation
   submits that pending random ID, input peer, uploaded media, literal caption,
   empty entities and `clear_draft: false`.
6. The returned Updates are processed by the original account's official
   updates manager. A short sent result is expanded through the same local
   `updateMessageID` / `updateNewMessage` sequence used by K text sending,
   retaining the returned server media. A malformed/unknown result is uncertain.

High-level `sendFile` is deliberately not called: lines 3488–3491 parse Markdown;
the method retains `message.send` and has paid-message recovery paths that can
create another send. The finite projection sends no `message.send`, callback or
retry closure across the worker boundary. SDK protocol recovery may retransmit
the same random ID; the application does not generate a fresh one to recover an
uncertain outcome.

The official [messages.sendMedia API][send-media] exposes `clear_draft` and
`entities`. [Uploaded photos][uploaded-photo] and [uploaded documents][uploaded-document]
are separate InputMedia constructors. Documents use `force_file` when native
selection explicitly classified them as files. No TTL, spoiler, reply,
send-as, scheduling, stars payment, suggested-post or rich-message options are
introduced by this adapter.

## Draft preservation

The adapter never invokes a composer clear, draft save, chat-open or input-write
method. Staging passes `clearDraft: false`; the message template has no `send`
closure, so the conditional draft-clearing/send branch at lines 5017–5041 cannot
run. The RPC independently passes `clear_draft: false`, leaving the destination's
cloud draft intact. Broadcast success does not clear the currently viewed draft.
Interactive plain K text still performs its existing exact-draft CAS after ACK.
Interactive replies keep both source text and reply helper after ACK.

## What confirms delivery

`history_append` acknowledges only that the exact local pending message exists.
An upload result, RPC fulfillment, elapsed timer, composer clear, global history
increment or unrelated same-text message does not confirm delivery.

The official finalizer at lines 12604–12722 associates random ID with temporary
ID, moves temporary media cache ownership, removes the temporary record, writes
the final history mirror and then emits `message_sent`.

The receipt matcher requires the original storage key, peer, fractional temp ID,
random ID, caption and temporary media identity. The final event must have an
ordinary outgoing message, positive integer server message ID and matching
platform mid, with no pending/error/rich state. Broadcast and plain sends require
no reply; interactive replies require the exact frozen reply header at every
stage. Its media must be the
expected ordinary photo/document shape. Documents additionally retain MIME,
size, filename and the expected video/document attributes. The authoritative
mirror must contain that same final message and server media ID. Temporary
media IDs are normalized as strings; they are not expected to equal the final
server media ID.

## Cancellation and uncertain effects

Preparation and bounded metadata reads have no upload/send effect. Their known
failures may return not-submitted. Starting `uploadMediaFile` crosses the
external-effect boundary; subsequent errors, account changes, cancellation,
timeouts, malformed results or partial bundles are uncertain and never
automatically replayed.

Each upload has a random, exclusive upload filename. Cancellation calls the
original account's `apiFileManager.cancelDownload(filename)`; it never cancels a
filename taken from user input. The shared opaque transfer retains its one busy
File slot until the actual upload Promise settles. A missing cancellation reply
cannot permit a second upload. An upload that finishes after cancellation never
advances to message submission. A local staged message that has not reached the
send invocation is removed with the original account's `cancelPendingMessage`.
Temporary media cache cleanup is best effort and does not determine success.

Per-file native/guest budgets remain five minutes, with bounded read-only phases
and a 30-second receipt wait inside that total. The existing bundle budget is
20 minutes. Native cancellation can settle the job while an unresolved platform
upload retains its guest File slot; explicit document reload disposes that
document. After a send invocation, late Updates still belong to their submitting
account, but expired/cancelled receipts cannot publish success or clear a draft.

## Verification boundary

`test/telegram-attachments.test.mjs` executes the actual adapter and composed
bridge with source-derived offline worker/event ports. It covers exact payloads,
real PNG/JPEG headers, empty/live-limit captions, original File bytes, media
permissions, sequential caption placement, transfer ownership, partial failure,
upload cancellation/timeout, account ABA, wrong/missing/late ACK, original-account
cleanup and absence of application replay. Existing K text/SendIntent composed
tests run against the same runtime and receipt changes.

`test/telegram-reply-context.test.mjs` and `test/telegram-reply-send.test.mjs`
execute the actual K composer, runtime and composed SendIntent with the same
source-derived ports. They cover private/basic-group/megagroup server/local ID
mapping, the 110/111-unit preview boundary, changes beyond the preview prefix,
whole-message model/DOM/account ABA, deletion, exact header matching at every
receipt stage, plain/media reply exclusion, original-account cleanup, retained
quoted drafts, stable preflight retries and no replay after uncertain effects.

The Node video port is a deterministic metadata decoder double, not evidence
that a particular real codec decodes in WebView2. Node tests do not claim real
Telegram delivery, real-account acceptance, Windows runtime acceptance or a
client release. Those evidence levels remain distinct.

[factory]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/lib/getProxiedManagers.ts
[proxy]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/lib/apiManagerProxy.ts
[messages]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/lib/appManagers/appMessagesManager.ts
[files]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/lib/appManagers/apiFileManager.ts
[documents]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/lib/appManagers/appDocsManager.ts
[media-ui]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/components/popups/newMedia.tsx
[limits]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/lib/appManagers/apiManagerMethods.ts
[send-media]: https://core.telegram.org/method/messages.sendMedia
[uploaded-photo]: https://core.telegram.org/constructor/inputMediaUploadedPhoto
[uploaded-document]: https://core.telegram.org/constructor/inputMediaUploadedDocument
[chat-input]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/components/chat/input.ts
[reply-render]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/components/chat/replyContainer.ts
[reply-text]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/components/wrappers/messageForReply.ts
[preview-cutoff]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/helpers/string/limitSymbols.ts
[peer-title]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/components/peerTitle.ts
[message-ids]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/lib/appManagers/appMessagesIdsManager.ts
[document-wrapper]: https://github.com/morethanwords/tweb/blob/654ffd809aa402f31357db2a13c462b4e5b69a23/src/components/wrappers/document.ts
