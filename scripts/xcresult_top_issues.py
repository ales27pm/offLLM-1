#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Print a concise list of the "top issues" from an .xcresult JSON dump.
This script is intentionally defensive: xcresult JSON can vary between
Xcode versions and flags (legacy vs non-legacy). We:
  * Accept strings OR dict nodes
  * Walk the entire structure recursively
  * Normalize different "message" shapes
  * De-dup messages while preserving order
"""
import json
import sys
from typing import Any, Iterable, List, Set, Tuple


def _as_str(x: Any) -> str:
    """Best-effort string extraction for common xcresult message shapes."""
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    if isinstance(x, dict):
        # Common shapes observed in xcresult JSON:
        #  - {"_type": "String", "_value": "text"} (non-legacy)
        #  - {"string": "text"} or {"text": "text"} (various tools)
        #  - {"message": "text"} (already normalized)
        for key in ("_value", "string", "text", "message", "description", "summary"):
            if key in x and isinstance(x[key], str):
                return x[key]
        # Sometimes message is nested again:
        for key in ("message", "summary"):
            if key in x and isinstance(x[key], dict):
                inner = _as_str(x[key])
                if inner:
                    return inner
    # Fallback: JSON-stringify primitives/containers (as a last resort)
    try:
        return json.dumps(x, ensure_ascii=False)
    except Exception:
        return str(x)


def _collect_messages(node: Any, out: List[Tuple[str, str]]) -> None:
    """
    Recursively collect (severity, message) pairs.
    We try to infer severity from common keys if present; otherwise "info".
    """
    if node is None:
        return

    # Leaf node that is itself a message string
    if isinstance(node, str):
        text = node.strip()
        if text:
            out.append(("info", text))
        return

    if isinstance(node, list):
        for item in node:
            _collect_messages(item, out)
        return

    if isinstance(node, dict):
        # Heuristics for common xcresult layouts:
        # 1) Direct message on this node
        possible_message_keys = (
            "message",
            "resultMessage",
            "issueMessage",
            "compilerMessage",
            "summary",
            "description",
        )
        message_val = None
        for k in possible_message_keys:
            if k in node:
                message_val = node[k]
                break

        # Severity/Type hints
        severity_keys = ("severity", "issueType", "type", "category")
        severity_val = None
        for k in severity_keys:
            if k in node and isinstance(node[k], str):
                severity_val = node[k]
                break
        if not severity_val:
            # Some nodes encode as {"severity": {"string": "error"}}
            for k in severity_keys:
                if k in node and isinstance(node[k], dict):
                    s = _as_str(node[k]).strip()
                    if s:
                        severity_val = s
                        break

        if message_val is not None:
            msg = _as_str(message_val).strip()
            if msg:
                out.append((severity_val or "info", msg))

        # 2) Known containers of issues/messages
        container_keys = (
            "issues",
            "warnings",
            "errors",
            "errorSummaries",
            "warningSummaries",
            "notes",
            "messages",
            "diagnostics",
            "children",
            "subIssues",
            "result",
        )
        for k in container_keys:
            if k in node:
                _collect_messages(node[k], out)

        # 3) Fallback: walk every child
        for v in node.values():
            _collect_messages(v, out)
        return


def _dedupe_preserve_order(pairs: Iterable[Tuple[str, str]]) -> List[Tuple[str, str]]:
    seen: Set[str] = set()
    out: List[Tuple[str, str]] = []
    for sev, msg in pairs:
        key = f"{sev}::{msg}"
        if key not in seen:
            seen.add(key)
            out.append((sev, msg))
    return out


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        # If input isn't JSON for any reason, don't fail the step
        return

    pairs: List[Tuple[str, str]] = []
    _collect_messages(data, pairs)
    pairs = _dedupe_preserve_order(pairs)

    for sev, msg in pairs[:200]:
        # Prefix severity if it looks meaningful (error/warning/note/info)
        s = sev.lower()
        if s in ("error", "warning", "note", "info", "fatal"):
            print(f"- [{s}] {msg}")
        else:
            print(f"- {msg}")


if __name__ == "__main__":
    main()




