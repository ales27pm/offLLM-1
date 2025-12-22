# offLLM Symbiosis Conductor Report (v1)

- Generated: **2025-12-22T03:20:18Z**
- Repo root: `/home/ales27pm/offLLM-1`
- Repo fingerprint: `git:5f20f16736d280d7a03471367b8e600ceafe0d72`
- Input report: `/home/ales27pm/offLLM-1/scripts/reports/symbiosis_v6/symbiosis_deep_report.json`
- Input SARIF: `/home/ales27pm/offLLM-1/scripts/reports/symbiosis_v6/symbiosis_deep_report.sarif.json`

## Where to search (from Symbiosis Advisor)

### prompts

- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `ci/download-mlx-model.sh`
- `train_lora.py`
- `eval/golden_prompts.json`

Suggested ripgrep probes:

- `rg -n --hidden --no-ignore-vcs '\bSYSTEM_PROMPT\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'ci/download-mlx-model.sh' 'train_lora.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '\bsystem prompt\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'ci/download-mlx-model.sh' 'train_lora.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '\bprompt_template\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'ci/download-mlx-model.sh' 'train_lora.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '\bPROMPT_TEMPLATE\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'ci/download-mlx-model.sh' 'train_lora.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '###\s*Instruction' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'ci/download-mlx-model.sh' 'train_lora.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '###\s*Response' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'ci/download-mlx-model.sh' 'train_lora.py' 'eval/golden_prompts.json'`

### tools_orchestration

- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `mlops/telemetry_to_sft.py`
- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `offllm_symbiosis_advisor_v3.py`
- `offllm_symbiosis_advisor_v6.py`
- `train_lora.py`
- `offllm_end_to_end_pipeline.py`
- `eval/golden_prompts.json`

Suggested ripgrep probes:

- `rg -n --hidden --no-ignore-vcs '\btool(s)?\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'mlops/telemetry_to_sft.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_symbiosis_advisor_v6.py' 'train_lora.py' 'offllm_end_to_end_pipeline.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '\bfunction_call\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'mlops/telemetry_to_sft.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_symbiosis_advisor_v6.py' 'train_lora.py' 'offllm_end_to_end_pipeline.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '\btool_calls\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'mlops/telemetry_to_sft.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_symbiosis_advisor_v6.py' 'train_lora.py' 'offllm_end_to_end_pipeline.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '\bToolRegistry\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'mlops/telemetry_to_sft.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_symbiosis_advisor_v6.py' 'train_lora.py' 'offllm_end_to_end_pipeline.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '\bToolHandler\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'mlops/telemetry_to_sft.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_symbiosis_advisor_v6.py' 'train_lora.py' 'offllm_end_to_end_pipeline.py' 'eval/golden_prompts.json'`
- `rg -n --hidden --no-ignore-vcs '\bschema\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'mlops/telemetry_to_sft.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_symbiosis_advisor_v6.py' 'train_lora.py' 'offllm_end_to_end_pipeline.py' 'eval/golden_prompts.json'`

### telemetry

- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v6.py`
- `offllm_symbiosis_advisor_v3.py`
- `offllm_end_to_end_pipeline.py`
- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `mlops/telemetry_to_sft.py`
- `eval/retrieval_eval.py`
- `eval/export_equivalence.py`
- `mlops/generate_retrieval_pairs.py`
- `convert_to_coreml.py`

Suggested ripgrep probes:

- `rg -n --hidden --no-ignore-vcs '\btelemetry\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'mlops/telemetry_to_sft.py' 'eval/retrieval_eval.py' 'eval/export_equivalence.py' 'mlops/generate_retrieval_pairs.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\bevent\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'mlops/telemetry_to_sft.py' 'eval/retrieval_eval.py' 'eval/export_equivalence.py' 'mlops/generate_retrieval_pairs.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\bredact\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'mlops/telemetry_to_sft.py' 'eval/retrieval_eval.py' 'eval/export_equivalence.py' 'mlops/generate_retrieval_pairs.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\bpii\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'mlops/telemetry_to_sft.py' 'eval/retrieval_eval.py' 'eval/export_equivalence.py' 'mlops/generate_retrieval_pairs.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\bhash\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'mlops/telemetry_to_sft.py' 'eval/retrieval_eval.py' 'eval/export_equivalence.py' 'mlops/generate_retrieval_pairs.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\blatenc(y|ies)\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'mlops/telemetry_to_sft.py' 'eval/retrieval_eval.py' 'eval/export_equivalence.py' 'mlops/generate_retrieval_pairs.py' 'convert_to_coreml.py'`

### retrieval_rag

- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v3.py`
- `offllm_end_to_end_pipeline.py`
- `offllm_symbiosis_advisor_v6.py`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `eval/retrieval_eval.py`
- `mlops/generate_retrieval_pairs.py`

Suggested ripgrep probes:

