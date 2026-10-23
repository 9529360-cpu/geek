# Windows desktop architecture

## 1. Scope and decisions

The new client is an independent Windows application runtime: Rust owns local business
state; Tauri connects the bundled HTML/CSS/JavaScript shell to WebView2. It is not an
Electron wrapper, Node sidecar, local HTTP server or a rewrite of the production Workers.
The Electron client remains a separate product path until the owner accepts a migration.
LINE is excluded from the present implementation, not a blocker for other development.

One application crate with enforceable module boundaries is sufficient today. Do not
create a microservice, a crate per entity, an event bus or empty feature scaffolding
without an active caller. Extract a crate only when a real build/runtime boundary needs
it. Domain/application code already avoid Tauri and OS implementation dependencies.

Existing-client source dependencies are explicit **build-time adapters**:
`scripts/export-platforms.cjs` reads the repository's canonical `src/platform-catalog.cjs`.
`scripts/prepare-frontend.cjs` reuses the original `ui/index.html`, presentation styles,
fonts and platform icon data. It removes all Electron scripts and turns original inline
styles into an external stylesheet; it does not weaken the Tauri CSP. The resulting
bundle lives under `src-tauri/target/ui`, not a second handwritten product UI. Exact
markup/style parity tests keep this dependency reviewable. See UI-PARITY.md.
No Electron modules, globals, IPC, profiles or JavaScript runtime are used at execution.
This subtree is therefore runtime-independent, but not yet a fully extractable standalone
repository. Moving the catalog requires a deliberate shared-contract change, not a copy
that silently drifts. Tauri and tauri-build remain explicitly pinned because child WebView
APIs use the unstable feature. Dependency upgrades require focused compatibility checks.

## 2. Code ownership and dependency direction

```text
frontend/app.mjs                       main.rs
  -> controller/view/model              -> bootstrap.rs (composition only)
  -> api/desktop.mjs                         |
          |                                 v
          +------ local IPC ------> desktop/commands.rs
                                        |  authorize + blocking executor
                                        v
                                application/workspace.rs
                                  |                 |
                          application/accounts.rs   DesktopHost port
                                  |                 |
                           AccountRepository port   desktop/host.rs
                                  |                 | WebView2/layout/tray
                    infrastructure/repository.rs   |
                                  |                 |
                     DPAPI + atomic filesystem     profiles
                                  \                 /
                             domain rules and types
```

| Owner | Authoritative responsibility | Not allowed |
| --- | --- | --- |
| domain | Account/Settings/Document, UUID/name/schema validation, platform/navigation policy, typed errors | Tauri, I/O, UI state, network, side effects |
| application/accounts | Single account document; validate candidate, persist, then publish memory | Public mutable state, secondary config owner, native code |
| application/broadcast | Independent encrypted job document, bounded scheduler, immutable targets and single-use submit admission | Workspace/network waits under its owner lock, replay of uncertain effects |
| application/session | Encrypted login generation, expiring server quota authority and cancellation leases | Renderer tokens, local billing or network work under its authority lock |
| application/translation | Bounded incoming/outgoing transforms, account-specific tokens, request identities and completed-result caches | Composer/send ownership, automatic new IDs after uncertain outcomes |
| application/send_intent + send_runner | Interactive intent identity, bounded foreground work, one commit admission and receipt settlement | Workspace/network waits under its owner lock, replay of confirmed or uncertain effects |
| application/workspace | Activate/close/reload/archive/settings orchestration; active account | Browser profile rewriting, network jobs under its lock |
| application/ports | Repository and native-host contracts | Concrete implementation or generic arbitrary-command interfaces |
| infrastructure | Encryption/atomic writes/process lock/profile paths/catalog decoding | UI operations or calls back into use-case implementations |
| desktop | Native sender authorization, Tauri command ingress, WebView2/layout/tray | Independent account state or global navigation allowlist |
| frontend/controller | Transient selection/draft/busy state and event wiring | Credential ownership, account transactions, direct native bridge |
| frontend/view + model | DOM text rendering, pure filtering/queue helpers | Persistence, privileged APIs, unsanitized HTML |
| frontend/api | Named IPC operations | Generic eval/file/Shell/URL command exposure |

Imports flow inward. Infrastructure implements application ports (dependency inversion),
not application use cases. `bootstrap.rs` is the only production composition root.
The architecture checker rejects common reverse dependencies, unowned Rust source,
unsafe outside the DPAPI adapter, frontend cycles/escapes, IPC bypass and manifest drift.
It is a lexical maintenance guard, not a replacement for compiler checks or code review.

Window chrome is a separate native adapter: `desktop_window` shares sender authorization
and the blocking executor, but does not request `SharedDesktop` or wait on its mutex.
Account/guest commands continue through the serialized workspace wrapper. Broadcast commands use the same authorization and blocking boundary with their separate BroadcastDesktop owner; no Workspace lock surrounds platform calls. The frontend
likewise keeps window controls out of its account queue, with one pending request per
window action; a pending maximize cannot block close. Only the original window buttons
remain above modal overlays and inside their keyboard navigation boundary. Close still
uses a normal close request and the last committed tray preference, never force-exit.
This removes our account-lock dependency; it does not promise recovery from a blocked
Windows UI thread, WebView2 runtime, or OS. Atomic persistence remains the authority if
the user closes while a save is pending. Window actions do not replay that save.

## 3. State, identity and transactions

