export function renderHumanReport({ xcodebuild, xcresult }) {
  const lines = [
    "# iOS CI Diagnosis",
    "",
    "## Most likely root cause",
    "```" + guessRootCause(xcodebuild, xcresult) + "```",
    "",
    "## Top XCResult issues",
  ];

  if (xcresult?.ok && xcresult.issues?.length) {
    lines.push(
      ...xcresult.issues
        .slice(0, 15)
        .map(
          (i) =>
            `- **${i.severity ?? "unknown"}**: ${i.title ?? "(no title)"}${i.detailed ? ` — _${i.detailed}_` : ""}`,
        ),
    );
  } else {
    lines.push("- (no structured issues captured from xcresulttool)");
  }

  lines.push("", "## Log stats");
  const stats = [
    { label: "Errors", count: xcodebuild.errorCount },
    { label: "Warnings", count: xcodebuild.warningCount },
    { label: "Hermes script mentions", count: xcodebuild.hermesScripts.length },
    {
      label: "PhaseScriptExecution failures",
      count: xcodebuild.phaseScriptFailures.length,
    },
    {
      label: "Deployment target mismatches",
      count: xcodebuild.deploymentTargetNotes.length,
    },
    {
      label: "Internal inconsistency errors",
      count: xcodebuild.internalInconsistency.length,
    },
  ];
  stats.forEach(({ label, count }) => {
    if (count) lines.push(`- ${label}: **${count}**`);
  });

  lines.push(
    "",
    "## Pointers",
    `- Full log: \`${xcodebuild.logPath}\``,
    `- Result bundle: \`${xcresult?.path ?? "(unavailable)"}\``,
  );

  return lines.join("\n");
}

function guessRootCause(x, r) {
  const candidates = [
    [
      () => x.hermesScripts.length > 0,
      "Hermes '[CP-User] Replace Hermes...' script phase is still present; scrub it post-install/post-integrate.",
    ],
    [
      () => x.internalInconsistency.length > 0,
      "Xcode 'Internal inconsistency error' (e.g., swift-transformers/TensorUtils). Clean SPM caches & ensure packages resolve.",
    ],
    [
      () => x.phaseScriptFailures.length > 0,
      "A CocoaPods '[CP]' script phase failed; check inputs/outputs or sandboxing settings.",
    ],
    [
      () => x.deploymentTargetNotes.length > 0,
      "One or more Pods declare iOS 9.0; raise to 12+ or set `IPHONEOS_DEPLOYMENT_TARGET` via post_install overrides.",
    ],
    [
      () => x.errorCount > 0,
      "Build contains errors in xcodebuild.log; see the Errors section for specifics.",
    ],
    [
      () => r?.ok && r.issues?.length > 0,
      () =>
        `XCResult lists ${r.issues.length} issue(s); inspect the highest severity above.`,
    ],
  ];

  for (const [test, msg] of candidates) {
    if (test()) return typeof msg === "function" ? msg() : msg;
  }

  return "No obvious single root cause detected; inspect warnings and CI environment.";
}



