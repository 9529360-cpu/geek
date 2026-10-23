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
and outgoing plain-text translation for K. The original broadcast workbench/task center also
serves K text, schedules and saved messages/audiences; unavailable import/attachment/entity
controls remain disabled by capability. WhatsApp outgoing retains its original send gesture
and adds verified group mentions, captioned image/video replies and single image/video or
identified-PDF attachment captions through the actual preview send button. A retained complex draft
uses the existing success feedback instead of clearing only part of the composition.
These paths share the existing application owners and do not introduce a replacement layout.
The Tauri workbench's open recipient dropdown participates in the scrollable body layout so
its rows remain reachable above the footer at both 1280 × 820 and the 960 × 640 minimum size.