`Account.id` is a canonical v4 UUID and never changes after creation. It owns one profile
path and one native guest label. `active_id` is only a presentation selection: selecting
B cannot retarget A's settings, storage, pending work or native view. There is no mutable
renderer copy that can persist accounts by writing an entire document back.

`Accounts<R>` keeps its document and repository private. Reads return immutable slices
or explicit snapshots. Every mutation copies a candidate, validates it, saves it through
the repository port, and only then replaces authoritative memory. The repository encrypts
with current-user DPAPI and atomically replaces a file in the same directory after sync.
No remove-then-rename sequence or plaintext fallback is permitted.

The repository owns an exclusive process lock for its lifetime. Bad ciphertext, unknown
schema, malformed IDs, duplicate IDs or invalid platform policy fail closed. Loading
schema 1 through 5 preserves IDs without eager writes; a successful mutation writes schema 6.
A failed write keeps the old durable document and memory. The older prototype must not
silently reset a newer document to downgrade it.

Archive is one application use case: validate owner -> close exactly that guest -> clear
its active selection if necessary -> commit archived metadata. A close failure prevents
the write. A later disk failure leaves a closed, non-archived, recoverable account and is
reported as failure. There is no claim of atomicity across native windows and the disk.
Restore changes metadata only. Neither operation deletes cookies or browser storage.

Account display settings (name, integer font size and hexadecimal color) commit as one
candidate through Accounts. The original defaults fill absent display fields in older
schemas; invalid persisted values still fail closed. There is no renderer-owned
appearance store. A no-op save does not rewrite the document. The legacy rename path
preserves the account's display fields.

Account order is the document's existing vector order. The move use case accepts two
stable IDs, validates both as non-archived members of the same platform family, and
resolves their current positions in Rust. It changes only that order after persistence
succeeds, without native lifecycle effects or changing active selection. The frontend
does not submit a full account array, mutate order optimistically, or replay failed moves.

Activation ensures a hidden/off-screen owner-bound guest, fits it, hides other known
accounts, shows/focuses the target only when content is not suspended, then commits
presentation selection. Hidden selection is allowed while a modal is open. Failure tries to
hide/close the target and restore the previous view; it must not report a new active
account that was never shown. Close does not log out. Hidden background reception is a
separate runtime acceptance question, not inferred from the presence of a guest.

## 4. Threads and lifecycle

All shell commands pass the same native sender check (WebView label + parent window
+ precise bundled origin) and use Tauri's blocking executor. Account/guest commands
serialize through the workspace mutex; native window actions do not acquire that mutex.
Neither path runs blocking work on an async worker. The workspace lock protects account
state/lifecycle operations and their commit ordering, not window chrome.

Native tray/close callbacks use atomics only, never the workspace lock: a command can be
waiting for that UI thread to create a child view. Tray close behavior requires both a
working tray and a successfully persisted explicit user preference. Failure to install a
tray must not trap an invisible application. Explicit quit closes the application.

Future external I/O must use its own bounded async work plane. Do not add a network await,
translation request, retry loop, broadcast wait interval or attachment upload while holding
the workspace mutex. Freeze immutable owner/generation information before releasing the
lock and revalidate it before committing a native effect.

## 5. IPC, storage and security boundaries

`contracts/commands.json` is the command inventory and argument-name/response contract.
The build script reads it for Tauri AppManifest. The checker compares it with Rust ingress,
handler registration, explicit capabilities and the frontend gateway. Unknown extra or
missing commands fail the gate. Rust DTOs use camelCase; input Settings and persisted
records deny unknown fields. Typed AppError serializes a stable SCREAMING_SNAKE_CASE code,
never a native exception, URL, profile path, credential or chat payload.

Only the bundled shell receives these permissions; remote guests receive none. Do not
replace webview-level capabilities with a parent-window wildcard. Third-party pages
cannot access file/shell/eval or authentication material. Current guest popups, downloads
and permission requests are denied; support requires an account-owned adapter, not a
blanket allow. Website navigation is exact-host HTTPS and account-owned. That URL policy
is not a DNS-rebinding firewall or network sandbox.

Profiles live under the new application's own local data identifier, not Electron userData.
Debug profiles are bound to a hashed compile workspace; release prototypes use their own
prototype path. DPAPI encrypts account metadata, not the entire WebView2 profile directory,
and does not protect against a malicious process running as the same Windows user.
No scan/import of real legacy profiles, token extraction or automated real-message sending
is part of foundation development.

## Account network configuration

`domain/proxy.rs` is the typed route validator; `Account.proxy` is persisted by the existing
account owner, not a second configuration store. The add-account use case accepts the
route before its first activation. The modify-route use case validates the owner/config,
no-ops unchanged input, confirms the same guest has closed, then saves through Accounts.
The common close operation rejects a success response that leaves the native view registered.
A failed close prevents both proxy and archive commits. A failed save leaves the old route,
closed view and stable profile recoverable; no automatic reconnect or fallback is permitted.

`desktop/host.rs` applies the validated endpoint before creating the guest. System leaves
OS configuration in effect; HTTP/SOCKS5 use `WebviewBuilder::proxy_url`. No raw flags,
credentials, PAC or bypass list cross this interface. View closure is not proof that the
WebView2 environment has exited: rebuilding the same profile can fail and require an app
restart, never an identity change. Proxy HTTP/HTTPS routing is not a VPN, DNS firewall or
WebRTC/UDP egress guarantee. The translation HTTP adapter separately consumes
the same immutable account route; global login and explicit quota refresh use System.

