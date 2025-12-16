const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

describe("emit_ios_diagnostics_summary", () => {
  let tmpDir;

  afterEach(() => {
    if (!tmpDir) {
      return;
    }

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }

    tmpDir = undefined;
  });

  test("summarizes unsigned device build issues from Apple xcresult JSON", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-summary-"));
    const envLog = path.join(tmpDir, "environment.log");
    const errorLog = path.join(tmpDir, "xcode-errors.log");
    const derivedLog = path.join(tmpDir, "derived-data.log");
    const unifiedLog = path.join(tmpDir, "unified.log");

    fs.writeFileSync(envLog, "macOS 15.0.1\nXcode 16.4\n", "utf8");
    fs.writeFileSync(errorLog, "warning: sample log\n", "utf8");
    fs.writeFileSync(
      derivedLog,
      "DerivedData base: /Users/runner/Library/Developer/Xcode/DerivedData\n",
      "utf8",
    );
    fs.writeFileSync(unifiedLog, "log show unavailable\n", "utf8");

    const unsignedFixture = path.join(
      __dirname,
      "fixtures",
      "iosUnsigned",
      "ResultBundle_unsigned_sample.json",
    );
    const archiveFixture = path.join(
      __dirname,
      "fixtures",
      "iosUnsigned",
      "archive_result_sample.json",
    );

    // The script writes to GITHUB_STEP_SUMMARY when it is defined, so clear it to
    // keep stdout assertions deterministic across environments.
    const childEnv = { ...process.env, PYTHONUTF8: "1" };
    delete childEnv.GITHUB_STEP_SUMMARY;

    const result = spawnSync(
      "python3",
      [
        "scripts/ci/emit_ios_diagnostics_summary.py",
        "--label",
        "iOS unsigned device build",
        "--env-log",
        envLog,
        "--error-log",
        errorLog,
        "--derived-log",
        derivedLog,
        "--unified-log",
        unifiedLog,
        "--artifact-path",
        "build/diagnostics",
        "--result-json",
        unsignedFixture,
        "--result-json",
        archiveFixture,
        "--issue-limit",
        "5",
      ],
      {
        encoding: "utf8",
        cwd: path.join(__dirname, ".."),
        env: childEnv,
      },
    );

    if (result.stderr) {
      // Improve debugging on CI by surfacing stderr when the command fails.
      console.error(result.stderr);
    }

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("## iOS unsigned device build diagnostics");
    expect(result.stdout).toContain("Swift Compiler Error");
    expect(result.stdout).toContain(
      "Sending 'session' risks causing data races",
    );
    expect(result.stdout).toContain(
      "Run script build phase '[CP-User] [Hermes] Replace Hermes",
    );
    expect(result.stdout).toContain(
      "Run script build phase 'Create Symlinks to Header Folders'",
    );
    expect(result.stdout).toContain(
      "Use of GNU ?: conditional expression extension, omitting middle operand",
    );
    expect(result.stdout).toContain(
      "Skipping duplicate build file in Copy Headers build phase",
    );
    expect(result.stdout).toContain("Artifacts: `build/diagnostics`");
  });
});
