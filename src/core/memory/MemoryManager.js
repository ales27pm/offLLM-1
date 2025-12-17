import { HNSWVectorStore } from "../../utils/hnswVectorStore";
import LLMService from "../../services/llmService";
import { applySparseAttention } from "../../utils/sparseAttention";
import VectorIndexer from "./services/VectorIndexer";
import Retriever from "./services/Retriever";
import HistoryService from "./services/HistoryService";

export class MemoryManager {
  constructor({
    vectorStore = new HNSWVectorStore(),
    indexer,
    retriever,
    history,
  } = {}) {
    const store = vectorStore;
    this.indexer = indexer || new VectorIndexer(store, LLMService);
    this.retriever =
      retriever || new Retriever(store, LLMService, applySparseAttention);
    this.history = history || new HistoryService();
  }

  async addInteraction(userPrompt, aiResponse, toolResults = []) {
    await this.indexer.index(userPrompt, aiResponse, toolResults);
    this.history.add({ role: "user", content: userPrompt });
    this.history.add({ role: "assistant", content: aiResponse });
  }

  async retrieve(query, maxResults) {
    return this.retriever.retrieve(query, maxResults);
  }

  getConversationHistory() {
    return this.history.getAll();
  }
}

export default MemoryManager;
