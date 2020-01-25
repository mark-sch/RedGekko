const moment = require('moment');
const crypto = require('crypto');
const os = require('os');
const obUtil = require('../utils/orderbook_util');
const PositionStateChangeEvent = require('../event/position_state_change_event');

module.exports = class Trade {
  constructor(
    eventEmitter,
    instances,
    notify,
    logger,
    createOrderListener,
    tickListener,
    tickers,
    tickerDatabaseListener,
    exchangeOrderWatchdogListener,
    orderExecutor,
    pairStateExecution,
    systemUtil,
    logsRepository,
    tickerLogRepository,
    exchangePositionWatcher,
    orderbookSnapshots
  ) {
    this.eventEmitter = eventEmitter;
    this.instances = instances;
    this.notify = notify;
    this.logger = logger;
    this.createOrderListener = createOrderListener;
    this.tickListener = tickListener;
    this.tickers = tickers;
    this.tickerDatabaseListener = tickerDatabaseListener;
    this.exchangeOrderWatchdogListener = exchangeOrderWatchdogListener;
    this.orderExecutor = orderExecutor;
    this.pairStateExecution = pairStateExecution;
    this.systemUtil = systemUtil;
    this.logsRepository = logsRepository;
    this.tickerLogRepository = tickerLogRepository;
    this.exchangePositionWatcher = exchangePositionWatcher;
    this.orderbookSnaphots = orderbookSnapshots;
  }

  start() {
    this.logger.debug('Trade module started');

    process.on('SIGINT', async () => {
      // force exit in any case
      setTimeout(() => {
        process.exit();
      }, 7500);

      await this.pairStateExecution.onTerminate();

      process.exit();
    });

    const instanceId = crypto.randomBytes(4).toString('hex');

    const notifyActivePairs = this.instances.symbols
      .filter(symbol => {
        return symbol.state === 'watch';
      })
      .map(symbol => {
        return `${symbol.exchange}.${symbol.symbol}`;
      });

    const message = `Start: ${instanceId} - ${os.hostname()} - ${os.platform()} - ${moment().format()} - ${notifyActivePairs.join(
      ', '
    )}`;

    this.notify.send(message);

    const me = this;
    const { eventEmitter } = this;

    // let the system bootup; eg let the candle be filled by exchanges
    setTimeout(() => {
      console.log('Trade module: warmup done; starting ticks');
      this.logger.info('Trade module: warmup done; starting ticks');

      setInterval(() => {
        eventEmitter.emit('tick', {});
      }, this.systemUtil.getConfig('tick.default', 20100));

      setInterval(() => {
        eventEmitter.emit('orderbook_tick', {});
      }, this.systemUtil.getConfig('tick.orderbook_default', 2000));

      // order create tick
      setInterval(() => {
        eventEmitter.emit('signal_tick', {});
      }, this.systemUtil.getConfig('tick.signal', 10600));

      setInterval(() => {
        eventEmitter.emit('watchdog', {});
      }, this.systemUtil.getConfig('tick.watchdog', 30800));

      setInterval(() => {
        eventEmitter.emit('tick_ordering', {});
      }, this.systemUtil.getConfig('tick.ordering', 10800));
    }, this.systemUtil.getConfig('tick.warmup', 30000));

    // cronjob like tasks
    setInterval(async () => {
      await me.logsRepository.cleanOldLogEntries();
      await me.tickerLogRepository.cleanOldLogEntries();

      me.logger.debug('Logs: Cleanup old entries');
    }, 86455000);

    const { tickers } = this;

    eventEmitter.on('ticker', async function(tickerEvent) {
      tickers.set(tickerEvent.ticker);
      me.tickerDatabaseListener.onTicker(tickerEvent);
    });

    eventEmitter.on('orderbook', function(orderbookEvent) {
      let ob = orderbookEvent.orderbook;
      let bid = Number(ob.bids[0].price);
      let ask = Number(ob.asks[0].price);

      let buySlippage = obUtil.getBuySlippageCurrency(100000, ob);
      let sellSlippage = obUtil.getSellSlippageCurrency(100000, ob);
      let depth = obUtil.depth(ob);
    
      me.orderbookSnaphots.upsert(orderbookEvent.exchange, orderbookEvent.symbol, ob);
      //console.log('Received', orderbookEvent.exchange, 'orderbook data,', orderbookEvent.symbol + '. bid:', bid,'ask:', ask, 'spread:', (((ask-bid)/ask)*100).toFixed(4) +'%,', 'depth:', depth.sellTotalMio + 'M/' + depth.buyTotalMio + 'M', 'sell/buy slippage 100k:', sellSlippage.mySlippage + '%/' + buySlippage.mySlippage +'% (' + sellSlippage.myPrice + ('/' + buySlippage.myPrice + ')'));
    });

    eventEmitter.on('order', async event => me.createOrderListener.onCreateOrder(event));

    eventEmitter.on('createHedgedOrders', async event => me.createOrderListener.onCreateHedgedOrders(event));

    eventEmitter.on('closeHedgedOrders', async event => me.createOrderListener.onCloseHedgedOrders(event));

    eventEmitter.on('tick', async () => {
      me.tickListener.onTick();
    });

    eventEmitter.on('orderbook_tick', async () => {
      me.tickListener.onOrderbookTick(me.orderbookSnaphots.getAllSnapshots());
    });

    eventEmitter.on('watchdog', async () => {
      me.exchangeOrderWatchdogListener.onTick();
      await me.exchangePositionWatcher.onPositionStateChangeTick();
    });

    eventEmitter.on(PositionStateChangeEvent.EVENT_NAME, async event => {
      await me.exchangeOrderWatchdogListener.onPositionChanged(event);
    });

    let running;
    eventEmitter.on('tick_ordering', async () => {
      if (typeof running === 'undefined' || running < moment().subtract(20, 'seconds')) {
        running = new Date();
        await me.pairStateExecution.onPairStateExecutionTick();
        await me.orderExecutor.adjustOpenOrdersPrice();
        running = undefined;
      } else {
        me.logger.debug('tick_ordering still running');
      }
    });
  }
};
