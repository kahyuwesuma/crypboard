const { startHuobiWS, getHuobiOrderbook, closeHuobiOrderbookWS } = require('../shared/exchange/houbi_ws');
const { startGateioWS, getGateioOrderbook, closeGateioOrderbookWS } = require('../shared/exchange/gateio_ws');
const { startKucoinWS, getKucoinOrderbook, closeKucoinOrderbookWS } = require('../shared/exchange/kucoin_ws');
const { startMexcWS, getMexcOrderbook, closeMexcOrderbookWS } = require('../shared/exchange/mexc_ws');
const { startOkxWS, getOkxOrderbook, closeOkxOrderbookWS } = require('../shared/exchange/okx_ws');
const { startBitgetWS, getBitgetOrderbook, closeBitgetOrderbookWS } = require('../shared/exchange/bitget_ws');
const { startBybitWS, getBybitOrderbook, closeBybitOrderbookWS } = require('../shared/exchange/bybit_ws');
const { startBinanceWS, getBinanceOrderbook, closeBinanceOrderbookWS } = require('../shared/exchange/binance_ws');

const priceConfigs = [
	{
		name: 'binance',
		startFunction: startBinanceWS
	},
	{
		name: 'huobi',
		startFunction: startHuobiWS
	},
	{
		name: 'gateio',
		startFunction: startGateioWS
	},
	{
		name: 'kucoin',
		startFunction: startKucoinWS
	},
	{
		name: 'mexc',
		startFunction: startMexcWS
	},
	{
		name: 'okx',
		startFunction: startOkxWS
	},
	{
		name: 'bitget',
		startFunction: startBitgetWS
	},
	{
		name: 'bybit',
		startFunction: startBybitWS
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
