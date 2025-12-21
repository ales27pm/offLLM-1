import fs from "fs";
import path from "path";
import PromptBuilder from "../src/core/prompt/PromptBuilder";

const goldenPath = path.join(
  __dirname,
  "..",
  "scripts",
  "eval",
  "golden_prompts.json",
);

const loadGolden = () => JSON.parse(fs.readFileSync(goldenPath, "utf-8"));

test("PromptBuilder matches golden prompts", () => {
  const golden = loadGolden();
  golden.forEach((entry) => {
    const registry = {
      getAvailableTools: () => entry.tools,
    };
    const builder = new PromptBuilder(registry);
    const prompt = builder.build(entry.user_prompt, entry.context);
    expect(prompt).toBe(entry.expected_prompt);
  });
});
