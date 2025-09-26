// index.js (atualizado para tickers da corretora e VIX-OCT25)
const dotenv = require('dotenv');
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.local';
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
  try { res.json(newsModule.getLatest()); } 
  catch (err) { console.error('Erro ao obter notícias:', err); res.status(500).json({ error: 'Erro ao obter notícias' }); }
});

app.get('/strategies', (req, res) => {
  try {
    const allStrategies = strategies.getAll ? strategies.getAll() : strategies;
    res.json(allStrategies);
  } catch (err) {
    console.error('Erro ao obter estratégias:', err);
    res.status(500).json({ error: 'Erro ao obter estratégias' });
  }
});

// Endpoint de teste de sinal
app.get('/test-signal', (req, res) => {
  const signal = { id: Date.now(), symbol: 'GOLD', preco: 1950, direcao: 'BUY', status: 'ativo', hora: new Date().toLocaleTimeString(), resultado: null };
  io.emit('signal', signal);
  res.json(signal);
});

// ==============================
// Endpoint para ticks reais do EA
// - aceita um único tick (objeto) ou um array de ticks
// - formato esperado: { symbol, price, change, timestamp? }
// ==============================
app.post('/ea-tick', (req, res) => {
  const ticks = Array.isArray(req.body) ? req.body : [req.body];
  const processedTicks = [];

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

    io.emit('candle', candle);
    io.emit('ticker', { symbol, price, change, timestamp: candle.time });
    io.emit('volatility', { symbol, level: calculateVolatility(symbol) });

    processedTicks.push(symbol);
  });

  if (processedTicks.length === 0) return res.status(400).json({ error: 'Nenhum tick válido recebido' });
  res.json({ status: 'ok', processed: processedTicks.length, symbols: processedTicks });
});

// ==============================
// Top ativos (ajustados para ticker da corretora)
// ==============================
const SYMBOLS = [
  'GOLD','SILVER','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','NZDUSD','USDCHF','EURJPY',
  'BTCUSD','ETHUSD','LTCUSD','XRPUSD','BCHUSD',
  'US500Cash','US30Cash','US100Cash','US2000Cash','UK100Cash','GER40Cash','JP225Cash','NIKKEI','HK50Cash','ChinaHCash',
  'Apple','MICROSOFT','AMAZON','GOOGLE','TESLA','FACEBOOK','Nvidia','NETFLIX','JPMorgan',
  'OILCash','NGASCash','XPTUSD','XPDUSD',
  'VIX-OCT25'
];
const MAX_CANDLES = 500;
const candlesBySymbol = {};
SYMBOLS.forEach(s => candlesBySymbol[s] = []);

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
  // Ajuste das bases: GOLD substitui XAUUSD, OILCash para petróleo
  const base = prev ? prev.close : (symbol === 'GOLD' ? 1950 : 1.0);
  const volatility = symbol === 'GOLD' ? 1.5 : (symbol === 'OILCash' ? 0.8 : 0.005);
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

function saveCandlesToFile() {
  try { fs.writeFileSync('candles.json', JSON.stringify(candlesBySymbol)); } 
  catch(e) { console.error('Erro ao salvar candles:', e); }
}
setInterval(saveCandlesToFile, 5*60*1000);

// ==============================
// Emissão de sinais
// ==============================
const SIGNAL_EXPIRATION_MS = 5 * 60 * 1000;
function emitSignalWithPriority(signals) {
  if (!signals || signals.length === 0) return null;
  const now = Date.now();
  const validSignals = signals.filter(s => s && (!s.timestamp || (now - s.timestamp) < SIGNAL_EXPIRATION_MS));
  if (validSignals.length === 0) return null;
  const topSignal = validSignals.sort((a,b) => (b.confidence||0) - (a.confidence||0))[0];
  topSignal.timestamp = now;
  return topSignal;
}

function getMarketSession(symbol){
  const hour = new Date().getUTCHours();
  if(hour>=13 && hour<22) return 'US';
  if(hour>=23 || hour<6) return 'Asia';
  return 'EU';
}

let globalFearIndex = 20;

// ==============================
// Simulação de Ticks
// ==============================
function tickSimulation() {
  const today = new Date().toISOString().slice(0,10);
  if(lastScalpDate !== today){ scalpDailyCount = 0; lastScalpDate = today; }

  const scoreThreshold = parseInt(process.env.SCORE_THRESHOLD || 50, 10);

  SYMBOLS.forEach(symbol => {
    const candle = candlesBySymbol[symbol].slice(-1)[0] || generateRandomCandle(symbol);
    const arr = candlesBySymbol[symbol];
    arr.push(candle);
    if(arr.length>MAX_CANDLES) arr.shift();

    // Emit ticker e candle no mesmo formato que o EA envia
    io.emit('candle', candle);
    io.emit('ticker', { symbol, price: candle.close, change: +(candle.close-candle.open).toFixed(3), timestamp: candle.time });
    io.emit('volatility', { symbol, level: calculateVolatility(symbol) });

    try {
      const context = { 
        timeframe:'5m', 
        higher:{daily:candlesBySymbol[symbol].slice(-200)}, 
        news:newsModule.getLatest(), 
        session:getMarketSession(symbol), 
        fearIndex:globalFearIndex 
      };

      let signals = strategies.checkAll(symbol, arr, 10000, context);
      signals = Array.isArray(signals) ? signals.filter(Boolean) : signals ? [signals] : [];

      // ajuste: scalpDailyCount para GOLD (era XAUUSD)
      if(symbol === 'GOLD'){
        signals = signals.map(s => { 
          if(s.strategy==='scalp_gold' && scalpDailyCount<3){ scalpDailyCount++; return s; } 
          return s; 
        }).filter(Boolean);
      }

      const filteredSignals = signals.filter(s => s.confidence >= scoreThreshold);
      const topSignal = emitSignalWithPriority(filteredSignals);
      if(topSignal) io.emit('signal', topSignal);

    } catch(err){ console.error('Erro strategies:', err); }
  });
}

// ==============================
// Socket.IO
// ==============================
io.on('connection', socket => {
  console.log(`📡 Cliente conectado: ${socket.id}`);
  const payload = {};
  SYMBOLS.forEach(s => payload[s] = candlesBySymbol[s].slice(-200));
  socket.emit('init',{ candles: payload, symbols: SYMBOLS });
  socket.emit('news', newsModule.getLatest());
  socket.on('disconnect', ()=> console.log(`❌ Cliente desconectado: ${socket.id}`));
});

// ==============================
// Intervalos
// ==============================
setInterval(tickSimulation, 1500);
newsModule.start(news => io.emit('news', news));

// ==============================
// Global error handling
// ==============================
process.on('uncaughtException', err => console.error('❌ Uncaught Exception:', err));
process.on('unhandledRejection', err => console.error('❌ Unhandled Rejection:', err));

// ==============================
// Start Server
// ==============================
server.listen(PORT, ()=> {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
  console.log(`👉 Backend disponível em ${process.env.BACKEND_URL}`);
});
