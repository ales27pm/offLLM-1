const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT_PATH = path.join(
  __dirname,
  "..",
  "scripts",
  "ci",
  "build_report.py",
);

const PYTHON_INTERPRETER =
  process.env.BUILD_REPORT_PYTHON || process.env.PYTHON || "python3";

const writeExecutable = (filePath, contents) => {
  fs.writeFileSync(filePath, contents, "utf8");
  fs.chmodSync(filePath, 0o755);
};

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

class BuildReportFixture {
  constructor(prefix = "build-report") {
    this.workspace = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    this.paths = {
      workspace: this.workspace,
      binDir: path.join(this.workspace, "bin"),
      stubPath: null,
      logPath: path.join(this.workspace, "xcodebuild.log"),
      xcresultPath: path.join(this.workspace, "monGARS.xcresult"),
      reportPath: path.join(this.workspace, "REPORT.md"),
      agentPath: path.join(this.workspace, "report_agent.md"),
    };
    ensureDir(this.paths.binDir);
    this.paths.stubPath = path.join(this.paths.binDir, "xcrun");
  }

  run({ stubScript, logContent = "", xcresultContent = "{}" } = {}) {
    if (!stubScript) {
      throw new Error("stubScript is required to run the build report fixture");
    }

    writeExecutable(this.paths.stubPath, stubScript);

    fs.writeFileSync(this.paths.logPath, logContent, "utf8");
    fs.writeFileSync(this.paths.xcresultPath, xcresultContent, "utf8");

    const env = {
      ...process.env,
      PATH: `${this.paths.binDir}${path.delimiter}${process.env.PATH || ""}`,
      PYTHONUTF8: "1",
    };

    const result = spawnSync(
      PYTHON_INTERPRETER,
      [
        SCRIPT_PATH,
        "--log",
        this.paths.logPath,
        "--xcresult",
        this.paths.xcresultPath,
        "--out",
        this.paths.reportPath,
        "--agent",
        this.paths.agentPath,
      ],
      {
        cwd: path.join(__dirname, ".."),
        env,
        encoding: "utf8",
      },
    );

    return {
      result,
      paths: this.paths,
    };
  }

  cleanup() {
    fs.rmSync(this.workspace, { recursive: true, force: true });
  }
}

const createBuildReportFixture = (prefix) => new BuildReportFixture(prefix);

module.exports = {
  createBuildReportFixture,
  PYTHON_INTERPRETER,
  SCRIPT_PATH,
};



