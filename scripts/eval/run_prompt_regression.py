import argparse
import json
import os


def build_prompt(template: dict, tools: list[dict], context: list[dict], user_prompt: str) -> str:
    tool_format = template["tool_format"]
    tools_sorted = sorted(tools, key=lambda t: t["name"])
    tools_desc = "\n".join(
        tool_format.format(
            name=tool["name"],
            description=tool["description"],
            parameters=json.dumps(tool.get("parameters", {}), ensure_ascii=False),
        )
        for tool in tools_sorted
    )

    context_lines = []
    for entry in context:
        role = entry.get("role", "")
        content = entry.get("content", "")
        role_label = f"{role.capitalize()}:" if role else ""
        context_lines.append(f"{role_label} {content}".strip())

    sections = [
        template["system_intro"],
        tools_desc,
        template["instructions_title"],
        template["instructions"],
        template["context_title"],
        "\n".join(context_lines),
        f"{template['user_prefix']} {user_prompt}",
        template["assistant_prefix"],
    ]
    return "\n".join([segment for segment in sections if segment != ""])


def main() -> None:
    parser = argparse.ArgumentParser(description="Run prompt regression tests.")
    parser.add_argument(
        "--template",
        default=os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "src",
            "core",
            "prompt",
            "promptTemplates.json",
        ),
    )
    parser.add_argument(
        "--golden",
        default=os.path.join(os.path.dirname(__file__), "golden_prompts.json"),
    )
    args = parser.parse_args()

    with open(args.template, "r", encoding="utf-8") as handle:
        template = json.load(handle)
    with open(args.golden, "r", encoding="utf-8") as handle:
        golden = json.load(handle)

    failures = []
    for entry in golden:
        expected = entry["expected_prompt"]
        actual = build_prompt(
            template,
            entry.get("tools", []),
            entry.get("context", []),
            entry.get("user_prompt", ""),
        )
        if actual != expected:
            failures.append(entry["id"])

    if failures:
        raise SystemExit(f"Prompt regression failed for: {', '.join(failures)}")
    print("Prompt regression passed")


if __name__ == "__main__":
    main()
