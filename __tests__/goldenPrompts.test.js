const fs = require("fs");
const path = require("path");

describe("golden prompts schema", () => {
  const goldenPath = path.join(
    __dirname,
    "..",
    "scripts",
    "eval",
    "golden_prompts.json",
  );
  const raw = fs.readFileSync(goldenPath, "utf-8");
  const data = JSON.parse(raw);

  it("has at least 8 cases with unique stable ids", () => {
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(8);
    const ids = new Set(data.map((entry) => entry.stable_id));
    expect(ids.size).toBe(data.length);
  });

  it("matches the golden prompt schema", () => {
    const allowedTop = new Set([
      "stable_id",
      "prompt",
      "tools",
      "context",
      "user_prompt",
      "expected_prompt_hash",
      "expected",
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

    data.forEach((entry) => {
      Object.keys(entry).forEach((key) => {
        expect(allowedTop.has(key)).toBe(true);
      });

      expect(typeof entry.stable_id).toBe("string");
      expect(entry.stable_id.length).toBeGreaterThan(0);
      expect(typeof entry.user_prompt).toBe("string");
      expect(typeof entry.prompt).toBe("string");
      expect(entry.prompt).toBe(entry.user_prompt);
      expect(typeof entry.expected_prompt_hash).toBe("string");
      expect(entry.expected_prompt_hash.length).toBeGreaterThan(0);

      expect(Array.isArray(entry.tools)).toBe(true);
      entry.tools.forEach((tool) => {
        expect(typeof tool.name).toBe("string");
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.parameters && typeof tool.parameters).toBe("object");
      });

      expect(Array.isArray(entry.context)).toBe(true);
      entry.context.forEach((ctx) => {
        if (typeof ctx === "string") {
          expect(ctx.length).toBeGreaterThanOrEqual(0);
          return;
        }
        expect(ctx && typeof ctx).toBe("object");
        expect(typeof ctx.content).toBe("string");
      });

      expect(entry.expected && typeof entry.expected).toBe("object");
      Object.keys(entry.expected).forEach((key) => {
        expect(allowedExpected.has(key)).toBe(true);
      });
      expect(Array.isArray(entry.expected.tool_calls)).toBe(true);
      entry.expected.tool_calls.forEach((call) => {
        expect(call && typeof call).toBe("object");
        expect(typeof call.name).toBe("string");
        expect(call.args && typeof call.args).toBe("object");
      });
      expect(typeof entry.expected.json_valid).toBe("boolean");
      expect(typeof entry.expected.refusal).toBe("boolean");
      expect(typeof entry.expected.citations_required).toBe("boolean");
    });
  });
});
