const moment = require('moment');
const FastHedgedOrders = require('../orders/fast_hedged_orders');
var me;

module.exports = class CreateOrderListener {
  
  constructor(tickers, orderExecutor, exchangeManager, logger) {
    this.tickers = tickers;
    this.orderExecutor = orderExecutor;
    this.exchangeManager = exchangeManager;
    this.logger = logger;
    me = this;

    this.fastHedgedOrders = new FastHedgedOrders(this.tickers, this.orderExecutor, this.exchangeManager);
  }


  async syncAndCheckHedge(opportunity, counter) {
    let hedgeCompleted = false;
    console.log(new Date().getTime() + ' *** syncAndCheckHedge', counter);
    
    hedgeCompleted = await me.fastHedgedOrders.checkFilledHedgeOrders(opportunity);

    if (hedgeCompleted) {
      opportunity.hPair.order.signal = "none";
      opportunity.hPair.order.hedgeCompleted = true;
      console.log('*** Creating hedged orders completed successfully!');
      return;
    }
    
    if (hedgeCompleted == false && counter >= 5) {
      console.log('*** Error creating hedged orders: Orders did not fill in time.');
    }
    else {
      setTimeout(me.syncAndCheckHedge, 4000, opportunity, ++counter);
    }
  }


  async syncAndCheckCloseHedge(opportunity, counter) {
    let hedgeCloseCompleted = false;
    console.log(new Date().getTime() + ' *** syncAndCheckCloseHedge', counter);
    
    hedgeCloseCompleted = await me.fastHedgedOrders.checkClosedHedgeOrders(opportunity);

    if (hedgeCloseCompleted) {
      opportunity.hPair.order.signal = "none";
      opportunity.hPair.order.hedgeCloseCompleted = true;
      console.log('*** Closing hedged orders completed successfully!');
      return;
    }
    
    if (hedgeCloseCompleted == false && counter >= 5) {
      console.log('*** Error closing hedged orders: Orders did not fill in time.');
    }
    else {
      setTimeout(me.syncAndCheckCloseHedge, 4000, opportunity, ++counter);
    }
  }


  async onCreateHedgedOrders(opportunity) {
    let longPair = opportunity.hPair.long.pair.split('#');
    let shortPair = opportunity.hPair.short.pair.split('#');
    
    if (longPair.length !== 2 && shortPair.length !== 2) {
      console.log('*** Create Hedged Orders: Invalid order pairs!');
      return;
    }

    let exchange1 =  this.exchangeManager.get(longPair[0]);
    let exchange2 =  this.exchangeManager.get(shortPair[0]);
    if (exchange1.ConnectionHealth != "Good" || exchange2.ConnectionHealth != "Good") {
      console.log("*** ATTENTION: Bad exchange connectivity, SKIPPING CREATE order!", exchange1.getName(), exchange1.pingPongDelay + 'ms', exchange1.ConnectionHealth, '/ ', exchange2.getName(), exchange2.pingPongDelay + 'ms', exchange2.ConnectionHealth);
      setTimeout(() => { opportunity.hPair.order.signal = "none" }, 5000);
      return;
    }

    this.logger.debug(new Date().getTime() + ' *** Creating Hedged Orders:', opportunity.hPair.long.pair, opportunity.hPair.short.pair);
    console.log(new Date().getTime() + ' *** Creating Hedged Orders:', opportunity.hPair.long.pair, opportunity.hPair.short.pair);

    let cfgAmount = opportunity.hPair.order.amount;

    // create order
    try {
      let amount = opportunity.hPair.order.inverse ? cfgAmount * -1 : cfgAmount;
      opportunity.hPair.order.long.status = 'Opening';
      let order = { amount: amount, price: opportunity.hPair.order.long.foundPrice };
      opportunity.hPair.order.long.latencyCreate = exchange1.pingPongDelay;
      this.fastHedgedOrders.createMarketOrder(opportunity.hPair.long.pair, order).then(result => {
        opportunity.hPair.order.long.idCreate = result.id;
        opportunity.hPair.order.long.execDurationCreate = result.execDuration;
      });
    } catch (e) {
      console.log('Error creating first order, aborting: ', e);
      return;
    }

    // create hedged order
    try {
      let amount = opportunity.hPair.order.inverse ? cfgAmount : cfgAmount * -1;
      opportunity.hPair.order.short.status = 'Opening';
      opportunity.hPair.order.short.latencyCreate = exchange2.pingPongDelay;
      this.fastHedgedOrders.createMarketOrder(opportunity.hPair.short.pair, { amount: amount, price: opportunity.hPair.order.short.foundPrice }).then(result => {
        opportunity.hPair.order.short.idCreate = result.id;
        opportunity.hPair.order.short.execDurationCreate = result.execDuration;
      });
    } catch (e) {
      console.log('Error creating second order, aborting: ', e);
      // todo: cancel first order
      return;
    }

    this.logger.debug(`${new Date().getTime()} *** Both hedged order creations fired`);
    console.log(`${new Date().getTime()} *** Both hedged order creations fired`);
    setTimeout(me.syncAndCheckHedge, 1000, opportunity, 1);
  }


  async onCloseHedgedOrders(opportunity) {
    let longPair = opportunity.hPair.long.pair.split('#');
    let shortPair = opportunity.hPair.short.pair.split('#');
    
    if (longPair.length !== 2 && shortPair.length !== 2) {
      console.log('*** Close Hedged Orders: Invalid order pairs!');
      return;
    }

    let exchange1 =  this.exchangeManager.get(longPair[0]);
    let exchange2 =  this.exchangeManager.get(shortPair[0]);
    if (exchange1.ConnectionHealth != "Good" && exchange2.ConnectionHealth != "Good") {
      console.log("*** ATTENTION: Bad exchange connectivity, SKIPPING CLOSE order!", exchange1.getName(), exchange1.pingPongDelay + 'ms', exchange1.ConnectionHealth, '/ ', exchange2.getName(), exchange2.pingPongDelay + 'ms', exchange2.ConnectionHealth);
      setTimeout(() => { opportunity.hPair.order.signal = "none" }, 5000);
      return;
    }

    this.logger.debug(new Date().getTime() + ' *** Closing Hedged Orders:', opportunity.hPair.long.pair, opportunity.hPair.short.pair);
    console.log(new Date().getTime() + ' *** Closing Hedged Orders:', opportunity.hPair.long.pair, opportunity.hPair.short.pair);

    // close order
    try {
      let amount = opportunity.hPair.order.long.amount * -1;
      opportunity.hPair.order.long.status = 'Closing';
      opportunity.hPair.order.long.latencyClose = exchange1.pingPongDelay;
      this.fastHedgedOrders.createMarketOrder(opportunity.hPair.long.pair, { amount: amount, price: 1 }).then(result => {
        opportunity.hPair.order.long.idClose = result.id;
        opportunity.hPair.order.long.execDurationClose = result.execDuration;
      });
    } catch (e) {
      console.log('Error closing first order, aborting: ', e);
      return;
    }

    // close hedged order
    try {
      let amount = opportunity.hPair.order.short.amount * -1;
      opportunity.hPair.order.short.status = 'Closing';
      opportunity.hPair.order.short.latencyClose = exchange2.pingPongDelay;
      this.fastHedgedOrders.createMarketOrder(opportunity.hPair.short.pair, { amount: amount, price: 1 }).then(result => {
        opportunity.hPair.order.short.idClose = result.id;
        opportunity.hPair.order.short.execDurationClose = result.execDuration;
      });
    } catch (e) {
      console.log('Error closing second order, aborting: ', e);
      // todo: cancel first order
      return;
    }

    this.logger.debug(`${new Date().getTime()} *** Both hedged order closings fired`);
    console.log(`${new Date().getTime()} *** Both hedged order closings fired`);
    setTimeout(me.syncAndCheckCloseHedge, 1000, opportunity, 1);
  }


  async onCreateOrder(orderEvent) {
    this.logger.debug(`Create Order:${JSON.stringify(orderEvent)}`);

    const exchange = this.exchangeManager.get(orderEvent.exchange);
    if (!exchange) {
      console.log(`order: unknown exchange:${orderEvent.exchange}`);
      return;
    }

    // filter same direction
    const ordersForSymbol = (await exchange.getOrdersForSymbol(orderEvent.order.symbol)).filter(order => {
      return order.side === orderEvent.order.side;
    });

    if (ordersForSymbol.length === 0) {
      this.triggerOrder(exchange, orderEvent.order);
      return;
    }

    this.logger.debug(`Info Order update:${JSON.stringify(orderEvent)}`);

    const currentOrder = ordersForSymbol[0];

    if (currentOrder.side !== orderEvent.order.side) {
      console.log('order side change');
      return;
    }

    exchange
      .updateOrder(currentOrder.id, orderEvent.order)
      .then(order => {
        console.log(`OderUpdate:${JSON.stringify(order)}`);
      })
      .catch(() => {
        console.log('order update error');
      });
  }

  triggerOrder(exchange, order, retry = 0) {
    if (retry > 3) {
      console.log(`Retry limit stop creating order: ${JSON.stringify(order)}`);
      return;
    }

    if (retry > 0) {
      console.log(`Retry (${retry}) creating order: ${JSON.stringify(order)}`);
    }

    exchange
      .order(order)
      .then(order => {
        if (order.status === 'rejected') {
          setTimeout(() => {
            console.log(`Order rejected: ${JSON.stringify(order)}`);
            this.triggerOrder(exchange, order, retry + 1);
          }, 1500);

          return;
        }

        console.log(`Order created: ${JSON.stringify(order)}`);
      })
      .catch(e => {
        console.log(e);
        console.log(`Order create error: ${JSON.stringify(e)} - ${JSON.stringify(order)}`);
      });
  }
};
