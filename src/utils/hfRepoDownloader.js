import RNFS from "react-native-fs";

const HF_API_ROOT = "https://huggingface.co/api/models";
const HF_RESOLVE_ROOT = "https://huggingface.co";
const VALID_EXTENSIONS = new Set([
  "mlpackage",
  "mlmodel",
  "mlmodelc",
  "mlx",
  "gguf",
  "safetensors",
  "bin",
]);
const ALLOWED_JSON_FILENAMES = new Set([
  "coreml_artifacts.json",
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "generation_config.json",
  "special_tokens_map.json",
]);

async function fetchModelMetadata(repoId) {
  const url = `${HF_API_ROOT}/${encodeURIComponent(repoId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch model metadata: ${response.status}`);
  }
  return await response.json();
}

function sanitizePathSegment(segment) {
  return segment.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildTargetDir(repoId, targetRoot) {
  const safeRepo = repoId
    .split("/")
    .map((part) => sanitizePathSegment(part))
    .join("/");
  return `${targetRoot}/${safeRepo}`;
}

function isArtifactFile(name) {
  const lowerName = name.toLowerCase();
  const ext = lowerName.split(".").pop() ?? "";
  return (
    VALID_EXTENSIONS.has(ext) ||
    ALLOWED_JSON_FILENAMES.has(lowerName) ||
    lowerName.endsWith("readme.md")
  );
}

async function ensureParentDir(path) {
  const parts = path.split("/");
  parts.pop();
  const parent = parts.join("/");
  if (parent && !(await RNFS.exists(parent))) {
    await RNFS.mkdir(parent);
  }
}

async function downloadFile(fromUrl, toFile) {
  await ensureParentDir(toFile);
  const result = await RNFS.downloadFile({
    fromUrl,
    toFile,
  }).promise;
  if (result.statusCode && result.statusCode >= 400) {
    throw new Error(`Download failed (${result.statusCode}) for ${fromUrl}`);
  }
}

export async function ensureHuggingFaceRepoDownloaded(
  repoId,
  {
    revision = "main",
    targetRoot = `${RNFS.DocumentDirectoryPath}/Models`,
    onProgress,
  } = {},
) {
  if (!repoId) {
    throw new Error("repoId is required");
  }

  const targetDir = buildTargetDir(repoId, targetRoot);

  const metadata = await fetchModelMetadata(repoId);
  const siblings = metadata?.siblings ?? [];
  const files = siblings
    .map((s) => s?.rfilename)
    .filter(Boolean)
    // Avoid downloading large training checkpoints; keep to Core ML/weights files.
    .filter((name) => isArtifactFile(name));

  if (!files.length) {
    throw new Error(`No downloadable files found for ${repoId}`);
  }

  for (const file of files) {
    const dest = `${targetDir}/${file}`;
    if (await RNFS.exists(dest)) {
      onProgress?.(1);
      return targetDir;
    }
  }

  let completed = 0;
  let downloadedAnyArtifact = false;
  for (const file of files) {
    const dest = `${targetDir}/${file}`;
    if (await RNFS.exists(dest)) {
      completed += 1;
      onProgress?.(completed / files.length);
      downloadedAnyArtifact = downloadedAnyArtifact || isArtifactFile(file);
      continue;
    }
    const encoded = file
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = `${HF_RESOLVE_ROOT}/${repoId}/resolve/${encodeURIComponent(revision)}/${encoded}`;
    await downloadFile(url, dest);
    completed += 1;
    onProgress?.(completed / files.length);
    downloadedAnyArtifact = downloadedAnyArtifact || isArtifactFile(file);
  }

  if (!downloadedAnyArtifact) {
    throw new Error(
      `Downloaded files for ${repoId} but no MLX/Core ML artifacts were detected (supported extensions: .safetensors, .gguf, .mlx, .mlpackage, .mlmodel, .mlmodelc; metadata: ${[
        ...ALLOWED_JSON_FILENAMES,
      ].join(", ")})`,
    );
  }

  return targetDir;
}

export default ensureHuggingFaceRepoDownloaded;
