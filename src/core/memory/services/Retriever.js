import {
  buildRetrievalEvent,
  logTelemetryEvent,
} from "../../../utils/telemetry";

export default class Retriever {
  constructor(vectorStore, llmService, attentionFn) {
    this.store = vectorStore;
    this.llm = llmService;
    this.attention = attentionFn;
    this.initialized = false;
  }

  async _ensureInit() {
    if (!this.initialized) {
      await this.store.initialize();
      this.initialized = true;
    }
  }

  async retrieve(query, maxResults = 5) {
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
      void logTelemetryEvent(
        buildRetrievalEvent({
          query,
          resultIds: [],
          maxResults,
          latencyMs: Date.now() - startTime,
          candidateIds,
          candidateScores,
          modelId:
            typeof this.llm.getModelId === "function"
              ? this.llm.getModelId()
              : "unknown",
        }),
      );
      return [];
    }

    const indices = this.attention(
      qEmb,
      items.map((i) => i.emb),
      { numClusters: 3, topK: Math.min(2, items.length) },
    );
    const selected = indices.map((i) => items[i]);

    void logTelemetryEvent(
      buildRetrievalEvent({
        query,
        resultIds: selected.map((item) => item.id),
        maxResults,
        latencyMs: Date.now() - startTime,
        candidateIds,
        candidateScores,
        modelId:
          typeof this.llm.getModelId === "function"
            ? this.llm.getModelId()
            : "unknown",
      }),
    );

    return selected.map((item) => ({ role: "context", content: item.content }));
  }
}
