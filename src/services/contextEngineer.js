import { chunkText } from "../retrieval/chunking";
import { DEFAULT_RETRIEVAL_CONFIG } from "../retrieval/retrievalConfig";

const buildChunksFromDocs = async (docs, cfg) => {
  const out = [];
  for (const doc of docs || []) {
    const text = String(doc.text || "");
    const chunks = chunkText(text, cfg.chunking);
    for (let i = 0; i < chunks.length; i += 1) {
      out.push({
        doc_id: String(doc.id || doc.doc_id || "unknown"),
        chunk_id: `${String(doc.id || "unknown")}#${i}`,
        text: chunks[i],
      });
    }
  }
  return out;
};

export async function retrieveContext(query, docs, opts = {}) {
  const cfg = opts.config || DEFAULT_RETRIEVAL_CONFIG;
  const telemetry = opts.telemetry || null;
  const promptCtx = opts.promptCtx || null;
  const convoCtx = opts.convoCtx || null;

  const chunks = await buildChunksFromDocs(docs || [], cfg);

  let hits;
  if (typeof opts.retriever === "function") {
    hits = await opts.retriever(String(query || ""), chunks, cfg);
  } else {
    const q = String(query || "").toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    hits = chunks
      .map((chunk) => {
        const t = chunk.text.toLowerCase();
        let score = 0;
        for (const tok of tokens) {
          if (t.includes(tok)) score += 1;
        }
        return { ...chunk, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.search.topK);
  }

  const filtered = (hits || []).filter(
    (hit) => (hit.score || 0) >= cfg.search.minScore,
  );

  if (telemetry && typeof telemetry.event === "function") {
    telemetry.event(
      "retrieval_trace",
      {
        query: String(query || ""),
        topK: cfg.search.topK,
        returned: filtered.length,
        hits: filtered.map((hit) => ({
          doc_id: hit.doc_id,
          chunk_id: hit.chunk_id,
          score: hit.score,
        })),
      },
      {
        prompt: promptCtx || undefined,
        conversation: convoCtx || undefined,
      },
    );
  }

  return filtered.map(
    (hit) => `[#${hit.doc_id}:${hit.chunk_id} score=${hit.score}] ${hit.text}`,
  );
}
