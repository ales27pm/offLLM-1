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

async function directoryHasArtifacts(dir) {
  const visited = new Set();
  let queue = [dir];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    let entries;
    try {
      entries = await RNFS.readDir(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = entry.name.split(".").pop()?.toLowerCase();
        if (ext && VALID_EXTENSIONS.has(ext)) {
          return true;
        }
      } else if (entry.isDirectory()) {
        queue.push(entry.path);
      }
    }
  }
  return false;
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
  if (await directoryHasArtifacts(targetDir)) {
    onProgress?.(1);
    return targetDir;
  }

  const metadata = await fetchModelMetadata(repoId);
  const siblings = metadata?.siblings ?? [];
  const files = siblings
    .map((s) => s?.rfilename)
    .filter(Boolean)
    // Avoid downloading large training checkpoints; keep to Core ML/weights files.
    .filter(
      (name) =>
        VALID_EXTENSIONS.has(name.split(".").pop()?.toLowerCase() ?? "") ||
        name.endsWith("coreml_artifacts.json") ||
        name.endsWith(".json") ||
        name.toLowerCase().endsWith("readme.md"),
    );

  if (!files.length) {
    throw new Error(`No downloadable files found for ${repoId}`);
  }

  let completed = 0;
  for (const file of files) {
    const dest = `${targetDir}/${file}`;
    if (await RNFS.exists(dest)) {
      completed += 1;
      onProgress?.(completed / files.length);
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
  }

  if (!(await directoryHasArtifacts(targetDir))) {
    throw new Error(
      `Downloaded files for ${repoId} but no Core ML artifacts were detected`,
    );
  }

  return targetDir;
}

export default ensureHuggingFaceRepoDownloaded;
