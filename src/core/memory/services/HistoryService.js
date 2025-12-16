export default class HistoryService {
  constructor(maxEntries = 20) {
    this.max = maxEntries;
    this.history = [];
  }

  add(entry) {
    this.history.push(entry);
    if (this.history.length > this.max) {
      this.history = this.history.slice(-this.max);
    }
  }

  getAll() {
    return this.history;
  }
}



