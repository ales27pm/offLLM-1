import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const writeTelemetry = (dir) => {
  const events = [
    {
      event_id: "evt_prompt",
      ts_ms: 1,
      type: "model_interaction",
      app: { name: "offLLM", version: "1.0.0", platform: "test" },
      model: { id: "model-test", runtime: "local", quant: "" },
      prompt: {
        prompt_id: "runtime_system",
        prompt_version: "v1",
        system_hash: "sha256_prompt",
      },
      payload: { phase: "request", user_chars: 24 },
    },
    {
      event_id: "evt_tool",
      ts_ms: 2,
      type: "tool_call",
      app: { name: "offLLM", version: "1.0.0", platform: "test" },
      model: { id: "model-test", runtime: "local", quant: "" },
      prompt: {
        prompt_id: "runtime_system",
        prompt_version: "v1",
        system_hash: "sha256_prompt",
      },
      payload: { tool: "open_url", args: { url: "https://example.com" } },
    },
    {
      event_id: "evt_retrieval",
      ts_ms: 3,
      type: "retrieval_trace",
      app: { name: "offLLM", version: "1.0.0", platform: "test" },
      model: { id: "model-test", runtime: "local", quant: "" },
      prompt: {
        prompt_id: "runtime_system",
        prompt_version: "v1",
        system_hash: "sha256_prompt",
      },
      payload: {
        query: "example query",
        topK: 2,
        returned: 2,
        hits: [
          { doc_id: "doc-1", chunk_id: "doc-1#0", score: 0.9 },
          { doc_id: "doc-2", chunk_id: "doc-2#0", score: 0.3 },
        ],
      },
    },
  ];
  const telemetryPath = path.join(dir, "telemetry.jsonl");
  fs.writeFileSync(
    telemetryPath,
    events.map((event) => `${JSON.stringify(event)}\n`).join(""),
    "utf-8",
  );
  return telemetryPath;
};

describe("telemetry dataset scripts", () => {
  it("builds tool call and retrieval triple datasets from telemetry", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-data-"));
    const telemetryPath = writeTelemetry(tempDir);
    const toolCallsPath = path.join(tempDir, "tool_calls.jsonl");
    const triplesPath = path.join(tempDir, "retrieval_triples.jsonl");

    execFileSync("python", [
      "scripts/mlops/telemetry_to_tool_calls.py",
      "--telemetry",
      telemetryPath,
      "--output",
      toolCallsPath,
      "--strict",
    ]);
    execFileSync("python", [
      "scripts/mlops/telemetry_to_retrieval_triples.py",
      "--telemetry",
      telemetryPath,
      "--output",
      triplesPath,
      "--strict",
    ]);

    const toolCallLines = fs
      .readFileSync(toolCallsPath, "utf-8")
      .trim()
      .split("\n");
    expect(toolCallLines).toHaveLength(1);
    const toolCall = JSON.parse(toolCallLines[0]);
    expect(toolCall.tool_name).toBe("open_url");
    expect(toolCall.tool_args.url).toBe("https://example.com");

    const tripleLines = fs
      .readFileSync(triplesPath, "utf-8")
      .trim()
      .split("\n");
    expect(tripleLines).toHaveLength(1);
    const triple = JSON.parse(tripleLines[0]);
    expect(triple.query).toBe("example query");
    expect(triple.positive).toBe("doc-1");
    expect(triple.hard_negative).toBe("doc-2");
  });
});
