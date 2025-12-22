import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const writeJson = (filePath, payload) => {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
};

describe("eval summary writer", () => {
  it("writes eval summary and enforces baseline gating", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-summary-"));
    const promptPath = path.join(tempDir, "prompt.json");
    const toolPath = path.join(tempDir, "tool.json");
    const retrievalPath = path.join(tempDir, "retrieval.json");
    const latencyPath = path.join(tempDir, "latency.json");
    const memoryPath = path.join(tempDir, "memory.json");
    const baselinePath = path.join(tempDir, "baseline.json");
    const outputPath = path.join(tempDir, "summary.json");

    const prompt = { passed: 1, failures: 0 };
    const tool = { valid_rate: 0.98 };
    const retrieval = { mrr: 0.4, ndcg: 0.5 };
    const latency = { p95_latency_ms: 120 };
    const memory = { peak_memory_mb: 512 };
    const baseline = {
      prompt_regression: { passed: 1, failures: 0 },
      tool_json_validity: { valid_rate: 0.9 },
      retrieval: { mrr: 0.3, ndcg: 0.4 },
      latency: { p95_latency_ms: 150 },
      memory: { peak_memory_mb: 600 },
    };

    writeJson(promptPath, prompt);
    writeJson(toolPath, tool);
    writeJson(retrievalPath, retrieval);
    writeJson(latencyPath, latency);
    writeJson(memoryPath, memory);
    writeJson(baselinePath, baseline);

    execFileSync("python", [
      "scripts/eval/write_eval_summary.py",
      "--prompt-regression",
      promptPath,
      "--tool-json",
      toolPath,
      "--retrieval",
      retrievalPath,
      "--latency",
      latencyPath,
      "--memory",
      memoryPath,
      "--baseline",
      baselinePath,
      "--output",
      outputPath,
    ]);

    const summary = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
    expect(summary.status).toBe("pass");
    expect(summary.regressions).toHaveLength(0);
  });
});