- `rg -n --hidden --no-ignore-vcs '\bHNSW\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'offllm_symbiosis_advisor_v6.py' 'eval/retrieval_eval.py' 'mlops/generate_retrieval_pairs.py'`
- `rg -n --hidden --no-ignore-vcs '\bvector\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'offllm_symbiosis_advisor_v6.py' 'eval/retrieval_eval.py' 'mlops/generate_retrieval_pairs.py'`
- `rg -n --hidden --no-ignore-vcs '\bembed(ding|s)\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'offllm_symbiosis_advisor_v6.py' 'eval/retrieval_eval.py' 'mlops/generate_retrieval_pairs.py'`
- `rg -n --hidden --no-ignore-vcs '\bchunk(ing)?\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'offllm_symbiosis_advisor_v6.py' 'eval/retrieval_eval.py' 'mlops/generate_retrieval_pairs.py'`
- `rg -n --hidden --no-ignore-vcs '\bRAG\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'offllm_symbiosis_advisor_v6.py' 'eval/retrieval_eval.py' 'mlops/generate_retrieval_pairs.py'`
- `rg -n --hidden --no-ignore-vcs '\bretriev(er|al)\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v3.py' 'offllm_end_to_end_pipeline.py' 'offllm_symbiosis_advisor_v6.py' 'eval/retrieval_eval.py' 'mlops/generate_retrieval_pairs.py'`

### evaluation

- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `offllm_symbiosis_advisor_v6.py`
- `offllm_symbiosis_advisor_v3.py`
- `eval/run_prompt_regression.py`
- `eval/export_equivalence.py`
- `convert_to_coreml.py`
- `reports/symbiosis_v6/symbiosis_deep_report.sarif.json`

Suggested ripgrep probes:

- `rg -n --hidden --no-ignore-vcs '\bgolden\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'eval/run_prompt_regression.py' 'eval/export_equivalence.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\beval\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'eval/run_prompt_regression.py' 'eval/export_equivalence.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\bregression\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'eval/run_prompt_regression.py' 'eval/export_equivalence.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\brefusal\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'eval/run_prompt_regression.py' 'eval/export_equivalence.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\bjson validity\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'eval/run_prompt_regression.py' 'eval/export_equivalence.py' 'convert_to_coreml.py'`
- `rg -n --hidden --no-ignore-vcs '\bgrounded\b' 'mlops/offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v4.py' 'offllm_symbiosis_advisor_v6.py' 'offllm_symbiosis_advisor_v3.py' 'eval/run_prompt_regression.py' 'eval/export_equivalence.py' 'convert_to_coreml.py'`

## Hotspots (ranked)

- **mlops/offllm_symbiosis_advisor_v4.py** — score=120.0, churn=0, reasons=appears_in_surfaces=['evaluation', 'hot_churn', 'ios_mlx_coreml', 'prompts', 'retrieval_rag', 'telemetry', 'todos_fixmes', 'tools_orchestration']; sarif_findings=3
- **offllm_symbiosis_advisor_v4.py** — score=110.0, churn=0, reasons=appears_in_surfaces=['evaluation', 'ios_mlx_coreml', 'prompts', 'retrieval_rag', 'telemetry', 'todos_fixmes', 'tools_orchestration']; sarif_findings=3
- **offllm_symbiosis_advisor_v3.py** — score=60.0, churn=0, reasons=appears_in_surfaces=['evaluation', 'hot_churn', 'ios_mlx_coreml', 'retrieval_rag', 'telemetry', 'tools_orchestration']
- **reports/symbiosis_v6/symbiosis_deep_report.json** — score=60.0, churn=0, reasons=appears_in_surfaces=['evaluation', 'ios_mlx_coreml', 'prompts', 'retrieval_rag', 'telemetry', 'tools_orchestration']
- **reports/symbiosis_v6/symbiosis_deep_report.md** — score=60.0, churn=0, reasons=appears_in_surfaces=['evaluation', 'ios_mlx_coreml', 'prompts', 'retrieval_rag', 'telemetry', 'tools_orchestration']
- **offllm_end_to_end_pipeline.py** — score=50.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml', 'retrieval_rag', 'telemetry', 'tools_orchestration']
- **offllm_symbiosis_advisor_v6.py** — score=50.0, churn=0, reasons=appears_in_surfaces=['evaluation', 'ios_mlx_coreml', 'retrieval_rag', 'telemetry', 'tools_orchestration']
- **ci/download-mlx-model.sh** — score=40.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml', 'prompts']; sarif_findings=1
- **convert_to_coreml.py** — score=40.0, churn=0, reasons=appears_in_surfaces=['evaluation', 'hot_churn', 'ios_mlx_coreml', 'telemetry']
- **train_lora.py** — score=40.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'prompts', 'tools_orchestration']; sarif_findings=1
- **eval/export_equivalence.py** — score=30.0, churn=0, reasons=appears_in_surfaces=['evaluation', 'hot_churn', 'telemetry']
- **eval/golden_prompts.json** — score=30.0, churn=0, reasons=appears_in_surfaces=['prompts', 'tools_orchestration']; sarif_findings=1
- **eval/retrieval_eval.py** — score=30.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'retrieval_rag', 'telemetry']
- **mlops/telemetry_to_sft.py** — score=30.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'telemetry', 'tools_orchestration']
- **AGENTS.md** — score=28.0, churn=1, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']; git_churn_commits~1
- **build-ios-unsigned.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **build_unsigned_ios.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/bootstrap-build.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/bootstrap_ios.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/build_report.py** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/check_mlx_bridge.js** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/emit_ios_diagnostics_summary.py** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/ensure_ios_platform.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/export_ipa.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/import_signing.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/prep-ios-unsigned-archive.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/select_xcode.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/select_xcode_and_ensure_ios.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **ci/upload_testflight.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']
- **dev/doctor.sh** — score=20.0, churn=0, reasons=appears_in_surfaces=['hot_churn', 'ios_mlx_coreml']