## 6. Feature boundaries for subsequent implementation

The table describes ownership constraints. Implemented WhatsApp/Telegram K broadcast, auth,
incoming translation and typed SendIntent subsets are specified below; remaining entries guide subsequent work.
Introduce each owner only with a working caller, tests and an integration path.

| Feature owner | Inputs/state and commit rule |
| --- | --- |
| Subscription/auth | Local secure credential store + fixed service contract; backend remains authority for session validity, quota and billing; no renderer provider secrets |
| Platform adapter | Explicit platform capabilities and immutable account/guest generation; no global `eval`, focus-based routing or fallback to a different account |
| SendIntent | Transaction ID, account, guest generation, conversation, composer snapshot, deadline/cancellation; owns send; revalidates destination immediately before native commit |
| Translation | Cancellable transform of SendIntent; separate bounded background-receive queue; no authority to pick conversation, send or charge quota locally |
| Broadcast | Immutable job owner and audience/message/attachment snapshots; one executing job per account, different accounts may proceed concurrently; per-target serial pacing and cancellation |
| Attachment | Opaque account/job-bound capability; Rust owns paths; bounded streaming and revalidation; durable refs have expiry/cleanup; no arbitrary renderer paths |
| Recovery/notifications | Owner-scoped lifecycle events and bounded recovery; notifications opt-in and privacy-safe; no silent restart loop or false login state |
| Installer/update | Separate identity/channel/signing/authorization; prototype artifacts are not production releases; no reuse of Electron updater metadata |

A feature is not complete merely because its UI exists, a port is declared or a synthetic
test passes. Do not create a generic `utils`, `manager`, `service` or `runtime` dumping ground.
The SendIntent rule is especially important: translation must never become the owner of
sending or silently restore the old focus-dependent flow.

## 7. Engineering gates and verification

Every handwritten source/config/test/script file: <=3000 physical lines, including comments
and blanks. Review splitting at 500. Rust uses rustfmt (2021 style, 100-column target);
JavaScript/CSS use readable statements and a 180-character hard line check. Generated
Cargo.lock and untracked dependency/build/schema outputs are not handwritten code.
No minification, giant embedded strings or new exclusions to evade limits.

`node desktop-tauri/scripts/run-tests.cjs` runs architecture checks and auto-discovers tests.
Mutation tests cover 3000 vs 3001 lines, packed lines, reverse imports, source-inclusion
escapes, generic IPC access, cycles and mismatched command permissions. Frontend behavior
tests execute the real controller/view/gateway with DOM/native doubles.

Rust tests cover policy, DPAPI roundtrip/tamper, schema compatibility, independent profiles,
instance locking and failed atomic writes. Fake repository/native host tests exercise the
actual workspace owner: cross-account archive/proxy, pending/failed close, commit failure, activate
rollback, reuse, unknown IDs and post-commit tray publication. These tests require no
customer login or message data.

Windows CI compiles/tests the exact candidate, checks formatting/lints and builds the
standalone prototype EXE. Use the actual Cargo-generated lock with --locked; dependency
lock reproducibility is distinct from compiler/SDK/runtime pinning or bit-for-bit binaries.
The root contract workflow and existing Electron E2E still run independently.

Manual WebView2/real-account acceptance is separate and owner-scheduled. No workflow here
publishes Workers, updater metadata, an installer, a tag or a production client. The focused
PR and exact-head Actions results hold live progress; this document holds durable decisions.

## Primary API references

- Tauri capabilities: https://v2.tauri.app/security/capabilities/
- Blocking executor: https://docs.rs/tauri/latest/tauri/async_runtime/fn.spawn_blocking.html
- Proxy builder: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html#method.proxy_url
- Browser routing scope: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags
- Cargo lock guidance: https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html
- Rustfmt configuration: https://rust-lang.github.io/rustfmt/
- Windows DPAPI: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata

## Original UI and native presentation

The shell retains the original platform-family tabs, collapsible account navigation,
application center and modal entry points. Its controller talks only to named gateway
operations. Unsupported controls stay disabled, not wired to success-shaped stubs.

The shell reports the measured `webview-container` rectangle in CSS/logical pixels.
Rust validates finite bounded coordinates and clips to the current client area using
its scale factor. No copied sidebar/header constants determine native guest placement.
A layout request with `visible=false` hides guests before acknowledging a modal. If a
hide fails, the frontend does not open the modal. Selection may change while suspended,
but no guest is revealed until a visible layout resumes; UUID/profile stay unchanged.
Window controls accept only a typed action enum and always target the main window.
The close action uses the ordinary close request, preserving the tray preference.

DOM/synthetic-host tests and offline Chromium comparisons are not native WebView2
acceptance. Real DPI changes, native child visibility and drag/window behavior require
Windows runtime verification in addition to compilation and use-case tests.

## Broadcast ownership and platform bridge

`application/broadcast*` owns the encrypted broadcast document, revisions, job queue and
single-use DispatchControl admission. `desktop/broadcast` composes it with its own repository
and platform port; its 250 ms scheduler never holds Workspace while waiting for a guest.
At most four target workers run, with one executing job per account. Each target checkpoint
also freezes the rendered message, so a pause before commit cannot redraw a random variant.
All mutations persist a validated candidate before publication. A persistence error at
settlement blocks execution while preserving the old checkpoint. Restart converts unresolved
checkpoints to uncertain outcomes and skips those targets on explicit resume.

