# MOB-004 progress

The mobile translation task started after MOB-003 dual-account acceptance.

## Implemented

- Ported the desktop translation-output safety contract to pure Java.
- Model preambles, thinking blocks, Markdown fences, and outer quotation wrappers are removed before preview.
- Empty output, unchanged Chinese source, target-script mismatch, and suspiciously long output fail closed.
- Added the user's Italian regression: `以下是意大利语翻译` followed by the unchanged Chinese source is blocked.
- Added the valid paired case: an explanatory prefix followed by real Italian is reduced to the Italian translation only.

## Checks passed

- `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed in one 47-task Gradle run.

## Remaining

- Connect the authenticated Geek HTTPS translation worker without embedding a provider key in the APK.
- Replace the account-scoped placeholder sheet with source, target-language, loading, preview, retry, and explicit-send states.
- Inject only the validated preview into the active account composer; request failure must preserve the source draft and send nothing.
