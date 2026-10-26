# Original Geek UI is the migration baseline

The Windows Tauri work replaces the desktop runtime, not the product design.
The owner explicitly requires the existing Geek layout and interaction locations.
The earlier independent sidebar-form prototype is not an accepted replacement UI.

## Source and scope

Use the repository's actual `ui/index.html`, styles, icons and active UI modules
as the visual reference, not a newly invented design or an old mockup. Preserve
collapsible navigation, account tabs, application center, chat workspace, tool
entry locations, colors, typography and ordinary keyboard/mouse interactions.
Adapt Electron/native operations through the narrow Tauri gateway and Rust owners.
Do not execute Electron-specific renderer code or grant remote guests shell APIs.

Unavailable features stay at their original locations and are explicitly disabled;
do not fake success, login state, translation, subscription status or messages.
LINE stays deferred. User-owned real account acceptance is separate from development.

## Implementation and review

Keep original Electron files unchanged. Prefer traceable reuse of original markup
and presentation assets; isolate runtime-specific overrides and bindings. Source
modules, scripts and tests must still obey the 3000-physical-line hard ceiling.
Do not use generated-file exclusions to hide newly handwritten oversized code.

Verify native WebView bounds when the sidebar collapses, the window resizes, DPI
changes, or a dialog overlays the chat. A child WebView must not cover dialogs or
receive clicks through a modal. Hiding a view must not change its account identity.

Compare the original and migrated shells at matching viewport sizes and states.
Record which paths are wired, which are unavailable, and what was actually tested.
Visual similarity alone does not prove backend/runtime parity. Keep PR #802 draft;
do not merge or release the mismatched prototype while parity work is unfinished.

The original translation panel now exposes automatic incoming translation for Telegram A/K,
and outgoing plain-text and verified same-chat text-reply translation for K. The original broadcast workbench/task center also
serves K text, ordered attachments, schedules and saved messages/audiences. The same file list
shows K photos/videos/documents and changes the caption limit without truncating a draft;
unavailable import/entity controls remain disabled by capability. WhatsApp outgoing retains
its original send gesture and adds verified group mentions, captioned image/video/audio/file replies,
and ordinary PDF replies with a user-written caption and matching loaded page previews,
and verified same-group replies combined with selected contact mentions,
single image/video or identified-PDF captions, and bounded image/PDF batches with one selected
caption through the actual preview send button. A selected video may accompany images;
video/PDF mixtures and multiple videos remain unavailable. Batches send separate ordered
media messages. A retained complex draft
uses the existing success feedback instead of clearing only part of the composition.
Visible account/translation panels refresh the existing native session snapshot; ended jobs
keep evidence and dismissal without a resume control, while failed stop persistence exposes
an explicit finish-stop action in the original task bar and center.
These paths share the existing application owners and do not introduce a replacement layout.
Exclusion selectors keep their original locations and save per account; inline save/retry
feedback uses their existing action rows. Backup review includes both exclusion collections
and distinguishes preserving an absent collection from clearing an explicitly empty one.
The Tauri workbench's open recipient dropdown participates in the scrollable body layout so
its rows remain reachable above the footer at both 1280 × 820 and the 960 × 640 minimum size.
