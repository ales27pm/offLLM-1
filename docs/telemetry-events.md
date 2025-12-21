# Telemetry events

Telemetry is stored as JSON Lines under the app document directory so runtime traces can be converted into SFT or retrieval training examples without leaking sensitive content.【F:src/utils/telemetry.js†L1-L169】

## Event schema

- `prompt_received` captures a redacted prompt preview with a deterministic hash so later tool and response events can be correlated without storing raw content.【F:src/utils/telemetry.js†L139-L154】
- `tool_invocation` records tool name, hashed arguments, redacted previews, latency, and success/failure to describe how tools were used in context.【F:src/utils/telemetry.js†L119-L137】
- `retrieval` stores hashed queries, selected result ids, and raw candidate ids/scores to support debugging and recall evaluation before re-ranking.【F:src/utils/telemetry.js†L157-L172】【F:src/core/memory/services/Retriever.js†L18-L65】
- `final_response` captures the redacted response payload and tool-call count to finish the training record associated with a prompt hash.【F:src/utils/telemetry.js†L145-L155】【F:src/core/AgentOrchestrator.js†L158-L170】

## Redaction rules

- Emails, phone numbers, bearer tokens, and secret-like keys are replaced with standardized placeholders before telemetry is written to disk, and values are truncated to avoid capturing long payloads.【F:src/utils/telemetry.js†L12-L46】
- Structured payloads are redacted recursively so sensitive nested fields or arrays are sanitized before serialization.【F:src/utils/telemetry.js†L28-L46】

## JSONL output

- Each line is a standalone JSON object with ISO timestamps, a tool schema version, and the event payload so downstream scripts can stream-process telemetry safely.【F:src/utils/telemetry.js†L90-L117】
- Conversion utilities in `scripts/mlops` turn telemetry into SFT-ready datasets and retrieval pair files for training workflows.【F:scripts/mlops/telemetry_to_sft.py†L1-L78】【F:scripts/mlops/generate_retrieval_pairs.py†L1-L41】
