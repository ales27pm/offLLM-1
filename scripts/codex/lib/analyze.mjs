/* eslint-env node */
import path from "node:path";
import fs from "node:fs";
import { ensureDir, writeJSON, writeText } from "./util.mjs";
import { parseXcodebuildLog } from "./parse-xcodebuild.mjs";
import { parseXCResult } from "./parse-xcresult.mjs";
import { renderHumanReport } from "./render-report.mjs";
import { renderAgentReport } from "./render-agent-report.mjs";
import console from "node:console";

export async function analyzeCmd(opts) {
  const outDir = path.resolve(opts.out || "reports");
  ensureDir(outDir);

  const emptyLog = (logPath) => ({
    errorCount: 0,
    warningCount: 0,
    errors: [],
    warnings: [],
    hermesScripts: [],
    phaseScriptFailures: [],
    deploymentTargetNotes: [],
    internalInconsistency: [],
    logPath,
  });

  let xcodebuild = emptyLog(opts.log || "(missing)");
  if (opts.log && fs.existsSync(opts.log)) {
    xcodebuild = parseXcodebuildLog(path.resolve(opts.log));
  }

  let xcresult = {
    ok: false,
    path: opts.xcresult ? path.resolve(opts.xcresult) : "(missing)",
    issues: [],
  };
  if (opts.xcresult && fs.existsSync(opts.xcresult)) {
    xcresult = parseXCResult(path.resolve(opts.xcresult));
  }

  writeJSON(path.join(outDir, "report.json"), { xcodebuild, xcresult });
  writeText(
    path.join(outDir, "REPORT.md"),
    renderHumanReport({ xcodebuild, xcresult }),
  );
  writeText(
    path.join(outDir, "report_agent.md"),
    renderAgentReport({ xcodebuild, xcresult }),
  );

  // keep a tiny status file for CI grep
  const status = xcodebuild.errorCount > 0 ? "errors" : "ok";
  writeText(path.join(outDir, "status.txt"), status);

  console.log(`Wrote reports to: ${outDir}`);
}



