*****************************************************
* RedGekko CLI - command line margin trader, v0.1.
* (c)2021 Think5 GmbH
*****************************************************

A command line tool for fast trade execution on Binance Futures exchange.
It uses the RedGekko exchange implementations with fast http/2 protocol.
If you go long and then short with the same amount, the short position will
close the previous long position and vice-versa.

Example: margin-trader --c config.js --p ETHUSDT --d long --a 0.02

Optional parameter: --mqtt <server:port> (listen to signals for execution)