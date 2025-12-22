#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True), encoding="utf-8")


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _env_truthy(name: str) -> bool:
    v = os.environ.get(name, "")
    return v.strip().lower() in {"1", "true", "yes", "y", "on"}


def _detect_accelerator() -> Tuple[bool, str]:
    """
    Returns: (has_accelerator, accelerator_kind)
      - kind is one of: cuda, mps, xpu, cpu
    We keep this conservative and robust for CI.
    """
    try:
        import torch  # type: ignore
    except Exception:
        return (False, "cpu")

    # CUDA
    try:
        if hasattr(torch, "cuda") and torch.cuda.is_available():
            return (True, "cuda")
    except Exception:
        pass

    # Apple MPS (macOS)
    try:
        if hasattr(torch, "backends") and hasattr(torch.backends, "mps"):
            if torch.backends.mps.is_available() and torch.backends.mps.is_built():
                return (True, "mps")
    except Exception:
        pass

    # Intel XPU (rare; keep best-effort)
    try:
        xpu = getattr(torch, "xpu", None)
        if xpu is not None and hasattr(xpu, "is_available") and xpu.is_available():
            return (True, "xpu")
    except Exception:
        pass

    return (False, "cpu")


@dataclass(frozen=True)
class StepResult:
    name: str
    status: str  # ok | skipped | failed
    message: str
    details: Dict[str, Any]


def _ok(name: str, msg: str, **details: Any) -> StepResult:
    return StepResult(name=name, status="ok", message=msg, details=dict(details))


def _skipped(name: str, msg: str, **details: Any) -> StepResult:
    return StepResult(name=name, status="skipped", message=msg, details=dict(details))


def _failed(name: str, msg: str, **details: Any) -> StepResult:
    return StepResult(name=name, status="failed", message=msg, details=dict(details))


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="offLLM end-to-end pipeline orchestrator (CI-safe).")

    p.add_argument("--stage", default="full_scan", choices=[
        "full_scan",
        "harvest",
        "retrieval",
        "finetune",
        "export",
    ])

    p.add_argument("--base-model", required=True)
    p.add_argument("--harvest-manifest", required=True)

    # harvest controls
    p.add_argument("--internet-max-records", type=int, default=0)
    p.add_argument("--internet-min-chars", type=int, default=0)

    # retrieval controls
    p.add_argument("--retrieval-max-negatives", type=int, default=0)

    # unsloth controls
    p.add_argument("--unsloth-max-steps", type=int, default=0)
    p.add_argument("--unsloth-lr", type=float, default=0.0)

    # export controls
    p.add_argument("--mlx-model-path", default="")
    p.add_argument("--mlx-export-dir", default="")
    p.add_argument("--mlx-quantize-bits", type=int, default=0)
    p.add_argument("--coreml-export-dir", default="")

    # misc paths
    p.add_argument("--telemetry-path", default="")
    p.add_argument("--tool-schema-path", default="")

    # behavior flags
    p.add_argument(
        "--require-accelerator",
        action="store_true",
        help="Fail (exit 1) if finetune requires accelerator and none is present. "
             "Default behavior is to skip finetune on CPU-only runners."
    )
    p.add_argument(
        "--report-out",
        default="runs/pipeline_report.json",
        help="Write a machine-readable report for CI."
    )

    return p.parse_args(argv)


def _stage_plan(stage: str) -> List[str]:
    """
    Defines what 'full_scan' means in a stable, explicit way.
    """
    if stage == "full_scan":
        return ["harvest", "retrieval", "finetune", "export"]
    if stage == "harvest":
        return ["harvest"]
    if stage == "retrieval":
        return ["retrieval"]
    if stage == "finetune":
        return ["finetune"]
    if stage == "export":
        return ["export"]
    return ["harvest", "retrieval", "finetune", "export"]


def _run_harvest(args: argparse.Namespace) -> StepResult:
    manifest = Path(args.harvest_manifest)
    if not manifest.exists():
        return _failed("harvest", f"harvest manifest not found: {manifest}", manifest=str(manifest))

    # Minimal “real” validation: must be valid JSON and non-empty
    try:
        m = _read_json(manifest)
    except Exception as e:
        return _failed("harvest", f"failed to parse harvest manifest JSON: {e}", manifest=str(manifest))

    if not isinstance(m, dict):
        return _failed("harvest", "harvest manifest must be a JSON object", manifest=str(manifest), type=str(type(m)))

    sources = m.get("sources")
    if not isinstance(sources, list) or len(sources) == 0:
        return _failed("harvest", "harvest manifest must include non-empty 'sources' array", manifest=str(manifest))

    return _ok(
        "harvest",
        "harvest stage validated inputs (execution occurs in dedicated jobs/scripts)",
        sources=len(sources),
        internet_max_records=args.internet_max_records,
        internet_min_chars=args.internet_min_chars,
    )


