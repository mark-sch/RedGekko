const WebSocket = require('ws');
const ccxt = require('ccxt');
const moment = require('moment');
const crypto = require('crypto');
const Ticker = require('./../dict/ticker');
const TickerEvent = require('./../event/ticker_event');
const ExchangeCandlestick = require('../dict/exchange_candlestick');

const CandlesFromTrades = require('./utils/candles_from_trades');

const Position = require('../dict/position');
const ExchangeOrder = require('../dict/exchange_order');

const CcxtExchangeOrder = require('./ccxt/ccxt_exchange_order');
const CcxtUtil = require('./utils/ccxt_util');

module.exports = class Ftx {
  constructor(eventEmitter, requestClient, candlestickResample, logger, queue, candleImporter) {
    this.eventEmitter = eventEmitter;
    this.logger = logger;
    this.queue = queue;
    this.candleImporter = candleImporter;
    this.exchange = null;

    this.apiKey = undefined;
    this.apiSecret = undefined;
    this.ccxtExchangeOrder = undefined;

    this.positions = {};
    this.orders = {};
    this.tickers = {};
    this.symbols = [];
    this.intervals = [];
    this.ConnectionHealth = "Bad";
    this.ccxtClient = undefined;

    this.candlesFromTrades = new CandlesFromTrades(candlestickResample, candleImporter);
  }

  start(config, symbols) {
    const { eventEmitter } = this;
    const { logger } = this;
    this.exchange = null;

    this.pongTimer = null;
    this.pingTimer = null;
    this.pingInterval = config.pingInterval ? config.pingInterval : 10000;
    this.pongTimeout = config.pongTimeout ? config.pongTimeout : 1000;
    this.pingPongSatisfaction = this.pingPongSatisfaction = config.pingPongSatisfaction ? config.pingPongSatisfaction : 150;

    const ccxtClient = (this.ccxtClient = new ccxt.ftx({
      apiKey: config.key,
      secret: config.secret
    }));

    // conditional orders are not supported by ccxt
    const CcxtExchangeOrderExtends = class extends CcxtExchangeOrder {
      async cancelOrder(id) {
        const order = await this.findOrderById(id);
        if (order && order.type.includes(ExchangeOrder.TYPE_STOP, ExchangeOrder.TYPE_STOP_LIMIT)) {
          let result;
          try {
            result = await this.ccxtClient.privateDeleteConditionalOrdersOrderId({ order_id: id });
          } catch (e) {
            this.logger.error(
              `FTX: can not cancel trigger order${JSON.stringify({ message: String(e), order: order })}`
            );

            return undefined;
          }

          if (!result || !result.success) {
            this.logger.error(`FTX: can not cancel trigger order${JSON.stringify({ response: result })}`);
            return undefined;
          }

          this.orderbag.delete(id);
          return ExchangeOrder.createCanceled(order);
        }

        return super.cancelOrder(id);
      }
    };

    // stop order (trigger orders) are not supported by ccxt
    this.ccxtExchangeOrder = new CcxtExchangeOrderExtends(ccxtClient, this.symbols, this.logger, {
      syncOrders: async client => {
        return CcxtUtil.createExchangeOrders(
          (await client.privateGetConditionalOrders()).result.map(r => client.parseOrder(r))
        );
      }
    });

    this.intervals = [];

    this.symbols = symbols;
    this.positions = {};
    this.orders = {};
    this.leverageUpdated = {};

    var ws = new WebSocket('wss://ftx.com/ws/');

    const me = this;

    setTimeout(async () => {
      await ccxtClient.fetchMarkets();
    }, 5000);

    ws.onopen = function() {
      me.logger.info('FTX: Connection opened.');
      console.log('FTX: Connection opened.');

      symbols.forEach(symbol => {
        ws.send(JSON.stringify({ op: 'subscribe', channel: 'trades', market: symbol.symbol }));
        ws.send(JSON.stringify({ op: 'subscribe', channel: 'ticker', market: symbol.symbol }));
      });

      me.pingTimer = setInterval(() => {me._ping(ws)}, me.pingInterval);

      if (config.key && config.secret && config.key.length > 0 && config.secret.length > 0) {
        const time = new Date().getTime();
        const signature = crypto
          .createHmac('sha256', config.secret)
          .update(`${time}websocket_login`)
          .digest('hex');

        ws.send(JSON.stringify({ op: 'login', args: { key: config.key, sign: signature, time: time } }));

        me.exchange = new ccxt.ftx({
          apiKey: config.key,
          secret: config.secret
        });

        setInterval(
          (function f() {
            me.ccxtExchangeOrder.syncOrders();
            return f;
          })(),
          1000 * 30
        );

        setInterval(
          (function f() {
            me.syncPositionViaRestApi();
            return f;
          })(),
          1000 * 30
        );

        setTimeout(() => {
          ws.send(JSON.stringify({ op: 'subscribe', channel: 'fills' }));
          ws.send(JSON.stringify({ op: 'subscribe', channel: 'orders' }));
        }, 5000);
      } else {
        me.logger.info('FTX: Starting as anonymous; no trading possible');
      }
    };

    ws.onmessage = async function(event) {
      if (event.type === 'message') {
        const data = JSON.parse(event.data);

        if (data && data.type === 'pong') {
            me.pingPongDelay = new Date().getTime() - me.pingStart;
            if (me.pingPongDelay < me.pingPongSatisfaction) {
              me.ConnectionHealth = "Good";
            }
            else {
              me.ConnectionHealth = "Bad";
            }
            //console.log(me.getName(), 'PingPong delay:', me.pingPongDelay + 'ms.', me.ConnectionHealth);
            clearTimeout(me.pongTimer);
        }
        if (data.type === 'subscribed') {
          logger.debug(`FTX: subscribed to channel: ${data.channel} - ${event.data}`);
          return;
        }
        if (data.type === 'error') {
          logger.error(`FTX: websocket error: ${JSON.stringify(data)}`);
          return;
        }

        if (data.channel === 'orders') {
          me.ccxtExchangeOrder.triggerOrder(CcxtUtil.createExchangeOrder(ccxtClient.parseOrder(data.data)));
        }

        if (data.channel === 'fills') {
          // do a full sync
          await me.syncPositionViaRestApi();
        }

        if (data.channel === 'trades') {
          const trades = data.data.map(trade => {
            const t = ccxtClient.parseTrade(trade, data.market);
            t.symbol = data.market;
            return t;
          });

          await me.candlesFromTrades.onTrades(me.getName(), trades, symbols);
        }

        if (data.channel === 'ticker') {
          if (data.data.bid != me.lastBidPrice || data.data.ask != me.lastAskPrice) {
            me.lastBidPrice = data.data.bid;
            me.lastAskPrice = data.data.ask;
            eventEmitter.emit(
              'ticker',
              new TickerEvent(
                me.getName(),
                data.market,
                (me.tickers[data.market] = new Ticker(
                  me.getName(),
                  data.market,
                  moment().format('X'),
                  data.data.bid,
                  data.data.ask
                ))
              ),
              me
            );
          }
        }
      }
    };

    ws.onclose = function() {
      logger.info('FTX: Connection closed.');
      console.log('FTX: Connection closed.');

      for (const interval of me.intervals) {
        clearInterval(interval);
      }

      me.intervals = [];

      // retry connecting after some second to not bothering on high load
      setTimeout(() => {
        me.start(config, symbols);
      }, 10000);
    };

    symbols.forEach(symbol => {
      symbol.periods.forEach(period => {
        // for bot init prefill data: load latest candles from api
        this.queue.add(async () => {
          const ourCandles = (await ccxtClient.fetchOHLCV(symbol.symbol, period, undefined, 500)).map(candle => {
            return new ExchangeCandlestick(
              me.getName(),
              symbol.symbol,
              period,
              Math.round(candle[0] / 1000),
              candle[1],
              candle[2],
              candle[3],
              candle[4],
              candle[5]
            );
          });

          await me.candleImporter.insertThrottledCandles(ourCandles);
        });
      });
    });
  }


  _ping(ws) {
    clearTimeout(this.pongTimer);
    this.pongTimer = null;

    this.pingStart = new Date().getTime();
    ws.send(JSON.stringify({op: 'ping'}));

    this.pongTimer = setTimeout(() => {
      console.log(this.getName(), 'connection too slow, ping pong test did not pass, terminating websocket');
      this.ConnectionHealth = "Bad";
      this._teardown();
      ws.terminate();
      ws = new WebSocket('wss://ftx.com/ws/');
    }, this.pongTimeout);
  }

  _teardown() {
    if(this.pingTimer) clearInterval(this.pingTimer);
    if(this.pongTimer) clearTimeout(this.pongTimer);

    this.pongTimer = null;
    this.pingTimer = null;
  }


  /**
   * Updates all position; must be a full update not delta. Unknown current non orders are assumed to be closed
   *
   * @param positions Position in raw json from Bitmex
   */
  fullPositionsUpdate(positions) {
    const currentPositions = {};

    for (const position of positions) {
      currentPositions[position.symbol] = position;
    }

    this.positions = currentPositions;
  }

  async getOrders() {
    return this.ccxtExchangeOrder.getOrders();
  }

  async findOrderById(id) {
    return this.ccxtExchangeOrder.findOrderById(id);
  }

  async getOrdersForSymbol(symbol) {
    return this.ccxtExchangeOrder.getOrdersForSymbol(symbol);
  }

  async getPositions() {
    const results = [];

    for (const x in this.positions) {
      let position = this.positions[x];
      if (position.entry && this.tickers[position.symbol]) {
        if (position.side === 'long') {
          position = Position.createProfitUpdate(
            position,
            (this.tickers[position.symbol].bid / position.entry - 1) * 100
          );
        } else if (position.side === 'short') {
          position = Position.createProfitUpdate(
            position,
            (position.entry / this.tickers[position.symbol].ask - 1) * 100
          );
        }
      }

      results.push(position);
    }

    return results;
  }

  async getPositionForSymbol(symbol) {
    for (const position of await this.getPositions()) {
      if (position.symbol === symbol) {
        return position;
      }
    }

    return undefined;
  }

  calculatePrice(price, symbol) {
    return price; // done by ccxt
  }

  calculateAmount(amount, symbol) {
    return amount; // done by ccxt
  }

  getName() {
    return 'ftx';
  }

  async order(order, fast) {
    let dtOrderEntry = new Date().getTime();
    console.log(dtOrderEntry + ` *** ${this.getName()}: before order execution`);
    
    let myorder = await this.ccxtExchangeOrder.createOrder(order);
    
    let dtOrderFinished = new Date().getTime();
    myorder.execDuration = dtOrderFinished - dtOrderEntry;
    console.log(dtOrderFinished + ` *** ${this.getName()}: order executed. Duration: ${myorder.execDuration}ms`);
    return myorder;
  }

  /**
   * Set the configured leverage size "0-100" for pair before creating an order default "5" if not provided in configuration
   *
   * symbol configuration via:
   *
   * "extra.bybit_leverage": 5
   *
   * @param symbol
   */
  async updateLeverage(symbol) {}

  async cancelOrder(id) {
    const result = this.ccxtExchangeOrder.cancelOrder(id);
    await this.ccxtExchangeOrder.syncOrders();
    return result;
  }

  async cancelAll(symbol) {
    const result = this.ccxtExchangeOrder.cancelAll(symbol);
    await this.ccxtExchangeOrder.syncOrders();
    return result;
  }

  async updateOrder(id, order) {
    if (!order.amount && !order.price) {
      throw 'Invalid amount / price for update';
    }

    const result = this.ccxtExchangeOrder.updateOrder(id, order);
    await this.ccxtExchangeOrder.syncOrders();
    return result;
  }

  /**
   * Convert incoming positions only if they are open
   *
   * @param positions
   * @returns {*}
   */
  static createPositions(positions) {
    return positions.map(position => {
      let amount = Math.abs(position.size);
      const side = position.side === 'sell' ? 'short' : 'long';

      if (side === 'short') {
        amount *= -1;
      }

      return new Position(
        position.future,
        side,
        amount,
        undefined,
        new Date(),
        position.recentAverageOpenPrice ? position.recentAverageOpenPrice : undefined,
        undefined
      );
    });
  }

  /**
   * As a websocket fallback update orders also on REST
   */
  async syncPositionViaRestApi() {
    let response;
    try {
      response = await this.exchange.privateGetPositions({ showAvgPrice: true });
    } catch (e) {
      this.logger.error(`FTX: error getting positions:${e}`);
      return;
    }

    const positions = response.result.filter(position => position.size > 0);
    this.fullPositionsUpdate(Ftx.createPositions(positions));
  }

  async syncTradesViaRestApi(orderId, symbol) {
    let response;
    try {
      response = await this.exchange.fetchMyTrades(symbol, undefined, 2, { order: String(orderId) });
    } catch (e) {
      this.logger.error(`Ftx: error getting trades:${e}`);
      console.log(`Ftx: error getting trades:${e}`);
      return;
    }

    var _trade = response.filter(trade => trade.order && Number(trade.order) == Number(orderId));
    
    if (Array.isArray(_trade) && _trade.length >= 1) {
      let sumTrades = {
        price: 0,
        amount: 0
      };
      _trade.forEach(trade => {
          let amount = trade.side.toUpperCase() == 'BUY' ? Number(trade.amount) : Number(trade.amount) * -1
          sumTrades.symbol = trade.symbol,
          sumTrades.side = trade.side.toUpperCase(),
          sumTrades.price += Number(trade.price) * Number(amount),
          sumTrades.amount += Number(amount)
      });
      sumTrades.price = sumTrades.price / sumTrades.amount;
      _trade = sumTrades;
    }
    
    return _trade;
  }

  isInverseSymbol(symbol) {
    return false;
  }
};
