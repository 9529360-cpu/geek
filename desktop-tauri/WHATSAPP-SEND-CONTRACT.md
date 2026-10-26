# WhatsApp interactive send: verified special contexts

This records the platform contract behind the existing `SendIntent` owner. It covers
contact mentions, verified replies with or without contact mentions, and captions for a prepared
image, video, positively identified PDF or bounded media batch. Each mode has its own bounded input
proof and acceptance evidence. Local synthetic-platform tests do not establish delivery
through an authenticated WhatsApp account.

The adapters preserve the original WhatsApp interface. They introduce neither a second
send queue nor another translation cache. A trusted Enter/button action starts the
existing native intent, whose one-use permit authorizes an explicit target send.
Uncertain submission is terminal for that intent; it is never permission to resend.

## Sources and version boundary

The product uses the exact `@wppconnect/wa-js` **4.7.1** package in
[`package-lock.json`](../package-lock.json). Its npm integrity is
`sha512-vcA9q0adL6O9ixRM33wa3geKmYEz+CYP0k1t0rwCAxkp5rjl1YLO3hQOwPRfbTwdgMXC1RtaEl0g625v4In/tw==`.
The relevant explicit send options are implemented in the pinned
[`prepareRawMessage`](https://github.com/wppconnect-team/wa-js/blob/v4.7.1/src/chat/functions/prepareRawMessage.ts)
and [`sendTextMessage`](https://github.com/wppconnect-team/wa-js/blob/v4.7.1/src/chat/functions/sendTextMessage.ts).
Their runtime-export types alone do not establish a composer DOM or draft schema.

The runtime evidence was retrieved without login, cookies or a user profile from
the public [WhatsApp entry](https://web.whatsapp.com/) and its `static.whatsapp.net`
resources. The entry identified build **`1051480189_main`**. The WA-JS maintainer's
[matching version archive](https://github.com/wppconnect-team/wa-version/blob/main/html/2.3000.1051480189-alpha.html)
was used to locate lazy resource URLs; the JavaScript bodies were obtained from the
official CDN. The entry SHA-256 was
`c959377010f1f0b94f2d591e4c25b9cb9d79064c8aa08fd9e0ecfd83594ef9d2`.

This is evidence for one inspected runtime build, not a promise that WhatsApp's private
module shapes remain stable. Missing models, unknown attributes, unproved identities or
changed API shapes fail closed. A DOM selector or an `any` declaration is insufficient
on its own. No vendor source is copied into these adapters.

## Contact mention contract

### Actual platform path

`WAWebMentionNode` creates the Lexical mention span and stores the canonical Wid between
two U+200B characters in `data-app-text-template`. Its metadata distinguishes canonical
message text (`@` plus `wid.user`) from parsable draft text (the wrapped full UID).
`WAWebEditorStatePlugin.react` walks the Lexical paragraphs, creates both text forms,
and collects `mentionedJidList` for contact mentions. Paragraphs are joined with one
newline. `WAWebComposeBox.react` persists the parsable form through
`ChatModel.setComposeContents` and sends the canonical text with the explicit entities.
`WAWebUpdateDraftMessageChatAction` changes `draftMessage` synchronously before its
asynchronous persistence work. The module hashes and official assets are listed below.

`WAWebMentionsPlugin.react` checks the real contact, group participant and non-self
identity before restoring a serialized mention. The finite adapter follows this
proof path; it does not infer a UID from the visible nickname. Chrome `innerText`
can insert extra paragraph spacing, so layout text is not the serialized-draft oracle.

### Accepted finite shape

[`guest/whatsapp-mentions.js`](guest/whatsapp-mentions.js) accepts only ordinary group
contact mentions with all of these sources agreeing:

| Source | Required agreement |
| --- | --- |
| DOM | Exact Lexical mention span, wrapped UID attribute and one plain visible `@name` text child |
| Whole editor | Known paragraph/span/line-break structure and known attributes; no unknown rich sibling |
| Chat model | Real loaded `ChatModel`; complete DOM-to-parsable projection equals `getComposeContents().text` |
| Contact | Real loaded `ContactModel` and Wid; visible name is one of that contact's known names |
| Group | Real loaded group metadata and participant containing that exact UID |
| Current user | Matching-namespace self identity proves the entity is not self |

PN (`@c.us`) and LID (`@lid`) are accepted only as explicit, exact identities. The
adapter does not query contacts or invent a PN/LID alias. Numeric user IDs are canonical
`[1-9][0-9]{0,29}`. At most 32 entities are admitted. The same numeric user under two
different namespaces is rejected. Repeated occurrences of one exact UID are allowed;
the send option contains that UID once.

The wire context is `kind: "mentions"` with ordered `{id, offset, length}` entries.
Offsets and lengths are UTF-16 units in the canonical message text. Rust validates
that each non-overlapping range equals `@` plus that UID's numeric user. The DOM,
contact objects, participant models and parsable draft remain private to the guest.

Bot/group mentions, `@all`, unknown rich content, self mentions, ambiguous identity,
and combinations with a new attachment are rejected. Verified quotes use the combined
context specified below. Ordinary text without
entities continues through the existing plain-composer proof. A bare UID in text does
not establish a selected mention.

### Translation and billing identity

[`domain/send_mentions.rs`](src-tauri/src/domain/send_mentions.rs) replaces each proven
range with a deterministic URL under `https://geek-mention.invalid/`, containing the
existing request UUID and occurrence index. Spaces separate a URL from adjoining
non-whitespace text because the existing quality contract recognizes a URL through the
next whitespace. The normal outgoing transform receives this protected text with the
same request UUID. Identity sends return the original canonical text and do not use
the translation service.

The existing [Worker](../scripts/geek-translate-worker.js) and
[client quality contract](../src/translation-output-safety.cjs) compare complete URL
literals including multiplicity. They remove URLs before comparing ordinary numbers,
so digits inside the UUID/index do not become independent numeric requirements.
Native decoding requires every expected URL exactly once. Missing, altered, duplicated
or extra protected URLs, reserved-host source text and an invalid final body are rejected.
The decoder's permitted terminal URL punctuation matches the Worker rule. A rejected
paid result does not authorize an automatic request under a new UUID.

**Cost boundary:** the Worker counts the text actually submitted, including the UUID
protection URLs and any separator spaces. `countChars` counts each code point above
255 as two units and other code points as one. `/v1/translate` reserves input units;
`finishUsage` also accounts for the output units before native decoding. The protection
URLs therefore increase both input and output counts compared with the visible mention
names or canonical `@number` text. This migration does not alter the Worker or its
production charging rules and does not claim to charge only the original displayed text.
Same-ID retries preserve the same envelope and existing replay/cache identity rather
than creating another logical billing operation.

### Final submission and draft protection

The helper retains private node, draft, contact, participant and metadata proofs.
Model/collection subscriptions and the shared MutationObserver advance the existing
composer revision even for A-to-B-to-A changes. Immediately before submission the
shared composer performs a synchronous full comparison. A precommit retry must be a
new trusted gesture, retain the logical fingerprint, advance its attempt and invalidate
the older attempt. An appearance-only policy revision does not create a new billing ID.

`submitOptions` derives `mentionedList` only from this proof. The pinned send uses
`detectMentioned: false` and `linkPreview: true`. Untyped text still cannot become a
mention. The preview flag matches the old native composer button, which let
WhatsApp build a link preview. File sends keep `linkPreview: false`.
Confirmation requires a real message ID and ACK at least 1. Missing
ACK, callback loss or an exception after possible invocation remains uncertain.
Confirmed mention sends retain the **entire draft** with `draftCleared: false` and the
existing retained-draft notice. Cleanup/cancellation cannot turn confirmation into a
retryable outcome.

## Replying to a loaded image or video

[`guest/whatsapp-reply-context.js`](guest/whatsapp-reply-context.js) extends the existing
typed `reply` contract. The original same-chat `MsgModel` and canonical `MsgKey` must be
loaded, and the pinned `canReplyMsg` must accept the message. The supported media subset
is an image/video with a nonempty complete caption, matching `MediaDataModel`, non-view-once
flags and one already loaded preview. The preview must be an unreleased `OpaqueData`
object with an accepted image MIME, a WhatsApp-origin blob URL and size from 1 byte to
512 KiB. The visible reply banner must contain the exact caption, the proven thumbnail,
and only a known author if present. Unknown surrounding content is rejected.

The wire context contains only `kind: "reply"`, the message ID and chat ID. The caption,
author, original model and thumbnail bytes are not included in the translation request.
The helper does not download media or reconstruct a quote payload. Pinned WA-JS
`prepareRawMessage` uses the frozen original model's `msgContextInfo(chat.id)` through
`quotedMsg`; it is not a quoted-text imitation.

Model and nested media changes, preview replacement, IMG source changes and node
replacement invalidate the attempt. The final comparison includes these identities.
Image/video reply ACK retains the whole source text and quote. The platform contract
does not provide a reviewed synchronous atomic quote-clear operation; clearing just
the editor text would leave a stale quote attached to the next message.

Audio, generic documents, stickers, view-once content, absent captions, unproved thumbnails
and newly selected attachments remain outside this reply adapter.

## Replying to a loaded ordinary PDF with a user caption

The same adapter also accepts a finite PDF subset. This continues the original
[`ui/whatsapp-send-intent-capability.js`](../ui/whatsapp-send-intent-capability.js)
composer workflow: select a platform reply and translate the new body using the
existing Enter/send action. No separate quote picker or send owner is introduced.
The original same-chat, loaded `MsgModel`/`MsgKey` and `canReplyMsg` checks still apply.

### Source-backed visible content

In the freshly retrieved [document formatting asset][restore],
`WAWebQuotedMsgUtils.formatQuotedMsg` routes ordinary documents through
`WAWebFormatMsgText`, `WAWebMessagePluginFormatMsgText` and its document registry entry
to `WAWebFormatDocumentMsgText`. Its ordinary branch displays a nonempty caption only
when `isCaptionByUser` is true. Otherwise it displays the filename and possibly a
localized page count; this adapter does not guess that localized string.

The accepted models have `type: "document"`, `mimetype: "application/pdf"`, a complete
nonempty caption and `isCaptionByUser: true`. Template, dynamic-button, vCard and
view-once flags must be false. `MsgModel` and the real `MediaDataModel` must agree on
the PDF filename, positive integral byte size and page count. The filename is a
bounded plain basename ending in `.pdf`; unknown subtype, nonempty footer, protected
PDF or conflicting metadata is rejected. These strict metadata/footer conditions are
the adapter's conservative scope, not additional requirements imposed by the platform.
In particular, the platform's ordinary branch does not append an inactive footer.

The [quoted-media components][quoted-media] register documents with
`WAWebMediaMsgPreviewQuotedMsgThumbnailIcon.react` and render their media through
`WAWebMediaMsgPreview`. Its non-image branch emits one leaf DIV for each loaded
`preview` and `fullPreviewData` holder, in that order. Each leaf uses only a class
and one `background-image: url(...)` inline declaration; this is a different shape
from the existing image/video IMG proof.

The PDF proof admits one or two distinct, unreleased `OpaqueData` previews. Each has
an accepted image MIME, a WhatsApp-origin Blob URL and a byte size from 1 to 512 KiB.
The complete ordered URL list must match the visible leaf DIVs exactly. A bounded
base64 `preview` string may be present when a real opaque `fullPreviewData` supplies
the thumbnail: the platform ignores that string in this renderer, and the adapter
does not decode it, create a URL, download the PDF or read any document bytes.

Unknown CSS does not establish a preview. Multiple URLs, shorthand, gradients,
remote URLs, duplicate/missing/reordered images, interactive wrappers and extra
image nodes are rejected. Other passive nodes in the PDF quote cannot carry a
nonempty inline style; CSS comments, escaped property names and other image-bearing
properties cannot bypass the exact preview matcher. The quote region must contain
the entire caption, known author if present, and every proved thumbnail node.

### Ownership, submission and evidence

The existing composer freezes the original model and media owner, caption-ownership
flag, special flags, filename, byte size, page count, hashes, both preview holders and
their URL/MIME/byte-size/released state. Model subscriptions and the style observer
fence changes restored before the next poll. Final synchronous comparison rejects
same-key model replacements and identical-looking replacement nodes or holders.

Submission still passes only the frozen original model as `quotedMsg` to pinned
`sendTextMessage`; it never rebuilds or uploads a document. The ordinary `reply` wire
context carries only chat/message identity. A PDF with selected contact mentions
uses the same new PDF proof plus the unchanged independent mention proof, and only
the outgoing body enters protected translation. All quoted content stays in the
guest. Confirmation and uncertainty retain the complete draft, and neither outcome
opens a second send of an unchanged body.

`test/send-document-reply-guest.test.mjs` adds eight composed-guest tests covering
the four preview shapes, direct-model/MsgKey lookup, PDF plus mentions, metadata and
preview ABA, CSS ABA, final comparison, invalid source/DOM combinations, lost ACK
and late confirmation. A separate read-only experiment executed the official
quoted-document dispatcher and formatter with its source-selected registry entry;
it distinguished user captions from generated filename/vCard content without sending.
Fresh official source downloads and independent review were repeated for this slice.

An offline Chromium 151.0.7922.34 check used a non-root sandbox, a locally fulfilled
navigation and interception of all other network requests. The current composed
guest passed four real CSS serialization shapes, a real style-MutationObserver ABA
check, and three browser-parsed comment/escape/content-image rejection cases. Its
platform ports were explicit doubles; these results are source, DOM and integration
evidence, not authenticated WhatsApp delivery. Generic documents, captionless PDF
cards, unproved previews and newly selected attachments remain unavailable here.

## Verified reply with selected contact mentions

The `replyMentions` context combines the existing independently verified reply and
ordinary-group contact-mention proofs. It accepts the same complete text quote,
captioned image/video quote or limited user-captioned PDF quote described above. Neither proof relaxes the other's DOM,
model, identity, size or lifecycle checks. The quote region still cannot contain an
unproved mention span merely because the outgoing editor has a valid entity.

The wire shape is exactly `kind`, `messageId`, `chatId` and `mentions`. Native validation
requires the original same-chat WhatsApp group reply key plus canonical, bounded,
non-overlapping UTF-16 mention ranges in the new body. Telegram K does not admit this
variant. Quoted body, author, thumbnails and raw models stay inside the guest. The
existing `MentionTranslation` protects only the outgoing body with the same intent UUID,
so retry, token safety and billing rules remain those of the ordinary mention path.

The pinned `prepareRawMessage` Git blob
`c3fe092f38f4e9d1c0695e67856ce8446d20e577` independently sets `mentionedJidList`
before merging `quotedMsg.msgContextInfo(chat.id)`. The inspected official
`WAWebMsgModel` returns only four top-level fields: `quotedMsg`, `quotedParticipant`,
`quotedStanzaID` and `quotedRemoteJid`. An original quote's own mention list remains
nested in `quotedMsg`; it cannot replace the outgoing selected entities. The official
`WAWebSendTextMsgChatAction` also composes quote context and explicit mention entities.
Their complete named-module hashes appear below.

Before the one `sendTextMessage` invocation, the composer synchronously rechecks both
proofs and passes the original `MsgModel` plus the independently derived `mentionedList`.
Quote and entity model/DOM subscriptions each advance the same composer revision,
including changes restored before the next poll. `prepare` compares both wire components;
changing either while a native worker is running revokes that worker's commit admission.
Only a real ACK confirms delivery. Confirmed and uncertain combinations retain the whole
draft and the existing duplicate guard; quote-only/entity-only changes or disabling
translation cannot reopen an unchanged submitted body.

`test/send-reply-mentions-guest.test.mjs` executes the actual composed guest with text,
image and video quotes, PN/LID and repeated entities, detached contexts, both ABA paths,
synchronous replacements, unsupported mixtures, same-ID retries, late/missing ACK and
retained drafts. Native domain/transform and runner regressions exercise the combined
validation, protected translation, account binding and concurrent context invalidation.
A separate read-only experiment executed the actual pinned preparation function and
inspected official quote method with quote entity A and outgoing entity B; A stayed
nested while B remained the sole outgoing entity. No send or authenticated account was
used. These checks establish source and synthetic integration evidence, not real delivery.

## Interactive attachment captions

### Actual platform path

`WAWebMediaEditorForChat.react` renders `WAWebMediaEditor.react`, which supplies
`WAWebMediaEditorCaptionInput.react`. The latter uses a real rich-text editor with
`data-testid="media-caption-input-container"`; its change callback persists the parsable
caption. `WAWebMediaEditor.react` updates the active `AttachMediaModel.caption`, obtains
the editor's canonical text/entities at submission and trims the caption before handing
the selected media to the flow. Captions with mention/rich entities cannot be treated
as plain strings merely because this editor has a text-like appearance.

The legacy flow is unsuitable as a delayed interception point:
`WAWebAttachMediaFlow.react` schedules its send on `ui_idle`, then calls completion and
dismissal before that send runs. A preserving adapter must capture the trusted UI action
before that flow, prove the selected prepared media and use the fixed send boundary.
It must not call the flow and try to restore the preview after the fact.

The live preparation/send contract has four relevant details:

1. A normal READY `AttachMediaModel` already has `originalAttachment`, and normal
   processing can set `editedFile` to the same file. Non-null alone does not prove an
   edit; the actual editor state, transformation flags and object identities matter.
2. `MediaPrep.sendToChat` passes its live `mediaData` to asynchronous work.
   `WAWebMediaPrepSendToChat` awaits chat/outgoing preparation before later reads.
   A pre-call snapshot by itself cannot freeze a mutable payload across those awaits.
3. `WAWebMediaPrepMediaProps` may replace `mediaData.mediaBlob` with the platform's
   cached `OpaqueData` having the same file hash. This legitimate internal change
   after invocation is not proof that no submission occurred. The platform also
   mutates its owned send options, so blindly freezing the options object is incompatible.
4. Success includes the returned `msg`; a truthy result is insufficient. The created
   MsgKey and final result/model must be bound to the intended chat, prepared payload
   and caption before ACK can confirm. `onMsgKeyCreated` errors are caught by the
   platform, so throwing from that notification cannot serve as a cancellation gate.

The old `ui/app.js` hook looked for a static `WAWebMediaPrep.sendMediaMsgToChat` method.
The inspected module exports a default class with instance `sendToChat`; that old hook
does not establish a working interception path for this build. New media payloads must
not be replaced with a separate text send, and an uncertain media result must not cause
an automatic duplicate attachment.

### Accepted finite shape

[`guest/whatsapp-caption.js`](guest/whatsapp-caption.js) admits a real, selected READY
`AttachMediaModel`, or the finite batch below, in the active ordinary chat. Its current
collection, selection, `MediaPrep`, `MediaDataModel`, original Blob, visible caption and preview must all agree.
The original media file is already prepared by WhatsApp; the adapter neither reads a
filesystem path nor uploads through a separate transport.

| Boundary | Accepted value |
| --- | --- |
| Media | One unedited, standard-quality image or ordinary video; a PDF requires the specific loaded preview below. A batch allows 2–10 images and verified PDFs in any combination, including all PDFs, or a selected video with all other items images. PDF/video combinations remain unsupported |
| Payload size | 1 byte through 512 MiB per item and at most 1 GiB in total, with matching model size, MIME and file hash |
| Caption | Nonempty plain text, at most 1,024 Unicode code points and 32,768 UTF-8 bytes, matching the complete parsable model caption |
| Metadata | A deep copy of the 56 declared `MediaData` props, bounded by depth, node count and 1 MiB of string/binary/unique preview-Blob metadata per item. Only the three proven PDF thumbnail paths may contain an `OpaqueData` holder |
| Gesture | The original Send button, including its trusted keyboard activation; Enter in the caption editor is intercepted as unsupported because its send preference is not exposed by the pinned facade |
| Native context | Only `kind: "attachment"` and a guest-generated attachment UUID; paths, bytes, media hash and model objects stay inside the guest |
| Completion | Exact created and returned message identity, target, type, caption, file hash, size and ACK of at least 1 |

Shift+Enter retains the platform's newline behavior. When send translation is disabled,
the original platform handler remains in control. Multiple nonempty captions, unsupported
batch compositions, edited/HD media, GIFs, view-once media, stickers, generic documents, an unproved PDF viewer, and mixed
mention/reply/attachment contexts are rejected by this finite adapter.

At commit, a private real `MediaPrep` receives the verified immutable Blob and the frozen
deep metadata snapshot. The original preview model is not used as a mutable send payload.
Only the translated caption is passed in the fixed send options; there is no additional
text send and no invocation of the original flow that dismisses the drawer. The send is
authorized once by the existing intent permit. Missing ACK or any result whose identity
does not match remains uncertain and cannot automatically resend the media.

Confirmation retains the **entire original preview and caption**, reports
`draftCleared: false`, and uses the existing retained-draft notice. A repeated gesture
cannot submit the confirmed intent again. A new explicit retry before submission reuses
the logical ID and translated output when the attachment/source identity still matches.
Closing the preview drops the helper's retained proof and model subscriptions; an active
send keeps only the references needed until its own result settles.

### Finite ordered batch

A batch uses the same SendIntent and one translated source: only the currently selected
item may have a nonempty plain caption; every other caption must be absent or exactly
empty. The output belongs only to that selected item. No multi-text translation protocol,
additional billing ID or independent sending queue is introduced.

The real filmstrip has a `tablist` with ordered `tab` items, including `aria-posinset`,
`aria-setsize` and `aria-selected`. Its image source equals `AttachMediaModel.preview`,
which the normal READY image path sets to the file's `fullPreview` Blob URL. The adapter
matches every thumbnail to the ordered collection and selection list. Non-selected
videos are excluded because their static base64 thumbnail does not uniquely identify
the full file. A selected video still requires the existing main VIDEO/fullPreview proof.
For a PDF, the real filmstrip uses the page's `fullPreview` Blob URL, after checking
its loaded size and page count. Every PDF thumbnail must match that item's fully
verified document enrichment and have a unique source within the batch. The selected
PDF additionally requires the existing main `data-js-attach-preview` IMG. The caption
may belong to either a selected image or a selected PDF; all other captions stay empty.

All items, payload snapshots, order, selection, captions and DOM nodes are frozen for
the attempt. Model and DOM observations invalidate changes. The actual collection can
silently reorder unselected items while `SingleSelection.init` returns early for an
unchanged active index. Therefore a trusted dragstart or relevant keyboard gesture
inside the proven filmstrip invalidates the old attempt before React's reorder handler,
including a reorder and reversal within one task. Platform methods are not patched.

[`guest/whatsapp-caption-media.js`](guest/whatsapp-caption-media.js) creates a private
MediaPrep for each item that is not sent as an album. A batch whose every item is an
image writes the translated caption onto the selected model and the visible editor,
then clicks WhatsApp's own send button so WhatsApp creates the album parent. The
receipt is that new parent MsgKey only when it was not already in the chat, every
child file hash is present, the translated caption is on the parent or a child and
no caption differs, and every ACK is at least 1. If the button does not start a
send, the batch falls back to the sequential independent messages below.
PDF and video batches never use this album release. Each independent item must
return its own exact validated MsgKey and ACK; duplicates are rejected. The complete
proof and native intent validity are rechecked after every asynchronous return and
before the next item. Cancellation, a changed draft, failure or the existing 50-second
total deadline, including translation, stops later items and leaves an uncertain intent.
Already submitted items cannot be rolled back or automatically replayed.

Only complete success produces `wa-batch:<count>:<sha256hex>`. The digest input is the
UTF-8 encoding of `JSON.stringify({attachmentId,chatId,messageIds})`, where `messageIds`
contains every validated real MsgKey in send order. This is a client aggregate proof,
not a server-issued single-message ID. Its ACK is the minimum of all item ACKs. The
ordered keys exist only in private guest memory and are not logged. The proof is checked
again after the asynchronous digest. Single attachments retain their real MsgKey receipt.
Both success and uncertainty retain the entire preview and source caption.

The actual composed-owner regressions in
[`send-caption-batch-guest.test.mjs`](test/send-caption-batch-guest.test.mjs) cover order,
caption ownership, all-item confirmation, partial failure, duplicate IDs, cancellation,
deadline expiry during final digest, full-list identity changes and unchanged-draft replay
prevention. They also retain the original single-attachment behavior checks.

### Prepared PDF metadata and thumbnail ownership

The inspected `processRawDocument` returns the PDF's original `mediaBlob` separately
from its `documentPreview`. Both official enrichment paths, `WAWebPDFUtils` and
`WAWebTPDocumentEnrichment`, supply the page URL, thumbnail data URL, dimensions,
positive page count and thumbnail holders. `WAWebCanvasUtils.generateMicroThumb`
adds a second holder in the nested micro-thumbnail. These are real runtime objects,
not ordinary JSON metadata. The earlier single-PDF fixture omitted them and therefore
did not establish a usable PDF send payload. The current fixture retains the complete
inspected schema; the corresponding existing single-PDF success test failed before
the snapshot correction and passes with it.

The PDF reader requires agreement between the original immutable file Blob, file hash,
MIME, filename, `AttachMediaModel`, `MediaDataModel` and every preview field:

| Prepared evidence | Required agreement |
| --- | --- |
| Page preview | `documentPreview.url === media.fullPreview`, with an existing WhatsApp-origin Blob URL; visible main/filmstrip IMG sources use that exact URL |
| Thumbnail URL | `documentPreview.thumbUrl === media.preview`, as a nonempty JPEG data URL |
| Page count | `documentPreview.pdfPages === data.pageCount === media.documentPageCount`, a positive safe integer |
| Thumbnail dimensions | `documentPreview.width/height`, its `fullPreviewSize`, the data model's `fullPreviewSize` and the attachment's `fullPreviewSize` all agree; each dimension is a positive integer at most 32,768 |
| Full thumbnail | `data.fullPreviewData === documentPreview.fullPreviewData`, one unreleased real `OpaqueData` with an already available immutable JPEG Blob |
| Micro-thumbnail | A distinct unreleased `documentPreview.microThumbnail.opaqueData`, an already available JPEG Blob, positive bounded dimensions and a JPEG `dataUrl` whose base64 body exactly matches `data.preview` |

Each thumbnail Blob is at most 512 KiB. Unique thumbnail Blob bytes count toward the
existing 1 MiB metadata bound. The full-page IMG can have a different natural pixel
size from the reduced upload thumbnail; URL identity and the explicit prepared fields
provide the association. The adapter does not fetch the URL, read hidden file inputs,
parse another PDF, call `forceToBlob`, or claim support for unproved viewer branches.
Unknown enrichment keys, password-protected PDFs and incomplete fields fail before
native admission.

Only `fullPreviewData`, `documentPreview.fullPreviewData` and
`documentPreview.microThumbnail.opaqueData` are converted to Blob references in the
bounded snapshot. Every other `OpaqueData` instance is rejected, including base64-only
holders that otherwise resemble a plain object with scalar fields. Different Blobs
are never considered equal merely because both have no enumerable keys. Original
holder and Blob identities join the existing fingerprint; named model changes and
the existing DOM observer preserve replacement/restore revision evidence. Every
asynchronous preparation and ACK boundary also compares the complete metadata again.

At commit, the official `OpaqueData.createFromData` creates two **private** thumbnail
holders from those exact immutable Blobs. The full holder is shared only between the
private payload's two full-thumbnail paths; the micro holder belongs only to its private
UI metadata. The original holders are neither reused nor frozen, retained or released.
The existing intent validity, whole-composer proof and 50-second total deadline are
checked after each factory promise and immediately before `sendToChat`. Cancellation,
factory failure or private-prep failure before invocation releases every created holder.

Ownership after invocation follows the actual sender, not a generic cleanup rule.
`MediaPrepMediaProps` normalizes the main file Blob itself and balances its references
through `MediaObject.consolidate`. That same consolidate method adopts
`fullPreviewData` into `contentInfo` **without retaining it**; `uploadMediaWithPrep`
then reads it for the upload. Once `sendToChat` is invoked the adapter must not release
that full holder, including on an uncertain or failed result. The private prep and
platform retain the references they need. In contrast, `MediaTypes.DOCUMENT` does not
copy `documentPreview` or its micro-thumbnail into upload content fields. That unused
private micro holder is released when the send settles. The adapter never releases
the platform's original preview holders or installs another lifetime manager.

### Independent caption review findings

Two initial candidate gaps required correction before acceptance: the original mutable
`MediaPrep` was used across its internal awaits, and equal caption text alone associated
the visible drawer with the current media model. The reviewed design now requires a
private `MediaPrep` constructed from a bounded deep copy of the declared metadata and
the already verified immutable Blob, plus a positive visible-preview association. Binary
metadata views must have an ordinary `ArrayBuffer` backing; shared-memory views are
rejected because cloning them would preserve a mutable shared backing. The adapter
retains the original platform draft and does not mutate/freeze the original prep.

The public source supports the three otherwise easy-to-mock model assumptions:

- The READY path assigns `file` and `editedFile` from the same prepared `mediaBlob`
  in one `AttachMediaModel.set` operation. A normal unedited READY model can satisfy
  the strict reference equality; it is not required to have an empty original attachment.
- `BaseModel.toJSON` delegates to `serialize`, which copies each declared prop directly
  from the model. The inspected `MediaData` has exactly the 56 declared prop keys used
  by the clone allowlist. Its local ID is a session field, not an exported prop.
- The real `MediaPrep` constructor creates `mediaData` synchronously, before its promise
  callback. Pinned WA-JS resolves `MediaDataModel` from the `mediaData` proxy-name class
  and returns that original class; it does not manufacture a wrapper model for the test.

The sender also accepts this frozen Blob representation in production:
`WAWebMediaPrepMediaProps` converts a non-`OpaqueData` `mediaBlob` with
`OpaqueData.createFromData(blob, blob.type)` before continuing. Its later cache branch
may replace that private model's holder with the same-hash cached media object. The
adapter does not need to mutate or retain the original holder to use this path.

Preview evidence is specific to each supported rendering branch:

| Branch | Required positive source association |
| --- | --- |
| Unedited image | `media-editor-canvas` IMG source equals the editor background image source and `media.fullPreview` |
| Ordinary video | `data-animate-attach-media` VIDEO source equals `media.fullPreview`; a nonempty `currentSrc` must also agree, with no `srcObject` or alternate source |
| PDF with an existing old-style preview | `data-js-attach-preview` IMG source equals `media.fullPreview`; original Blob, complete enrichment, thumbnail holders, dimensions and positive page count satisfy the PDF contract above |

The video source was traced through `WAWebVideo`, `WAWebVideoPlayerX` and
`useWAWebVideoImplementations`: the ordinary attachment source becomes both native HD
and SD URLs. Without a DASH manifest or media stream, the progressive engine sets the
video element's `src` to that URL. It does not create another preview Blob URL. Unknown
player branches remain unsupported. A generic filename and localized size do not
uniquely identify a document; they cannot authorize the generic-document case.

The shared mode router must intercept an ordinary-footer gesture while an attachment
is active even if the specific caption UI is unrecognized. Otherwise the original
WhatsApp handler could send untranslated content. The dedicated
[`send-caption-guest.test.mjs`](test/send-caption-guest.test.mjs) suite exercises the
actual composed owner, including private-snapshot mutation during internal awaits,
preview/model A-to-B-to-A changes, exact returned message/ACK, retained-preview behavior,
mode changes, unsupported shapes and source/output limits.

## Evidence and acceptance limits

### PDF batch candidate

The current focused composed-owner suites pass **34 tests**: 17 single-attachment
tests and 17 batch tests. The batch cases exercise mixed image/PDF selections, all-PDF
selections, the ten-item bound, second-item failure, cancellation and deadline expiry
during private thumbnail preparation, original-holder preservation, metadata/preview
changes and unsupported combinations. The existing single-PDF test uses the corrected
complete enrichment schema. The independent source review also added a failing
base64-only-`OpaqueData` counterexample outside the permitted paths and verified its
rejection after the explicit instance guard.

The local Chromium evidence must remain tied to the exact composed-bundle hash. Its
offline ports distinguish actual DOM/MutationObserver behavior and the executed
official `OpaqueData`/`MediaPrepMediaProps` modules from simulated message/ACK transport
and media storage. These checks establish the guarded contract and lifetime behavior;
they do not establish delivery through an authenticated WhatsApp session.

### Earlier mention and single-attachment candidate

The actual composed guest tests cover the strict contexts, trusted-gesture attempts,
node/model A-to-B-to-A changes, quote identity, receipt loss, retry reuse and retained
drafts. The focused mention/media/reply/plain suites passed **61 tests** for this
candidate. An independent Chromium run used the actual composed bundle, real DOM and
MutationObserver, trusted keyboard/button actions, and synthetic loaded models. Its
**7 scenarios** passed, including paragraph projection, entity replacement, delayed ACK,
thumbnail changes and media-model changes. All external requests were blocked. The
dedicated composed caption suite passed **17 tests**. The final combined Node run passed
**44 test files**. The 7 mention/media browser scenarios were rerun against the final
composed send bundle with SHA-256
`220fca422a457e6692b8852538875ed4fd64141d30ce2ad721e6f7aa05418816`.

A separate Chromium **7-scenario** caption run passed against that same bundle. It
covered original plain-text behavior, trusted image/button submission, video and PDF
preview binding, same-ID precommit retries, missing-ACK protection, real DOM/model
changes, payload mutation during the sender's awaits, and returning to plain composition
after closing the drawer. Chromium 151 ran with its sandbox enabled as UID 65534. The
recorded external-request, page-error, console-error and CSP-violation lists were empty.
The caption source SHA-256 was
`04de3fd551dacacaf259573f9403d3ad7423ab1685485d695b4ece936aaa9c80`.

The image-confirmed, narrow PDF-confirmed and uncertain-result screenshots each assert
that the existing feedback remains visible with the same text before and after capture.
Playwright's default caret hiding had changed the editor's inline style and correctly
triggered the stale-composer observer; the final capture uses `caret: 'initial'` to avoid
mutating the tested DOM. This correction was confined to the offline browser harness.
The uncertain result retains the original preview and explicitly states that it will
not automatically resend.

An additional offline oracle executed the actual Worker's quality functions and passed
8 checks for URL/number preservation, missing/duplicate/mutated tokens, punctuation and
the input/output counting boundary. No network request or paid translation was made.
These results establish local contract behavior, not acceptance by an authenticated
WhatsApp session. Windows CI and its real crate tests are separately recorded for the
exact commit; these counts must not be substituted for those results.

### Official module fingerprints

Hashes are SHA-256 of the extracted complete named `__d(...)` module, with the trailing
newline retained. The selected asset links below and module names allow the public
contract to be identified without storing vendor bodies in this repository.

| Module | SHA-256 | Asset |
| --- | --- | --- |
| `WAWebMentionNode` | `0b913b6d348bda657a144a24987c09250dd86269b1f0cbc0a4dfbb6273af6362` | [Entities][entities] |
| `WAWebEditorStatePlugin.react` | `b63270dae34ff4598778af13a32fb79a76bed0818c3eeac88c5b00dda32062ca` | [Entities][entities] |
| `WAWebMentionsPlugin.react` | `a834908326aedf6522ba909a5cca248f8a09113a78904b18b102185eaeb4ce42` | [Mention restoration][restore] |
| `WAWebComposeBox.react` | `dd0705b3b79e4126b96723f58b31126524506ab01551391f7d07813c3ad225f3` | [Composer][composer] |
| `WAWebChatModel` | `2f8615356f7cef6976d02cff1f15bdc36e9ee4c292d09a9ebd4357d2a355d970` | [Models and media prep][models] |
| `WAWebMsgModel` | `b9ca07ce2c6e3591f86bd94d6e8777f968428f3da9d5ebfbd0ad81a2e3997be7` | [Models and media prep][models] |
| `WAWebSendTextMsgChatAction` | `8218f67fc38f39cc1d13d21eddff0e78f5d69f4c64ee4e40f207491b53c4b024` | [Models and media prep][models] |
| `WAWebQuotedMsgUtils` | `4d09279477d982a8810bc72557cee98e1110188a7b0338e5e0838908ed46be24` | [Document formatting][restore] |
| `WAWebFormatMsgText` | `0d17b00bd47de454c59e314701d0dacccebdb45587e2181fc3136e9ec38b8fd9` | [Document formatting][restore] |
| `WAWebMessagePluginFormatMsgText` | `e9046c0fc92c8511350436c935756a6cfff1990547876786b248588516ac02b1` | [Document formatting][restore] |
| `WAWebMessagePluginFormatMsgTextRegistry` | `b639de73851abe55768e27628884a868ab9d2c04ecf729dc83bcf13b9fa0ea7d` | [Document formatting][restore] |
| `WAWebFormatDocumentMsgText` | `a69a3b87dcbac8a451e7d524e25c1a5bba20ae8525a3d4faeb4f6c50e653a359` | [Document formatting][restore] |
| `WAWebFormatMsgTextUtils` | `de33c6e3f641d10a217bafaea43b3984e9620b089954b1c79916bdc4d391df5e` | [Document formatting][restore] |
| `WAWebQuotedMsgContent.react` | `0ccee5f053a84d5376619bb96486950d54ee4983ecf112220792953f7f6c04ce` | [Quoted media][quoted-media] |
| `WAWebMediaMsgPreview.react` | `28c1f74f26c65cc73a473d821913cc2b88d00b6c201b6ea541950f30b3c4f049` | [Quoted media][quoted-media] |
| `WAWebMediaMsgPreviewQuotedMsgThumbnailIcon.react` | `ad96bbf97af7a0ab1a3eac39f7c15c3b392d68cbc8c9f7aaeffb1ac1a24d9b7f` | [Quoted media][quoted-media] |
| `WAWebMessagePluginQuotedMsgThumbnailIconRegistry` | `e982357b35573883038323bfed92befd126783f7a62636b62532304b75239792` | [Quoted media][quoted-media] |
| `WAWebUpdateDraftMessageChatAction` | `7b8e74394fdb2bc6ed58bdb1247cdc76b0be4b34a39a13b3cfcbf60b1d9b3518` | [Models and media prep][models] |
| `WAWebCopyPasteCopyable.react` | `b379ba61def0f28aac47bbcc3bf6ee789d8f3ad60062988f965d185a1e2d1c89` | [Caption UI][caption] |
| `WAWebAttachMediaModel` | `dbcf6ef30912ed22fdf8912202acc143b5ab832bad6102d8f18ca46ed58bddcd` | [Composer][composer] |
| `WAWebAttachMediaFlow.react` | `181bc9f64bf8fb9a908be81fcae18387b16ffcd77d2b5c98a1c19b12b7a298f0` | [Media flow][flow] |
| `WAWebMediaPrep` | `84a1bbcdc4b6affecf1832be02fe207f1b31c69363fecd6ec406e639f8e31b11` | [Models and media prep][models] |
| `WAWebMediaPrepSendToChat` | `d5b81ea4c284bcee53d77eed85d94a6b58195f869614c7a7c2ae002b0d6356f4` | [Models and media prep][models] |
| `WAWebMediaPrepMediaProps` | `3095aeee2bcde45dc9c26c49363419dc2dc1d79f13754b001658c4c6a052cf6c` | [Models and media prep][models] |
| `WAWebBaseModel` | `e0d3d2e75c1b173855e1e8f8102baf31d2a76306823040cce18da402052d32f4` | [Base model][base] |
| `WAWebMediaData` | `947bf87cebb261c2341f86573204399d61f7bcb774a09b07c65d05b36547c37b` | [Models and media prep][models] |
| `WAWebMediaOpaqueData` | `2fe5da40bead7159b2b58e5df4086cfab56acda74cdf33031dd549e5eb8ee0d9` | [Opaque media][opaque] |
| `WAWebMediaDataUtils` | `6e64aba6e77d6c8057e8044d63720ac8b4394aefdfc0ee7552aede75fa7d4079` | [Prepared PDF and upload][pdf-media] |
| `WAWebPDFUtils` | `35ae6899eb5eb9691266b4f78a39a219e006827fca140d7dd99f75f347ebff11` | [Prepared PDF and upload][pdf-media] |
| `WAWebTPDocumentEnrichment` | `e6bd353b5552be2ec2110db91a3036204c0c2e61a0f75e0d114c3d5e6a75f4d6` | [Prepared PDF and upload][pdf-media] |
| `WAWebCanvasUtils` | `2cae3ae1c26b14bec1c6f65c5747b25eb27298e94812483af30ca17522ffc9b5` | [Canvas and micro-thumbnail][collection] |
| `WAWebMediaObject` | `eb151373d0c2ec1eecd0242af4de7b4c79556fafd9db325f4b63b3f185735368` | [Prepared PDF and upload][pdf-media] |
| `WAWebMediaTypes` | `a9c9e6cb870cc7c4d7bb91237d6387dab0c512fd13cc4127f82a1e5319364b8f` | [Prepared PDF and upload][pdf-media] |
| `WAWebMediaUploadMediaWithPrep` | `71e3dca2dbfc51475541cb9bc1b6c8d73d5c39eb2fccb46c70e7ae82ec190f21` | [Prepared PDF and upload][pdf-media] |
| `WAWebMediaEditorForChat.react` | `804ad4d07193fe82494bb9a2cee58bfee74e6f7e2bf464e126c310f511d8c7ee` | [Caption UI][caption] |
| `WAWebMediaEditor.react` | `5e347a0a2ade6d09650d89acb543c9d95fbcf2eecea9f3d569bb0fa2dfc5d6c9` | [Caption UI][caption] |
| `WAWebMediaEditorCaptionInput.react` | `5774bb39a0ea4a7f245101ce4ca012c8c9fec85623f4625ad89514e374c8d7e4` | [Caption UI][caption] |
| `WAWebMediaEditorImage.react` | `8352dd32efe56e1f79aae39660c127cf8974653a431801c23078e76b055f86ce` | [Caption UI][caption] |
| `useWAWebVideoImplementations` | `3f4fec8841d6483c458c535d24537ca9be9f1fe04070b441ea4ff6ced37fb9fc` | [Video implementation][video] |
| `VideoPlayerProgressiveImplementationEngine` | `cc6f8efe2c21d9221efab26f11de690f1a4965b71b87e1644398bb508398cfad` | [Video implementation][video] |
| `WAWebMediaEditorFilmstripDragAndDrop.react` | `44b77b6a1f02d1826d7bb09959b0efc9aacff4d5fbd571c40039273d8f3a121c` | [Filmstrip and ordering][caption] |
| `WAWebMediaEditorFilmstripAttachMediaThumb.react` | `dd4303f760cce3cc4179da8d56b881c84059dbbad0495c6f50a3526d67ef6930` | [Filmstrip and ordering][caption] |
| `useCometDraggableItems` | `3e8a6478c92626d2fa4f2cd4169bde57d3362cc0ebac754a35575c7192149fa0` | [Filmstrip and ordering][caption] |
| `WAWebSingleSelection` | `11d7e8ed968ce2aa992963ae8626ca1932c9ee9d0c43984324eb6e99cfc2386c` | [Filmstrip and ordering][selection] |
| `WAWebCollection` | `afa6d609827453b2be3fb1f5dd74335ed52f4a78bfc77690a2860453df1d267a` | [Filmstrip and ordering][collection] |

[entities]: https://static.whatsapp.net/rsrc.php/v4iDmr4/yP/l/en_US-j/D0u5tvXqu7W7T09bvlJ7oufaGUaYdVti8co9TrzRIsI3Eu6Xsfswb4t_oayrl-rWOU25tnfcbs0TXP17R_g10IG7ap9XjpiZnSLhP-GdkUr6D_Gq5X_Ho1FIjzPwNwtEu_k2BzRAbOK83URfXj59NZEN6_LP5CkbSgW8ssecj6EXVJp6hv2-3oWVJl99TzQwv2BKS3q8GBBAQkpIX3Cqy_6usulsk5jRvIk23r_Xc11OI-vcItLFRgrHjexONYOR8caWn7QALvovRXLF19FoY5dKuoQUPihjeC9EzWiky1C8xEcCI-1GMUG-51HH_zQsXSds_kkOIp.js
[restore]: https://static.whatsapp.net/rsrc.php/v4iTb14/yY/l/en_US-j/y8s9TQLFc98.js
[quoted-media]: https://static.whatsapp.net/rsrc.php/v4iFSQ4/yn/l/en_US-j/lUmMBICs-yj.js
[composer]: https://static.whatsapp.net/rsrc.php/v4iuOo4/yy/l/en_US-j/RsX7je4nhEUDoy_65rPHB-Z6svWH3WIKahnf9pmf3NRippdYC97NSWEodSTJvSsSXzJejYPoDQJ6cs3WMiU-2t36nGM0IFyoOMeXf8aY9cFBnXwn6gzLAxT2Y9mGVjWCBlVT1_-rTXRCMzX3s94nei1BWycI7LQcNEhxZWmuKyAq_whf66pj5cCEwjvIcSRyjvdZW3OL6DyAU-P9QRc12CWliTw5APcfAZb0NkIotJpgUVEhAovKwX3vTZ34QZovqWqcEL6NDukE4vUDwTjdVNcJDnmSWZSsVSSOHLOfq.js
[models]: https://static.whatsapp.net/rsrc.php/v4iFkR4/yF/l/en_GB-j/rSSl-KoQn-T.js
[flow]: https://static.whatsapp.net/rsrc.php/v4i-Tn4/yS/l/en_US-j/y7wK-7D14zF.js
[caption]: https://static.whatsapp.net/rsrc.php/v4iW4X4/yq/l/en_GB-j/ppdYC97NSWECRajZbv_JUgb2_BtPq044_odSTJvSsSXzrHhPC2d3riSB2XILqrHedBHjr_gvbA2UOwn6gzLAxT2YMGw3qBp3HPlP86P0UQu2Jc9wOG39rwPJYktuucgPyduQcr8VofRaGJyAPcfAZb0NkIvKwX3vTZ34Q.js
[base]: https://static.whatsapp.net/rsrc.php/v4incC4/ye/l/en_GB-j/WUUKocWarAumTfixAq_AX8PLdtGOMpRrWq8GBBAQkpIX_23LEffI1_XvdPdCSIMPYUk5jRvIk23r_BG5Pz7vmDjrnhyXeOa3JV_GWGFXil8x1Q3BcYmPkwSiO7KJoSQKFgmFOYAuspDhlhzZk-PQqXYsbbYOR8caWn7QAzdZJywGwzJ6LvovRXLF19Fi9SaU-4ORb_dFMJ40LPHSxmYT-V10erhj1C8xEcCI-1Gj0YAvs-ocQZvVbfeyWd89SLKvPJbPyPAXiiRKHWyVVemkb0pXIL6h44yX5uCHgEKa9tNukyLhEHOUamyyESXW7jt19dvV4H__B-.js
[opaque]: https://static.whatsapp.net/rsrc.php/v4iwLD4/yh/l/en_GB-j/EGLj4o3kfs9.js
[video]: https://static.whatsapp.net/rsrc.php/v4iVv04/yQ/l/en_US-j/B6hstUK1GEW.js
[pdf-media]: https://static.whatsapp.net/rsrc.php/v4iFkR4/yr/l/en_US-j/rSSl-KoQn-T.js

[selection]: https://static.whatsapp.net/rsrc.php/v4iMIC4/yo/l/en_US-j/f1OIZWZGQveBxgWBYdHv4dFTtq7zwpbbDNl9ZYyREraxVmIHUz_jTaWR2XauXVhI_t2Px67ruRd1hJSbQUtRw7z47pBGHqm4NnLzdWp_yf8iIXWUUKocWarAumTfixAq_AX8_23LEffI1_Xwo8zQ5TASp1vdPdCSIMPYUBG5Pz7vmDjr3BcYmPkwSiO7KJoSQKFgmFOYAuspDhlhzZk-PQqXYsbbk9E_PXJB2--zdZJywGwzJ6i9SaU-4ORb_dFMJ40LPHSxj0YAvs-ocQZvVbfeyWd89Skb0pXIL6h44yX5uCHgEKa9tNukyLhEHOU19dvV4H__B-.js
[collection]: https://static.whatsapp.net/rsrc.php/v4iuQ-4/yq/l/en_US-j/arb2I9DYsKN_bAmhifpIiDthC7jKNM5FPEGLj4o3kfs9oBhQ0HVsbfBCRajZbv_JUgRX7jpK-UrjTB2XILqrHedBHjr_gvbA2UO9wOG39rwPJYktuucgPyduQPsHB1ibGrbJ_izLa2TZoeJ7yQKSv7A_M0Lc7oweNK41I1iKsn8dh0KRZt_LYVfTEUg4EIeUY9UHO17rZQrzh2svruxnQksOMZKjvSezoP28JeZ.js
