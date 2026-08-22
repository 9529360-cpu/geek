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
- Added `翻译当前输入` to the account translation drawer. It reads the current Web composer without clearing it, requests a translation, applies the desktop output-safety contract, and shows an explicit source/translation confirmation sheet.
- Safe output can be placed back into the composer for editing or explicitly confirmed for sending. Any request, selector, or safety failure preserves the source draft and sends nothing.

## Checks passed

- `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed in one 47-task Gradle run.
- APK reinstall preserved both real Telegram sessions.
- UI Automator verified the global controls, account scope, empty-current-chat state, scrolling drawer, and primary save action at 720 x 1640.
- `geek-mobile-translation-global.png` contains the safe LINE login surface behind the final global-settings drawer.
- `geek-product-login-dialog.png` records the final mobile product-login sheet and its PC-service/Keystore explanation.
- `geek-mobile-translation-action.png` records the compact translation drawer with the new draft action on a real retained Telegram session.

## Remaining

- Log in with a real Geek product account and verify a live translation/quota response on the test device.
- Harden and verify the per-platform composer/send adapters against the current Telegram, WhatsApp, and LINE DOMs.
- Implement the receive-side global/per-chat translation renderer; its settings are present but incoming message replacement is not yet wired.
