# MOB-004 progress

The mobile translation task started after MOB-003 dual-account acceptance.

## Implemented

- Ported the desktop translation-output safety contract to pure Java.
- Model preambles, thinking blocks, Markdown fences, and outer quotation wrappers are removed before preview.
- Empty output, unchanged Chinese source, target-script mismatch, and suspiciously long output fail closed.
- Added the user's Italian regression: `以下是意大利语翻译` followed by the unchanged Chinese source is blocked.
- Added the valid paired case: an explanatory prefix followed by real Italian is reduced to the Italian translation only.
- Added account-isolated mobile storage for the PC-compatible global and per-chat configuration model.
- Added hashed chat-scope keys so raw conversation identifiers are not used as preference keys.
- Replaced the placeholder sheet with a modern 84%-height mobile drawer using `全局设置 / 当前对话` tabs.
- Global settings now cover automatic incoming translation, incoming target, group behavior, translate-before-send, source detection, target language, and manual translation.
- Current-chat settings detect the active platform conversation, inherit global defaults, support an explicit override, and can reset to global behavior.
- The same 20-language catalog used by the PC settings is available in the mobile selectors.
- Added the same product-account boundary as PC: mobile signs in through `geek-subscription`, obtains a short-lived translation token, and calls `geek-translate` with the same route contract.
- Product passwords are never stored; the long-lived Geek product token is encrypted with Android Keystore, while provider credentials remain server-side only.
- Matched the desktop send contract: pressing Enter or the platform send button is intercepted when send translation is enabled; validated translated text is verified after composer refill and then sent automatically, without a second confirmation sheet.
- Any request, selector, safety, or composer-refill failure blocks the send and preserves/restores the source draft.
- The `译 / 发` floating tool group is draggable, clamped within the account surface, and remembers a separate position for each account.

## Checks passed

- `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed in one 47-task Gradle run.
- APK reinstall preserved both real Telegram sessions.
- UI Automator verified the global controls, account scope, empty-current-chat state, scrolling drawer, and primary save action at 720 x 1640.
- `geek-mobile-translation-global.png` contains the safe LINE login surface behind the final global-settings drawer.
- `geek-product-login-dialog.png` records the final mobile product-login sheet and its PC-service/Keystore explanation.
- Real-device UI Automator verified that the translation send hook reports `翻译发送保护已开启` and that a dragged tool position survives leaving and reopening the account.
- `geek-mobile-draggable-tools.png` records the draggable tool group moved away from its default edge position on the safe LINE surface.

## Remaining

- Log in with a real Geek product account and verify a live translation/quota response on the test device.
- Harden and verify the per-platform composer/send adapters against the current Telegram, WhatsApp, and LINE DOMs.
- Implement the receive-side global/per-chat translation renderer; its settings are present but incoming message replacement is not yet wired.
