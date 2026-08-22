# MOB-001 formal Android shell verification

Date: 2026-08-23 (Europe/Berlin)

## Delivered

- Formal Android project under `mobile/android` with production package namespace.
- Debug application ID `com.bbnba.geek.mobile.debug`, installable alongside the disposable spike.
- Compact account-first shell with Accounts, Conversations, Tools, and Profile navigation.
- Explicit product sequence: App, multi-account, translation, broadcast.
- Browser runtime boundary that remains unavailable until MOB-002 implements and verifies single-account login.

## Checks

1. `testDebugUnitTest` passed, including default navigation and null-state protection.
2. `lintDebug` passed with `abortOnError` enabled.
3. `assembleDebug` passed; the combined Gradle run completed successfully with 47 tasks.
4. `adb install -r` returned `Success` on Mblu 21 serial `416HGEFK22S7E`.
5. Forced-stop cold start returned `Status: ok`, `LaunchState: COLD`, and `TotalTime: 1186` ms.
6. The application remained resumed with PID `16515`; the post-launch fatal crash scan was empty.
7. UI Automator confirmed all four navigation destinations: `统一会话`, `效率工具`, `我的极客`, and return to `你的移动工作台`.
8. The 720 x 1640 real-device screenshot shows no horizontal overflow or clipped primary action.
9. `git diff --check` passed.

## Evidence

- `geek-mobile-shell-awake.png`: formal shell on the physical device.
- `geek-mobile-shell-awake.xml`: accessibility/UI hierarchy.
- APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

## Scope boundary

MOB-001 deliberately does not implement login, session persistence, multi-account isolation, translation, or broadcast. The next task is MOB-002 single-account runtime acceptance.
