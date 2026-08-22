# MOB-002 single-account acceptance

Date: 2026-08-23 (Europe/Berlin)

## Accepted behavior

- A platform is selected from the formal account-first shell and opens in a non-exported in-App WebView Activity.
- The user completed a real Telegram login on the authorized Mblu 21.
- After `am force-stop`, a cold App start, and reopening Telegram, the existing conversation list returned without another login.
- Cold start completed in 980 ms and the post-restart fatal crash scan was empty.
- The login container allows only the selected platform's HTTPS origins, disables file/content access and mixed content, exposes no JavaScript bridge, and caps renderer recovery at two attempts per minute.

## Usability revision

The onboarding-style home screen was replaced after user feedback with a daily-use account workspace:

- account count and add action are in the top bar;
- the saved account and primary open action are the first content block;
- translation and broadcast are secondary, clearly sequenced actions;
- Accounts, Conversations, Tools, and Profile remain fixed in the bottom thumb zone;
- development-stage prose and the oversized roadmap were removed from the normal logged-in view.

## Checks

1. `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed in one 47-task Gradle run.
2. Origin unit tests passed for allowed HTTPS subdomains and denied cleartext/unrelated hosts.
3. APK reinstall and 980 ms cold start passed on serial `416HGEFK22S7E`.
4. Real Telegram session persistence passed after force-stop and cold restart.
5. UI Automator passed all revised destinations: recent conversation, tools, device profile, account return, and account reopen.
6. The final fatal crash scan and `git diff --check` passed.

## Privacy

The temporary screenshot containing private conversation data was replaced immediately and is not included in the acceptance package. The retained `geek-redesign-account.png` contains only the Geek account dashboard.
