import SQLite from "react-native-sqlite-storage";
import { cosineSimilarity } from "./vectorUtils";
import EncryptionService from "../services/encryption";
import { getEnv } from "../config";
import { Buffer } from "buffer";

const HNSW_DEFAULTS = {
  m: 16,
  mMax: 16,
  mMax0: 32,
  efConstruction: 100,
  efSearch: 50,
};

class MaxHeap {
  constructor() {
    this.h = [];
  }
  size() {
    return this.h.length;
  }
  peek() {
    return this.h[0];
  }
  push(item) {
    this.h.push(item);
    this._up(this.h.length - 1);
  }
  pop() {
    if (!this.h.length) return null;
    const top = this.h[0];
    const last = this.h.pop();
    if (this.h.length && last) {
      this.h[0] = last;
      this._down(0);
    }
    return top;
  }
  toArray() {
    return this.h.slice();
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p].priority >= this.h[i].priority) break;
      [this.h[p], this.h[i]] = [this.h[i], this.h[p]];
      i = p;
    }
  }
  _down(i) {
    for (;;) {
      const l = i * 2 + 1,
        r = l + 1;
      let m = i;
      if (l < this.h.length && this.h[l].priority > this.h[m].priority) m = l;
      if (r < this.h.length && this.h[r].priority > this.h[m].priority) m = r;
      if (m === i) break;
      [this.h[m], this.h[i]] = [this.h[i], this.h[m]];
      i = m;
    }
  }
}

class MinHeap {
  constructor() {
    this.h = [];
  }
  size() {
    return this.h.length;
  }
  peek() {
    return this.h[0];
  }
  push(item) {
    this.h.push(item);
    this._up(this.h.length - 1);
  }
  pop() {
    if (!this.h.length) return null;
    const top = this.h[0];
    const last = this.h.pop();
    if (this.h.length && last) {
      this.h[0] = last;
      this._down(0);
    }
    return top;
  }
  toArray() {
    return this.h.slice();
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p].priority <= this.h[i].priority) break;
      [this.h[p], this.h[i]] = [this.h[i], this.h[p]];
      i = p;
    }
  }
  _down(i) {
    for (;;) {
      const l = i * 2 + 1,
        r = l + 1;
      let m = i;
      if (l < this.h.length && this.h[l].priority < this.h[m].priority) m = l;
      if (r < this.h.length && this.h[r].priority < this.h[m].priority) m = r;
      if (m === i) break;
      [this.h[m], this.h[i]] = [this.h[i], this.h[m]];
      i = m;
    }
  }
}

export class HNSWVectorStore {
  constructor() {
    this.db = null;
    this.initialized = false;
    this.config = { ...HNSW_DEFAULTS };
    this.index = { entryPoint: null, maxLayer: 0, layers: [] };
    this.nodeMap = new Map();
    const key =
      getEnv("MEMORY_ENCRYPTION_KEY") || "default-dev-key-32-bytes-long-0000";
    this.crypto = new EncryptionService(Buffer.from(key.padEnd(32).slice(0, 32)));
  }

  async initialize(config = {}) {
    if (this.initialized) return;
    this.config = { ...this.config, ...config };
    this.db = await SQLite.openDatabase({ name: "hnsw.db", location: "default" });
    await this.db.executeSql("PRAGMA foreign_keys = ON;");
    await this._createTables();
    await this._loadIndex();
    this.initialized = true;
  }

  async _createTables() {
    await this.db.executeSql(
      "CREATE TABLE IF NOT EXISTS vectors (id INTEGER PRIMARY KEY, content TEXT, metadata TEXT)",
    );
    await this.db.executeSql(
      "CREATE TABLE IF NOT EXISTS vector_data (id INTEGER PRIMARY KEY, vector BLOB)",
    );
    await this.db.executeSql(
      "CREATE TABLE IF NOT EXISTS hnsw_layers (layer INTEGER, node_id INTEGER, connections TEXT, PRIMARY KEY (layer, node_id))",
    );
    await this.db.executeSql(
      "CREATE TABLE IF NOT EXISTS hnsw_config (key TEXT PRIMARY KEY, value TEXT)",
    );
  }

