const fs = require("fs");
const {
  createBuildReportFixture,
} = require("../test-utils/buildReportFixture");

describe("build_report.py", () => {
  let fixture;

  beforeEach(() => {
    fixture = createBuildReportFixture();
  });

  afterEach(() => {
    if (fixture) {
      fixture.cleanup();
    }
  });

  const runWithStub = (options) => {
    const { result, paths } = fixture.run(options);
    if (result.stderr) {
      // Aid debugging on CI by surfacing stderr output.
      console.error(result.stderr);
    }
    return { result, paths };
  };

  test("summarizes log diagnostics and xcresult issues when legacy flag is supported", () => {
    const stubScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${2:-}" == "get" && "\${3:-}" == "--help" ]]; then
  echo "usage: includes --legacy"
  exit 0
fi

if [[ "\${2:-}" == "get" ]]; then
  echo '{"_type":{"_name":"IssueSummary"},"issueType":"CodeSign failure detected"}'
  exit 0
fi

>&2 echo "unexpected invocation: $*"
exit 1
`;

    const { result, paths } = runWithStub({
      stubScript,
      logContent: "error: Provisioning failed\nwarning: Swift deprecated API\n",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✅ Reports generated");

    const humanReport = fs.readFileSync(paths.reportPath, "utf8");
    expect(humanReport).toContain("- Workflow log:");
    expect(humanReport).toContain("error: Provisioning failed");
    expect(humanReport).toContain("warning: Swift deprecated API");
    expect(humanReport).toContain("CodeSign failure detected");

    const agentReport = fs.readFileSync(paths.agentPath, "utf8");
    expect(agentReport).toContain("errors_count=1");
    expect(agentReport).toContain("warnings_count=1");
    expect(agentReport).toContain("xcresult_issues_count=1");
    expect(agentReport).toContain(
      "first_xcresult_issue=CodeSign failure detected",
    );
  });

  test("falls back to non-legacy xcresulttool when legacy invocation fails", () => {
    const stubScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${2:-}" == "get" && "\${3:-}" == "--help" ]]; then
  echo "usage: includes --legacy"
  exit 0
fi

if [[ "\${2:-}" == "get" && "\${5:-}" == "--legacy" ]]; then
  echo "error: --legacy not supported" >&2
  exit 64
fi

if [[ "\${2:-}" == "get" ]]; then
  echo '{"_type":{"_name":"IssueSummary"},"issueType":"Simulator fallback succeeded"}'
  exit 0
fi

>&2 echo "unexpected invocation: $*"
exit 1
`;

    const { result, paths } = runWithStub({
      stubScript,
      logContent: "warning: Legacy flag removed\n",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✅ Reports generated");

    const humanReport = fs.readFileSync(paths.reportPath, "utf8");
    expect(humanReport).toContain("Simulator fallback succeeded");

    const agentReport = fs.readFileSync(paths.agentPath, "utf8");
    expect(agentReport).toContain("xcresult_issues_count=1");
    expect(agentReport).toContain(
      "first_xcresult_issue=Simulator fallback succeeded",
    );
  });

  test("records parse failures when xcresulttool is unavailable", () => {
    const stubScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${2:-}" == "get" && "\${3:-}" == "--help" ]]; then
  echo "usage"
  exit 0
fi

if [[ "\${2:-}" == "get" && "\${5:-}" == "--legacy" ]]; then
  printf "fatal: legacy mode removed" >&2
  exit 1
fi

if [[ "\${2:-}" == "get" ]]; then
  printf "xcresulttool crashed" >&2
  exit 2
fi

>&2 echo "unexpected invocation: $*"
exit 1
`;

    const { result, paths } = runWithStub({
      stubScript,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✅ Reports generated");

    const humanReport = fs.readFileSync(paths.reportPath, "utf8");
    expect(humanReport).toContain(
      "(xcresult parse failed: xcresulttool crashed)",
    );

    const agentReport = fs.readFileSync(paths.agentPath, "utf8");
    expect(agentReport).toContain("xcresult_issues_count=1");
    expect(agentReport).toContain(
      "first_xcresult_issue=(xcresult parse failed: xcresulttool crashed)",
    );
  });

  test("records parse failures when xcresult output is empty", () => {
    const stubScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${2:-}" == "get" ]]; then
  echo ''
  exit 0
fi

>&2 echo "unexpected invocation: $*"
exit 1
`;

    const { result, paths } = runWithStub({
      stubScript,
      xcresultContent: "",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✅ Reports generated");

    const humanReport = fs.readFileSync(paths.reportPath, "utf8");
    expect(humanReport).toContain("(xcresult parse failed: Expecting value");

    const agentReport = fs.readFileSync(paths.agentPath, "utf8");
    expect(agentReport).toContain("xcresult_issues_count=1");
    expect(agentReport).toMatch(
      /first_xcresult_issue=\(xcresult parse failed: Expecting value/,
    );
  });

  test("records parse failures when xcresult output is malformed JSON", () => {
    const stubScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${2:-}" == "get" ]]; then
  echo '{invalid json'
  exit 0
fi

>&2 echo "unexpected invocation: $*"
exit 1
`;

    const { result, paths } = runWithStub({
      stubScript,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✅ Reports generated");

    const humanReport = fs.readFileSync(paths.reportPath, "utf8");
    expect(humanReport).toContain(
      "(xcresult parse failed: Expecting property name enclosed in double quotes",
    );

    const agentReport = fs.readFileSync(paths.agentPath, "utf8");
    expect(agentReport).toContain("xcresult_issues_count=1");
    expect(agentReport).toMatch(
      /first_xcresult_issue=\(xcresult parse failed: Expecting property name enclosed in double quotes/,
    );
  });
});
