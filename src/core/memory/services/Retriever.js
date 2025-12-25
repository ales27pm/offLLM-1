export default class Retriever {
  constructor(vectorStore, llmService, attentionFn, opts = {}) {
    this.store = vectorStore;
    this.llm = llmService;
    this.attention = attentionFn;
    this.initialized = false;
    this.telemetry = opts.telemetry || null;
  }

  async _ensureInit() {
    if (!this.initialized) {
      await this.store.initialize();
      this.initialized = true;
    }
  }

  async retrieve(query, maxResults = 5, ctx = {}) {
    await this._ensureInit();
    const startTime = Date.now();
    const qEmb = await this.llm.embed(query);
    const raw = await this.store.searchVectors(qEmb, maxResults * 3);
    const candidateIds = raw.map((item) => item.id);
    const candidateScores = raw.map((item) => item.similarity);
    const items = raw.map((r) => {
      const node = this.store.nodeMap.get(r.id);
      const meta = r.metadata || node?.metadata || {};
      const content =
        node?.content || `User: ${meta.user}\nAssistant: ${meta.assistant}`;
      return {
        id: r.id,
        emb: node?.vector || [],
        content,
      };
    });

    if (!items.length) {
      this._emitTelemetry({
        query,
        maxResults,
        startTime,
        candidateIds,
        candidateScores,
        resultIds: [],
        ctx,
      });
      return [];
    }

    const indices = this.attention(
      qEmb,
      items.map((i) => i.emb),
      { numClusters: 3, topK: Math.min(2, items.length) },
    );
    const selected = indices.map((i) => items[i]);

    this._emitTelemetry({
      query,
      maxResults,
      startTime,
      candidateIds,
      candidateScores,
      resultIds: selected.map((item) => item.id),
      ctx,
    });

    return selected.map((item) => ({ role: "context", content: item.content }));
  }

  _emitTelemetry({
    query,
    maxResults,
    startTime,
    candidateIds,
    candidateScores,
    resultIds,
    ctx,
  }) {
    if (!this.telemetry || typeof this.telemetry.event !== "function") return;

    this.telemetry.event(
      "retrieval_trace",
      {
        query: String(query || ""),
        topK: maxResults,
        returned: resultIds.length,
        latency_ms: Date.now() - startTime,
        hits: resultIds.map((id, idx) => ({
          doc_id: id,
          chunk_id: id,
          score: candidateScores[idx],
        })),
      },
      ctx,
    );
  }
}