  async _loadIndex() {
    const [cfg] = await this.db.executeSql("SELECT * FROM hnsw_config");
    cfg.rows.raw().forEach((row) => {
      if (row.key === "entryPoint")
        this.index.entryPoint = row.value ? parseInt(row.value) : null;
      if (row.key === "maxLayer") this.index.maxLayer = parseInt(row.value) || 0;
    });
    this.index.layers = new Array(this.index.maxLayer + 1)
      .fill(0)
      .map(() => new Map());
    const [layers] = await this.db.executeSql("SELECT * FROM hnsw_layers");
    layers.rows.raw().forEach((row) => {
      const l = parseInt(row.layer);
      if (!this.index.layers[l]) this.index.layers[l] = new Map();
      this.index.layers[l].set(parseInt(row.node_id), JSON.parse(row.connections));
    });
    if (this.nodeMap.size === 0) await this._loadNodeMap();
  }

  async _loadNodeMap() {
    const [res] = await this.db.executeSql(
      "SELECT v.id, v.content, v.metadata, vd.vector FROM vectors v JOIN vector_data vd ON v.id = vd.id",
    );
    res.rows.raw().forEach((row) => {
      try {
        const content = this.crypto.decrypt(Buffer.from(row.content, "base64"));
        const metadata = JSON.parse(
          this.crypto.decrypt(Buffer.from(row.metadata, "base64")),
        );
        const vector = new Float32Array(new Uint8Array(row.vector).buffer);
        this.nodeMap.set(row.id, { content, metadata, vector: Array.from(vector) });
      } catch (error) {
        console.warn("Failed to decrypt cached vector", error);
      }
    });
  }

  _randomLevel() {
    const invLogM = 1.0 / Math.log(this.config.m);
    return Math.floor(-Math.log(Math.random()) * invLogM);
  }

  async addVector(content, vector, metadata = {}) {
    if (!this.initialized) await this.initialize();
    const encContent = this.crypto.encrypt(content).toString("base64");
    const encMeta = this.crypto.encrypt(JSON.stringify(metadata)).toString("base64");
    const [res] = await this.db.executeSql(
      "INSERT INTO vectors (content, metadata) VALUES (?, ?)",
      [encContent, encMeta],
    );
    const id = res.insertId;
    const buf = new ArrayBuffer(vector.length * 4);
    new Float32Array(buf).set(vector);
    await this.db.executeSql("INSERT INTO vector_data (id, vector) VALUES (?, ?)", [
      id,
      new Uint8Array(buf),
    ]);
    this.nodeMap.set(id, { content, metadata, vector });
    await this._insert(id, vector);
    return id;
  }

  async _insert(id, vector) {
    const level = this._randomLevel();
    if (this.index.entryPoint === null) {
      this.index.entryPoint = id;
      this.index.maxLayer = level;
      this.index.layers = new Array(level + 1).fill(0).map(() => new Map());
      for (let l = 0; l <= level; l++) this.index.layers[l].set(id, []);
      await this._saveConfig();
      return;
    }

    // Ensure layers array is big enough
    while (this.index.layers.length <= level) {
      this.index.layers.push(new Map());
    }

    let ep = this.index.entryPoint;
    const curMax = this.index.maxLayer;
    for (let l = curMax; l > level; l--) ep = this._greedySearchLayer(vector, ep, l);

    const upper = Math.min(level, curMax);
    for (let l = upper; l >= 0; l--) {
      const candidates = this._searchLayerEF(vector, ep, l, this.config.efConstruction);
      const M = l === 0 ? this.config.mMax0 : this.config.mMax;
      const selected = this._selectNeighbors(vector, candidates, M);
      await this._connectBidirectional(id, l, selected, M);
      if (selected.length) ep = selected[0];
    }

    if (level > curMax) {
      for (let l = curMax + 1; l <= level; l++) {
        if (!this.index.layers[l]) this.index.layers[l] = new Map();
        this.index.layers[l].set(id, []);
      }
      this.index.entryPoint = id;
      this.index.maxLayer = level;
      await this._saveConfig();
    }
  }

  _greedySearchLayer(qv, entryId, layer) {
    let curr = entryId;
    let changed = true;
    while (changed) {
      changed = false;
      const currNode = this.nodeMap.get(curr);
      if (!currNode) break;
      let currSim = cosineSimilarity(qv, currNode.vector);
      const nbrs = this._getConnections(layer, curr);
      for (const n of nbrs) {
        const nn = this.nodeMap.get(n);
        if (!nn) continue;
        const sim = cosineSimilarity(qv, nn.vector);
        if (sim > currSim) {
          currSim = sim;
          curr = n;
          changed = true;
        }
      }
    }
    return curr;
  }

