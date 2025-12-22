import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const writeTelemetry = (dir) => {
  const events = [
    {
      schema_version: "telemetry_v2",
      event_type: "prompt_received",
      timestamp: "2025-01-01T00:00:00Z",
      prompt_id: "runtime_prompt",
      prompt_version: "v1",
      model_id: "model-test",
      tool_calls: [],
      retrieval_hits: [],
      outcome: "received",
      latency: 0,
      redaction_applied: false,
      prompt_hash: "sha256_prompt",
      prompt_preview: "Open https://example.com",
    },
    {
      schema_version: "telemetry_v2",
      event_type: "tool_invocation",
      timestamp: "2025-01-01T00:00:01Z",
      prompt_id: "runtime_prompt",
      prompt_version: "v1",
      model_id: "model-test",
      tool_calls: [
        {
          name: "open_url",
          args: { url: "https://example.com" },
          success: true,
          error: null,
        },
      ],
      retrieval_hits: [],
      outcome: "success",
      latency: 12,
      redaction_applied: false,
      prompt_hash: "sha256_prompt",
      tool_name: "open_url",
      tool_args_preview: { url: "https://example.com" },
      success: true,
      error: null,
    },
    {
      schema_version: "telemetry_v2",
      event_type: "retrieval",
      timestamp: "2025-01-01T00:00:02Z",
      prompt_id: "runtime_prompt",
      prompt_version: "v1",
      model_id: "model-test",
      tool_calls: [],
      retrieval_hits: ["doc-1", "doc-2"],
      outcome: "retrieved",
      latency: 7,
      redaction_applied: false,
      query_hash: "sha256_query",
      query_preview: "example query",
      retrieval_trace: {
        candidate_ids: ["doc-1", "doc-3", "doc-2"],
        candidate_scores: [0.9, 0.8, 0.7],
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
    expect(triple.hard_negative).toBe("doc-3");
  });
});