def _run_retrieval(args: argparse.Namespace) -> StepResult:
    # This repo’s retrieval pipeline likely exists elsewhere; this orchestrator stays CI-safe.
    # We still validate inputs deterministically.
    if args.retrieval_max_negatives < 0:
        return _failed("retrieval", "--retrieval-max-negatives must be >= 0", value=args.retrieval_max_negatives)
    return _ok("retrieval", "retrieval stage validated inputs (execution occurs in dedicated jobs/scripts)",
              retrieval_max_negatives=args.retrieval_max_negatives)


def _run_finetune_unsloth(args: argparse.Namespace, accel_kind: str) -> StepResult:
    """
    Finetune stage: attempt Unsloth only if accelerator exists.
    Lazy-import so CPU runners never crash at import time.
    """
    # sanity checks
    if args.unsloth_max_steps <= 0:
        return _skipped("finetune", "unsloth finetune skipped: --unsloth-max-steps <= 0",
                        unsloth_max_steps=args.unsloth_max_steps)
    if args.unsloth_lr <= 0:
        return _failed("finetune", "--unsloth-lr must be > 0 when finetuning", unsloth_lr=args.unsloth_lr)

    try:
        import unsloth  # type: ignore  # noqa: F401
    except Exception as e:
        return _failed(
            "finetune",
            f"Unsloth import failed even though accelerator={accel_kind}: {e}",
            accelerator=accel_kind,
        )

    # At this point you can wire your real finetune function.
    # We keep the orchestrator stable: report intent and required config.
    return _ok(
        "finetune",
        "unsloth available; finetune stage ready (wire into your training entrypoint here)",
        accelerator=accel_kind,
        base_model=args.base_model,
        unsloth_max_steps=args.unsloth_max_steps,
        unsloth_lr=args.unsloth_lr,
    )


def _run_export(args: argparse.Namespace) -> StepResult:
    # Exports are platform-specific; validate requested outputs.
    # MLX export is macOS-only in practice; CoreML export also macOS-friendly.
    mlx_dir = args.mlx_export_dir.strip()
    coreml_dir = args.coreml_export_dir.strip()

    if mlx_dir:
        if args.mlx_quantize_bits not in (0, 2, 3, 4, 5, 6, 8, 16):
            return _failed("export", "invalid --mlx-quantize-bits", bits=args.mlx_quantize_bits)
    # Just confirm requested destinations
    return _ok(
        "export",
        "export stage validated destinations (execution occurs in dedicated jobs/scripts)",
        mlx_export_dir=mlx_dir or None,
        mlx_quantize_bits=args.mlx_quantize_bits or None,
        coreml_export_dir=coreml_dir or None,
    )


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    plan = _stage_plan(args.stage)

    has_accel, accel_kind = _detect_accelerator()

    results: List[StepResult] = []
    fatal = False

    # Run steps in order
    for step in plan:
        if step == "harvest":
            results.append(_run_harvest(args))
        elif step == "retrieval":
            results.append(_run_retrieval(args))
        elif step == "finetune":
            if not has_accel:
                msg = (
                    "finetune skipped: no torch accelerator detected (CPU-only runner). "
                    "Use a GPU runner (CUDA/MPS/XPU) or pass --require-accelerator to fail hard."
                )
                r = _skipped("finetune", msg, accelerator=accel_kind)
                results.append(r)
                if args.require_accelerator:
                    fatal = True
            else:
                r = _run_finetune_unsloth(args, accel_kind)
                results.append(r)
        elif step == "export":
            results.append(_run_export(args))
        else:
            results.append(_skipped(step, "unknown step (ignored)"))

        # Any explicit failures mark fatal
        if results[-1].status == "failed":
            fatal = True

    report_path = Path(args.report_out)
    report_obj: Dict[str, Any] = {
        "tool": "offLLM end-to-end pipeline",
        "ts": _utc_now_iso(),
        "stage": args.stage,
        "plan": plan,
        "accelerator": {"has": has_accel, "kind": accel_kind},
        "base_model": args.base_model,
        "harvest_manifest": args.harvest_manifest,
        "results": [
            {
                "name": r.name,
                "status": r.status,
                "message": r.message,
                "details": r.details,
            }
            for r in results
        ],
        "ok": [r.name for r in results if r.status == "ok"],
        "skipped": [r.name for r in results if r.status == "skipped"],
        "failed": [r.name for r in results if r.status == "failed"],
    }
    _write_json(report_path, report_obj)

    # Exit code policy:
    # - fatal if any step failed
    # - fatal if require_accelerator and finetune was skipped for lack of accel
    return 1 if fatal else 0


if __name__ == "__main__":
    raise SystemExit(main())
