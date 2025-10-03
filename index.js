const dotenv = require('dotenv');

// --------------------------
// Ajuste para suportar DOTENV_CONFIG_PATH
// --------------------------
const envFile = process.env.DOTENV_CONFIG_PATH || '.env.local';
dotenv.config({ path: envFile });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const strategies = require('./strategies');
const cors = require('cors');
const newsModule = require('./news');
const helmet = require('helmet');
const fs = require('fs');

// ==============================
// Configuração do Express + CORS
// ==============================
const allowedOrigins = [
  "http://localhost:5173",
  "https://apinextmarketpoints.online",
  "https://nextmarketpoints.netlify.app"
];

const app = express();
app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"]
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET","POST"] }
});

// ==============================
// Configuração do servidor
// ==============================
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'nextmarketpoints-backend' }));

// ==============================
// Rotas HTTP
// ==============================
app.get('/news', (req, res) => {
  try { 
    const news = newsModule.getLatest() || [];
    console.log('📰 /news retornando notícias:', news.length);
    res.json(news); 
  } catch (err) { 
    console.error('Erro ao obter notícias:', err); 
    res.status(500).json({ error: 'Erro ao obter notícias' }); 
  }
});

app.get('/strategies', (req, res) => {
  try {
    const allStrategies = strategies.getAll ? strategies.getAll() : strategies;
    console.log('📈 /strategies retornando estratégias:', Object.keys(allStrategies).length);
    res.json(allStrategies);
  } catch (err) {
    console.error('Erro ao obter estratégias:', err);
    res.status(500).json({ error: 'Erro ao obter estratégias' });
  }
});

// Endpoint de teste de sinal
app.get('/test-signal', (req, res) => {
  const signal = { id: Date.now(), symbol: 'GOLD', preco: 1950, direcao: 'BUY', status: 'ativo', hora: new Date().toLocaleTimeString(), resultado: null };
  console.log('⚡ Emitindo sinal de teste:', signal);
  io.emit('signal', signal);
  res.json(signal);
});

// ==============================
// Endpoint para ticks reais do EA
// ==============================
app.post('/ea-tick', (req, res) => {
  const ticks = Array.isArray(req.body) ? req.body : [req.body];
  const processedTicks = [];
  console.log('🟢 /ea-tick recebido:', ticks.length);

  ticks.forEach(tick => {
    const { symbol, price, change, timestamp } = tick;
    if (!symbol || price === undefined || change === undefined) return;

    const candle = {
      symbol,
      time: timestamp || Date.now(),
      open: price - change,
      high: price + Math.abs(change),
      low: price - Math.abs(change),
      close: price,
      volume: Math.floor(Math.random() * 1000)
    };

    candlesBySymbol[symbol] = candlesBySymbol[symbol] || [];
    candlesBySymbol[symbol].push(candle);
    if (candlesBySymbol[symbol].length > MAX_CANDLES) candlesBySymbol[symbol].shift();

    console.log(`📊 Emitindo candle: ${symbol} - O:${candle.open} C:${candle.close}`);
    io.emit('candle', candle);

    console.log(`📈 Emitindo ticker: ${symbol} - ${price}`);
    io.emit('ticker', { symbol, price, change, timestamp: candle.time });

    console.log(`⚡ Emitindo volatilidade: ${symbol} - ${calculateVolatility(symbol)}`);
    io.emit('volatility', { symbol, level: calculateVolatility(symbol) });

    processedTicks.push(symbol);
  });

  if (processedTicks.length === 0) {
    console.warn('⚠️ /ea-tick não processou nenhum tick válido');
    return res.status(400).json({ error: 'Nenhum tick válido recebido' });
  }

  console.log(`✅ /ea-tick processou ${processedTicks.length} símbolos:`, processedTicks);
  res.json({ status: 'ok', processed: processedTicks.length, symbols: processedTicks });
});

// ==============================
// Top ativos
// ==============================
const SYMBOLS = [
  'GOLD','SILVER','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','NZDUSD','USDCHF','EURJPY',
  'BTCUSD','ETHUSD','LTCUSD','XRPUSD','BCHUSD',
  'US500Cash','US30Cash','US100Cash','US2000Cash','UK100Cash','GER40Cash','JP225Cash','NIKKEI','HK50Cash','ChinaHCash',
  'Apple','Microsoft','Amazon','Google','Tesla','Facebook','Nvidia','Netlix','JPMorgan',
  'OILCash','NGASCash','XPTUSD','XPDUSD',
  'VIX-OCT25'
];
const MAX_CANDLES = 500;

