/* eslint-env node */
export function renderAgentReport({ xcodebuild }) {
  const bullets = [];
  if (xcodebuild.hermesScripts.length)
    bullets.push("Hermes replacement script still found.");
  if (xcodebuild.internalInconsistency.length)
    bullets.push(
      "Internal inconsistency error near swift-transformers / TensorUtils.",
    );
  if (xcodebuild.phaseScriptFailures.length)
    bullets.push("PhaseScriptExecution failures present.");
  if (xcodebuild.deploymentTargetNotes.length)
    bullets.push("Pods with too-low IPHONEOS_DEPLOYMENT_TARGET (e.g., 9.0).");

  const brief = bullets.length
    ? bullets.join(" ")
    : "No singular dominant failure; inspect errors & warnings.";

  // Keep to ~800-1200 chars so it can be inlined in agent prompts safely
  return [
    "## Build Diagnosis (Condensed)",
    "",
    `- Errors: ${xcodebuild.errorCount}, Warnings: ${xcodebuild.warningCount}`,
    `- Signals: ${brief}`,
    "",
    "### Next actions (high-level)",
    "- Remove '[Hermes] Replace Hermes' script phases (Pods + user projects).",
    "- Ensure ENABLE_USER_SCRIPT_SANDBOXING=NO and disable IO paths for [CP] scripts if using static pods.",
    "- Force IPHONEOS_DEPLOYMENT_TARGET >= 12.0 in post_install for old pods.",
    "- Clean SPM caches & re-resolve packages if you see 'Internal inconsistency error'.",
  ].join("\n");
}



