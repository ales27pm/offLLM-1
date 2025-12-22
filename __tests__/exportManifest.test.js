import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

describe("export manifest writer", () => {
  it("writes manifest with dataset and model hashes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-data-"));
    const datasetPath = path.join(tempDir, "dataset.jsonl");
    fs.writeFileSync(datasetPath, '{"foo":"bar"}\n', "utf-8");
    const modelDir = path.join(tempDir, "model");
    fs.mkdirSync(modelDir);
    fs.writeFileSync(path.join(modelDir, "weights.bin"), "model", "utf-8");

    const manifestPath = path.join(tempDir, "manifest.json");
    execFileSync("python", [
      "scripts/mlops/write_export_manifest.py",
      "--datasets",
      datasetPath,
      "--model-path",
      modelDir,
      "--output",
      manifestPath,
    ]);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.commit_sha).toBeTruthy();
    expect(manifest.dataset_hashes[datasetPath]).toBeTruthy();
    expect(manifest.model_hash).toBeTruthy();
    expect(manifest.model_path).toBe(modelDir);

    execFileSync("python", [
      "scripts/mlops/verify_export_manifest.py",
      "--manifest",
      manifestPath,
      "--model-path",
      modelDir,
    ]);
  });
});
