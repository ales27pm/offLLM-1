#!/usr/bin/env python3
import json, re, sys
from pathlib import Path

def main():
    pkg_path = Path("package.json")
    lock_path = Path("ios/Podfile.lock")

    if not pkg_path.exists():
        print("package.json not found", file=sys.stderr)
        sys.exit(2)
    if not lock_path.exists():
        print("ios/Podfile.lock not found (run pod install)", file=sys.stderr)
        sys.exit(2)

    pkg = json.loads(pkg_path.read_text())
    deps = {}
    deps.update(pkg.get("dependencies", {}))
    deps.update(pkg.get("devDependencies", {}))
    expected = deps.get("react-native")
    if not expected:
        print("No react-native in dependencies", file=sys.stderr)
        sys.exit(2)
    if expected[:1] in {"^", "~"}:
        expected_version = expected[1:]
    else:
        expected_version = expected

    lock = lock_path.read_text()
    react_versions = set(re.findall(r"^\s+- React(?:-[^\s]+)? \((\d+(?:\.\d+){1,2})\)", lock, re.MULTILINE))
    hermes_versions = set(re.findall(r"^\s+- hermes-engine(?:/[^\s]+)? \((\d+(?:\.\d+){1,2})\)", lock, re.MULTILINE))

    print("react-native (package.json):", expected_version)
    print("React-* pods (Podfile.lock):", sorted(react_versions) or "NONE")
    print("hermes-engine pods (Podfile.lock):", sorted(hermes_versions) or "NONE")

    ok = True
    if expected_version not in react_versions:
        print(
            f"Expected React pods at {expected_version} not found in Podfile.lock",
            file=sys.stderr,
        )
        ok = False
    unexpected_react = sorted(v for v in react_versions if v != expected_version)
    if unexpected_react:
        print(
            "Unexpected React pod versions detected: " + ", ".join(unexpected_react),
            file=sys.stderr,
        )
        ok = False

    if expected_version not in hermes_versions:
        print(
            f"Expected hermes-engine pods at {expected_version} not found in Podfile.lock",
            file=sys.stderr,
        )
        ok = False
    unexpected_hermes = sorted(v for v in hermes_versions if v != expected_version)
    if unexpected_hermes:
        print(
            "Unexpected hermes-engine pod versions detected: "
            + ", ".join(unexpected_hermes),
            file=sys.stderr,
        )
        ok = False

    sys.exit(0 if ok else 2)

if __name__ == "__main__":
    main()



