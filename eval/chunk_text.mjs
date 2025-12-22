/* eslint-env node */
/* eslint-disable no-undef */
import { chunkText } from "../src/retrieval/chunking.js";

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const main = async () => {
  const raw = await readStdin();
  if (!raw.trim()) {
    throw new Error("No input provided");
  }
  const payload = JSON.parse(raw);
  const documents = payload.documents || [];
  const options = payload.options || {};
  const results = {};

  documents.forEach((doc) => {
    results[doc.id] = chunkText(doc.text || "", options);
  });

  process.stdout.write(JSON.stringify({ chunks: results }));
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
