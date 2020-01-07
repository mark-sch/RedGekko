var _ = require('lodash');

var orderbookHelper = {
    getBuySlippageCurrency: function(buyamount, ob) {
        var bestAsk = ob.asks[0].price;
        var asset = 0;
        var invest = 0;
        var slippage = 0
        var myprice = 0;

        _.each(ob.asks, function(ask) {
            let askPrice = Number(ask.price);
            let askAmount = Number(ask.size);
            let askTotal = askPrice * askAmount;

            if (invest + askTotal >= buyamount) {
                //we can fill our order with this amount
                let assetPart = (buyamount-invest) / askPrice;
                invest = invest + (assetPart * askPrice);
                asset = asset + assetPart;
                
                //console.log(askPrice, askAmount, askTotal, asset, invest);
                //console.log('OK, our total invest is:', asset, invest);
                
                //determine slippage
                myprice = invest / asset;
                slippage = ((myprice - bestAsk) / bestAsk) * 100;
                return false;
            }
            else {
                //we need to include further offers to fill our order
                asset = asset + askAmount;
                invest = invest + askTotal;
                //console.log(askPrice, askAmount, askTotal, asset, invest);
            }
        });

        return {
            mySlippage: slippage.toFixed(4),
            myPrice: myprice.toFixed(2)
        }
    },


    getSellSlippageCurrency: function(sellamount, ob) {
        var bestBid = ob.bids[0].price;
        var asset = 0;
        var invest = 0;
        var slippage = 0
        var myprice = 0;

        _.each(ob.bids, function(bid) {
            let bidPrice = Number(bid.price);
            let bidAmount = Number(bid.size);
            let bidTotal = bidPrice * bidAmount;

            if (invest + bidTotal >= sellamount) {
                //we can fill our order with this amount
                let assetPart = (sellamount-invest) / bidPrice;
                invest = invest + (assetPart * bidPrice);
                asset = asset + assetPart;
                
                //console.log(bidPrice, bidAmount, bidTotal, asset, invest);
                //console.log('OK, our total invest is:', asset, invest);
                
                //determine slippage
                myprice = invest / asset;
                slippage = ((bestBid - myprice) / bestBid) * 100;
                return false;
            }
            else {
                //we need to include further offers to fill our order
                asset = asset + bidAmount;
                invest = invest + bidTotal;
                //console.log(bidPrice, bidAmount, bidTotal, asset, invest);
            }
        });

        return {
            mySlippage: slippage.toFixed(4),
            myPrice: myprice.toFixed(2)
        }
    },


    depth: function(ob) {
        var buyTotal = 0
        var sellTotal = 0;
        var sellTotalMio = 0;
        var buyTotalMio = 0;

        _.each(ob.bids, function(bid) {
            let bidPrice = Number(bid.price);
            let bidAmount = Number(bid.size);
            let bidTotal = bidPrice * bidAmount;

            sellTotal = sellTotal + bidTotal;
        });

        _.each(ob.asks, function(ask) {
            let askPrice = Number(ask.price);
            let askAmount = Number(ask.size);
            let askTotal = askPrice * askAmount;

            buyTotal = buyTotal + askTotal;
        });

        sellTotalMio = (sellTotal / 1000000).toFixed(2);
        buyTotalMio = (buyTotal / 1000000).toFixed(2);

        return {
            sellTotal,
            buyTotal,
            sellTotalMio,
            buyTotalMio
        }
    }
}

module.exports = orderbookHelper;