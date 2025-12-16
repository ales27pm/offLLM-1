#!/usr/bin/env python3
"""Summarize iOS build diagnostics for GitHub step summaries."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any, Iterable, List, Tuple
from urllib.parse import unquote, urlparse


def _stringify(value: Any) -> str:
    """Convert xcresult string containers into plain text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        for key in ("_value", "value", "string", "text", "title", "message"):
            if key in value:
                return _stringify(value[key])
        return " ".join(
            f"{key}={_stringify(val)}"
            for key, val in value.items()
            if not key.startswith("_")
        ).strip()
    if isinstance(value, (list, tuple, set)):
        return ", ".join(_stringify(item) for item in value if item is not None)
    return str(value)


def _clean_location(value: str) -> str:
    if value.startswith("file://"):
        parsed = urlparse(value)
        path = parsed.path or value
        return unquote(path)
    return value


def _extract_location(node: Any) -> str:
    if isinstance(node, dict):
        for key in ("documentLocationInCreatingWorkspace", "locationData"):
            if key in node:
                candidate = _extract_location(node[key])
                if candidate:
                    return candidate
        for key in ("path", "filePath", "relativePath", "documentURLString", "url"):
            value = node.get(key)
            if isinstance(value, str) and value:
                cleaned = _clean_location(value)
                line = node.get("lineNumber") or node.get("startingLineNumber")
                if isinstance(line, (int, float)):
                    return f"{cleaned}:{int(line)}"
                try:
                    if isinstance(line, str) and line.strip():
                        return f"{cleaned}:{int(float(line))}"
                except (ValueError, TypeError):
                    pass
                return cleaned
    elif isinstance(node, (list, tuple)):
        for item in node:
            candidate = _extract_location(item)
            if candidate:
                return candidate
    return ""


def _walk_issues(node: Any, source: str, seen: set[Tuple[str, str, str, str, str]], results: List[dict[str, str]]) -> None:
    if isinstance(node, dict):
        node_type = node.get("_type")
        type_name = ""
        if isinstance(node_type, dict):
            type_name = node_type.get("_name", "")
        if type_name == "IssueSummary":
            issue_type = _stringify(node.get("issueType")) or "Unknown"
            message = _stringify(node.get("message"))
            if not message:
                message = _stringify(node.get("subtitle")) or _stringify(node.get("title"))
            location = _extract_location(node)
            produced = _stringify(node.get("targetName")) or _stringify(node.get("producedByTarget"))
            key = (source, issue_type, message, location, produced)
            if key not in seen:
                seen.add(key)
                results.append(
                    {
                        "source": source,
                        "type": issue_type,
                        "message": message or "(no message provided)",
                        "location": location,
                        "produced": produced,
                    }
                )
            return
        for value in node.values():
            _walk_issues(value, source, seen, results)
    elif isinstance(node, (list, tuple)):
        for item in node:
            _walk_issues(item, source, seen, results)


def _collect_issues(paths: Iterable[Path]) -> Tuple[List[dict[str, str]], List[str]]:
    issues: List[dict[str, str]] = []
    parse_failures: List[str] = []
    seen: set[Tuple[str, str, str, str, str]] = set()
    for path in paths:
        if not path.exists() or path.stat().st_size == 0:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except json.JSONDecodeError as exc:
            parse_failures.append(f"{path}: {exc}")
            continue
        _walk_issues(payload, str(path), seen, issues)
    return issues, parse_failures


def _load_lines(path: Path, limit: int | None) -> List[str]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    if limit is not None and len(lines) > limit:
        remaining = len(lines) - limit
        truncated = lines[:limit]
        truncated.append(f"… (+{remaining} more lines in {path.name})")
        return truncated
    return lines


def _append_section(buffer: List[str], title: str, lines: Iterable[str], *, code_block: bool = False) -> None:
    content = list(lines)
    if not content:
        return
    buffer.append(f"### {title}")
    if code_block:
        buffer.append("```")
        buffer.extend(content)
        buffer.append("```")
    else:
        buffer.extend(content)
    buffer.append("")


