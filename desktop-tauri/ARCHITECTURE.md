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
Account/guest commands continue through the serialized workspace wrapper. The frontend
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
schema 1 or 2 preserves IDs without eager writes; a successful mutation writes schema 3.
A failed write keeps the old durable document and memory. The older prototype must not
silently reset a newer document to downgrade it.

Archive is one application use case: validate owner -> close exactly that guest -> clear
its active selection if necessary -> commit archived metadata. A close failure prevents
the write. A later disk failure leaves a closed, non-archived, recoverable account and is
reported as failure. There is no claim of atomicity across native windows and the disk.
Restore changes metadata only. Neither operation deletes cookies or browser storage.

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
WebRTC/UDP egress guarantee, and does not affect the shell or Rust HTTP clients.

## 6. Feature boundaries for subsequent implementation

These are design constraints, **not implemented-feature claims or placeholder modules**.
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
