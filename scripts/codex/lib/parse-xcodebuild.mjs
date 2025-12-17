import fs from "node:fs";

export function parseXcodebuildLog(logPath) {
  const text = fs.readFileSync(logPath, "utf8");

  // Collect errors, warnings, and notable lines
  const lines = text.split(/\r?\n/);

  const errors = [];
  const warnings = [];
  const hermesScripts = [];
  const phaseScriptFailures = [];
  const deploymentTargetNotes = [];
  const internalInconsistency = [];

  for (const line of lines) {
    const l = line.trim();

    if (/error: /i.test(l) || /Command PhaseScriptExecution failed/i.test(l)) {
      errors.push(line);
    }
    if (/warning: /i.test(l)) {
      warnings.push(line);
    }
    if (
      /\[Hermes\] Replace Hermes/i.test(l) ||
      /Replace Hermes for the right configuration/i.test(l)
    ) {
      hermesScripts.push(line);
    }
    if (/Command PhaseScriptExecution failed/i.test(l)) {
      phaseScriptFailures.push(line);
    }
    if (
      /deployment target .* is set to 9\.0/i.test(l) ||
      /The iOS deployment target .* is set to 9\.0/i.test(l)
    ) {
      deploymentTargetNotes.push(line);
    }
    if (/Internal inconsistency error/i.test(l)) {
      internalInconsistency.push(line);
    }
  }

  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    hermesScripts,
    phaseScriptFailures,
    deploymentTargetNotes,
    internalInconsistency,
    // keep raw log path reference
    logPath,
  };
}
