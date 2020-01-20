const BinanceFutures = require('./binance_futures');

module.exports = class BinanceFuturesTestnet extends BinanceFutures {
  getName() {
    return 'binance_futures_testnet';
  }

  getBaseUrl() {
    return 'https://testnet.binancefuture.com';
  }

  getBaseWebsocketUrl() {
    return 'wss://stream.binancefuture.com';
  }
};
