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

## Checks passed

- `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed in one 47-task Gradle run.
- APK reinstall preserved both real Telegram sessions.
- UI Automator verified the global controls, account scope, empty-current-chat state, scrolling drawer, and primary save action at 720 x 1640.
- `geek-mobile-translation-global.png` contains the safe LINE login surface behind the final global-settings drawer.

## Remaining

- Connect the authenticated Geek HTTPS translation worker without embedding a provider key in the APK.
- Add translated-draft preview, loading, failure, and retry states to the account composer flow.
- Inject only the validated preview into the active account composer; request failure must preserve the source draft and send nothing.
