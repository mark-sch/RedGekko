module.exports = class OrderbookSnapshots {
    constructor() {
      this.snapshots = {};
    }

    upsert(exchange, pair, ob) {
        this.snapshots[exchange + '#' + pair] = ob;
    }

    getSnapshot(exchange, pair) {
        return this.snapshots[exchange + '#' + pair];
    }

    getAllSnapshots() {
        return this.snapshots;
    }
  };
  