Attachments use that same job owner, checkpoint and commit admission. A shell-only native
picker on a fresh STA thread creates temporary account-owned opaque references; it never
returns paths or file bytes to the shell. The pinned rfd Rust API adds no dialog plugin,
guest scripts or general filesystem IPC. At submit, selected metadata and private sources
become immutable job-owned records in one encrypted document commit. Schema 2 reads old
schema 1 without an eager rewrite. Snapshots expose only attachment metadata; private paths,
size/mtime and SHA-256 stay in the encrypted document and are removed atomically at terminal
settlement. Cleanup never removes the original file.

The native attachment adapter verifies every source before the first side effect, retaining
the same Windows read-shared handles through transfer. It streams 512 KiB chunks through a
fixed guest protocol and checks the digest again at EOF. A document stages one File at a
time; a pending WA-JS upload owns that slot until its actual Promise settles, including after
cancellation or timeout. Files follow selection order, with the rendered message on the
last file, then vcards. All receipts must be confirmed. The bundle has a 20-minute native
deadline and each file has at most five minutes. A missing/changed source before commit
fails the job; any failure after the first commit is uncertain and pauses without automatic
replay. File and text dispatch share the existing queue, lifecycle invalidation and pacing.

Snapshots may project `storageBlocked` at an unchanged durable revision; consumers discard
only strictly older revisions. Stop-after-settle is finalized under the same owner lock as
worker removal, including the failure case. Retained history is bounded; only explicitly
dismissed terminal jobs may be compacted when full, and their UUIDs become durable bounded
tombstones. A retired UUID never creates another job. No acknowledged or uncertain message
is retried automatically.

`desktop/platform_sessions` binds account UUID, native view incarnation and document
generation. Old incarnation callbacks cannot revoke or mark a replacement view ready.
Explicit close/reload revokes the guest bridge, rotates native identity and queues lifecycle
invalidation for the independent scheduler. Page navigation also rotates identity. Catalog
leases are bounded and temporary; their audience and names come from the correct native
guest, while the shell sends only selected IDs. Creation resolves these IDs into immutable
Rust-owned targets. Closed/archived accounts and stale leases fail closed.

`desktop/platform_bridge` evaluates only fixed bundled assets and named semantic requests.
No renderer-controlled script crosses IPC. The original pure capability and safety contracts
are extracted by `prepare-platform.cjs`; the existing pinned WA-JS runtime is the only WA
runtime. The Electron sender and its timeout-to-success fallback are not included. Real
runtime readiness precedes scheduled target checkpoint admission. Normal users/groups are
admitted; unsupported channel/status/community-parent destinations are excluded and checked
again immediately before a platform side effect.

Telegram K plugs into this same BroadcastPlatform port and durable job owner. Its exact
`/k/` document exposes only a finite account-bound adapter; no WPP runtime is loaded there.
Its first successful readiness/catalog capture pins the internal account and self identity
for that bridge lifetime. An internal account switch, including switching back, retires it;
a new native document is required. Targets use canonical `tg:` peers and ordinary user/group
metadata. Text and scheduling are supported, with the longest template expansion bounded
to 4096 UTF-16 units. Native ingress also rejects forged attachment/vcard/tagAll/member/label
capabilities. There is no parallel queue or Telegram-specific persistent job format.

Windows eval callbacks do not await Promise results, so the guest uses a bounded mailbox.
Rust begins an operation once and polls that same ID. Native monotonic deadlines and
cancellation cover even a lost begin callback. Cleanup uses the originally held WebView and
old generation token, including after native generation revocation. Guest cancel/revoke,
expiry, and consumed attempt tombstones prevent late preparation or secondary card effects.

### Recipient sources and exception reports

`domain/broadcast_import` is a bounded UTF-8 CSV/TXT parser. Only explicit phone/chat-ID
columns become candidates; file names/contact names do not grant target authority. Statused
exports admit only `NOT_SUBMITTED`, never uncertain targets or task rows. Its pasted-number
parser accepts one complete phone number per nonempty line, bounded at 128 KiB and 2000 unique
candidates; it shares the strict phone normalizer without guessing country codes or accepting
file/chat-ID syntax. File and pasted-text entry points share the same native import gate and
catalog resolver. They resolve batches through the fixed WA-JS bridge, validate the exact
returned candidate order and canonical contact models, then extend the existing catalog lease.
The source catalog must remain live for that account/generation through the final catalog lock.
No query, picker or disk wait owns Workspace, job state or the catalog mutex. A single finite
import gate bounds external queries; late shell responses are rejected by the editor epoch.
Verified directory-external contacts are capped at 2000 per lease; new selections survive eviction,
and normal directory entries stay separate so repeated imports cannot grow the lease indefinitely.
Pasted results additionally bind the editor's exact text revision; an A-to-B-to-A edit cannot adopt
an earlier response. Input edits revoke send eligibility immediately, independently of native query
completion. File, pasted, group-member, platform-label and manual audience drafts remain separate.

`desktop/broadcast/audiences` resolves the two additional typed sources through that same
`RecipientImport` gate, lease and absolute ten-minute deadline. Group IDs must belong to the
source catalog's native directory; at most 20 groups are read one at a time. Real participant
IDs are filtered against proved own PN/LID identities before the common two-contact resolver,
and against the same frozen identity again after canonical resolution. An uncovered self
namespace, changed identity or more than 2000 unique candidates rejects the operation.
Optional label metadata belongs to the catalog lease. Label membership checks inspect up to
200 native catalog IDs per call, compare model labels to the exact label ID, and accept only
the requested subset. Ordinary label groups keep their existing catalog authority; they do
not pass through the contact-only resolver. No label name-first lookup, arbitrary group/label
script, dynamic scheduled expansion or additional task owner is introduced.

