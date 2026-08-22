# MOB-003 progress

The PC-aligned mobile interaction model is implemented and installed on the authorized Mblu 21.

## Implemented UI contract

- Bottom navigation is now `应用中心 / 账户列表 / 我的`.
- Application Center exposes WhatsApp, Telegram, and LINE as addable applications.
- A completed login appears in Account List using the PC naming convention (`Telegram 1`).
- Selecting the account reopens its preserved in-App session.
- The active account WebView has two compact floating actions: `译` and `发`.
- Translation opens an account-scoped bottom sheet.
- Broadcast opens an account-scoped composer bottom sheet.

## Checks passed

- Unit tests, Android lint, and debug APK assembly.
- APK reinstall and physical-device cold start.
- Application Center and Account List rendering at 720 x 1640 without horizontal overflow.
- UI Automator detection of both contextual floating actions.
- Translation sheet and Broadcast sheet open from the active `Telegram 1` session.
- Dedicated WebView processes and data-directory suffixes are implemented for three additional account slots.
- `Telegram 2` opens in `:geek_account_1` with a clean Telegram login page instead of inheriting the `Telegram 1` session.
- The account-management action clears only the selected isolated slot's cookies, cache, WebStorage, and registry entry.
- Physical-device delete verification removed `Telegram 2` while `Telegram 1` remained present and reopened without the phone-login form.
- Recreating `Telegram 2` reused isolated slot 1; after a process stop/restart it again rendered the clean phone-login form.
- Measured PSS on Mblu 21: main process about 34 MB and one active isolated Telegram WebView process about 104 MB.
- Post-interaction fatal crash scan and `git diff --check`.

## Final acceptance

The user completed a real login for `Telegram 2`. UI Automator then verified the sequence `Telegram 2 -> Telegram 1 -> Telegram 2`: both account headers were correct, both pages were ready, neither displayed Telegram's phone-login form, and the fatal-crash scan stayed empty. Runtime isolation, independent deletion, process restart, two credentialed sessions, and the initial memory profile are therefore accepted. Translation and broadcast panels define interaction only; their engines remain owned by MOB-004 and MOB-005.

## Physical-device evidence

- `geek-account-management.png`: three-account registry with an explicit management action on the isolated instance.
- `geek-telegram-2-isolated.png`: first clean launch of the second Telegram process.
- `geek-telegram-2-recreated-clean.png`: clean login state after deletion, slot reuse, and process restart.
