const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

describe("symbiosis advisor artifact blindness", () => {
  it("ignores reports files during prompt analysis", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symbiosis-"));
    const repoRoot = path.join(tmpRoot, "repo");
    const reportsDir = path.join(repoRoot, "reports");
    const srcDir = path.join(repoRoot, "src");
    const outDir = path.join(tmpRoot, "out");

    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "app.js"),
      "// system prompt\nconst prompt = 'You are an assistant';",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(reportsDir, "symbiosis_deep_report.md"),
      "system prompt: should be ignored",
      "utf-8",
    );

    const scriptPath = path.join(
      __dirname,
      "..",
      "scripts",
      "offllm_symbiosis_advisor_v6.py",
    );
    const python = process.env.PYTHON || "python";
    const result = spawnSync(
      python,
      [scriptPath, "--repo-root", repoRoot, "--out-dir", outDir],
      { encoding: "utf-8" },
    );

    if (result.status !== 0) {
      throw new Error(
        `symbiosis advisor failed: ${result.stderr || result.stdout}`,
      );
    }

    const reportPath = path.join(outDir, "symbiosis_deep_report.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    const promptFiles = new Set(
      (report.prompt_snippets || []).map((snippet) => snippet.file),
    );

    expect(promptFiles.size).toBeGreaterThan(0);
    promptFiles.forEach((file) => {
      expect(file.startsWith("src/")).toBe(true);
      expect(file.includes("reports/")).toBe(false);
    });
  });
});