Typed exclusion sets are account-local editor state, following the original product's all-chats
minus-explicit-exclusions semantics. The two sets filter every source before the existing create
command receives final IDs. Exclusion modes freeze the catalog population on entry; refresh may
invalidate an ID but cannot silently add targets. An explicit update action rebuilds this frozen
population from the current directory while retaining exclusions. Exclusions remain editor state;
saving a reusable audience records the resulting fixed IDs, never a dynamic scheduled query.

`application/broadcast_report` snapshots the existing owner, including projected storage failure,
then releases the lock before domain CSV encoding. Explicit account/job ownership is required;
no online guest is needed. Rows distinguish not-submitted, uncertain and task issues, without
turning unexecuted targets into failures. `infrastructure/broadcast_files` performs bounded reads
and atomic report replacement. Native pick/save dialogs are the only path authority; the file
commands accept IDs, never paths, file bytes or CSV bodies. Pasted text has its own narrow bounded
command and cannot select a path. None of these operations changes job state,
checkpoints, persistence schema, retry policy or the sending owner.

### Reusable broadcast messages and audiences

`application/broadcast_presets` is the sole durable owner for two account-scoped collections:
raw message templates and fixed recipient ID lists. It never creates jobs, queries a platform,
or bills translations. `infrastructure/broadcast_preset_repository` stores schema 1 in an independent
`broadcast-presets.dpapi`, using DPAPI and synchronized temporary-file replacement under the
existing process instance lock. Accounts schema 6 and live-job schema 2 remain unchanged;
preset volume and failed preset writes cannot consume or replace the job checkpoint document.

Every mutation checks an account-local expected revision, validates a complete candidate,
persists it, then publishes memory. Stable native UUIDs replace array-index identity. Same-name
messages overwrite in place; audience names may repeat and deletion addresses one UUID. Empty
account rows retain their revision so deleting the final entry cannot revive an old revision-zero
request. Limits are 100 entries per collection/account, 80 UTF-16 units per name, the existing text
bounds per message, 2000 unique IDs per audience and less than 2 MiB of plaintext globally.
Malformed/unknown-version state is never reset. Archiving does not delete presets.

`desktop/broadcast/presets` checks the actual account and requires current catalog authority to
save a recipient list. Restoration holds the existing RecipientImport gate. Current native groups
stay native; absent groups are reported unavailable. Missing WhatsApp contacts use the same bounded
canonical-contact resolver in pairs under the shared ten-minute budget. Selected contacts are
protected in the final imported cache; current platform models supply names. The final short
publication checks both preset revision and catalog lease, with no preset lock across platform
waits and no Workspace/job/catalog lock across persistence. A zero-recipient restoration is an
explicit successful result, so the editor clears old selections and disables creation.

Telegram K messages and recipient presets use the same owner and schema. Every restored
`tg:` peer must still exist in that account's fresh native catalog. Missing peers are skipped;
they never enter the WhatsApp resolver/import cache. Native save and restore reject mixed
platform namespaces before publication. Stored message templates retain their original
format; the Telegram length limit is enforced on all expanded variants before job creation.

The frontend restores a list into the existing custom-selection draft and retains exclusions;
applying a message changes only its raw body. Current editor/account/catalog/revision tokens guard
asynchronous reads and writes. Five finite shell-only commands expose these operations; no generic
key/value store, path API, alternate job owner or legacy profile access is added.

## Session and incoming translation ownership

`application/session*` owns one encrypted `session.dpapi`, independent of Workspace.
Credentials are native-only zeroizing values. Login verifies server identity, saves a
candidate, then rotates generation. Logout saves a token-free candidate before cancelling
old leases. Explicit server rejection blocks authorization immediately even when its
durable tombstone fails; the UI retains identity with a persistence warning and does not
claim logout succeeded. Old login, refresh and 401 responses cannot replace newer identity.

Quota authority uses a monotonic 30-second TTL. Disk mirrors are not authority; ordinary
quota and paid-translation replies for one generation retain the smaller balance. Explicit
authenticated refresh may adopt an increased server balance, including recovery from zero.
It captures the current lease and an in-memory quota revision before network I/O; a successful
reply is accepted only if no quota result or revocation has since advanced that revision.
A late successful refresh preserves the newer state. Current-lease authentication rejection
still blocks the identity regardless of quota revision. No new persisted field is introduced.
A null balance invalidates authority without turning a charged success into failure. Failed
mirror persistence also preserves successful translation and verified balance authority.
Only the existing server decides billing; no client usage debit.

`Account.translation` contains one revision, global policy and at most 100 chat overrides.
Each override stores only the original UI's seven local fields: enabled, autoSend, target,
messageAction, displayTranslation, translationMode and messageTarget. The remaining fields
always inherit the account's current global policy. Domain resolution is the runtime
authority; both native translation paths and full guest configuration projections use it.
The shell holds sparse local drafts and never publishes an unsaved global draft to a guest.
Typed command inputs distinguish a complete global policy, a seven-field chat override and
an explicit chat-override removal; hidden global fields cannot enter a new local override.
The persistence decoder recognizes both complete legacy overrides and strict seven-field
overrides; it rejects unknown or partial shapes. Legacy values are fully validated before
preserving the seven local choices and restoring global inheritance. This compatibility
read is independent of the supported document version; canonical writes use schema 6 and
only seven-field overrides. Reading never eagerly rewrites a document. The existing Accounts owner persists
mutations before publishing snapshots. Unknown, archived or unsupported accounts, stale
revisions and unsupported history flags fail before writes. Missing policy defaults to
manual-only translation.

