import path from "path";
import { randomBytes } from "crypto";
import { cosineSimilarity } from "../utils/vectorUtils";
import { getEnv } from "../config";
import { runMigrations, CURRENT_VERSION } from "./migrations";
import EncryptionService from "../services/encryption";
import FileStorage from "../services/fileStorage";

export interface MemoryItem {
  id: string;
  vector: number[];
  content: string;
  metadata?: Record<string, any>;
  conversationId?: string;
  timestamp: number;
}

interface StoredData {
  version: number;
  items: MemoryItem[];
}

let cachedEphemeralKey: string | null = null;
let hasWarnedMissingKey = false;

function getKey() {
  const envKey = getEnv("MEMORY_ENCRYPTION_KEY");
  if (!envKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[VectorMemory] MEMORY_ENCRYPTION_KEY is required in production.",
      );
    }
    const shouldWarn = process.env.NODE_ENV !== "test" && !hasWarnedMissingKey;
    if (shouldWarn) {
      console.warn(
        "[VectorMemory] MEMORY_ENCRYPTION_KEY missing; using ephemeral key for development.",
      );
      hasWarnedMissingKey = true;
    }
    if (!cachedEphemeralKey) {
      cachedEphemeralKey = randomBytes(16).toString("hex");
    }
    return cachedEphemeralKey;
  }
  hasWarnedMissingKey = false;
  cachedEphemeralKey = null;
  return envKey.padEnd(32, "0").slice(0, 32);
}

export default class VectorMemory {
  storage: FileStorage;
  crypto: EncryptionService;
  maxBytes: number;
  data: StoredData;

  constructor({
    filePath = path.join(process.cwd(), "vector_memory.dat"),
    maxMB = Number(getEnv("MEMORY_MAX_MB") || "10"),
  } = {}) {
    this.storage = new FileStorage(filePath);
    this.crypto = new EncryptionService(Buffer.from(getKey(), "utf8"));
    this.maxBytes = maxMB * 1024 * 1024;
    this.data = { version: CURRENT_VERSION, items: [] };
  }

  async load() {
    const raw = await this.storage.loadRaw();
    if (raw) {
      const json = this.crypto.decrypt(raw);
      this.data = JSON.parse(json);
      await runMigrations(this.data);
    } else {
      await this._save();
    }
  }

  async remember(items: Omit<MemoryItem, "id" | "timestamp">[]) {
    for (const item of items) {
      let id = randomBytes(8).toString("hex");
      while (this.data.items.some((i) => i.id === id)) {
        id = randomBytes(8).toString("hex");
      }
      this.data.items.push({ ...item, id, timestamp: Date.now() });
    }
    await this._enforceLimits();
    await this._save();
  }

  async recall(
    queryVector: number[],
    k = 5,
    filters?: { conversationId?: string },
  ) {
    const items = this.data.items.filter((i) => {
      if (
        filters?.conversationId &&
        i.conversationId !== filters.conversationId
      )
        return false;
      return true;
    });
    const scored = items.map((i) => ({
      item: i,
      score: cosineSimilarity(queryVector, i.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => ({ ...s.item, score: s.score }));
  }

  async wipe(scope?: { conversationId?: string }) {
    if (!scope) {
      this.data.items = [];
    } else if (scope.conversationId) {
      this.data.items = this.data.items.filter(
        (i) => i.conversationId !== scope.conversationId,
      );
    }
    await this._save();
  }

  async export() {
    return this.storage.exportBase64();
  }

  async import(data: string) {
    await this.storage.importBase64(data);
    await this.load();
  }

  async _enforceLimits() {
    // simple LRU by timestamp
    this.data.items.sort((a, b) => a.timestamp - b.timestamp);
    while (true) {
      const plaintext = JSON.stringify(this.data);
      const encrypted = this.crypto.encrypt(plaintext);
      const size = encrypted.length;
      if (size <= this.maxBytes) break;
      if (this.data.items.length === 0) break;
      this.data.items.shift();
    }
  }

  async _save() {
    const json = JSON.stringify(this.data);
    const encrypted = this.crypto.encrypt(json);
    await this.storage.saveRaw(encrypted);
  }
}



