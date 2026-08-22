# SPK-001 Android runtime verification

Date: 2026-08-23 (Europe/Berlin)

## Scope

Disposable validation spike only. The implementation is intentionally kept under
`20-validation-spikes/android-web-runtime` and is not eligible for integration
into the production mobile client.

## Device

- Serial: `416HGEFK22S7E`
- Product/model: `meizu_mblu_RU` / `Mblu_21`
- Android: 14 (API 34)
- Display: 720 x 1640, density 320
- ABI: arm64-v8a

## Deterministic checks

1. `gradlew.bat assembleDebug` completed with `BUILD SUCCESSFUL`; 32 tasks executed.
2. `adb install -r app-debug.apk` returned `Success`.
3. A forced-stop followed by `am start -W` returned `Status: ok`, `LaunchState: COLD`, and `TotalTime: 977` ms.
4. `pidof com.bbnba.geek.mobile.debug.spike` returned PID `15016` after launch.
5. A post-launch error log scan found no `FATAL EXCEPTION` or `AndroidRuntime` crash for the package.
6. The real-device screenshot shows Geek branding, WhatsApp/Telegram/LINE selectors, the single-account empty state, and the bounded action button without horizontal overflow.
7. Selecting Telegram and opening the probe kept `ProbeActivity` resumed inside the same application process and loaded Telegram's public HTTPS login page.
8. `git diff --check` completed without whitespace errors.

## Evidence

- `geek-spike-main-awake.png`: real-device main shell.
- `geek-spike-probe.png`: real-device Telegram probe.
- `geek-spike-probe-ui.xml`: Android UI hierarchy for the probe screen.
- APK: `20-validation-spikes/android-web-runtime/app/build/outputs/apk/debug/app-debug.apk`.

## Assessment

The Android App-shell and bounded WebView runtime route is feasible on the
authorized Mblu 21. This proves the foundation only; it does not prove account
login persistence, multi-account isolation, translation, or broadcast.
