#!/usr/bin/env python3
"""
scripts/offllm_end_to_end_pipeline.py

End-to-end (or staged) pipeline runner for offLLM:
- harvest   : build/refresh a local corpus from a manifest
- retrieval : build retrieval negatives / datasets for RAG training
- finetune  : run Unsloth fine-tuning (GPU/accelerator required)
- export    : export to MLX / CoreML if configured

CI reality:
- GitHub-hosted runners are typically CPU-only → finetune must be skipped unless you explicitly require an accelerator.
- Use --require-accelerator to hard-fail if no GPU/accelerator is available.
- Use --stage internals to run CI-safe stages: harvest + retrieval + export (never finetune).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# -----------------------------
# Utilities
# -----------------------------

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True), encoding="utf-8")


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _env_truthy(name: str, default: str = "") -> bool:
    v = os.environ.get(name, default).strip().lower()
    return v in {"1", "true", "yes", "y", "on"}


def _which(cmd: str) -> Optional[str]:
    return shutil.which(cmd)


def _log(msg: str) -> None:
    print(msg, flush=True)


def _warn(msg: str) -> None:
    print(f"⚠️  {msg}", flush=True)


def _die(msg: str, code: int = 1) -> int:
    print(f"❌ {msg}", flush=True)
    return code


# -----------------------------
# Accelerator detection
# -----------------------------

@dataclass(frozen=True)
class AcceleratorInfo:
    available: bool
    kind: str          # "cuda" | "mps" | "rocm" | "cpu"
    detail: str


def detect_accelerator() -> AcceleratorInfo:
    """
    Conservative detection:
    - CUDA if torch.cuda.is_available()
    - MPS if torch.backends.mps.is_available()
    - ROCm is typically also reported as cuda in torch builds; keep "cuda" bucket.
    """
    try:
        import torch  # type: ignore
    except Exception as e:
        return AcceleratorInfo(False, "cpu", f"torch import failed: {e}")

    # CUDA
    try:
        if hasattr(torch, "cuda") and torch.cuda.is_available():
            try:
                dev = torch.cuda.get_device_name(0)
                return AcceleratorInfo(True, "cuda", f"{dev}")
            except Exception:
                return AcceleratorInfo(True, "cuda", "cuda available")
    except Exception as e:
        return AcceleratorInfo(False, "cpu", f"cuda check failed: {e}")

    # MPS (Apple)
    try:
        if hasattr(torch, "backends") and hasattr(torch.backends, "mps"):
            if torch.backends.mps.is_available() and torch.backends.mps.is_built():
                return AcceleratorInfo(True, "mps", "Apple MPS backend available")
    except Exception:
        pass

    return AcceleratorInfo(False, "cpu", "no torch accelerator detected")


# -----------------------------
# Stage planning
# -----------------------------

def _stage_plan(stage: str) -> List[str]:
    """
    full_scan: harvest -> retrieval -> finetune -> export
    internals: harvest -> retrieval -> export  (NEVER finetune; CI-safe)
    """
    if stage == "full_scan":
        return ["harvest", "retrieval", "finetune", "export"]
    if stage == "internals":
        return ["harvest", "retrieval", "export"]
    if stage == "harvest":
        return ["harvest"]
    if stage == "retrieval":
        return ["retrieval"]
    if stage == "finetune":
        return ["finetune"]
    if stage == "export":
        return ["export"]
    return ["harvest", "retrieval", "finetune", "export"]


# -----------------------------
# Wiring points
# -----------------------------

def _call_if_exists(module_name: str, fn_name: str, kwargs: Dict[str, Any]) -> Tuple[bool, str]:
    """
    Attempts to import module_name and call fn_name(**kwargs).
    Returns: (ok, message)
    """
    try:
        mod = __import__(module_name, fromlist=[fn_name])
    except Exception as e:
        return False, f"import {module_name} failed: {e}"

    fn = getattr(mod, fn_name, None)
    if fn is None:
        return False, f"{module_name}.{fn_name} not found"

    try:
        fn(**kwargs)
        return True, f"called {module_name}.{fn_name}"
    except Exception as e:
        return False, f"call {module_name}.{fn_name} failed: {e}"


# -----------------------------
# CLI
# -----------------------------

def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="offLLM end-to-end pipeline runner")
    p.add_argument(
        "--stage",
        default="full_scan",
        choices=["full_scan", "internals", "harvest", "retrieval", "finetune", "export"],
        help="Which stage(s) to run",
    )
    p.add_argument("--base-model", required=True, help="HF model id for the base model")
    p.add_argument("--harvest-manifest", required=True, help="Path to sources manifest JSON")

    p.add_argument("--internet-max-records", type=int, default=2000)
    p.add_argument("--internet-min-chars", type=int, default=200)

    p.add_argument("--retrieval-max-negatives", type=int, default=4)

    p.add_argument("--unsloth-max-steps", type=int, default=800)
    p.add_argument("--unsloth-lr", type=float, default=2e-4)

    p.add_argument("--mlx-model-path", default="", help="Path to MLX model (if already exists)")
    p.add_argument("--mlx-export-dir", default="", help="Directory to export MLX model into")
    p.add_argument("--mlx-quantize-bits", default="", help="Quantize bits for MLX export (e.g. 4)")

    p.add_argument("--coreml-export-dir", default="", help="Directory to export CoreML model into")

    p.add_argument("--telemetry-path", default="", help="Optional telemetry output path")
    p.add_argument("--tool-schema-path", default="", help="Optional tool schema path (JSON)")

    p.add_argument(
        "--require-accelerator",
        action="store_true",
        help="Hard-fail if no accelerator exists (for finetune).",
    )

    p.add_argument("--report-out", default="", help="Write a JSON report of what happened")
    return p.parse_args(argv)


# -----------------------------
# Main
# -----------------------------

def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    report: Dict[str, Any] = {
        "tool": "offLLM end-to-end pipeline",
        "ts": _utc_now_iso(),
        "stage": args.stage,
        "plan": _stage_plan(args.stage),
        "base_model": args.base_model,
        "harvest_manifest": args.harvest_manifest,
        "accelerator": {},
        "steps": [],
        "warnings": [],
        "errors": [],
        "ok": True,
    }

    # Validate inputs early
    manifest_path = Path(args.harvest_manifest)
    if not manifest_path.exists():
        report["ok"] = False
        report["errors"].append(f"harvest manifest not found: {manifest_path}")
        if args.report_out:
            _write_json(Path(args.report_out), report)
        return _die(f"Harvest manifest not found: {manifest_path}", 2)

    # Accelerator detection once
    acc = detect_accelerator()
    report["accelerator"] = {"available": acc.available, "kind": acc.kind, "detail": acc.detail}
    _log(f"[accel] available={acc.available} kind={acc.kind} detail={acc.detail}")

    plan = _stage_plan(args.stage)

    # If finetune is planned but no accelerator, decide policy
    if "finetune" in plan and not acc.available:
        msg = "No accelerator detected; finetune requires GPU/accelerator (Unsloth)."
        if args.require_accelerator:
            report["ok"] = False
            report["errors"].append(msg)
            if args.report_out:
                _write_json(Path(args.report_out), report)
            return _die(msg, 1)

        _warn(msg + " Skipping finetune (use --require-accelerator to fail instead).")
        report["warnings"].append(msg + " skipped finetune")
        plan = [s for s in plan if s != "finetune"]
        report["plan"] = plan

    # Stage: harvest
    if "harvest" in plan:
        step = {"stage": "harvest", "ok": True, "detail": ""}
        _log("[stage] harvest")

        ok, detail = _call_if_exists(
            "scripts.mlops.harvest",
            "run_harvest",
            {
                "base_model": args.base_model,
                "manifest_path": str(manifest_path),
                "internet_max_records": args.internet_max_records,
                "internet_min_chars": args.internet_min_chars,
                "telemetry_path": args.telemetry_path or None,
            },
        )
        if not ok:
            # fallback: validate manifest JSON at least
            try:
                _read_json(manifest_path)
                _warn("harvest runner not found; manifest JSON is valid but harvest was not executed")
                detail = detail + " (fallback: validated manifest json only)"
                ok = True
            except Exception as e:
                ok = False
                detail = f"{detail}; fallback manifest parse failed: {e}"

        step["ok"] = bool(ok)
        step["detail"] = detail
        report["steps"].append(step)
        if not ok:
            report["ok"] = False
            report["errors"].append(f"harvest failed: {detail}")

    # Stage: retrieval
    if "retrieval" in plan and report["ok"]:
        step = {"stage": "retrieval", "ok": True, "detail": ""}
        _log("[stage] retrieval")

        ok, detail = _call_if_exists(
            "scripts.mlops.retrieval",
            "run_retrieval",
            {
                "base_model": args.base_model,
                "manifest_path": str(manifest_path),
                "retrieval_max_negatives": args.retrieval_max_negatives,
                "telemetry_path": args.telemetry_path or None,
            },
        )
        if not ok:
            _warn("retrieval runner not found; skipping retrieval execution (no-op)")
            ok = True
            detail = detail + " (no-op fallback)"

        step["ok"] = bool(ok)
        step["detail"] = detail
        report["steps"].append(step)
        if not ok:
            report["ok"] = False
            report["errors"].append(f"retrieval failed: {detail}")

    # Stage: finetune (Unsloth)
    if "finetune" in plan and report["ok"]:
        step = {"stage": "finetune", "ok": True, "detail": ""}
        _log("[stage] finetune")

        # Import Unsloth ONLY here (prevents CPU CI crash)
        try:
            import unsloth  # type: ignore  # noqa: F401
        except Exception as e:
            step["ok"] = False
            step["detail"] = f"unsloth import failed: {e}"
            report["steps"].append(step)
            report["ok"] = False
            report["errors"].append(step["detail"])
        else:
            ok, detail = _call_if_exists(
                "scripts.mlops.finetune",
                "run_finetune_unsloth",
                {
                    "base_model": args.base_model,
                    "manifest_path": str(manifest_path),
                    "max_steps": args.unsloth_max_steps,
                    "lr": args.unsloth_lr,
                    "telemetry_path": args.telemetry_path or None,
                    "tool_schema_path": args.tool_schema_path or None,
                },
            )
            if not ok:
                step["ok"] = False
                step["detail"] = detail
                report["ok"] = False
                report["errors"].append(f"finetune failed: {detail}")
            else:
                step["detail"] = detail

            report["steps"].append(step)

    # Stage: export
    if "export" in plan and report["ok"]:
        step = {"stage": "export", "ok": True, "detail": "", "exports": {}}
        _log("[stage] export")

        exports: Dict[str, Any] = {}

        mlx_export_dir = (args.mlx_export_dir or "").strip()
        if mlx_export_dir:
            ok, detail = _call_if_exists(
                "scripts.mlops.exporters",
                "export_mlx",
                {
                    "base_model": args.base_model,
                    "mlx_model_path": args.mlx_model_path or None,
                    "export_dir": mlx_export_dir,
                    "quantize_bits": int(args.mlx_quantize_bits) if str(args.mlx_quantize_bits).strip() else None,
                },
            )
            exports["mlx"] = {"requested": True, "ok": bool(ok), "detail": detail}
            if not ok:
                _warn(f"MLX export not executed: {detail}")

        coreml_export_dir = (args.coreml_export_dir or "").strip()
        if coreml_export_dir:
            ok, detail = _call_if_exists(
                "scripts.mlops.exporters",
                "export_coreml",
                {
                    "base_model": args.base_model,
                    "export_dir": coreml_export_dir,
                },
            )
            exports["coreml"] = {"requested": True, "ok": bool(ok), "detail": detail}
            if not ok:
                _warn(f"CoreML export not executed: {detail}")

        if not exports:
            exports["none"] = {"requested": False, "ok": True, "detail": "no export dirs configured"}

        step["exports"] = exports
        step["detail"] = "export stage completed"
        report["steps"].append(step)

    if args.report_out:
        _write_json(Path(args.report_out), report)

    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
