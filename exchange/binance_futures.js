const WebSocket = require('ws');
const querystring = require('querystring');
const crypto = require('crypto');
const ccxt = require('ccxt');
const moment = require('moment');
const Ticker = require('./../dict/ticker');
const Order = require('./../dict/order');
const TickerEvent = require('./../event/ticker_event');
const ExchangeCandlestick = require('../dict/exchange_candlestick');
const Position = require('../dict/position');
const CcxtExchangeOrder = require('./ccxt/ccxt_exchange_order');

module.exports = class BinanceFutures {
  constructor(eventEmitter, requestClient, candlestickResample, logger, queue, candleImporter) {
    this.eventEmitter = eventEmitter;
    this.requestClient = requestClient;
    this.logger = logger;
    this.queue = queue;
    this.candleImporter = candleImporter;
    this.exchange = null;

    this.ccxtExchangeOrder = undefined;

    this.positions = {};
    this.orders = {};
    this.tickers = {};
    this.symbols = [];
    this.intervals = [];
    this.ccxtClient = undefined;
  }

  async start(config, symbols) {
    const { eventEmitter } = this;
    const { logger } = this;
    this.exchange = null;

    if (config.key && config.secret && config.key.length > 0 && config.secret.length > 0) {
      this.apiKey = config.key;
      this.apiSecret = config.secret;
    }

    const ccxtClient = (this.ccxtClient = new ccxt.binance({
      urls :{
        api: { 
          fapiPublic: this.getBaseUrl() + '/fapi/v1',
          fapiPrivate: this.getBaseUrl() + '/fapi/v1'
        }
      },
      apiKey: config.key,
      secret: config.secret,
      options: { defaultType: 'future', warnOnFetchOpenOrdersWithoutSymbol: false }
    }));

    this.intervals = [];

    this.symbols = symbols;
    this.positions = {};
    this.orders = {};
    this.ccxtExchangeOrder = BinanceFutures.createCustomCcxtOrderInstance(ccxtClient, symbols, logger);

    const me = this;
    this.pongTimer = null;
    this.pingTimer = null;
    this.pingInterval = config.pingInterval ? config.pingInterval : 10000;
    this.pongTimeout = config.pongTimeout ? config.pongTimeout : 1000;
    this.pingPongSatisfaction = this.pingPongSatisfaction = config.pingPongSatisfaction ? config.pingPongSatisfaction : 150;
    this.timeOffset = await this.getServerTimeOffset();
    
    if (config.key && config.secret && config.key.length > 0 && config.secret.length > 0) {
      setInterval(async () => {
        await me.ccxtExchangeOrder.syncOrders();
      }, 1000 * 30);

      setInterval(async () => {
        me.timeOffset = await me.getServerTimeOffset();
      }, 1000 * 120);

      setTimeout(async () => {
        await ccxtClient.fetchMarkets();
        await me.ccxtExchangeOrder.syncOrders();
        await me.syncPositionViaRestApi();
      }, 1000 * 30);

      setTimeout(async () => {
        await me.initUserWebsocket();
      }, 2000);
    } else {
      me.logger.info('Binance Futures: Starting as anonymous; no trading possible');
    }

    setTimeout(async () => {
      await me.initPublicWebsocket(symbols, config);
    }, 500);

    symbols.forEach(symbol => {
      symbol.periods.forEach(period => {
        // for bot init prefill data: load latest candles from api
        this.queue.add(async () => {
          let ohlcvs;

          try {
            ohlcvs = await ccxtClient.fetchOHLCV(symbol.symbol.replace('USDT', '/USDT'), period, undefined, 500);
          } catch (e) {
            me.logger.info(
              `Binance Futures: candles fetch error: ${JSON.stringify([symbol.symbol, period, String(e)])}`
            );

            return;
          }

          const ourCandles = ohlcvs.map(candle => {
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
    return 'binance_futures';
  }

  async getServerTimeOffset() {
    const verb = 'GET';
    const path = '/fapi/v1/time';

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    let dtStartRequest = new Date().getTime();
    const result = await this.requestClient.executeRequest(
      {
        headers: headers,
        url: this.getBaseUrl() + path,
        method: verb
      },
      result => {
        return result && result.response && result.response.statusCode >= 500;
      }
    );
    let dtFinishedRequest = new Date().getTime();
    let conLatency = dtStartRequest - dtFinishedRequest;

    let dtServerTime = JSON.parse(result.response.body).serverTime;
    let localOffset = dtServerTime - dtFinishedRequest;

    //console.log(`*** ${this.getName()}: Local time is ${dtFinishedRequest}, request latency is ${conLatency}ms, server time is ${dtServerTime}ms, localTimeOffset is ${localOffset}ms`);
    return localOffset;
  }

  async fastOrder(order, resolve) {
    const query = {
      symbol: order.getSymbol(),
      side: order.isShort() ? 'SELL' : 'BUY',
      quantity: order.getAmount(),
      type: order.getType().toUpperCase(),
      timestamp: new Date().getTime() + this.timeOffset
    };

    const verb = 'POST';
    const path = '/fapi/v1/order';
    var strQuery = querystring.stringify(query);
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(strQuery)
      .digest('hex');
    strQuery += '&' + 'signature=' + signature;

    const headers = {
      'X-MBX-APIKEY': this.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    let dtOrderEntry = new Date().getTime();
    //console.log(dtOrderEntry + ` *** ${this.getName()}: before order execution`);
    const result = await this.requestClient.executeRequest(
      {
        headers: headers,
        url: this.getBaseUrl() + path,
        body: strQuery,
        method: verb
      },
      result => {
        return result && result.response && result.response.statusCode >= 500;
      }
    );

    var myorder = JSON.parse(result.response.body);

    let dtOrderFinished = new Date().getTime();
    myorder.execDuration = dtOrderFinished - dtOrderEntry;
    myorder.id = myorder.orderId;
    console.log(dtOrderFinished + ` *** ${this.getName()}: order executed. Duration: ${myorder.execDuration}ms`);
    resolve(myorder);
  }

  async order(order, fast) {
    let dtOrderEntry = new Date().getTime();
    console.log(dtOrderEntry + ` *** ${this.getName()}: before order execution`);

    if (fast) {
      return new Promise(resolve => {
        this.fastOrder(order, resolve);
      });
    }
    
    let myorder = await this.ccxtExchangeOrder.createOrder(order);
    
    let dtOrderFinished = new Date().getTime();
    myorder.execDuration = dtOrderFinished - dtOrderEntry;
    console.log(dtOrderFinished + ` *** ${this.getName()}: order executed. Duration: ${myorder.execDuration}ms`);
    return myorder;
  }

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
      const positionAmt = parseFloat(position.positionAmt);

      return new Position(
        position.symbol,
        positionAmt < 0 ? 'short' : 'long',
        positionAmt,
        undefined,
        new Date(),
        position.entryPrice,
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
      response = await this.ccxtClient.fapiPrivateGetPositionRisk();
    } catch (e) {
      this.logger.error(`Binance Futures: error getting positions:${e}`);
      console.log(`Binance Futures: error getting positions:${e}`);
      return;
    }

    const positions = response.filter(position => position.entryPrice && parseFloat(position.entryPrice) > 0);
    this.fullPositionsUpdate(BinanceFutures.createPositions(positions));

    this.logger.debug(`Binance Futures: positions updates: ${positions.length}`);
  }

  async syncTradesViaRestApi(orderId, symbol) {
    let response;
    try {
      response = await this.ccxtClient.fapiPrivateGetUserTrades();
    } catch (e) {
      this.logger.error(`Binance Futures: error getting trades:${e}`);
      console.log(`Binance Futures: error getting trades:${e}`);
      return;
    }

    var _trade = response.filter(trade => trade.orderId && Number(trade.orderId) == Number(orderId));
    
    if (Array.isArray(_trade) && _trade.length >= 1) {
      let sumTrades = {
        price: 0,
        amount: 0
      };
      _trade.forEach(trade => {
        let amount = trade.side.toUpperCase() == 'BUY' ? Number(trade.qty) : Number(trade.qty) * -1
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

  getBaseUrl() {
    return 'https://fapi.binance.com';
  }

  getBaseWebsocketUrl() {
    return 'wss://fstream.binance.com';
  }

  async initPublicWebsocket(symbols, config) {
    const me = this;
    const ws = new WebSocket(this.getBaseWebsocketUrl() + '/stream');

    ws.onerror = function(e) {
      me.logger.info(`Binance Futures: Public stream error: ${String(e)}`);
    };

    ws.onopen = function() {
      me.logger.info(me.getName() + ': Public stream opened.');
      console.log(me.getName() + ': Connection opened.');

      symbols.forEach(symbol => {
        const params = [
          `${symbol.symbol.toLowerCase()}@bookTicker`,
          ...symbol.periods.map(p => `${symbol.symbol.toLowerCase()}@kline_${p}`)
        ];
        
        me.pingTimer = setInterval(() => {me._ping(ws)}, me.pingInterval);

        me.logger.debug(`Binance Futures: Public stream subscribing: ${JSON.stringify([symbol.symbol, params])}`);

        ws.send(
          JSON.stringify({
            method: 'SUBSCRIBE',
            params: params,
            id: Math.floor(Math.random() * Math.floor(100))
          })
        );
      });
    };

    ws.onmessage = async function(event) {
      if (event.type && event.type === 'message') {
        const body = JSON.parse(event.data);

        if (body && body.id === 2) {
          me.pingPongDelay = new Date().getTime() - me.pingStart;
          if (me.pingPongDelay < me.pingPongSatisfaction) {
            me.ConnectionHealth = "Good";
          }
          else {
            me.ConnectionHealth = "Bad";
          }
          //console.log(me.getName(), 'PingPong delay:', me.pingPongDelay + 'ms.', me.ConnectionHealth);
          clearTimeout(me.pongTimer);
        } else if (body.stream && body.stream.toLowerCase().includes('@bookticker')) {
          me.eventEmitter.emit(
            'ticker',
            new TickerEvent(
              me.getName(),
              body.data.s,
              (me.tickers[body.data.s] = new Ticker(
                me.getName(),
                body.data.s,
                moment().format('X'),
                parseFloat(body.data.b),
                parseFloat(body.data.a)
              ))
            ),
            me
          );
        } else if (body.stream && body.stream.toLowerCase().includes('@kline')) {
          await me.candleImporter.insertThrottledCandles([
            new ExchangeCandlestick(
              me.getName(),
              body.data.s,
              body.data.k.i,
              Math.round(body.data.k.t / 1000),
              parseFloat(body.data.k.o),
              parseFloat(body.data.k.h),
              parseFloat(body.data.k.l),
              parseFloat(body.data.k.c),
              parseFloat(body.data.k.v)
            )
          ]);
        }
      }
    };

    ws.onclose = function() {
      me.logger.info('Binance futures: Public stream connection closed.');
      console.log(me.getName() + ': Connection closed.');

      setTimeout(async () => {
        me.logger.info('Binance futures: Public stream connection reconnect');
        console.log('Binance futures: Public stream connection reconnect');
        await me.initPublicWebsocket(symbols, config);
      }, 1000 * 30);
    };
  }


  _ping(ws) {
    clearTimeout(this.pongTimer);
    this.pongTimer = null;

    this.pingStart = new Date().getTime();
    //ws ping
    ws.send(JSON.stringify({
      "method": "GET_PROPERTY",
      "params": [
        "combined"
      ],
      "id": 2
    }));

    this.pongTimer = setTimeout(() => {
      console.log(this.getName(), 'connection too slow, ping pong test did not pass, terminating websocket');
      this.ConnectionHealth = "Bad";
      this._teardown();
      ws.terminate();
      ws = new WebSocket(this.getBaseWebsocketUrl() + '/stream');
    }, this.pongTimeout);
  }


  _teardown() {
    if(this.pingTimer) clearInterval(this.pingTimer);
    if(this.pongTimer) clearTimeout(this.pongTimer);

    this.pongTimer = null;
    this.pingTimer = null;
  }


  async initUserWebsocket() {
    let response;
    try {
      response = await this.ccxtClient.fapiPublicPostListenKey();
    } catch (e) {
      this.logger.error(`${me.getName()}: listenKey error: ${String(e)}`);
      return undefined;
    }

    if (!response || !response.listenKey) {
      this.logger.error(`${me.getName()}: invalid listenKey response: ${JSON.stringify(response)}`);
      return undefined;
    }

    const me = this;
    var ws = new WebSocket(`${this.getBaseWebsocketUrl()}/ws/${response.listenKey}`);
    ws.onerror = function(e) {
      me.logger.info(`${me.getName()}: Connection error: ${String(e)}`);
      console.log(`${me.getName()}: Connection error: `, e.error);
    };

    ws.onopen = function() {
      me.logger.info(`${me.getName()}: Opened user stream`);
    };

    ws.onmessage = async function(event) {
      if (event && event.type === 'message') {
        const message = JSON.parse(event.data);

        if (message.e && message.e.toUpperCase() === 'ORDER_TRADE_UPDATE') {
          const order = message.o;

          const remapp = {
            s: 'symbol',
            c: 'clientOrderId',
            S: 'side',
            o: 'type',
            f: 'timeInForce',
            q: 'origQty',
            p: 'price',
            sp: 'stopPrice',
            X: 'status',
            i: 'orderId',
            T: 'updateTime'
          };

          Object.keys(order).forEach(k => {
            if (remapp[k]) {
              order[remapp[k]] = order[k];
            }
          });

          me.ccxtExchangeOrder.triggerPlainOrder(order);
        }

        if (message.e && message.e.toUpperCase() === 'ACCOUNT_UPDATE') {
          await me.syncPositionViaRestApi();
        }
      }
    };

    const heartbeat = setInterval(async () => {
      try {
        await this.ccxtClient.fapiPublicPutListenKey();
        this.logger.debug('Binance Futures: user stream ping successfully done');
      } catch (e) {
        this.logger.error(`Binance Futures: user stream ping error: ${String(e)}`);
      }
    }, 1000 * 60 * 10);

    ws.onclose = function() {
      me.logger.info(me.getName() + ': User stream connection closed.');
      console.log(me.getName() + ': User stream connection closed.');
      clearInterval(heartbeat);

      setTimeout(async () => {
        me.logger.info(me.getName() + ': User stream connection reconnect');
        console.log(me.getName() + ': User stream connection reconnect');
        await me.initUserWebsocket();
      }, 1000 * 30);
    };

    return true;
  }

  static createCustomCcxtOrderInstance(ccxtClient, symbols, logger) {
    // ccxt id and binance ids are not matching
    const CcxtExchangeOrderExtends = class extends CcxtExchangeOrder {
      async createOrder(order) {
        order.symbol = order.symbol.replace('USDT', '/USDT');
        return super.createOrder(order);
      }

      async syncOrders() {
        const orders = await super.syncOrders();

        if (Array.isArray(orders)) {
          orders.forEach(order => {
            order.symbol = order.symbol.replace('/USDT', 'USDT');
          });
        }

        return orders;
      }
    };

    return new CcxtExchangeOrderExtends(ccxtClient, symbols, logger, {
      cancelOrder: (client, args) => {
        return { symbol: args.symbol.replace('USDT', '/USDT') };
      },
      convertOrder: (client, order) => {
        order.symbol = order.symbol.replace('/USDT', 'USDT');
      },
      createOrder: order => {
        const request = {
          args: {}
        };

        if (order.isReduceOnly()) {
          request.args.reduceOnly = true;
        }

        if (order.getType() === Order.TYPE_STOP) {
          request.args.stopPrice = order.getPrice();
        }

        return request;
      }
    });
  }
};
