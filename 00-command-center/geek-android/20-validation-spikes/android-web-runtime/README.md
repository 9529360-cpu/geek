# Android Web Runtime Validation Spike

Disposable evidence-only prototype for `SPK-001`. It validates APK build/install,
the Geek mobile shell, a single Android WebView session, HTTPS/platform navigation
guards, persistence provided by the app WebView profile, and bounded renderer recovery.

This directory is not integration-eligible. Production work must reimplement the
accepted engine choice under `mobile/android/` after the spike evidence is reviewed.

The debug application id is `com.bbnba.geek.mobile.debug.spike`, so uninstalling the
spike cannot remove official WhatsApp, Telegram, LINE, or a future production Geek app.