`desktop/translation` polls only the visible owned WhatsApp or Telegram document. It releases Workspace
before readiness, DOM callbacks or network work. At most two workers and eight queued
requests exist globally; each has an independent native flight ID, a frozen logical
request, session lease, document cancellation flag and view/chat cancellation flag. The
35-second monotonic budget includes queue/token/network/retry time. Changing view or
policy cancels the old plane. Known cancellation is checked immediately before HTTP send;
cancellation cannot undo a request the service already accepted.

The guest offers named configure/context/poll/deliver/revoke operations without native
permissions or credentials. Logical UUID and attempt survive uncertain manual retries;
an explicit paid refresh creates a new UUID. Within one login generation, appearance and
non-semantic settings revisions cancel pending work but preserve request identity and
completed output. Only changed effective source/target/provider/route starts a new intent;
editing another chat's override cannot discard this chat's uncertain request.
Initial rows at every chat/config activation
remain manual-only, supplemented by a native per-activation timestamp cutoff. Automatic
admission requires verified incoming metadata, a new timestamp and allowed chat policy.
Target-Chinese messages already containing Han text preserve the original automatic skip.
The current node identity, body, message/chat, native generation, login generation and
policy revision must still match before rendering. This receive owner installs no composer interception.

Telegram Web A/K adapters share that same request/display owner for visible ordinary text under
exact native platform/URL/session bindings. Web A validates the route and
header peer against a chat-keyed MessageList identity; Web K validates each row's peer and message
ID. Unknown text structures, media, threads and special lists fail closed. Body extraction excludes
metadata and reply previews. Web K also admits new
incoming text only when a history_multiappend observation matches the current ordinary chat
instance, own/sender identity, time, history-only synchronous mirror and visible message body.
Its guest-local observations carry no UUID or requests: the shared owner still assigns every
logical request. Unknown provenance remains manual; missing mirror/DOM may match the same event
for five seconds, but contradictory metadata, edits, view changes and policy changes revoke it.
Observed identities are never evicted to authorize replay; bounded capacity falls back to manual.
Pending automatic delivery requires the same short-lived proof; a completed translation does not
depend on that proof's lifetime. Both guest and native policy require groupAuto for negative
Telegram peers, with channels/forums/special chats additionally excluded by the guest.

Web A automatic reception uses a packaged document-start observer installed only on the
native Telegram Z account. It preserves the production Worker constructor and observes only
trusted events from the exact same-origin API module worker in a top-level `/a/` document.
It sends no Worker requests and retains no raw worker handle, authorization material or
unbounded payload. A finite whitelist derives current user/connection, ordinary chat metadata
and new full incoming text. Worker replacements, disconnects, identity changes and reconnect
history fences invalidate observations. Positive private peers require a definite incoming
direction; negative peers additionally require full ordinary group metadata and sender identity.
The shared request owner still checks activation time, current visible body, group policy,
five-second DOM matching and 45-second delivery proof. Bounded identity tombstones prevent replay;
missing/unknown evidence falls back to manual. Localization is never timestamp authority.
Neither incoming adapter sends messages or modifies a composer. `TranslationGuest` uses fixed
private evaluation, without WPP on Telegram or another cache, scheduler or IPC.

`application/translation` holds account-specific short-token slots and a bounded 15-minute
memory cache (256 entries / 1 MiB), with session/account/chat/message/parameter keys. Even
cache hits require valid fresh positive quota. Only in-progress replies retry automatically
with the same payload, ID and deadline; an unauthorized short token may refresh once.
No ambiguous network failure allocates a new logical ID. The canonical output safety module
checks received text before DOM display, and a charged quality failure needs explicit
refresh rather than automatic replay. Outgoing results and logical request history remain
session-local; different send intents never coalesce by source text.

The same TranslationService also owns optional completed incoming results through the
TranslationCacheRepository port. The independent `translation-cache.dpapi` schema 1 uses
DPAPI and synchronized atomic replacement under the existing instance lock. It stores no
raw source text, credentials or executable requests. Domain validation bounds 256 entries,
1 MiB of translated UTF-8, 128 KiB per result and less than 2 MiB of actual serialized JSON.
Results expire 30 days after their original wall-clock save time; hits do not extend that
time, and zero/future/rolled-back clock readings cannot authorize durable hits.

The stable incoming key hashes a versioned, length-prefixed contract: verified subscription
user ID/account number, native account/platform, chat/message, exact source text and effective
language/provider/route. It excludes ephemeral request UUID and login generation. Current
SessionLease carries its verified user and remains separately checked for cancellation and
authority. Admission and fresh positive server quota precede both cache lookups; the lease is
checked again before returning. An explicit refresh skips both caches. No cache restores quota
authority, permits historical auto admission or broadens a platform's send capability.

