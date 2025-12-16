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
    const embedding = await this.llm.embed(user);
    const content = `User: ${user}\nAssistant: ${assistant}`;
    await this.store.addVector(content, embedding, {
      user,
      assistant,
      tools,
      timestamp: new Date().toISOString(),
    });
  }
}



