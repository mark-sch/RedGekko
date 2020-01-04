const Bybit = require('./bybit');

module.exports = class BybitTestnet extends Bybit {
  getName() {
    return 'bybit_testnet';
  }

  getBaseUrl() {
    return 'https://api-testnet.bybit.com';
  }

  getWssUrl() {
    return 'wss://stream-testnet.bybit.com/realtime';
  }
};