The repository is composed after the profile lock without constructor I/O. A load/decrypt/schema
failure disables durable caching for the process and preserves the original bytes. Successful
network results remain in the existing memory cache even if their optional disk save fails;
the paid success is not converted to a retry signal. Writes serialize only cache candidates,
never hold Workspace/session authority over I/O, and publish durable state only after the
atomic save. This is not a durable billing/request ledger: a crash after server billing but
before local persistence can still lose the result. Existing Electron cache files are not read.

`infrastructure/service_api` implements fixed worker endpoint contracts. `http` disables
environment proxies, redirects, connection reuse and protocol retries; every operation
uses a frozen account route with native TLS and bounded response reads. System routing
is resolved per fixed URI by the safe Windows WinRT projection, including system/PAC/WPAD
policy. Only the first ordered proxy is used, and resolver/proxy failure never falls back
to another route. Direct needs an empty proxy list and affirmative OS permission. Unfinished
WinRT resolution is explicitly cancelled; dropping a future alone is not cancellation.
No extra handwritten unsafe or general-purpose network/URL IPC is introduced.

Session/context commands share the native authorization/blocking boundary but use their
own owners. Translation policy saves stay in Workspace; no HTTP operation holds it.
The original UI provides login, quota, account/chat translation settings, incoming
display and the WhatsApp/Telegram K outgoing paths specified below. Unsupported attachment,
reply/entity shapes, Telegram Web A outgoing, registration/purchase and bulk history remain explicitly unavailable
until their corresponding owners and adapters are implemented.
Already submitted work remains uncertain if confirmation is lost. This is not a guarantee
that a malicious remote service reports truthful receipts, nor an exactly-once server protocol.

## Interactive SendIntent ownership

`application/send_intent` owns each UUID, native account/document/session binding,
chat, source, typed plain/reply/mentions/attachment context, composer revision, frozen effective policy and attempt nonce. Its in-memory
history retains at most 20000 records; output plus reserved output is bounded to 2 MiB.
Confirmed and uncertain tombstones are never evicted to authorize replay. An explicit
next attempt after definite precommit failure can rebind the current composer revision
and recover retained paid output, while its previous nonce is permanently fenced.
Attempt numbers describe trusted page gestures, not native poll counts: the first
observed attempt may exceed one, and cancelled local attempts may be skipped before a
later strictly increasing retry is observed. This never reopens an active or committed
record; account/document/session, fingerprint and composer checks still apply.
Appearance-only revisions do not change billing identity; source, quote identity, effective translation
parameters, route or login generation changes do. The history is not durable across restart.

`application/send_runner` owns one actual worker and at most one waiting ticket, separate
from incoming work. Cancellation keeps the actual slot occupied until the thread exits;
an old flight cannot cancel a newer queued attempt. Repeated IDs/attempts must still match
the complete frozen request; a changed context cancels the corresponding old ticket.
The complete ticket has a 50-second
monotonic budget, with a shared-cancellation translation sub-budget capped at 35 seconds.
Session and native presentation leases are attached before work. Hiding a guest revokes
interactive work immediately without changing its identity or background broadcast lease.
All owner/Workspace locks end before platform evaluation, network calls or waits.

`send_translation` implements a cancellable transform using the existing token/quota
service. The typed `OutgoingSend` service intent fixes the HTTP contract and UUID. Identity
paths never consult quota or require login. Transform errors and quality failures never
fall back to raw sending; repeated gestures on the same request retain its billing UUID.
The transform has no platform/composer capability. Fresh session validity is required
before reusing paid output and immediately before the native commit gate.

`desktop/send_guest` exposes only packaged configure/poll/prepare/commit/read/deliver/
cancel/deactivate/revoke semantics. The remote document gains no native IPC or credentials. Only a
trusted platform send shortcut or original send-button gesture admits an intent. Telegram K
uses its own Enter/Ctrl+Enter setting and touch-aware mousedown/click contract. Translation off
passes through native platform behavior, except for an unchanged draft already submitted
with a confirmed or uncertain result. Only deliberate editing/clearing releases that guard.

Presentation revocation plus guest deactivation enqueue and the final commit check plus
script enqueue share one short native gate. Callback waiting always occurs after it is
released. This relies on the pinned Tauri/Wry non-tracing eval dispatch being asynchronous;
enabling Tauri's tracing feature requires rechecking that property. A hidden-then-shown
guest receives a fresh lease, and deactivation cannot revive an earlier attempt.

The guest requires the pinned WA-JS active chat model and plain composer DOM to agree.
A reply additionally requires a loaded, replyable same-chat text or captioned image/video MsgModel and canonical
MsgKey, plus visible footer quote text exactly matching that model. Any author label must
match a known model name. No remote message fetch, quote-payload reconstruction or guessed
quote selector establishes authority. Media replies also require matching type, MIME, hash,
loaded preview and exact caption. Uncaptioned/audio/document/view-once/truncated/unknown quote
shapes, mixed reply/entities, edits/forwards and link previews fail before paid
work and again before commit. Every request has a mandatory strict typed context. Native code receives only
the quote message/chat IDs and includes them in the fingerprint; quoted body, author and raw
model never enter the transform. Prepare must match this frozen context. Quote model and
footer changes advance composer revision, including a quote A-to-B-to-A change.
Before one explicit-target `sendTextMessage` call, the chat, source, model/node identity,
quote, revision, session and policy must still match. Replies pass the frozen real MsgModel
as `quotedMsg`. Implicit mentions and link previews are disabled. A consumed permit
cannot be replayed, and the submitted attempt stays in the poll heartbeat until native
settlement so receipt waits cannot be mistaken for abandoned work.

