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
app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));
app.use(express.json());

const server = http.createServer(app);

// ==============================
// Socket.IO com CORS unificado
// ==============================
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] }
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
    const news = newsModule.getLatest();
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
  console.log('🟢 /ea-tick recebido:', ticks);

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

  if (processedTicks.length === 0) {
    console.warn('⚠️ /ea-tick não processou nenhum tick válido');
    return res.status(400).json({ error: 'Nenhum tick válido recebido' });
  }

  res.json({ status: 'ok', processed: processedTicks.length, symbols: processedTicks });
});

// ==============================
// Lista de símbolos, candles e constantes
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
const candlesBySymbol = {};
SYMBOLS.forEach(s => candlesBySymbol[s] = []);

// ==============================
// Restante do código (tickSimulation, sinais, etc.)
// ==============================
// Mantido exatamente como você já tinha, nada foi alterado aqui.
// ==============================

// ==============================
// Socket.IO – conexão
// ==============================
io.on('connection', socket => {
  console.log(`📡 Cliente conectado: ${socket.id}`);
  const payload = {};
  SYMBOLS.forEach(s => payload[s] = candlesBySymbol[s].slice(-200));
  socket.emit('init', { candles: payload, symbols: SYMBOLS });
  socket.emit('news', newsModule.getLatest());
  socket.on('disconnect', () => console.log(`❌ Cliente desconectado: ${socket.id}`));
});

// ==============================
// Intervalos, simulações, newsModule, erros globais
// ==============================
// Mantidos como antes

// ==============================
// Start Server
// ==============================
server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
  console.log(`👉 Backend disponível em ${process.env.BACKEND_URL}`);
});
