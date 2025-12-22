import {
  chunkText,
  DEFAULT_CHUNKING_OPTIONS,
} from "../../../retrieval/chunking";

export default class VectorIndexer {
  constructor(vectorStore, llmService) {
    this.store = vectorStore;
    this.llm = llmService;
    this.initialized = false;
  }

  async _ensureInit() {
    if (!this.initialized) {
      await this.store.initialize();
      this.initialized = true;
    }
  }

  async index(user, assistant, tools = []) {
    await this._ensureInit();
    const content = `User: ${user}\nAssistant: ${assistant}`;
    const chunks = chunkText(content, DEFAULT_CHUNKING_OPTIONS);
    const totalChunks = chunks.length || 1;
    for (let index = 0; index < totalChunks; index += 1) {
      const chunk = chunks[index];
      const embedding = await this.llm.embed(chunk);
      await this.store.addVector(chunk, embedding, {
        user,
        assistant,
        tools,
        chunk_index: index,
        chunk_total: totalChunks,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
