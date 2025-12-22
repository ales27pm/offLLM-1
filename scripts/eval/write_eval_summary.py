import argparse
import json
import sys
from pathlib import Path
from typing import Any


HIGHER_IS_BETTER = {"mrr", "ndcg", "valid_rate", "passed"}
LOWER_IS_BETTER = {"p95_latency_ms", "peak_memory_mb"}


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Input not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def require_fields(payload: dict[str, Any], fields: set[str], label: str) -> None:
    missing = [field for field in fields if field not in payload]
    if missing:
        raise ValueError(f"{label} missing required fields: {missing}")


def compare_metric(
    name: str, current: float | int | bool, baseline: float | int | bool
) -> dict[str, Any]:
    if name in HIGHER_IS_BETTER:
        regressed = current < baseline
    elif name in LOWER_IS_BETTER:
        regressed = current > baseline
    else:
        regressed = current != baseline
    return {
        "metric": name,
        "current": current,
        "baseline": baseline,
        "regressed": regressed,
    }


def build_summary(
    prompt_regression: dict[str, Any],
    tool_json: dict[str, Any],
    retrieval: dict[str, Any],
    latency: dict[str, Any],
    memory: dict[str, Any],
    baseline: dict[str, Any] | None,
) -> dict[str, Any]:
    require_fields(prompt_regression, {"passed", "failures"}, "prompt_regression")
    require_fields(tool_json, {"valid_rate"}, "tool_json")
    require_fields(retrieval, {"mrr", "ndcg"}, "retrieval")
    require_fields(latency, {"p95_latency_ms"}, "latency")
    require_fields(memory, {"peak_memory_mb"}, "memory")

    summary = {
        "prompt_regression": prompt_regression,
        "tool_json_validity": tool_json,
        "retrieval": retrieval,
        "latency": latency,
        "memory": memory,
        "regressions": [],
    }

    if baseline is None:
        summary["status"] = "no_baseline"
        return summary

    regressions = []
    for key, metrics in [
        ("prompt_regression", prompt_regression),
        ("tool_json_validity", tool_json),
        ("retrieval", retrieval),
        ("latency", latency),
        ("memory", memory),
    ]:
        baseline_metrics = baseline.get(key)
        if baseline_metrics is None:
            raise ValueError(f"Baseline missing {key}")
        for metric_name, current_value in metrics.items():
            if metric_name not in baseline_metrics:
                raise ValueError(f"Baseline missing metric {key}.{metric_name}")
            comparison = compare_metric(
                metric_name, current_value, baseline_metrics[metric_name]
            )
            if comparison["regressed"]:
                regressions.append(comparison)

    summary["regressions"] = regressions
    summary["status"] = "pass" if not regressions else "fail"
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Write eval summary and enforce regression gating."
    )
    parser.add_argument("--prompt-regression", required=True)
    parser.add_argument("--tool-json", required=True)
    parser.add_argument("--retrieval", required=True)
    parser.add_argument("--latency", required=True)
    parser.add_argument("--memory", required=True)
    parser.add_argument("--baseline", default=None)
    parser.add_argument("--output", default="reports/eval_summary.json")
    args = parser.parse_args()

    prompt_regression = load_json(Path(args.prompt_regression))
    tool_json = load_json(Path(args.tool_json))
    retrieval = load_json(Path(args.retrieval))
    latency = load_json(Path(args.latency))
    memory = load_json(Path(args.memory))
    baseline = load_json(Path(args.baseline)) if args.baseline else None

    summary = build_summary(
        prompt_regression,
        tool_json,
        retrieval,
        latency,
        memory,
        baseline,
    )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, sort_keys=True)
        handle.write("\n")

    if summary["status"] == "fail":
        raise SystemExit("Eval metrics regressed")
    print(f"Wrote eval summary to {output_path}")


if __name__ == "__main__":
    main()
