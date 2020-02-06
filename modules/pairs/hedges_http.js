const _ = require('lodash');
const moment = require('moment');

module.exports = class HedgesHttp {
  constructor() {
  }

  getCompletedHedges(hedges) {
    let arrHedges = [];
    var totalProfit = 0, totalProfitPercent = 0, totalMarginProfitPercent = 0, totalOrderVolume = 0;

    Object.keys(hedges).forEach(item => {
        let hedge = hedges[item];
        let arrPair = hedge.pair.split('###');
        hedge.long.fee = arrPair[0].includes('binance_futures') ? 0.04 : hedge.long.fee;
        hedge.long.fee = arrPair[0].includes('ftx') ? 0.07 : hedge.long.fee;
        hedge.long.fee = arrPair[0].includes('bitmex') ? 0.075 : hedge.long.fee;
        hedge.short.fee = arrPair[1].includes('binance_futures') ? 0.04 : hedge.short.fee;
        hedge.short.fee = arrPair[1].includes('ftx') ? 0.07 : hedge.short.fee;
        hedge.short.fee = arrPair[1].includes('bitmex') ? 0.075 : hedge.short.fee;
        let start = new moment(hedge.foundDate);
        let close = new moment(hedge.foundCloseDate);
        let amountUsd = Number(((hedge.long.tradedPrice + hedge.short.tradedPrice)/2)*hedge.amount).toFixed(2);
        let totalFoundSpread = Math.abs(Number(hedge.spreadFoundPercent + (hedge.spreadFoundClosePercent * -1)).toFixed(2));
        let totalTradedSpread = Math.abs(Number(hedge.spreadTradedPercent + (hedge.spreadTradedClosePercent * -1)).toFixed(2));
        let totalFeesPercent = Number(2*hedge.long.fee + 2*hedge.short.fee).toFixed(2);
        let profitPercent = Number(totalTradedSpread - totalFeesPercent).toFixed(2);

        let entry = {
          long: arrPair[0],
          short: arrPair[1],
          entry: start.format('DD.MM.YY[&nbsp;]HH:mm[h]'),
          duration: moment.utc(close.diff(start)).format("HH:mm:ss.SSS"),
          inverse: hedge.inverse,
          amount: hedge.amount,
          amountusd: amountUsd,
          foundspread: totalFoundSpread,
          tradedspread: totalTradedSpread,
          longlatency: `${hedge.long.latencyCreate} ms / ${hedge.long.latencyClose} ms`.replace(/undefined/g,'-'),
          shortlatency: `${hedge.short.latencyCreate} ms / ${hedge.short.latencyClose} ms`.replace(/undefined/g,'-'),
          longexecution: `${String(hedge.long.execDurationCreate).replace(/undefined/g,'-')} ms / ${String(hedge.long.execDurationClose).replace(/undefined/g,'-')} ms`,
          shortexecution: `${String(hedge.short.execDurationCreate).replace(/undefined/g,'-')} ms / ${String(hedge.short.execDurationClose).replace(/undefined/g,'-')} ms`,
          totalfeespercent: totalFeesPercent,
          profitpercent: profitPercent,
          profit: Number(amountUsd * profitPercent / 100).toFixed(2),
          marginprofitpercent: Number(profitPercent * 5).toFixed(2)
        };
        totalProfit += Number(entry.profit);
        totalProfitPercent += Number(entry.profitpercent);
        totalMarginProfitPercent += Number(entry.marginprofitpercent);
        totalOrderVolume += entry.amountusd * 4;

        entry.totalprofit = totalProfit.toFixed(2);
        entry.totalprofitpercent = totalProfitPercent.toFixed(2);
        entry.totalmarginprofitpercent = totalMarginProfitPercent.toFixed(2);
        entry.totalordervolume = totalOrderVolume.toFixed(2);

        arrHedges.push(entry);
      });

      arrHedges = arrHedges.slice().reverse();
      return arrHedges;
  }


  getOpenHedges(hedges) {
    let arrHedges = [];

    Object.keys(hedges).forEach(item => {
        let hedge = hedges[item].order;
        let arrPair = hedge.pair.split('###');
        hedge.long.fee = arrPair[0].includes('binance_futures') ? 0.04 : hedge.long.fee;
        hedge.long.fee = arrPair[0].includes('ftx') ? 0.07 : hedge.long.fee;
        hedge.long.fee = arrPair[0].includes('bitmex') ? 0.075 : hedge.long.fee;
        hedge.short.fee = arrPair[1].includes('binance_futures') ? 0.04 : hedge.short.fee;
        hedge.short.fee = arrPair[1].includes('ftx') ? 0.07 : hedge.short.fee;
        hedge.short.fee = arrPair[1].includes('bitmex') ? 0.075 : hedge.short.fee;
        let start = new moment(hedge.foundDate);
        let amountUsd = Number(((hedge.long.tradedPrice + hedge.short.tradedPrice)/2)*hedge.amount).toFixed(2);
        let totalFoundSpread = Math.abs(Number(hedge.spreadFoundPercent).toFixed(2));
        let totalTradedSpread = Math.abs(Number(hedge.spreadTradedPercent).toFixed(2));
        let totalFeesPercent = Number(2*hedge.long.fee + 2*hedge.short.fee).toFixed(2);
        let profitPercent = '-'

        let entry = {
          long: arrPair[0],
          short: arrPair[1],
          entry: start.format('DD.MM.YY[&nbsp;]HH:mm[h]'),
          duration: 'open',
          inverse: hedge.inverse,
          amount: hedge.amount,
          amountusd: amountUsd,
          foundspread: totalFoundSpread,
          tradedspread: totalTradedSpread,
          longlatency: `${hedge.long.latencyCreate} ms / - ms`.replace(/undefined/g,'-'),
          shortlatency: `${hedge.short.latencyCreate} ms / - ms`.replace(/undefined/g,'-'),
          longexecution: `${String(hedge.long.execDurationCreate).replace(/undefined/g,'-')} ms / - ms`,
          shortexecution: `${String(hedge.short.execDurationCreate).replace(/undefined/g,'-')} ms / - ms`,
          totalfeespercent: totalFeesPercent,
          profitpercent: profitPercent,
          profit: '-',
          marginprofitpercent: '-'
        };
        arrHedges.push(entry);
      });

      arrHedges = arrHedges.slice().reverse();
      return arrHedges;
  }
};