  _searchLayerEF(qv, entryId, layer, ef) {
    const visited = new Set([entryId]);
    const candidates = new MaxHeap();
    const results = new MinHeap();
    const entry = this.nodeMap.get(entryId);
    if (!entry) return [];
    const entrySim = cosineSimilarity(qv, entry.vector);
    candidates.push({ value: entryId, priority: entrySim });
    results.push({ value: entryId, priority: entrySim });

    while (candidates.size()) {
      const curr = candidates.pop();
      if (!curr) break;
      const worst = results.peek();
      if (worst && results.size() >= ef && curr.priority < worst.priority) break;
      const nbrs = this._getConnections(layer, curr.value);
      for (const n of nbrs) {
        if (visited.has(n)) continue;
        visited.add(n);
        const nn = this.nodeMap.get(n);
        if (!nn) continue;
        const sim = cosineSimilarity(qv, nn.vector);
        const worst2 = results.peek();
        if (results.size() < ef || (worst2 && sim > worst2.priority)) {
          candidates.push({ value: n, priority: sim });
          results.push({ value: n, priority: sim });
          if (results.size() > ef) results.pop();
        }
      }
    }
    return results
      .toArray()
      .sort((a, b) => b.priority - a.priority)
      .map((x) => x.value);
  }

  async _searchLayer(queryVector, entryId, layer, ef) {
    if (!this.nodeMap.has(entryId)) return [];
    return this._searchLayerEF(queryVector, entryId, layer, ef);
  }

  _selectNeighbors(qv, candidateIds, M) {
    const scored = [];
    for (const id of candidateIds) {
      const node = this.nodeMap.get(id);
      if (!node) continue;
      scored.push({ id, sim: cosineSimilarity(qv, node.vector) });
    }
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, M).map((s) => s.id);
  }

  _selectNeighborsFromIds(baseId, candidateIds, M) {
    const base = this.nodeMap.get(baseId);
    if (!base) return candidateIds.slice(0, M);
    return this._selectNeighbors(base.vector, candidateIds, M);
  }

  _getConnections(layer, nodeId) {
    const m = this.index.layers[layer];
    return m ? m.get(nodeId) || [] : [];
  }

  async _setConnections(layer, nodeId, conns) {
    if (!this.index.layers[layer]) this.index.layers[layer] = new Map();
    this.index.layers[layer].set(nodeId, conns);
    await this.db.executeSql(
      "INSERT OR REPLACE INTO hnsw_layers (layer, node_id, connections) VALUES (?, ?, ?)",
      [layer, nodeId, JSON.stringify(conns)],
    );
  }

  async _connectBidirectional(nodeId, layer, neighbors, maxM) {
    if (!this.index.layers[layer]) this.index.layers[layer] = new Map();
    if (!this.index.layers[layer].has(nodeId)) await this._setConnections(layer, nodeId, []);
    await this._setConnections(layer, nodeId, neighbors);

    // Reverse links
    for (const n of neighbors) {
      const existing = this._getConnections(layer, n).slice();
      if (!existing.includes(nodeId)) existing.push(nodeId);
      const pruned = this._selectNeighborsFromIds(n, existing, maxM);
      await this._setConnections(layer, n, pruned);
    }

    // IMPORTANT: Prune self (nodeId) after reciprocal connections to ensure maxM compliance
    const selfConns = this._getConnections(layer, nodeId).slice();
    if (selfConns.length > maxM) {
      const selfPruned = this._selectNeighborsFromIds(nodeId, selfConns, maxM);
      await this._setConnections(layer, nodeId, selfPruned);
    }
  }

  async searchVectors(queryVector, limit = 5) {
    if (!this.initialized) await this.initialize();
    if (this.index.entryPoint === null) return [];
    let ep = this.index.entryPoint;
    for (let l = this.index.maxLayer; l > 0; l--) {
      ep = this._greedySearchLayer(queryVector, ep, l);
    }
    const ids = this._searchLayerEF(queryVector, ep, 0, this.config.efSearch);
    return ids
      .map((id) => {
        const node = this.nodeMap.get(id);
        return node
          ? { id, ...node, similarity: cosineSimilarity(queryVector, node.vector) }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async _saveConfig() {
    await this.db.executeSql(
      "INSERT OR REPLACE INTO hnsw_config (key, value) VALUES (?, ?)",
      ["entryPoint", String(this.index.entryPoint)],
    );
    await this.db.executeSql(
      "INSERT OR REPLACE INTO hnsw_config (key, value) VALUES (?, ?)",
      ["maxLayer", String(this.index.maxLayer)],
    );
  }
}