## Refactor backlog (acceptance-test shaped)

### Make evaluation first-class (golden set + regression gates) (high)

**Why:** Fine-tuning without a regression gate is just vibe-training.

**Next steps:**

- Create a golden eval suite: tool parsing, JSON validity, groundedness/citations, refusal correctness.
- Add an offline eval CLI and a CI job that blocks regressions.
- Version eval cases alongside prompt templates.

**Acceptance checks:**

- CI job runs eval suite and fails on regressions (JSON validity, tool parsing, refusal correctness).
- Golden cases are versioned and tied to prompt template version.

**Suggested deliverables:**

- `eval/golden_prompts.json expanded with ids + expected tool calls`
- `eval/run_prompt_regression.py wired into CI`
- `reports/ outputs include SARIF for GitHub code scanning`

**Evidence files:**

- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `offllm_symbiosis_advisor_v6.py`
- `offllm_symbiosis_advisor_v3.py`
- `eval/run_prompt_regression.py`
- `eval/export_equivalence.py`
- `convert_to_coreml.py`
- `reports/symbiosis_v6/symbiosis_deep_report.sarif.json`

### Standardise telemetry schema and redaction (high)

**Why:** Telemetry is the bridge between what the app did and what the model should learn.

**Next steps:**

- Define an event schema for model interactions.
- Centralise PII redaction (emails, tokens, keys).
- Implement telemetry→SFT and telemetry→retrieval pairs transforms.

**Acceptance checks:**

- All telemetry events validate against JSON Schema in CI.
- PII redaction applied before writing to disk; unit tests include emails/tokens/keys.
- telemetry→SFT and telemetry→retrieval transforms are deterministic (stable hashes).

**Suggested deliverables:**

- `schemas/telemetry_event.schema.json`
- `src/utils/telemetry.{js,ts} updated to emit versioned schema ids`
- `scripts/mlops/telemetry_to_sft.py updated to validate input schema`

**Evidence files:**

- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v6.py`
- `offllm_symbiosis_advisor_v3.py`
- `offllm_end_to_end_pipeline.py`
- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `mlops/telemetry_to_sft.py`
- `eval/retrieval_eval.py`
- `eval/export_equivalence.py`
- `mlops/generate_retrieval_pairs.py`
- `convert_to_coreml.py`

### Harden tool-calling boundaries and injection resistance (med)

**Why:** Tool-calling is the highest-risk surface; harden and train for safe behaviour.

**Next steps:**

- Validate tool args against JSON schema before execution.
- Capability-based allowlists.
- Add red-team eval set: injection, schema smuggling, exfil attempts.

**Acceptance checks:**

- All tool args validated against schema before execution (reject unknown fields).
- Tool allowlist depends on capability context; tests cover allow/deny.
- Red-team eval cases included and run in CI.

**Suggested deliverables:**

- `schemas/tools/*.schema.json`
- `src/core/tools/ToolRegistry.js enforces schema+allowlist`
- `eval/redteam_tool_injection.json`

**Evidence files:**

- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `mlops/telemetry_to_sft.py`
- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `offllm_symbiosis_advisor_v3.py`
- `offllm_symbiosis_advisor_v6.py`
- `train_lora.py`
- `offllm_end_to_end_pipeline.py`
- `eval/golden_prompts.json`

### Isolate retrieval + chunking into a single library surface (med)

**Why:** Stable chunking/embedding settings prevent offline vs runtime mismatch.

**Next steps:**

- Extract chunking rules into one module with golden tests.
- Log retrieval traces into telemetry.
- Train embeddings/LLM2Vec with the same chunk distribution used at runtime.

**Acceptance checks:**

- Chunking outputs are stable: golden tests cover at least 20 representative documents.
- Runtime retrieval logs query+topk ids+scores into telemetry.
- Offline indexing uses the exact same chunker + embedding config as runtime.

**Suggested deliverables:**

- `src/retrieval/chunking.js (or .ts)`
- `src/retrieval/embedding_config.json`
- `eval/retrieval_eval.py extended with chunk distribution checks`

**Evidence files:**

- `mlops/offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v4.py`
- `offllm_symbiosis_advisor_v3.py`
- `offllm_end_to_end_pipeline.py`
- `offllm_symbiosis_advisor_v6.py`
- `reports/symbiosis_v6/symbiosis_deep_report.md`
- `reports/symbiosis_v6/symbiosis_deep_report.json`
- `eval/retrieval_eval.py`
- `mlops/generate_retrieval_pairs.py`
