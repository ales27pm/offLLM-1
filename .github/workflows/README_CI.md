# CI Workflow Overview

The repository now keeps a focused set of automation workflows that cover the
two core pieces of infrastructure we rely on in CI: signed iOS builds and
reproducible Core ML exports.

## Build iOS App (monGARS)

Runs on pushes to `main` and on manual dispatch. The workflow provisions a
temporary signing keychain with the secrets provided in the repo settings,
generates the Xcode project using XcodeGen, installs Pods with Bundler, and
archives the release build with manual code signing. It then exports an
ad-hoc-signed `.ipa` that is uploaded as an artifact before the signing
keychain is torn down.

- Xcode: 16.x as provided by the `macos-15` runner
- Workspace: `ios/monGARS.xcworkspace`
- Scheme: `monGARS`
- Artifacts: `.xcarchive`, signed `.ipa`

## Convert Dolphin to Core ML

Runs on pushes to `main`. The workflow installs the Python toolchain required
to download `cognitivecomputations/Dolphin3.0-Llama3.2-3B` from the Hugging
Face Hub and delegates conversion to `scripts/convert_to_coreml.py`. The script
produces FP16, INT8, and INT4 variants of the model along with a JSON manifest;
all artifacts are published via the workflow.

- Python: 3.11
- Dependencies: PyTorch 2.2, Transformers 4.44.2, Core ML Tools 8.0
- Artifacts: `{fp16,int8,int4-lut}.mlpackage`, `coreml_artifacts.json`
- Authentication: Set `HF_TOKEN` (or pass `--hf_token`) when working with
  private/gated models so the script can authenticate with Hugging Face.

## Fine-tune (LoRA) + Convert

Available via manual dispatch for experimentation. When `run_training` is set
to `true` the workflow expects a dataset path and fine-tunes the base model via
LoRA before merging and converting it. Otherwise it simply converts the chosen
model. The outputs mirror the Core ML conversion workflow and are uploaded as a
separate artifact bundle.
