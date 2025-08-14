const { startHuobiWS, stopHuobiWS ,getHuobiOrderbook, closeHuobiOrderbookWS } = require('../shared/exchange/houbi_ws');
const { startGateioWS, stopGateioWS ,getGateioOrderbook, closeGateioOrderbookWS } = require('../shared/exchange/gateio_ws');
const { startKucoinWS, closeKucoinWS, getKucoinOrderbook, closeKucoinOrderbookWS } = require('../shared/exchange/kucoin_ws');
const { startMexcWS, stopMexcWS, getMexcOrderbook, closeMexcOrderbookWS } = require('../shared/exchange/mexc_ws');
const { startOkxWS, stopOkxWS, getOkxOrderbook, closeOkxOrderbookWS } = require('../shared/exchange/okx_ws');
const { startBitgetWS, stopBitgetWS ,getBitgetOrderbook, closeBitgetOrderbookWS } = require('../shared/exchange/bitget_ws');
const { startBybitWS, stopBybitWS, getBybitOrderbook, closeBybitOrderbookWS } = require('../shared/exchange/bybit_ws');
const { startBinanceWS, stopBinanceWS ,getBinanceOrderbook, closeBinanceOrderbookWS, startBTCUSDTWS, stopBTCUSDTWS } = require('../shared/exchange/binance_ws');

const priceConfigs = [
	{
		name: 'binance',
		startFunction: startBinanceWS,
		stopFunction: stopBinanceWS,
		startBtcOnly: startBTCUSDTWS,
		stopBtcOnly: stopBTCUSDTWS
	},
	{
		name: 'huobi',
		startFunction: startHuobiWS,
		stopFunction: stopHuobiWS
	},
	{
		name: 'gateio',
		startFunction: startGateioWS,
		stopFunction: stopGateioWS
	},
	{
		name: 'kucoin',
		startFunction: startKucoinWS,
		stopFunction: closeKucoinWS
	},
	{
		name: 'mexc',
		startFunction: startMexcWS,
		stopFunction: stopMexcWS
	},
	{
		name: 'okx',
		startFunction: startOkxWS,
		stopFunction: stopOkxWS
	},
	{
		name: 'bitget',
		startFunction: startBitgetWS,
		stopFunction: stopBitgetWS
	},
	{
		name: 'bybit',
		startFunction: startBybitWS,
		stopFunction: stopBybitWS
	}
];

const orderbookConfigs = [
    {
        name: 'binance',
        startFunction: getBinanceOrderbook,
        closeFunction: closeBinanceOrderbookWS
    },
    {
        name: 'huobi',
        startFunction: getHuobiOrderbook,
        closeFunction: closeHuobiOrderbookWS
    },
    {
        name: 'gateio',
        startFunction: getHuobiOrderbook,
        closeFunction: closeHuobiOrderbookWS
    },
    {
        name: 'kucoin',
        startFunction: getKucoinOrderbook,
        closeFunction: closeKucoinOrderbookWS
    },
    {
        name: 'mexc',
        startFunction: getMexcOrderbook,
        closeFunction: closeMexcOrderbookWS
    },
    {
        name: 'okx',
        startFunction: getOkxOrderbook,
        closeFunction: closeOkxOrderbookWS
    },
    {
        name: 'bitget',
        startFunction: getBitgetOrderbook,
        closeFunction: closeBitgetOrderbookWS
    },
    {
        name: 'bybit',
        startFunction: getBybitOrderbook,
        closeFunction: closeBybitOrderbookWS
    },
];

const targetSymbols = [
	"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
	"ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT", "DOGEUSDT",
	"LTCUSDT", "BCHUSDT", "VETUSDT", "UNIUSDT", "CHZUSDT",
	"SANDUSDT", "MANAUSDT", "AXSUSDT", "ZILUSDT", "FILUSDT"
]
module.exports = { priceConfigs, orderbookConfigs, targetSymbols };
