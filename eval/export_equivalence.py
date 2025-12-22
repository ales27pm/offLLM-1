import argparse
import json
import re
import sys
from pathlib import Path


REFUSAL_PATTERN = re.compile(
    r"\b(can't|cannot|won't|unable to|not able to|refuse|decline)\b",
    re.IGNORECASE,
)


def load_outputs(path: Path) -> dict:
    outputs = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            entry = json.loads(line)
            entry_id = entry.get("id")
            if not entry_id:
                raise ValueError(f"Missing id in {path}")
            outputs[entry_id] = entry
    return outputs


def logits_max_diff(a: list, b: list) -> float:
    if len(a) != len(b):
        return float("inf")
    return max(abs(x - y) for x, y in zip(a, b)) if a else 0.0


def json_valid(text: str) -> bool:
    try:
        json.loads(text)
        return True
    except json.JSONDecodeError:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate CoreML/MLX export equivalence against Python outputs."
    )
    parser.add_argument("--python-output", required=True)
    parser.add_argument("--coreml-output", required=True)
    parser.add_argument("--logits-tolerance", type=float, default=1e-3)
    args = parser.parse_args()

    py_outputs = load_outputs(Path(args.python_output))
    core_outputs = load_outputs(Path(args.coreml_output))

    failures = []
    for entry_id, py_entry in py_outputs.items():
        core_entry = core_outputs.get(entry_id)
        if not core_entry:
            failures.append(f"Missing CoreML entry for {entry_id}")
            continue
        py_logits = py_entry.get("logits", [])
        core_logits = core_entry.get("logits", [])
        diff = logits_max_diff(py_logits, core_logits)
        if diff > args.logits_tolerance:
            failures.append(
                f"Logits mismatch for {entry_id}: max diff {diff}"
            )
        if py_entry.get("tokens") != core_entry.get("tokens"):
            failures.append(f"Token alignment mismatch for {entry_id}")
        py_response = py_entry.get("response", "")
        core_response = core_entry.get("response", "")
        if not isinstance(py_response, str):
            failures.append(f"Non-string response in Python entry {entry_id}")
            continue
        if not isinstance(core_response, str):
            failures.append(f"Non-string response in CoreML entry {entry_id}")
            continue
        if bool(REFUSAL_PATTERN.search(py_response)) != bool(
            REFUSAL_PATTERN.search(core_response)
        ):
            failures.append(f"Refusal behavior mismatch for {entry_id}")
        if json_valid(py_response) != json_valid(core_response):
            failures.append(f"JSON validity mismatch for {entry_id}")

    if failures:
        print(json.dumps({"failures": failures}, indent=2))
        sys.exit(1)

    print(json.dumps({"status": "ok", "entries": len(py_outputs)}, indent=2))


if __name__ == "__main__":
    main()
