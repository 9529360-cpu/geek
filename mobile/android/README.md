# Geek Android

Formal Android client workspace.

Current milestone (`MOB-001`) provides the production application shell only.
Account login and browser-session persistence belong to `MOB-002`; multi-account
isolation, translation, and broadcast follow in that order.

Build with JDK 17 and Android SDK 35:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```
