# MOB-003 multi-account acceptance

Date: 2026-08-23 (Europe/Berlin)

## Accepted behavior

- Application Center creates named WhatsApp, Telegram, or LINE account entries using the same mental model as the PC client.
- Account List opens each account by name and exposes management only for independently deletable slots.
- Three dedicated Android processes with separate WebView data-directory suffixes provide isolated storage for additional accounts.
- Contextual Translation and Broadcast actions open panels scoped to the currently visible account.
- A selected isolated account can be deleted with its cookies, cache, form data, history, and WebStorage without clearing another account.

## Physical-device verification

1. `Telegram 2` first opened in process `:geek_account_1` on a clean Telegram phone-login page while `Telegram 1` remained authenticated.
2. Deleting `Telegram 2` removed only its registry entry; `Telegram 1` reopened without the phone-login form.
3. Recreating `Telegram 2` reused isolated slot 1 and remained a clean login after process restart.
4. The user completed a real second-account login.
5. UI Automator executed `Telegram 2 -> Telegram 1 -> Telegram 2`. Both headers and ready states matched, neither account showed `auth-phone-number-form`, and the fatal-crash scan was empty.
6. Measured PSS was approximately 34 MB for the background main process and 104 MB for a clean isolated Telegram WebView; the authenticated second account measured approximately 179 MB.

## Build checks

- `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed in a 47-task Gradle run.
- Factory structure and Foundation Gate validation passed without errors or warnings.
- `git diff --check` passed.

## Privacy

No authenticated conversation screenshot or UI hierarchy is retained. Evidence images contain only the Geek account registry and Telegram's unauthenticated login page.
