const Huobi = require('../shared/exchange/huobi');
const Gateio = require('../shared/exchange/gateio');
const Kucoin = require('../shared/exchange/kucoin');
const Mexc = require('../shared/exchange/mexc');
const Okx = require('../shared/exchange/okx');
const Bybit = require('../shared/exchange/bybit');
const Binance = require('../shared/exchange/binance');
const Bitget = require('../shared/exchange/bitget');
const wsHandler = [
	{
		name: 'binance',
		startWS: Binance.startBinanceWS,
		stopWS: Binance.stopBinanceWS,
        getOrderbook: Binance.getBinanceOrderbook,
        stopOrderbook: Binance.stopBinanceOrderbook,
		getConn: Binance.getBinanceConnection,
		startBtcOnly: Binance.startBTCWS,
		stopBtcOnly: Binance.stopBTCWS,
	},
	{
		name: 'huobi',
		startWS: Huobi.startHuobiWS,
        getOrderbook: Huobi.getHuobiOrderbook,
        stopOrderbook: Huobi.stopHuobiOrderbook,
		getConn: Huobi.getHuobiConnection
	},
	{
		name: 'gateio',
		startWS: Gateio.startGateioWS,
		stopWS: Gateio.stopGateioWS,
        getOrderbook: Gateio.getGateioOrderbook,
        stopOrderbook: Gateio.stopGateioOrderbook,
		getConn: Gateio.getGateioConnection
	},
	{
		name: 'kucoin',
		startWS: Kucoin.startKucoinWS,
		stopWS: Kucoin.stopKucoinWS,
        getOrderbook: Kucoin.getKucoinOrderbook,
        stopOrderbook: Kucoin.stopKucoinOrderbook,
		getConn: Kucoin.getKucoinConnection
	},
	{
		name: 'mexc',
		startWS: Mexc.startMexcWS,
		stopWS: Mexc.stopMexcWS,
		getOrderbook: Mexc.getMexcOrderbook,
		stopOrderbook: Mexc.stopMexcOrderbook,
		getConn: Mexc.getMexcConnection
	},
	{
		name: 'okx',
		startWS: Okx.startOkxWS,
		stopWS: Okx.stopOkxWS,
		getOrderbook: Okx.getOkxOrderbook,
		stopOrderbook: Okx.stopOkxOrderbook,
		getConn: Okx.getOkxConnection
	},
	{
		name: 'bitget',
		startWS: Bitget.startBitgetWS,
		stopWS: Bitget.stopBitgetWS,
        getOrderbook: Bitget.getBitgetOrderbook,
        stopOrderbook: Bitget.stopBitgetOrderbook,
		getConn: Bitget.getBitgetConnection
	},
	{
		name: 'bybit',
		startWS: Bybit.startBybitWS,
		stopWS: Bybit.stopBybitWS,
		getOrderbook: Bybit.getBybitOrderbook,
		stopOrderbook: Bybit.stopBybitOrderbook,
		getConn: Bybit.getBybitConnection
	}
];

module.exports = { wsHandler };
