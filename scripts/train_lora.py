import argparse
import json
import os
import re
import subprocess
import sys

import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)


def load_prompt_registry(registry_path: str) -> dict:
    if not os.path.isfile(registry_path):
        raise FileNotFoundError(f"Prompt registry not found: {registry_path}")
    with open(registry_path, "r", encoding="utf-8") as handle:
        text = handle.read()
    match = re.search(r"PROMPT_REGISTRY_JSON\s*=\s*`(.*?)`", text, re.S)
    if not match:
        raise ValueError("Unable to locate PROMPT_REGISTRY_JSON in registry file")
    return json.loads(match.group(1))


def format_example(example: dict, training_template: dict) -> str:
    required_keys = {"system_prompt", "user_prompt_template", "assistant_template"}
    missing = required_keys - training_template.keys()
    if missing:
        raise ValueError(f"Training template missing required keys: {missing}")
    if not isinstance(training_template.get("user_prompt_template"), str):
        raise ValueError("Training template 'user_prompt_template' must be a string")
    system_prompt = training_template["system_prompt"]
    user_prompt = training_template["user_prompt_template"].format(
        instruction=example.get("instruction", ""),
        context=example.get("context", ""),
        schema=example.get("tool_schema", ""),
    )
    tool_call = json.dumps(example.get("expected_tool_call", {}), ensure_ascii=False)
    assistant = training_template["assistant_template"].format(
        tool=tool_call,
        answer=example.get("expected_answer", ""),
    )
    return f"<s>[SYSTEM]{system_prompt}\n[USER]{user_prompt}\n[ASSISTANT]{assistant}</s>"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base_model", required=True)
    parser.add_argument("--train_file", required=True)
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--max_steps", type=int, default=50)
    parser.add_argument("--prompt_template", default=None)
    parser.add_argument(
        "--manifest-out",
        default=os.path.join("export", "manifest.json"),
        help="Path to write export manifest JSON.",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.train_file):
        raise FileNotFoundError(f"Dataset not found: {args.train_file}")

    default_template_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "src",
            "core",
            "prompt",
            "PromptRegistry.ts",
        )
    )
    template_path = args.prompt_template or default_template_path
    registry = load_prompt_registry(template_path)
    training_prompt = registry["prompts"].get("training_prompt_v1")
    if not training_prompt:
        raise ValueError("Prompt registry missing training_prompt_v1")
    training_template = training_prompt.get("template")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    dataset = load_dataset("json", data_files=args.train_file, split="train")

    def _validate(record: dict) -> dict:
        required_keys = {"instruction", "expected_tool_call", "expected_answer"}
        missing_keys = required_keys - record.keys()
        if missing_keys:
            raise ValueError(
                "Each JSONL record must include 'instruction', 'expected_tool_call', and 'expected_answer'. "
                f"Missing: {missing_keys}"
            )
        if not isinstance(record["instruction"], str):
            raise ValueError(
                "Value for 'instruction' must be a string, "
                f"got {type(record['instruction']).__name__}."
            )
        tool_value = record["expected_tool_call"]
        if not isinstance(tool_value, (str, dict)):
            raise ValueError(
                "Value for 'expected_tool_call' must be a string or object, "
                f"got {type(tool_value).__name__}."
            )
        if not isinstance(record["expected_answer"], str):
            raise ValueError(
                "Value for 'expected_answer' must be a string, "
                f"got {type(record['expected_answer']).__name__}."
            )
        return record

    dataset = dataset.map(_validate)
    dataset = dataset.map(
        lambda record: {"text": format_example(record, training_template)}
    )

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        torch_dtype="auto",
        device_map=None,
    )
    model = prepare_model_for_kbit_training(model)

    lora_config = LoraConfig(
        r=8,
        lora_alpha=16,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)

    def tokenize_batch(batch: dict) -> dict:
        return tokenizer(
            batch["text"],
            truncation=True,
            max_length=1024,
            padding="max_length",
        )

    tokenized_dataset = dataset.map(
        tokenize_batch,
        batched=True,
        remove_columns=dataset.column_names,
    )
    collator = DataCollatorForLanguageModeling(tokenizer, mlm=False)

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        warmup_steps=5,
        max_steps=args.max_steps,
        fp16=False,
        bf16=False,
        logging_steps=5,
        save_steps=args.max_steps,
        save_total_limit=1,
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset,
        data_collator=collator,
    )
    trainer.train()
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    manifest_script = os.path.join(
        os.path.dirname(__file__), "mlops", "write_export_manifest.py"
    )
    subprocess.run(
        [
            sys.executable,
            manifest_script,
            "--datasets",
            os.path.abspath(args.train_file),
            "--model-path",
            os.path.abspath(args.output_dir),
            "--output",
            os.path.abspath(args.manifest_out),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
