# Documentation Guide

## Scope

- `docs/agent-architecture.md` is the authoritative narrative for how orchestration, memory, services, tools, plugins, and native bridges interact. Update it alongside any code changes so every section can still cite the implementation that proves the behaviour.【F:docs/agent-architecture.md†L3-L118】
- Keep the architecture guide focused on runtime responsibilities and extension points; platform-automation specifics belong in the scripts/tooling guides and should be referenced rather than copied.【F:docs/agent-architecture.md†L3-L118】【F:scripts/dev/doctor.sh†L200-L409】

## Authoring guidelines

- Preserve the existing structure: sentence-case headings, short context paragraphs, and bullet lists that end with repository citations (`【F:path†Lx-Ly】`). New sections should follow the same pattern so downstream agents can diff updates easily.【F:docs/agent-architecture.md†L3-L160】
- Cite the narrowest line range that demonstrates the claim (e.g., link directly to the function or test you touched) and prefer code references over prose whenever possible.【F:docs/agent-architecture.md†L5-L118】
- Avoid duplicating large code snippets; instead, summarise behaviour and point to the source. If diagrams or tables add clarity, introduce them after the descriptive text so readers can parse the summary first.【F:docs/agent-architecture.md†L3-L118】

## Coordination with tooling

- When the runtime, memory, or service contracts change, update the relevant Jest suites and mention the new expectations in the guide so code, tests, and docs stay aligned.【F:**tests**/toolHandler.test.js†L1-L76】【F:**tests**/vectorMemory.test.js†L1-L45】【F:**tests**/llmService.test.js†L1-L33】
- Reference automation artefacts by describing how to regenerate them (doctor or Codex) rather than pasting raw logs. Link to the scripts responsible for producing `REPORT.md`, `report_agent.md`, and other outputs when additional context is required.【F:scripts/dev/doctor.sh†L283-L409】【F:scripts/codex/lib/analyze.mjs†L11-L55】

## Living history

- 2025-09 — The architecture guide was refreshed to match the current plugin system, tool registry, and MLX-based native bridges. Mirror any future runtime changes here to avoid drift between the docs and the orchestrator code.【F:docs/agent-architecture.md†L15-L118】
