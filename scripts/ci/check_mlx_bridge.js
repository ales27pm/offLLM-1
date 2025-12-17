#!/usr/bin/env node
/**
 * Quick sanity checks for the MLX RN bridge before we spend minutes archiving.
 * - Verifies presence of Swift + ObjC bridge files.
 * - Verifies RN JS bridge wrapper exists.
 * - Verifies Xcode project references (basic heuristics on pbxproj).
 * - Verifies Podfile / XcodeGen settings (platform iOS 18, Swift 6).
 * - Verifies project.yml contains MLX packages + signing disabled.
 *
 * Exit non-zero with actionable errors so CI can fail fast.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(process.cwd());
const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

function resolveInRepo(targetPath) {
  const absPath = path.isAbsolute(targetPath)
    ? path.normalize(targetPath)
    : path.resolve(root, targetPath);

  if (absPath === root) {
    throw new Error("Refusing to operate on the repository root");
  }

  if (!absPath.startsWith(rootWithSep)) {
    throw new Error(`Refusing path outside repository root: ${targetPath}`);
  }

  return absPath;
}

function mustExist(relPath, label) {
  const resolved = resolveInRepo(relPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Missing ${label || relPath} at ${relPath}`);
  }
  return resolved;
}

function mustContain(targetPath, substrings, label) {
  const resolved = resolveInRepo(targetPath);
  const src = fs.readFileSync(resolved, "utf8");
  for (const s of substrings) {
    if (!src.includes(s)) {
      throw new Error(
        `Expected ${label || path.relative(root, resolved)} to contain: ${s}`,
      );
    }
  }
}

function softCheck(targetPath, substrings, label) {
  try {
    mustContain(targetPath, substrings, label);
    return true;
  } catch (e) {
    console.warn(`WARN: ${e.message}`);
    return false;
  }
}

function safeExists(targetPath) {
  try {
    return fs.existsSync(resolveInRepo(targetPath));
  } catch (e) {
    console.warn(`WARN: ${e.message}`);
    return false;
  }
}

function main() {
  const errors = [];

  // --- 1) Files existence checks
  const existChecks = [
    {
      rel: "ios/MyOfflineLLMApp/MLX/MLXModule.swift",
      label: "Swift bridge (MLXModule.swift)",
    },
    {
      rel: "ios/MyOfflineLLMApp/MLX/MLXModuleBridge.m",
      label: "ObjC shim (MLXModuleBridge.m)",
    },
    {
      rel: "ios/MyOfflineLLMApp/MLX/MLXEvents.swift",
      label: "Swift event emitter (MLXEvents.swift)",
    },
    {
      rel: "ios/MyOfflineLLMApp/MLX/MLXEventsBridge.m",
      label: "ObjC shim (MLXEventsBridge.m)",
    },
    {
      rel: "src/native/MLXModule.ts",
      label: "JS wrapper (src/native/MLXModule.ts)",
    },
    {
      rel: "src/services/chat/mlxChat.ts",
      label: "Chat service (mlxChat.ts)",
    },
  ];

  for (const { rel, label } of existChecks) {
    try {
      mustExist(rel, label);
    } catch (e) {
      errors.push(e.message);
    }
  }

  // --- 2) File content checks (hard-fail)
  const containChecks = [
    {
      rel: "ios/MyOfflineLLMApp/MLX/MLXModule.swift",
      substrings: [
        "@objc(MLXModule)",
        "@MainActor",
        "final class MLXModule: NSObject",
        "LLMModelFactory.shared.loadContainer",
        "ChatSession(",
      ],
      label: "MLXModule.swift",
    },
    {
      rel: "ios/MyOfflineLLMApp/MLX/MLXModuleBridge.m",
      substrings: [
        "RCT_EXTERN_MODULE(MLXModule, NSObject)",
        "RCT_EXTERN_METHOD(load:(NSString * _Nullable)modelID",
        "RCT_EXTERN_METHOD(generate:(NSString *)prompt",
        "options:(NSDictionary * _Nullable)options",
        "RCT_EXTERN_METHOD(startStream:(NSString *)prompt",
        "RCT_EXTERN_METHOD(reset)",
        "RCT_EXTERN_METHOD(unload)",
        "RCT_EXTERN_METHOD(stop)",
      ],
      label: "MLXModuleBridge.m",
    },
    {
      rel: "ios/MyOfflineLLMApp/MLX/MLXEvents.swift",
      substrings: ["@objc(MLXEvents)", "RCTEventEmitter"],
      label: "MLXEvents.swift",
    },
    {
      rel: "ios/MyOfflineLLMApp/MLX/MLXEventsBridge.m",
      substrings: ["RCT_EXTERN_MODULE(MLXEvents, RCTEventEmitter)"],
      label: "MLXEventsBridge.m",
    },
    {
      rel: "src/native/MLXModule.ts",
      substrings: [
        "NativeModules.MLXModule",
        "load(",
        "generate(",
        "startStream(",
        "reset(",
        "unload(",
        "stop(",
      ],
      label: "src/native/MLXModule.ts",
    },
  ];

  for (const { rel, substrings, label } of containChecks) {
    try {
      const filePath = mustExist(rel, label);
      mustContain(filePath, substrings, label);
    } catch (e) {
      errors.push(e.message);
    }
  }

  // --- 5) Basic Xcode project references (heuristic)
  // Ensure pbxproj mentions both files (not perfect, but catches common misses)
  const pbxprojCandidates = [
    "ios/monGARS.xcodeproj/project.pbxproj",
    "ios/MyOfflineLLMApp.xcodeproj/project.pbxproj",
  ];
  const pbx = pbxprojCandidates.find((p) => safeExists(p));
  if (pbx) {
    try {
      softCheck(pbx, ["MLXModule.swift"], `${pbx} (MLXModule.swift ref)`);
      softCheck(pbx, ["MLXModuleBridge.m"], `${pbx} (MLXModuleBridge.m ref)`);
      softCheck(pbx, ["MLXEvents.swift"], `${pbx} (MLXEvents.swift ref)`);
      softCheck(pbx, ["MLXEventsBridge.m"], `${pbx} (MLXEventsBridge.m ref)`);
    } catch (e) {
      console.warn(`WARN: ${e.message}`);
    }
  } else {
    console.warn(
      "WARN: Could not find a project.pbxproj to verify file references.",
    );
  }

  // --- 6) Podfile sanity (iOS 18)
  if (safeExists("ios/Podfile")) {
    try {
      softCheck(
        "ios/Podfile",
        ["platform :ios, '18.0'"],
        "Podfile platform iOS 18",
      );
    } catch (e) {
      console.warn(`WARN: ${e.message}`);
    }
  }

  // --- 7) XcodeGen project.yml sanity (Swift 6, signing disabled, MLX packages)
  if (safeExists("ios/project.yml")) {
    try {
      softCheck(
        "ios/project.yml",
        ['SWIFT_VERSION: "6.0"'],
        "Swift 6 in project.yml",
      );
      softCheck(
        "ios/project.yml",
        ["CODE_SIGNING_ALLOWED: NO"],
        "Signing disabled in project.yml",
      );
      softCheck(
        "ios/project.yml",
        ["MLXLMCommon"],
        "MLXLMCommon added in project.yml packages",
      );
      softCheck(
        "ios/project.yml",
        ["MLXLLM"],
        "MLXLLM added in project.yml packages",
      );
    } catch (e) {
      console.warn(`WARN: ${e.message}`);
    }
  }

  // --- 8) Surface any accumulated hard errors
  if (errors.length) {
    console.error(
      "❌ MLX bridge sanity check failed:\n- " + errors.join("\n- "),
    );
    process.exit(1);
  } else {
    console.log("✅ MLX bridge sanity check passed.");
  }
}

try {
  main();
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