WhatsApp mentions form a separate `mentions` context, limited to 32 current ordinary group
contact entities. The official Lexical ZWS-wrapped `data-app-text-template` identity, complete
DOM-to-parsable projection, ChatModel draft, loaded contact and group participant must agree.
PN and LID identities are never inferred from a display name or each other. Unknown rich
structure, own/bot/group identities and ambiguous namespaces are rejected. The native context
contains canonical IDs and exact UTF-16 ranges, not raw page models. A pure per-request envelope
replaces those ranges with protected UUID-bound URLs before the existing translation transform;
decoding requires every token exactly once and rejects mutations, extras and reserved-host input.
The original request UUID remains the only billing identity; no new cache or scheduler exists.
Protected URLs increase both actual input and output character counts under the existing Worker
billing contract; the settings panel states that overhead instead of implying nickname-length billing.
Explicit mentionedList is derived only from the frozen proof. Model/collection/DOM changes
advance revision and final synchronous CAS revalidates every node/member before submission.

WhatsApp attachment captions use a separate finite composer adapter with the same SendIntent
owner. It admits one READY standard image/video or PDF with a positively identified preview;
actual caption DOM, attachment collection/model, preview source, prepared Blob/hash and chat
must agree. Multiple files, unsupported document/viewer shapes, edits/HD/GIF/view-once,
empty captions and mixed mentions/replies fail closed. Native receives only an opaque attachment
UUID plus the caption, bounded to 1024 Unicode scalar values on input and transformed output.
Payload changes rotate that UUID; UI/model changes also advance revision even when changed back.
The trusted original send-button click or focused-button Enter/Space is captured before platform
handlers close the preview. Ordinary Enter in the caption editor does not establish that contract.
Submission uses a private MediaPrep created from the verified immutable Blob and a detached
metadata snapshot. It never freezes or mutates the platform's original preparation object;
the platform's asynchronous send steps cannot substitute a subsequently edited source payload.
The exact generated message key, target, caption, type, hash and size must match the confirmed
MsgModel. The complete preview remains after success, cancellation or uncertain dispatch.
Production-module provenance and reviewed shape limits live in `WHATSAPP-SEND-CONTRACT.md`.

Only a real message ID and ACK >= 1 confirm delivery. Callback loss after dispatch is
uncertain, never an instruction to submit again. The source draft remains until ACK;
plain-text cleanup checks the original chat/model/node/source/revision and uses the pinned no-chatId
`setInputText('')` path, whose mutation occurs before its first Promise suspension. A newer
draft is retained, and cleanup failure cannot downgrade a confirmed send into retryable
failure. Reply, mention and attachment ACK always preserve the complete draft with `draftCleared: false`
and the existing explicit retained-draft feedback. There is no reviewed synchronous atomic
quote-clear operation; clearing text alone would leave an old quote for the next message.
The submitted-draft guard remains keyed to chat/body, so changing only the quote cannot
authorize a duplicate. Native cancellation targets the held original WebView even after generation
revocation. Browser/Rust synthetic tests and Windows builds do not prove authenticated
WhatsApp or paid-service acceptance.
Failed unsubmitted attempts release composer/model/Blob references while retaining the bounded
request identity and paid output. Retries reacquire the current proof. Settled terminal attempts
release those references after native delivery, never while a transport call still owns them.

Telegram K uses the same SendIntent, transform and delivery owner, with `plain` context and
4096 UTF-16 limits on both source and output. Its finite production-manager adapter freezes
internal account/self, peer, temp message ID and random_id. It stages the platform's own local
message without clearing drafts, then admits one `messages.sendMessage` with `clear_draft: false`.
Confirmation requires the exact platform send event and history mirror to match target, text,
temporary/random/final identities and normal message flags. SDK protocol recovery may retransmit
the same random_id; the application never creates a second logical submission. Unknown external
errors remain uncertain. Only errors owned by a private precommit proof can return notSubmitted.
Native receipt parsing also requires that proof's exact platform, generation, intent, attempt
and single-use permit tuple; a foreign status/code cannot reopen a consumed intent.
Current-chat draft cleanup uses the reviewed synchronous skip-draft-save path after full CAS;
newer, switched, hidden or changed drafts remain intact. Broadcast and interactive adapters share
that same finite runtime/receipt code but retain their existing independent job/intent owners.

Web A outgoing remains disabled in both UI and native ingress: its production send method
unconditionally clears the target cloud draft and offers no preservation option. The original
Electron automation provides neither a stronger draft contract nor exact delivery correlation.
The source-pinned analysis and required future contract are in `TELEGRAM-A-SEND-CONTRACT.md`.

The original four-step workbench and task center expose this contract. A measured task bar
strip is reserved above native guest bounds before displaying controls; z-index alone cannot
cover a native child. The shell keeps the guest's account identity independent of visibility.
The named broadcast IPC remains authorized only to the local shell, with manifest/permission/
gateway drift and independent-owner checks enforced by the architecture gate.

Native text-input simulation and delivery into a guest page's file chooser do not currently
have an approved safe native adapter. They remain unavailable; Telegram K text uses the finite
platform contract above, and WhatsApp broadcast attachments
use the explicit WA-JS File API described above. Adding hand-written WebView2 COM outside the
reviewed DPAPI boundary requires a deliberate architecture decision; JS Enter, synthetic
file drops, arbitrary CDP and a remote-debugging port do not satisfy that boundary.
