#!/usr/bin/env python3
"""Fail if any Pods targets use a C++ standard other than c++20."""
from __future__ import annotations

from dataclasses import dataclass
import re
import sys
from pathlib import Path
from typing import Iterable

PODS_PROJECT = Path("ios/Pods/Pods.xcodeproj/project.pbxproj")
APP_PROJECT = Path("ios/monGARS.xcodeproj/project.pbxproj")

SECTION_TEMPLATE = r"/\* Begin {section} section \*/(?P<body>.*?)/\* End {section} section \*/"
BUILD_CONFIG_RE = re.compile(
    r"\s*(?P<id>[0-9A-Fa-f]+) /\* (?P<name>[^*]+) \*/ = \{\s*"
    r"isa = XCBuildConfiguration;\s*(?P<body>.*?)\};",
    re.DOTALL,
)
CONFIG_LIST_RE = re.compile(
    r"\s*(?P<id>[0-9A-Fa-f]+) /\* Build configuration list for (?P<kind>[^\"]+) \"(?P<name>[^\"]+)\" \*/ = \{\s*"
    r"isa = XCConfigurationList;\s*buildConfigurations = \((?P<configs>.*?)\);",
    re.DOTALL,
)
CONFIG_ID_RE = re.compile(r"([0-9A-Fa-f]+) /\*")
STD_SETTING_RE = re.compile(
    r"CLANG_CXX_LANGUAGE_STANDARD(?:\[[^\]]+\])?\s*=\s*(?P<value>[^;]+);"
)


@dataclass
class Configuration:
    identifier: str
    config_name: str
    target_label: str
    values: list[str]


def normalize_value(raw_value: str) -> str:
    value = raw_value.strip()
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    return value.strip()


def is_variable(value: str) -> bool:
    return value.startswith("$(") or value.startswith("${")


def extract_section(text: str, section: str) -> str:
    pattern = re.compile(SECTION_TEMPLATE.format(section=re.escape(section)), re.DOTALL)
    match = pattern.search(text)
    return match.group("body") if match else ""


def parse_configurations(text: str) -> dict[str, tuple[str, list[str]]]:
    section = extract_section(text, "XCBuildConfiguration")
    configurations: dict[str, tuple[str, list[str]]] = {}

    for match in BUILD_CONFIG_RE.finditer(section):
        config_id = match.group("id")
        config_name = match.group("name").strip()
        body = match.group("body")
        values: list[str] = []
        for setting_match in STD_SETTING_RE.finditer(body):
            if value := normalize_value(setting_match.group("value")):
                values.append(value)
        configurations[config_id] = (config_name, values)

    return configurations


def format_target(kind: str, name: str) -> str:
    prefixes = {
        "PBXProject": "Project",
        "PBXNativeTarget": "Target",
        "PBXAggregateTarget": "Aggregate target",
    }
    prefix = prefixes.get(kind.strip(), kind.strip() or "Unknown")
    return f"{prefix} \"{name.strip()}\""


def map_configuration_targets(text: str) -> dict[str, tuple[str, str]]:
    section = extract_section(text, "XCConfigurationList")
    mapping: dict[str, tuple[str, str]] = {}

    for match in CONFIG_LIST_RE.finditer(section):
        kind = match.group("kind")
        name = match.group("name")
        configs_blob = match.group("configs")
        for config_id_match in CONFIG_ID_RE.finditer(configs_blob):
            config_id = config_id_match.group(1)
            mapping[config_id] = (kind, name)

    return mapping


def collect_configuration_reports(path: Path) -> list[Configuration]:
    text = path.read_text(errors="ignore")
    values_by_id = parse_configurations(text)
    target_mapping = map_configuration_targets(text)

    reports: list[Configuration] = []
    for config_id, (config_name, values) in values_by_id.items():
        kind, name = target_mapping.get(config_id, ("Unknown", config_id))
        reports.append(
            Configuration(
                identifier=config_id,
                config_name=config_name,
                target_label=format_target(kind, name),
                values=values,
            )
        )

    return sorted(reports, key=lambda cfg: (cfg.target_label, cfg.config_name))


def summarize_values(configurations: Iterable[Configuration]) -> set[str]:
    values: set[str] = set()
    for config in configurations:
        values.update(config.values)
    return values


def evaluate_pods_configs(configurations: list[Configuration]) -> tuple[bool, list[str]]:
    failures: list[str] = []
    for config in configurations:
        explicit_values = [value for value in config.values if not is_variable(value)]
        if not explicit_values:
            failures.append(
                f"{config.target_label} [{config.config_name}]: "
                f"{', '.join(config.values) if config.values else '(missing)'}"
            )
            continue

        for value in explicit_values:
            if value.lower() != "c++20":
                failures.append(
                    f"{config.target_label} [{config.config_name}]: {', '.join(config.values)}"
                )
                break

    return (not failures, failures)


def print_app_summary(configurations: list[Configuration]) -> None:
    explicit_values = {
        value
        for config in configurations
        for value in config.values
        if not is_variable(value)
    }
    if explicit_values:
        print("App CLANG_CXX_LANGUAGE_STANDARD values:", explicit_values)
    else:
        print("App CLANG_CXX_LANGUAGE_STANDARD values:", {"(none)"})

    inherited_configs = [
        config
        for config in configurations
        if config.values and all(is_variable(value) for value in config.values)
    ]
    missing_configs = [config for config in configurations if not config.values]

    if inherited_configs:
        joined = ", ".join(
            f"{config.target_label} [{config.config_name}]" for config in inherited_configs
        )
        print("App configurations inheriting the standard:", joined)

    if missing_configs:
        joined = ", ".join(
            f"{config.target_label} [{config.config_name}]" for config in missing_configs
        )
        print("App configurations without the setting:", joined)


def main() -> int:
    if not PODS_PROJECT.exists():
        print("Pods.xcodeproj not found (run pod install)", file=sys.stderr)
        return 2

    pods_configs = collect_configuration_reports(PODS_PROJECT)
    pods_values = summarize_values(pods_configs)
    print("Pods CLANG_CXX_LANGUAGE_STANDARD values:", pods_values or {"(none)"})
    pods_ok, failures = evaluate_pods_configs(pods_configs)

    if APP_PROJECT.exists():
        app_configs = collect_configuration_reports(APP_PROJECT)
        print_app_summary(app_configs)
    else:
        print("App project not found at", APP_PROJECT, "(skipping app check)")

    if not pods_ok:
        print("Found Pods targets without an explicit CLANG_CXX_LANGUAGE_STANDARD=c++20:")
        for failure in failures:
            print(f"  - {failure}")
        return 2

    print("All Pods targets explicitly set CLANG_CXX_LANGUAGE_STANDARD=c++20.")
    return 0


if __name__ == "__main__":
    sys.exit(main())



