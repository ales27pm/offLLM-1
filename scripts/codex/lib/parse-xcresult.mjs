import path from "node:path";
import { sh, getValues } from "./util.mjs";

const LEGACY_UNSUPPORTED_TOKENS = [
  "unknown option",
  "unrecognized option",
  "invalid option",
  "invalid argument",
  "not supported",
  "no longer supported",
  "unsupported option",
  "does not support",
  "has been removed",
  "was removed",
  "removed in",
  "not a valid option",
];

let cachedLegacyFlagState;

function determineLegacyFlagState() {
  if (cachedLegacyFlagState) {
    return cachedLegacyFlagState;
  }

  const probe = sh("xcrun", ["xcresulttool", "get", "--help"]);
  const haystack = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.toLowerCase();

  if (haystack.includes("--legacy")) {
    cachedLegacyFlagState = "supported";
  } else if (probe.code === 0) {
    cachedLegacyFlagState = "unsupported";
  } else {
    cachedLegacyFlagState = "unknown";
  }

  return cachedLegacyFlagState;
}

function isLegacyUnsupportedMessage(message) {
  if (!message) {
    return false;
  }

  const lower = message.toLowerCase();
  if (!lower.includes("--legacy")) {
    return false;
  }

  return LEGACY_UNSUPPORTED_TOKENS.some((token) => lower.includes(token));
}

function runXCResultTool(xcresultPath) {
  const withLegacyArgs = [
    "xcresulttool",
    "get",
    "--format",
    "json",
    "--legacy",
    "--path",
    xcresultPath,
  ];
  const withoutLegacyArgs = [
    "xcresulttool",
    "get",
    "--format",
    "json",
    "--path",
    xcresultPath,
  ];

  const flagState = determineLegacyFlagState();
  const commandOrder =
    flagState === "unsupported"
      ? [withoutLegacyArgs, withLegacyArgs]
      : [withLegacyArgs, withoutLegacyArgs];

  const attempted = new Set();
  const failures = [];

  for (const args of commandOrder) {
    const key = args.join("\u0000");
    if (attempted.has(key)) {
      continue;
    }
    attempted.add(key);

    const result = sh("xcrun", args);
    if (result.code === 0) {
      return result;
    }

    const message = `${result.stderr ?? ""}${result.stdout ?? ""}`;
    failures.push({ result, message });
  }

  if (failures.length === 0) {
    return { code: 1, stdout: "", stderr: "xcresulttool failed" };
  }

  let chosen = failures[0];
  for (const failure of failures) {
    if (!failure.message) {
      continue;
    }

    if (
      (!chosen.message || isLegacyUnsupportedMessage(chosen.message)) &&
      !isLegacyUnsupportedMessage(failure.message)
    ) {
      chosen = failure;
      continue;
    }

    if (!chosen.message && failure.message) {
      chosen = failure;
    }
  }

  const stderr =
    (chosen.message && chosen.message.trim()) ||
    chosen.result.stderr ||
    chosen.result.stdout ||
    "xcresulttool failed";

  return {
    ...chosen.result,
    stderr,
  };
}

export function parseXCResult(xcresultPath) {
  // Use xcrun xcresulttool if available (macOS runners have it) and auto-select
  // the correct flag combination based on the detected tool support.
  const { code, stdout, stderr } = runXCResultTool(xcresultPath);

  if (code !== 0) {
    return {
      ok: false,
      error: "xcresulttool failed",
      stderr,
      path: xcresultPath,
    };
  }

  let root;
  try {
    root = JSON.parse(stdout);
  } catch (e) {
    return {
      ok: false,
      error: "xcresulttool JSON parse failed",
      stderr: e.message,
      path: xcresultPath,
    };
  }

  const records = getValues(root, "actions").flatMap((action) => [
    ...getValues(action, "actionResult", "issues", "issueSummaries").map(
      (rec) => ({ sourceType: "issueSummary", rec }),
    ),
    ...getValues(action, "actionResult", "issues", "testFailureSummaries").map(
      (rec) => ({ sourceType: "testFailure", rec }),
    ),
  ]);

  const { issues, errorCount, warningCount } = records.reduce(
    (acc, { sourceType, rec }) => {
      const issue = {
        type: rec.issueType?._value,
        title: rec.message?.text?._value,
        severity: rec.severity?._value,
        detailed: rec.producingTarget?.targetName?._value,
        sourceType,
      };

      const doc = rec.documentLocationInCreatingWorkspace;
      const url = doc?.url?._value;
      if (url) {
        issue.url = url;
        const loc = doc.concreteLocation;
        if (loc) {
          issue.filePath = loc.filePath?._value;
          const line = loc.lineNumber?._value;
          if (line && !isNaN(Number(line))) {
            issue.line = Number(line);
          }
        }
      }

      if (issue.severity === "error") acc.errorCount++;
      else if (issue.severity === "warning") acc.warningCount++;

      acc.issues.push(issue);
      return acc;
    },
    { issues: [], errorCount: 0, warningCount: 0 },
  );

  return {
    ok: true,
    path: path.resolve(xcresultPath),
    issues,
    errorCount,
    warningCount,
  };
}



