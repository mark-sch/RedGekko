const _ = require('lodash');

const Order = require('../../dict/order');

module.exports = class FastHedgedOrders {
  constructor(tickers, orderExecutor, exchangeManager) {
    this.tickers = tickers;
    this.orderExecutor = orderExecutor;
    this.exchangeManager = exchangeManager;
  }

  getOrders(pair) {
    const res = pair.split('.');
    return this.exchangeManager.getOrders(res[0], res[1]);
  }

  async cancel(pair, id) {
    const res = pair.split('.');

    return this.orderExecutor.cancelOrder(res[0], id);
  }

  async cancelAll(pair) {
    const res = pair.split('.');

    const orders = await this.exchangeManager.getOrders(res[0], res[1]);

    for (const order of orders) {
      await this.orderExecutor.cancelOrder(res[0], order.id);
    }
  }

  getTicker(pair) {
    const res = pair.split('.');
    return this.tickers.get(res[0], res[1]);
  }

  async createMarketOrder(pair, order) {
    const res = pair.split('#');

    const exchangeInstance = this.exchangeManager.get(res[0]);

    let orderAmount = parseFloat(order.amount);

    // support inverse contracts
    if (exchangeInstance.isInverseSymbol(res[1])) {
      orderAmount = parseFloat(order.amount_currency);
    }

    const amount = exchangeInstance.calculateAmount(orderAmount, res[1]);
    if (amount) {
      orderAmount = parseFloat(amount);
    }

    let ourOrder;
    ourOrder = Order.createMarketOrder(res[1], orderAmount)

    return this.orderExecutor.executeOrder(res[0], ourOrder);
  }
};
