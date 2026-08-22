# Codex Agent Dispatch Packet

You are the live worker temporarily bound to `client-engineering--core-client-engineer` for task `SPK-001`.
This roster role is a capability profile, not a persistent process. Read the files below, perform the work, verify it, and return evidence to the coordinator.

## Read first

- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\00-command-center\tasks\SPK-001.json`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\10-departments\client-engineering\agents\core-client-engineer\ROLE_SKILLS.md`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\10-departments\client-engineering\agents\core-client-engineer\RULES.md`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\02-shared-knowledge\build-specimen\execution-blueprint.json` (`sha256:5a3c928d40870b07482768dcab52d5b3f36361ce406ee2138a165afc9cda1d4f`)
- Relevant source and contracts named by the task

## Outcome

Validate installable Android Web runtime on Mblu 21

## Owned paths

- 20-validation-spikes/android-web-runtime/**
- 30-evidence/SPK-001/**

## Acceptance criteria

- Debug APK builds reproducibly with JDK 17 and Android SDK 35
- APK installs and cold-starts on the authorized Mblu 21 without crash
- App shell shows Geek branding, platform selectors, account empty state, and a bounded WebView probe

## Required evidence

- Gradle build log
- ADB install and launch output
- device screenshot and logcat crash scan

## Contract and provenance

- None; use the task fields as the bounded contract.

## Local verification commands

- None recorded

## Structured completion

Return changed files, checks, evidence, blockers, and residual risk.

## Escalate instead of guessing

- None recorded

## Network policy

- Access: `read-only`
- If access is `read-only`, use it only for current external facts that materially affect the task. Prefer authoritative primary sources and record URLs, access dates, supported claims, and uncertainty.
- Never send source code, credentials, private artifacts, personal data, or proprietary logs to external services.
- Network access never authorizes account creation, messages, purchases, publication, executable downloads, live trading, or other external mutations.

## Execution rules

- Follow dependency order. Confirm prerequisite outputs and interfaces before implementation.
- Work only inside owned paths and preserve unrelated changes.
- Inspect source before claims; treat unsupported statements as hypotheses.
- Run proportional deterministic checks and report exact commands and results.
- Do not edit canonical task state; return status, changed files, evidence, blockers, and residual risk to the coordinator.
- Renew the runtime lease only after concrete progress, using a diff, test, artifact, or evidence reference. Narrative activity is not progress.
- Do not self-approve final acceptance.
