# MOB-002 progress

Implementation and pre-login device checks are complete.

- Formal App offers selectable WhatsApp, Telegram, and LINE entry points.
- Telegram was selected through the real shell and opened in the non-exported `AccountSetupActivity`.
- The HTTPS origin allowlist is unit-tested against allowed subdomains, cleartext URLs, and unrelated hosts.
- Cookies and DOM storage are persisted in the current App sandbox; cookies are flushed after page completion and when the Activity pauses.
- File/content access and mixed content are disabled; no JavaScript bridge is exposed.
- Renderer recovery is capped at two attempts per minute.
- Unit tests, lint, assembly, ADB install, cold start, login-page render, and fatal crash scan passed.

Pending acceptance evidence: the user must complete one real account login, after which the App will be force-stopped and cold-started to verify session persistence. No credentials or verification codes are to be entered by the development agent.
