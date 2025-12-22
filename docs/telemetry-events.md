# Telemetry events

Telemetry is stored as JSON Lines under the app document directory so runtime traces can be converted into SFT or retrieval training examples without leaking sensitive content. Each entry validates against the canonical telemetry JSON Schema so CI can reject drift early, and the schema now enforces prompt identifiers, outcomes, latency, and redaction flags for every event.【F:src/utils/telemetry.js†L1-L215】【F:schemas/telemetry_event.schema.json†L1-L86】

## Event schema

- `prompt_received` captures the redacted prompt preview with a deterministic hash plus the prompt id/version, outcome, latency, and redaction flag so the entry can be safely reused for training.【F:src/utils/telemetry.js†L190-L245】
- `tool_invocation` records tool name, hashed arguments, redacted previews, latency, and success/failure while attaching prompt id/version and tool-call metadata for downstream dataset construction.【F:src/utils/telemetry.js†L150-L189】
- `retrieval` stores hashed queries, selected result ids, candidate ids/scores, prompt id/version, and redaction flags to support debugging and recall evaluation before re-ranking.【F:src/utils/telemetry.js†L246-L270】【F:src/core/memory/services/Retriever.js†L18-L80】
- `final_response` captures the redacted response payload, prompt metadata, and tool-call count to finish the training record associated with a prompt hash.【F:src/utils/telemetry.js†L222-L245】【F:src/core/AgentOrchestrator.js†L167-L185】

## Redaction rules

- Emails, phone numbers, bearer tokens, and secret-like keys are replaced with standardized placeholders before telemetry is written to disk, and values are truncated to avoid capturing long payloads.【F:src/utils/telemetry.js†L17-L78】
- Structured payloads are redacted recursively so sensitive nested fields or arrays are sanitized before serialization.【F:src/utils/telemetry.js†L28-L46】

## JSONL output

- Each line is a standalone JSON object with ISO timestamps, schema metadata, prompt identifiers, and a tool schema version so downstream scripts can stream-process telemetry safely.【F:src/utils/telemetry.js†L115-L170】
- Conversion utilities in `scripts/mlops` turn telemetry into SFT-ready datasets, tool-call traces, and retrieval triples for training workflows while validating schema compliance and redaction status.【F:scripts/mlops/telemetry_to_sft.py†L1-L128】【F:scripts/mlops/telemetry_to_tool_calls.py†L1-L136】【F:scripts/mlops/telemetry_to_retrieval_triples.py†L1-L93】