// ==============================
// Preços base reais
// ==============================
const BASE_PRICES = {
  GOLD: 3773.00,
  SILVER: 46.400,
  EURUSD: 1.17152,
  GBPUSD: 1.34147,
  USDJPY: 149.271,
  AUDUSD: 0.65531,
  USDCAD: 1.39295,
  NZDUSD: 0.57785,
  USDCHF: 0.79698,
  EURJPY: 174.903,
  BTCUSD: 112115.65,
  ETHUSD: 4137.32,
  LTCUSD: 105.37,
  XRPUSD: 2.84707,
  BCHUSD: 553.81,
  US500Cash: 6655.20,
  US30Cash: 46297.35,
  US100Cash: 24559.50,
  US2000Cash: 2436.10,
  UK100Cash: 9308.10,
  GER40Cash: 23786.00,
  JP225Cash: 44972,
  HK50Cash: 26282,
  ChinaHCash: 9325.31,
  Apple: 254.42,
  Microsoft: 509.49,
  Amazon: 218.43,
  Google: 246.32,
  Tesla: 438.70,
  Facebook: 740.14,
  Nvidia: 177.54,
  Netlix: 1205.00,
  JPMorgan: 315.30,
  OILCash: 65.37,
  NGASCash: 2.919,
  XPTUSD: 1614.82,
  XPDUSD: 1308.90,
  "VIX-OCT25": 17.42
};

// ==============================
// Inicializa candles
// ==============================
const candlesBySymbol = {};
SYMBOLS.forEach(s => {
  const price = BASE_PRICES[s] || 1.0;
  candlesBySymbol[s] = [{
    symbol: s,
    time: Date.now(),
    open: price,
    high: price,
    low: price,
    close: price,
    volume: Math.floor(100 + Math.random()*1000)
  }];
});

// ==============================
// Variáveis Scalp
// ==============================
let scalpDailyCount = 0;
let lastScalpDate = null;

// ==============================
// Funções auxiliares
// ==============================
function generateRandomCandle(symbol) {
  const prev = candlesBySymbol[symbol].slice(-1)[0] || null;
  const base = prev ? prev.close : (BASE_PRICES[symbol] || 1.0);

  const volatilityMap = {
    GOLD: 3,
    SILVER: 0.2,
    BTCUSD: 500,
    ETHUSD: 50,
    LTCUSD: 2,
    XRPUSD: 0.05,
    BCHUSD: 5,
    OILCash: 1,
    NGASCash: 0.05,
    XPTUSD: 10,
    XPDUSD: 10,
    default: 0.005
  };
  const volatility = volatilityMap[symbol] || volatilityMap.default;

  const open = +(base + (Math.random()-0.5)*volatility).toFixed(3);
  const close = +(open + (Math.random()-0.5)*volatility).toFixed(3);
  const high = Math.max(open,close) + Math.random()*volatility*0.5;
  const low = Math.min(open,close) - Math.random()*volatility*0.5;
  const volume = Math.floor(100 + Math.random()*1000);

  return { symbol, time: Date.now(), open, high:+high.toFixed(3), low:+low.toFixed(3), close, volume };
}

function calculateVolatility(symbol) {
  const candles = candlesBySymbol[symbol].slice(-20);
  if(candles.length<2) return 0;
  const highs = candles.map(c=>c.high);
  const lows = candles.map(c=>c.low);
  return +((Math.max(...highs)-Math.min(...lows))/Math.min(...lows)*100).toFixed(2);
}

function saveCandles() {
  try {
    fs.writeFileSync('./candles.json', JSON.stringify(candlesBySymbol,null,2));
    console.log('💾 Candles salvos em candles.json');
  } catch(e) {
    console.error('Erro ao salvar candles:', e);
  }
}

// ==============================
// Emissão contínua de candles/tickers
// ==============================
function tickSimulation() {
  SYMBOLS.forEach(symbol => {
    const candle = generateRandomCandle(symbol);
    candlesBySymbol[symbol].push(candle);
    if(candlesBySymbol[symbol].length>MAX_CANDLES) candlesBySymbol[symbol].shift();

    io.emit('candle', candle);
    io.emit('ticker', { symbol, price: candle.close, change: +(candle.close-candle.open).toFixed(3), timestamp: candle.time });
    io.emit('volatility', { symbol, level: calculateVolatility(symbol) });

    try {
      const signal = strategies.checkAll(symbol, candlesBySymbol[symbol], undefined, { news: newsModule.getLatest() }) || null;
      if(signal) io.emit('signal', signal);
    } catch(err) {
      console.error(`❌ Erro ao gerar sinal para ${symbol}:`, err.message);
    }
  });
}

// ==============================
// Socket.IO
// ==============================
io.on('connection', socket => {
  console.log('🔌 Cliente conectado:', socket.id);

  // Enviar candles iniciais
  SYMBOLS.forEach(symbol => {
    const latestCandle = candlesBySymbol[symbol].slice(-1)[0];
    if(latestCandle) socket.emit('candle', latestCandle);
  });

  // Enviar últimas notícias
  const news = newsModule.getLatest() || [];
  socket.emit('news', news);

  socket.on('disconnect', () => console.log('❌ Cliente desconectado:', socket.id));
});

// ==============================
// Inicialização do módulo de news
// ==============================
newsModule.start(news => {
  if(Array.isArray(news) && news.length>0){
    io.emit('news', news);
    console.log(`📰 Notícias atualizadas (${news.length})`);
  }
});

// ==============================
// Intervalos
// ==============================
setInterval(tickSimulation, 5000); // Atualiza candles e sinais a cada 5s
setInterval(saveCandles, 5*60*1000); // Salva candles a cada 5 min

// ==============================
// Start server
// ==============================
server.listen(PORT, () => console.log(`🚀 Backend rodando em http://localhost:${PORT}`));