def _format_issue(issue: dict[str, str]) -> str:
    parts = [issue.get("message", "").strip() or "(no message provided)"]
    location = issue.get("location")
    if location:
        parts.append(f"[{location}]")
    produced = issue.get("produced")
    if produced:
        parts.append(f"(target: {produced})")
    parts.append(f"source: {issue.get('source')}")
    return f"- **{issue.get('type', 'Unknown')}** " + " ".join(parts)


def _group_issues(issues: List[dict[str, str]]) -> Tuple[List[str], List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []
    others: List[str] = []
    for issue in issues:
        issue_type = (issue.get("type") or "").lower()
        formatted = _format_issue(issue)
        if "error" in issue_type and "warning" not in issue_type:
            errors.append(formatted)
        elif "warning" in issue_type:
            warnings.append(formatted)
        else:
            others.append(formatted)
    return errors, warnings, others


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", default="iOS build")
    parser.add_argument("--env-log", default="build/diagnostics/environment.log")
    parser.add_argument("--error-log", default="build/diagnostics/xcodebuild-errors.log")
    parser.add_argument("--derived-log", default="build/diagnostics/derived-data.txt")
    parser.add_argument("--unified-log", default="build/diagnostics/unified-xcodebuild.log")
    parser.add_argument("--artifact-path", default="build/diagnostics")
    parser.add_argument("--result-json", action="append", default=[])
    parser.add_argument("--env-limit", type=int, default=40)
    parser.add_argument("--error-limit", type=int, default=80)
    parser.add_argument("--derived-limit", type=int, default=60)
    parser.add_argument("--unified-limit", type=int, default=60)
    parser.add_argument("--issue-limit", type=int, default=20)
    args = parser.parse_args()

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    buffer: List[str] = []
    buffer.append(f"## {args.label} diagnostics")
    buffer.append("")

    env_lines = _load_lines(Path(args.env_log), args.env_limit)
    _append_section(buffer, "Toolchain snapshot", env_lines, code_block=True)

    error_lines = _load_lines(Path(args.error_log), args.error_limit)
    _append_section(buffer, "xcodebuild log highlights", error_lines, code_block=True)

    derived_lines = _load_lines(Path(args.derived_log), args.derived_limit)
    _append_section(buffer, "DerivedData overview", derived_lines, code_block=True)

    unified_lines = _load_lines(Path(args.unified_log), args.unified_limit)
    _append_section(buffer, "macOS unified log (xcodebuild)", unified_lines, code_block=True)

    issue_paths = [Path(path) for path in args.result_json]
    issues, parse_failures = _collect_issues(issue_paths)
    if issues:
        errors, warnings, others = _group_issues(issues)
        limit = args.issue_limit
        if errors:
            _append_section(buffer, "xcresult errors", errors[:limit])
            if len(errors) > limit:
                buffer.append(f"… {len(errors) - limit} additional errors (see artifacts)")
                buffer.append("")
        if warnings:
            _append_section(buffer, "xcresult warnings", warnings[:limit])
            if len(warnings) > limit:
                buffer.append(f"… {len(warnings) - limit} additional warnings (see artifacts)")
                buffer.append("")
        if others:
            _append_section(buffer, "xcresult notices", others[:limit])
            if len(others) > limit:
                buffer.append(f"… {len(others) - limit} additional notices (see artifacts)")
                buffer.append("")
    if parse_failures:
        notes = [f"- {failure}" for failure in parse_failures]
        _append_section(buffer, "xcresult parse issues", notes)

    artifact_path = args.artifact_path
    if artifact_path:
        buffer.append(f"Artifacts: `{artifact_path}`")
        buffer.append("")

    output = "\n".join(buffer).rstrip() + "\n"

    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as handle:
            handle.write(output)
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())



