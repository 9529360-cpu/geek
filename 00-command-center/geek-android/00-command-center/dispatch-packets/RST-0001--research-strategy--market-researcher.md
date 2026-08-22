# Codex Agent Dispatch Packet

You are the live worker temporarily bound to `research-strategy--market-researcher` for task `RST-0001`.
This roster role is a capability profile, not a persistent process. Read the files below, perform the work, verify it, and return evidence to the coordinator.

## Read first

- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\00-command-center\tasks\RST-0001.json`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\10-departments\research-strategy\agents\market-researcher\ROLE_SKILLS.md`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\10-departments\research-strategy\agents\market-researcher\RULES.md`
- `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\02-shared-knowledge\build-specimen\intent-contract.json` (`sha256:3e0009fc8b0234eb3fbc15a85e7ccef5b69d6fc537a9919b292778ed66bd3ca2`)
- Relevant source and contracts named by the task

## Outcome

Research the problem, users, constraints, and alternatives

## Owned paths

- 02-shared-knowledge/build-specimen/research.json
- 30-evidence/RST-0001/**

## Acceptance criteria

- Output validates against workflow stage research schema
- All cross-document IDs resolve and applicable requirement coverage is complete
- Facts and model assessments are separated in the evidence receipt
- Input and workflow hashes match the dispatch packet

## Required evidence

- structured completion
- deterministic checks
- cross-document validation
- provenance hashes

## Contract and provenance

- Workflow: `intent-to-build` / stage `research`
- Contract: `C:\Users\bz977\.codex\.chatgpt-projects\g-p-6a88a9bf82a881918dbd66f29c739b4f\geek-work\00-command-center\geek-android\00-command-center\workflows\intent-to-build.json` (`sha256:74a18c29b204dfb4002ff475803c71f35d96a06166ecd76ed164cfa40c322559`)
- Prompt version: `n-forge-intent-v1`
- Attempt limit: `3`
- Source hashes: `{"02-shared-knowledge/build-specimen/intent-contract.json": "3e0009fc8b0234eb3fbc15a85e7ccef5b69d6fc537a9919b292778ed66bd3ca2"}`
- Output schema: `{"properties": {"claims": {"type": "array"}, "recommendation": {"type": "string"}, "uncertainties": {"type": "array"}}, "required": ["claims", "uncertainties", "recommendation"], "type": "object"}`
- Routing rules: `{"allow": {"next_task": "PRD-0001"}, "block": {"next_task": null}, "defer": {"next_task": "RST-0001"}}`

## Local verification commands

- python "C:\Users\bz977\.codex\skills\n-forge\scripts\advance_workflow.py" --project "<project>" --task RST-0001 --result "<result.json>"

## Structured completion

Return one JSON object matching the task `completion_format`. Keep deterministic facts in `facts` and model judgments in `assessments`. Include exact `contract_hash`, `source_hashes`, `prompt_version`, output path, checks with exit codes, one `outcome`, and exactly the `next_task` allowed by the routing rule.

## Escalate instead of guessing

- contract or source hash drift
- scope or architecture change outside the stage contract
- repeated identical failure
- attempt budget exhausted
- missing deterministic verification

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
