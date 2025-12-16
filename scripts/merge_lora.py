import argparse

from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base_model", required=True)
    parser.add_argument("--lora_dir", required=True)
    parser.add_argument("--output_dir", required=True)
    args = parser.parse_args()

    base_model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        torch_dtype="auto",
    )
    merged_model = PeftModel.from_pretrained(base_model, args.lora_dir)
    merged_model = merged_model.merge_and_unload()

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)

    merged_model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)


if __name__ == "__main__":
    main()



