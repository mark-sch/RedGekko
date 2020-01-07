module.exports = class Ticker {
  constructor(exchange, symbol, time, bid, ask, isEstimated = false) {
    this.exchange = exchange;
    this.symbol = symbol;
    this.time = time;
    this.bid = bid;
    this.ask = ask;
    this.createdAt = new Date();
    this.isEstimated = isEstimated;
  }
};
