# Codex Agent Dispatch Packet

You are the live worker temporarily bound to `client-engineering--core-client-engineer` for task `MOB-001`.
This roster role is a capability profile, not a persistent process. Read the files below, perform the work, verify it, and return evidence to the coordinator.

## Read first

- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\00-command-center\tasks\MOB-001.json`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\10-departments\client-engineering\agents\core-client-engineer\ROLE_SKILLS.md`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\10-departments\client-engineering\agents\core-client-engineer\RULES.md`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\02-shared-knowledge\build-specimen\product-contract.json` (`sha256:52e4896c09aee038800522f98c3d0511ebbd8bbde9237964a8075a7d52ee103d`)
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\02-shared-knowledge\build-specimen\system-contracts.json` (`sha256:38c32ddf7d6d4361267ae4d1dedefe190631d1a0345d2b6cbd1d41621356be2b`)
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\02-shared-knowledge\build-specimen\experience-contract.json` (`sha256:689a5d143f6ee5d67f333accef9e268376d925769677dd625f7fb51a1b3d183f`)
- Relevant source and contracts named by the task

## Outcome

Build the formal Geek Android application shell

## Owned paths

- mobile/android/**

## Acceptance criteria

- Formal Android debug APK builds with unit tests and lint passing
- APK installs alongside the disposable spike and cold-starts on the authorized Mblu 21
- Shell presents compact mobile navigation for accounts, conversations, tools, and profile without implementing account login yet

## Required evidence

- Gradle test lint and assemble output
- ADB install cold-start screenshot and crash scan

## Contract and provenance

- None; use the task fields as the bounded contract.
- Foundation revision: `94afebafba7a89185df82fe3de449943815f19336c65719b70e11f10197b8242`
- Foundation workflow hash: `74a18c29b204dfb4002ff475803c71f35d96a06166ecd76ed164cfa40c322559`

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
