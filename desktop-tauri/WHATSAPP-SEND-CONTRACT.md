# WhatsApp interactive send: verified special contexts

This records the platform contract behind the existing `SendIntent` owner. It covers
contact mentions, replies to loaded image/video messages, and captions for a prepared
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
and combinations with a quote or a new attachment are rejected. Ordinary text without
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
`detectMentioned: false` and `linkPreview: false`, so it cannot reinterpret untyped text
as another mention. Confirmation requires a real message ID and ACK at least 1. Missing
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

Audio, documents, stickers, view-once content, absent captions, unproved thumbnails,
newly selected attachments and combined mentions remain outside this reply adapter.

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
| Media | One unedited, standard-quality image or ordinary video; a PDF requires the specific loaded preview below. A batch allows 2–10 images, or a selected video with all other items images |
| Payload size | 1 byte through 512 MiB per item and at most 1 GiB in total, with matching model size, MIME and file hash |
| Caption | Nonempty plain text, at most 1,024 Unicode code points and 32,768 UTF-8 bytes, matching the complete parsable model caption |
| Metadata | A deep copy of the 56 declared `MediaData` props, bounded by depth, node count and 1 MiB of string/binary metadata per item |
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

All items, payload snapshots, order, selection, captions and DOM nodes are frozen for
the attempt. Model and DOM observations invalidate changes. The actual collection can
silently reorder unselected items while `SingleSelection.init` returns early for an
unchanged active index. Therefore a trusted dragstart or relevant keyboard gesture
inside the proven filmstrip invalidates the old attempt before React's reorder handler,
including a reorder and reversal within one task. Platform methods are not patched.

[`guest/whatsapp-caption-media.js`](guest/whatsapp-caption-media.js) creates a private
MediaPrep for each item. The single permit authorizes sequential independent media
messages in the frozen order. This deliberately does not call the original Flow's
optional album-parent creation or reproduce its MEDIA_ALBUM grouping. Each item must
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
| PDF with an existing old-style preview | `data-js-attach-preview` IMG source equals `media.fullPreview`, with a valid positive page count |

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
[composer]: https://static.whatsapp.net/rsrc.php/v4iuOo4/yy/l/en_US-j/RsX7je4nhEUDoy_65rPHB-Z6svWH3WIKahnf9pmf3NRippdYC97NSWEodSTJvSsSXzJejYPoDQJ6cs3WMiU-2t36nGM0IFyoOMeXf8aY9cFBnXwn6gzLAxT2Y9mGVjWCBlVT1_-rTXRCMzX3s94nei1BWycI7LQcNEhxZWmuKyAq_whf66pj5cCEwjvIcSRyjvdZW3OL6DyAU-P9QRc12CWliTw5APcfAZb0NkIotJpgUVEhAovKwX3vTZ34QZovqWqcEL6NDukE4vUDwTjdVNcJDnmSWZSsVSSOHLOfq.js
[models]: https://static.whatsapp.net/rsrc.php/v4iFkR4/yF/l/en_GB-j/rSSl-KoQn-T.js
[flow]: https://static.whatsapp.net/rsrc.php/v4i-Tn4/yS/l/en_US-j/y7wK-7D14zF.js
[caption]: https://static.whatsapp.net/rsrc.php/v4iW4X4/yq/l/en_GB-j/ppdYC97NSWECRajZbv_JUgb2_BtPq044_odSTJvSsSXzrHhPC2d3riSB2XILqrHedBHjr_gvbA2UOwn6gzLAxT2YMGw3qBp3HPlP86P0UQu2Jc9wOG39rwPJYktuucgPyduQcr8VofRaGJyAPcfAZb0NkIvKwX3vTZ34Q.js
[base]: https://static.whatsapp.net/rsrc.php/v4incC4/ye/l/en_GB-j/WUUKocWarAumTfixAq_AX8PLdtGOMpRrWq8GBBAQkpIX_23LEffI1_XvdPdCSIMPYUk5jRvIk23r_BG5Pz7vmDjrnhyXeOa3JV_GWGFXil8x1Q3BcYmPkwSiO7KJoSQKFgmFOYAuspDhlhzZk-PQqXYsbbYOR8caWn7QAzdZJywGwzJ6LvovRXLF19Fi9SaU-4ORb_dFMJ40LPHSxmYT-V10erhj1C8xEcCI-1Gj0YAvs-ocQZvVbfeyWd89SLKvPJbPyPAXiiRKHWyVVemkb0pXIL6h44yX5uCHgEKa9tNukyLhEHOUamyyESXW7jt19dvV4H__B-.js
[opaque]: https://static.whatsapp.net/rsrc.php/v4iwLD4/yh/l/en_GB-j/EGLj4o3kfs9.js
[video]: https://static.whatsapp.net/rsrc.php/v4iVv04/yQ/l/en_US-j/B6hstUK1GEW.js

[selection]: https://static.whatsapp.net/rsrc.php/v4iMIC4/yo/l/en_US-j/f1OIZWZGQveBxgWBYdHv4dFTtq7zwpbbDNl9ZYyREraxVmIHUz_jTaWR2XauXVhI_t2Px67ruRd1hJSbQUtRw7z47pBGHqm4NnLzdWp_yf8iIXWUUKocWarAumTfixAq_AX8_23LEffI1_Xwo8zQ5TASp1vdPdCSIMPYUBG5Pz7vmDjr3BcYmPkwSiO7KJoSQKFgmFOYAuspDhlhzZk-PQqXYsbbk9E_PXJB2--zdZJywGwzJ6i9SaU-4ORb_dFMJ40LPHSxj0YAvs-ocQZvVbfeyWd89Skb0pXIL6h44yX5uCHgEKa9tNukyLhEHOU19dvV4H__B-.js
[collection]: https://static.whatsapp.net/rsrc.php/v4iuQ-4/yq/l/en_US-j/arb2I9DYsKN_bAmhifpIiDthC7jKNM5FPEGLj4o3kfs9oBhQ0HVsbfBCRajZbv_JUgRX7jpK-UrjTB2XILqrHedBHjr_gvbA2UO9wOG39rwPJYktuucgPyduQPsHB1ibGrbJ_izLa2TZoeJ7yQKSv7A_M0Lc7oweNK41I1iKsn8dh0KRZt_LYVfTEUg4EIeUY9UHO17rZQrzh2svruxnQksOMZKjvSezoP28JeZ.js
