import argparse
import json
import math
from pathlib import Path


def load_outputs(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Output file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def compare_logits(reference: list[float], candidate: list[float]) -> dict:
    if len(reference) != len(candidate):
        raise ValueError("Logit lengths do not match")
    deltas = [abs(r - c) for r, c in zip(reference, candidate)]
    return {
        "max_delta": max(deltas) if deltas else 0,
        "mean_delta": sum(deltas) / len(deltas) if deltas else 0,
        "rmse": math.sqrt(sum(d * d for d in deltas) / len(deltas))
        if deltas
        else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare reference and candidate export outputs."
    )
    parser.add_argument("--reference", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--max-delta", type=float, default=0.15)
    args = parser.parse_args()

    reference = load_outputs(Path(args.reference))
    candidate = load_outputs(Path(args.candidate))

    ref_logits = reference.get("logits")
    cand_logits = candidate.get("logits")
    if ref_logits is None or cand_logits is None:
        raise ValueError("Both files must contain a 'logits' array")

    metrics = compare_logits(ref_logits, cand_logits)
    print(json.dumps(metrics, indent=2))
    if metrics["max_delta"] > args.max_delta:
        raise SystemExit(
            f"Max delta {metrics['max_delta']:.4f} exceeds threshold {args.max_delta}"
        )


if __name__ == "__main__":
    main()
