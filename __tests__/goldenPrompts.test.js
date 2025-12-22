// __tests__/goldenPrompts.test.js
"use strict";

const fs = require("fs");
const path = require("path");

function readGoldenPrompts() {
  const goldenPath = path.join(
    __dirname,
    "..",
    "scripts",
    "eval",
    "golden_prompts.json",
  );

  const raw = fs.readFileSync(goldenPath, "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(
      `Failed to parse golden_prompts.json as JSON: ${msg}\nPath: ${goldenPath}`,
    );
  }

  // Normalise older/newer layouts:
  // - legacy: [ ...cases ]
  // - current: { cases: [ ...cases ], ...meta }
  if (Array.isArray(parsed)) {
    return { cases: parsed };
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.cases)) {
    return parsed;
  }

  const shape = parsed === null ? "null" : typeof parsed;
  throw new Error(
    `golden_prompts.json must be either an array of cases OR an object with { cases: [...] }. Got: ${shape}`,
  );
}

function isPlainObject(x) {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

describe("golden prompts", () => {
  it("loads and has at least 8 cases", () => {
    const data = readGoldenPrompts();
    expect(data && typeof data).toBe("object");
    expect(Array.isArray(data.cases)).toBe(true);
    expect(data.cases.length).toBeGreaterThanOrEqual(8);
  });

  it("each case satisfies the schema contract", () => {
    const data = readGoldenPrompts();

    const allowedTop = new Set([
      "stable_id",
      "prompt",
      "tools",
      "context",
      "user_prompt",
      "expected_prompt_hash",
      "sarif_category",
      "expected",

      // legacy / compatibility fields (allowed, but optional)
      "expected_tool_calls",
      "expects_json",
      "expects_refusal",
      "requires_citations",
    ]);

    const allowedExpected = new Set([
      "tool_calls",
      "json_valid",
      "refusal",
      "citations_required",
    ]);

    const allowedCategories = new Set([
      "tool-call",
      "refusal",
      "json-validity",
      "citation",
      "other",
    ]);

    data.cases.forEach((entry) => {
      expect(entry && typeof entry).toBe("object");

      // Top-level keys must be known
      Object.keys(entry).forEach((key) => {
        expect(allowedTop.has(key)).toBe(true);
      });

      // identifiers
      expect(typeof entry.stable_id).toBe("string");
      expect(entry.stable_id.length).toBeGreaterThan(0);

      // prompts
      // support both "prompt" and "user_prompt" but require user_prompt
      expect(typeof entry.user_prompt).toBe("string");
      if (typeof entry.prompt !== "undefined") {
        expect(typeof entry.prompt).toBe("string");
        // if both exist, they should match for determinism
        expect(entry.prompt).toBe(entry.user_prompt);
      }

      // prompt hash (optional, but when present must be strict sha256 hex)
      if (typeof entry.expected_prompt_hash !== "undefined") {
        expect(typeof entry.expected_prompt_hash).toBe("string");
        expect(entry.expected_prompt_hash.length).toBeGreaterThan(0);
        expect(entry.expected_prompt_hash).toMatch(/^[0-9a-f]{64}$/i);
      }

      // category (optional but recommended)
      if (typeof entry.sarif_category !== "undefined") {
        expect(allowedCategories.has(entry.sarif_category)).toBe(true);
      }

      // tools
      expect(Array.isArray(entry.tools)).toBe(true);
      entry.tools.forEach((tool) => {
        expect(tool && typeof tool).toBe("object");
        expect(typeof tool.name).toBe("string");
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.parameters && typeof tool.parameters).toBe("object");
      });

      // context
      expect(Array.isArray(entry.context)).toBe(true);
      entry.context.forEach((ctx) => {
        if (typeof ctx === "string") {
          expect(ctx.length).toBeGreaterThanOrEqual(0);
          return;
        }
        expect(ctx && typeof ctx).toBe("object");
        expect(typeof ctx.content).toBe("string");
      });

      // expected
      expect(entry.expected && typeof entry.expected).toBe("object");
      expect(isPlainObject(entry.expected)).toBe(true);

      Object.keys(entry.expected).forEach((key) => {
        expect(allowedExpected.has(key)).toBe(true);
      });

      expect(Array.isArray(entry.expected.tool_calls)).toBe(true);
      entry.expected.tool_calls.forEach((call) => {
        expect(call && typeof call).toBe("object");
        expect(typeof call.name).toBe("string");
        expect(call.name.length).toBeGreaterThan(0);
        expect(call.args && typeof call.args).toBe("object");
      });

      expect(typeof entry.expected.json_valid).toBe("boolean");
      expect(typeof entry.expected.refusal).toBe("boolean");
      expect(typeof entry.expected.citations_required).toBe("boolean");

      // legacy field consistency (only when both present)
      if (
        Object.prototype.hasOwnProperty.call(entry, "expected_tool_calls") &&
        Object.prototype.hasOwnProperty.call(entry.expected, "tool_calls")
      ) {
        expect(entry.expected.tool_calls).toEqual(entry.expected_tool_calls);
      }

      if (
        Object.prototype.hasOwnProperty.call(entry, "expects_json") &&
        Object.prototype.hasOwnProperty.call(entry.expected, "json_valid")
      ) {
        expect(entry.expected.json_valid).toBe(entry.expects_json);
      }

      if (
        Object.prototype.hasOwnProperty.call(entry, "expects_refusal") &&
        Object.prototype.hasOwnProperty.call(entry.expected, "refusal")
      ) {
        expect(entry.expected.refusal).toBe(entry.expects_refusal);
      }

      if (
        Object.prototype.hasOwnProperty.call(entry, "requires_citations") &&
        Object.prototype.hasOwnProperty.call(entry.expected, "citations_required")
      ) {
        expect(entry.expected.citations_required).toBe(entry.requires_citations);
      }
    });
  });

  it("optional prompt_hashes are well-formed when present", () => {
    const data = readGoldenPrompts();

    data.cases.forEach((entry) => {
      if (typeof entry.expected_prompt_hash === "undefined") return;
      expect(typeof entry.expected_prompt_hash).toBe("string");
      // strict sha256 hex
      expect(entry.expected_prompt_hash).toMatch(/^[0-9a-f]{64}$/i);
    });
  });

  it("stable ids are unique", () => {
    const data = readGoldenPrompts();
    const ids = new Set();
    data.cases.forEach((entry) => {
      ids.add(entry.stable_id);
    });
    expect(ids.size).toBe(data.cases.length);
  });
});
