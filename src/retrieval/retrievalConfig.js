const DEFAULT_RETRIEVAL_CONFIG = Object.freeze({
  chunking: {
    maxChars: 1200,
    overlap: 150,
  },
  search: {
    topK: 6,
    minScore: 0.0,
  },
  embedding: {
    modelId: "llm2vec-or-local-embedder",
    dim: 768,
    normalize: true,
  },
});

export { DEFAULT_RETRIEVAL_CONFIG };
