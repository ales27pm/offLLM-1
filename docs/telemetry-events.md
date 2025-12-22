# Telemetry events

Telemetry is stored as JSON Lines under the app document directory so runtime traces can be converted into SFT or retrieval training examples without leaking sensitive content. Each entry validates against the canonical telemetry JSON Schema so CI can reject drift early.【F:src/utils/telemetry.js†L1-L187】【F:schemas/telemetry_event.schema.json†L1-L118】

## Event schema

- `prompt_received` captures a redacted prompt preview with a deterministic hash so later tool and response events can be correlated without storing raw content.【F:src/utils/telemetry.js†L160-L181】
- `tool_invocation` records tool name, hashed arguments, redacted previews, latency, and success/failure to describe how tools were used in context.【F:src/utils/telemetry.js†L183-L205】
- `retrieval` stores hashed queries, selected result ids, and raw candidate ids/scores to support debugging and recall evaluation before re-ranking.【F:src/utils/telemetry.js†L220-L236】【F:src/core/memory/services/Retriever.js†L18-L73】
- `final_response` captures the redacted response payload and tool-call count to finish the training record associated with a prompt hash.【F:src/utils/telemetry.js†L207-L218】【F:src/core/AgentOrchestrator.js†L160-L174】

## Redaction rules

- Emails, phone numbers, bearer tokens, and secret-like keys are replaced with standardized placeholders before telemetry is written to disk, and values are truncated to avoid capturing long payloads.【F:src/utils/telemetry.js†L17-L78】
- Structured payloads are redacted recursively so sensitive nested fields or arrays are sanitized before serialization.【F:src/utils/telemetry.js†L28-L46】

## JSONL output

- Each line is a standalone JSON object with ISO timestamps, schema metadata, and a tool schema version so downstream scripts can stream-process telemetry safely.【F:src/utils/telemetry.js†L115-L154】
- Conversion utilities in `scripts/mlops` turn telemetry into SFT-ready datasets and retrieval pair files for training workflows.【F:scripts/mlops/telemetry_to_sft.py†L1-L78】【F:scripts/mlops/generate_retrieval_pairs.py†L1-L41】
