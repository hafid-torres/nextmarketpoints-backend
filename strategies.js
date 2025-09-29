// strategies.js
// Motor consolidado de estratégias com prioridade 5m/15m e validação por timeframe superior (daily/weekly)

const DEFAULT_BALANCE = 10000;
const SIGNAL_EXPIRE_SEC = 30 * 60; // 30min
const ASSET_COOLDOWN_SEC = 10 * 60; // 10min
const SCALP_GOLD_COOLDOWN_SEC = 5 * 60; // 5min
const ATR_PERIOD = 14;
const ATR_MULTIPLIER_STOP = 1.5;
const FIB_TARGETS = [0.382, 0.618, 1.0];
const NEWS_WINDOW_MIN = 30; // janela de impacto notícias em min
const VIX_THRESHOLD = 25; // nível crítico de medo global

// Pesos fixos avaliados (maior = mais robusta/consistente)
const WEIGHTS = {
  scalp_gold: 40,
  breakout: 33,
  macd: 30,
  ema_fan: 28,
  ma_crossover: 24,
  volume_spike: 16,
  bollinger: 18,
  rsi: 14
};
const MAX_WEIGHT_POSSIBLE = Math.max(...Object.values(WEIGHTS));

let lastSignalPerAsset = {}; // { symbol: timestamp_ms }

// 🔹 Atualizado com tickers corretos da corretora
const TOP10_ASSETS = ['GOLD','EURUSD','GBPUSD','USDJPY','BTCUSD','ETHUSD','Apple','MICROSOFT','US500Cash','US30Cash'];

// -----------------------------
// Função principal
function checkAll(symbol, candles, balance = DEFAULT_BALANCE, context = {}) {
  try {
    if (!candles || candles.length < 5) return null;

    const now = new Date();
    const timeframe = (context.timeframe || '5m').toLowerCase();
    const higher = context.higher || {};
    const news = context.news || [];
    const vix = context.vix || 20; // valor VIX global
    const potential = [];
    const last = candles[candles.length - 1];

    // ----------------------
    // Estratégias genéricas
    // ----------------------
    const ma9 = SMA(candles, 9);
    const ma21 = SMA(candles, 21);
    if (ma9 && ma21) {
      if (ma9 > ma21 && last.close > ma9)
        potential.push(makeSignal('COMPRA','ma_crossover',WEIGHTS.ma_crossover,['MA9>MA21'],now,symbol));
      if (ma9 < ma21 && last.close < ma9)
        potential.push(makeSignal('VENDA','ma_crossover',WEIGHTS.ma_crossover,['MA9<MA21'],now,symbol));
    }

    const rsi = RSI(candles,14);
    if (rsi !== null) {
      if (rsi < 30) potential.push(makeSignal('COMPRA','rsi',WEIGHTS.rsi,['RSI < 30'],now,symbol));
      if (rsi > 70) potential.push(makeSignal('VENDA','rsi',WEIGHTS.rsi,['RSI > 70'],now,symbol));
    }

    const macdSignal = MACD(candles,12,26,9);
    if (macdSignal === 'BUY') potential.push(makeSignal('COMPRA','macd',WEIGHTS.macd,['MACD BUY'],now,symbol));
    if (macdSignal === 'SELL') potential.push(makeSignal('VENDA','macd',WEIGHTS.macd,['MACD SELL'],now,symbol));

    const boll = BollingerBands(candles,20,2);
    if (boll) {
      if (last.close < boll.lower) potential.push(makeSignal('COMPRA','bollinger',WEIGHTS.bollinger,['Close < lower BB'],now,symbol));
      if (last.close > boll.upper) potential.push(makeSignal('VENDA','bollinger',WEIGHTS.bollinger,['Close > upper BB'],now,symbol));
    }

    const vol = detectVolumeSpike(candles);
    if (vol) potential.push(makeSignal(vol.side === 'up' ? 'COMPRA' : 'VENDA','volume_spike',WEIGHTS.volume_spike,['Volume spike'],now,symbol));

    // ----------------------
    // Estratégias TOP10 ativos
    // ----------------------
    if (TOP10_ASSETS.includes(symbol)) {
      const ema9 = EMA(candles,9);
      const ema21 = EMA(candles,21);
      const ema72 = EMA(candles,72);
      const ema200 = EMA(candles,200);

      if (ema9 && ema21 && ema72 && ema200) {
        // EMA fan trend
        if (ema200 < ema72 && ema72 < ema21 && ema21 < ema9 && last.close > ema9)
          potential.push(makeSignal('COMPRA','ema_fan',WEIGHTS.ema_fan,['EMA fan bullish'],now,symbol));
        if (ema200 > ema72 && ema72 > ema21 && ema21 > ema9 && last.close < ema9)
          potential.push(makeSignal('VENDA','ema_fan',WEIGHTS.ema_fan,['EMA fan bearish'],now,symbol));

        // Pullback EMA200
        if (touchedEMA(candles,200,8)) {
          const dir = ema200 < ema72 ? 'COMPRA' : 'VENDA';
          potential.push(makeSignal(dir,'pullback_ema200',Math.round(WEIGHTS.ema_fan*0.9),['Pullback EMA200'],now,symbol));
        }
      }

      // Scalp refinado
      const scalpCond = scalpConditionForGold(candles);
      if (scalpCond) potential.push(makeSignal(scalpCond.side,'scalp_gold',WEIGHTS.scalp_gold,['Scalp pattern + volume'],now,symbol));

      // Breakout com volume
      const breakout = detectBreakout(candles);
      if (breakout) potential.push(makeSignal(breakout.side === 'up' ? 'COMPRA' : 'VENDA','breakout',WEIGHTS.breakout,['Breakout with volume'],now,symbol));
    }

    if (potential.length === 0) return null;

    // ----------------------
    // Aplicar modificadores de confiança
    // ----------------------
    const penaltyFactor = computeNewsPenalty(symbol, news);
    const higherTrend = computeHigherTrend(symbol, higher, candles);
    const marketStrength = computeMarketStrength(candles); 
    const correlationFactor = computeCorrelationFactor(symbol, context.correlated || {});
    potential.forEach(s => {
      s.confidence = applyConfidenceModifiers(s, penaltyFactor, higherTrend, marketStrength, correlationFactor, vix);
    });

    const finalPotential = potential.filter(p=>p.confidence>=50);
    if (finalPotential.length === 0) return null;

    finalPotential.sort((a,b)=>{
      if (b.weight !== a.weight) return b.weight - a.weight;
      return b.confidence - a.confidence;
    });
    const chosen = finalPotential[0];

    const lastTs = lastSignalPerAsset[symbol] || 0;
    const diffSec = (Date.now() - lastTs)/1000;
    const cooldown = (chosen.strategy === 'scalp_gold') ? SCALP_GOLD_COOLDOWN_SEC : ASSET_COOLDOWN_SEC;
    if (diffSec < cooldown) return null;

    lastSignalPerAsset[symbol] = Date.now();

    return {
      asset: symbol,
      side: chosen.side,
      strategy: chosen.strategy,
      confidence: chosen.confidence,
      reasons: chosen.reasons || [],
      weight: chosen.weight,
      entry: chosen.entry,
      stopLoss: chosen.stopLoss,
      takeProfits: chosen.takeProfits,
      time: chosen.time,
      expiresAt: chosen.expiresAt,
      ativo: chosen.symbol,
      preco: chosen.entry,
      horario: chosen.time
    };

  } catch (e) {
    console.error('❌ Erro em strategies.checkAll:', e);
    return null;
  }
}

// -----------------------------
// Função de volatilidade (novo)
function calculateVolatility(candles, period = 14) {
  if (!candles || candles.length < 2) return 0;
  const closes = candles.slice(-period).map(c => c.close);
  const max = Math.max(...closes);
  const min = Math.min(...closes);
  return max - min;
}

// -----------------------------
// Helpers
function makeSignal(side, strategy, weight, reasons, now, symbol) { return { side, strategy, weight, reasons, time: now.toISOString(), symbol }; }
function SMA(candles, period) { if(candles.length<period) return null; return candles.slice(-period).reduce((a,c)=>a+c.close,0)/period; }
function EMA(candles, period) { if(candles.length<period) return null; const k=2/(period+1); let ema=candles[candles.length-period].close; for(let i=candles.length-period+1;i<candles.length;i++){ const p=candles[i].close; ema=p*k+ema*(1-k);} return ema; }
function RSI(candles, period=14) { if(candles.length<period+1) return null; let gains=0, losses=0; for(let i=candles.length-period;i<candles.length;i++){ const diff=candles[i].close-candles[i-1].close; if(diff>=0) gains+=diff; else losses-=diff; } const rs=gains/(losses||1); return 100-100/(1+rs); }
function MACD(candles,fast=12,slow=26,signalPeriod=9){ if(candles.length<slow+signalPeriod) return null; const emaFast=EMA(candles,fast), emaSlow=EMA(candles,slow); if(emaFast===null||emaSlow===null) return null; const macdLine=emaFast-emaSlow; const macdSignal=EMA_for_value_series(candles,fast,slow,signalPeriod); if(macdSignal===null) return null; if(macdLine>macdSignal) return 'BUY'; if(macdLine<macdSignal) return 'SELL'; return null; }
function EMA_for_value_series(candles,fast,slow,signalPeriod){ if(candles.length<slow+signalPeriod) return null; const macdSeries=[]; for(let i=0;i<candles.length;i++){ const sub=candles.slice(0,i+1); const ef=EMA(sub,fast), es=EMA(sub,slow); if(ef!==null && es!==null) macdSeries.push(ef-es); } if(macdSeries.length<signalPeriod) return null; let ema=macdSeries[macdSeries.length-signalPeriod]; const k=2/(signalPeriod+1); for(let i=macdSeries.length-signalPeriod+1;i<macdSeries.length;i++){ ema=macdSeries[i]*k+ema*(1-k);} return ema; }
function BollingerBands(candles,period=20,mult=2){ if(candles.length<period) return null; const slice=candles.slice(-period); const mean=slice.reduce((a,c)=>a+c.close,0)/period; const variance=slice.reduce((a,c)=>a+Math.pow(c.close-mean,2),0)/period; const sd=Math.sqrt(variance); return { upper: mean+mult*sd, middle: mean, lower: mean-mult*sd }; }
function detectVolumeSpike(candles){ if(candles.length<10) return null; const last10=candles.slice(-10); const avg=last10.reduce((a,c)=>a+c.volume,0)/last10.length; const last=last10[last10.length-1]; if(last.volume>avg*1.8){ const side=last.close>last.open?'up':'down'; return { side }; } return null; }
function detectBreakout(candles,lookback=20){ if(candles.length<lookback+1) return null; const slice=candles.slice(-(lookback+1),-1); const highs=slice.map(c=>c.high), lows=slice.map(c=>c.low); const maxHigh=Math.max(...highs), minLow=Math.min(...lows); const last=candles[candles.length-1]; const avgVol=slice.reduce((a,c)=>a+c.volume,0)/slice.length; if(last.close>maxHigh && last.volume>avgVol*1.2) return {side:'up'}; if(last.close<minLow && last.volume>avgVol*1.2) return {side:'down'}; return null; }
function scalpConditionForGold(candles){ if(candles.length<10) return null; const last=candles[candles.length-1], prev=candles[candles.length-2]; const rsi6=RSI(candles,6); if(!rsi6) return null; const volSpike=last.volume>prev.volume*1.5; if(volSpike && Math.abs(last.close-last.open)/(last.high-last.low+1e-9)>0.6){ const side=last.close>prev.close?'COMPRA':'VENDA'; if((side==='COMPRA'&&rsi6<70)||(side==='VENDA'&&rsi6>30)) return { side };} return null; }
function touchedEMA(candles,period,lookback=8){ const emaVal=EMA(candles,period); if(!emaVal) return false; return candles.slice(-lookback).some(c=>Math.abs(c.close-emaVal)/emaVal<0.0025); }
function computeHigherTrend(symbol,higher={},baseCandles=[]){ try{ const candDaily=higher.daily; const candWeekly=higher.weekly; const choose=candDaily||candWeekly||null; if(!choose||choose.length<50){ if(baseCandles.length>=200){ const ema200=EMA(baseCandles,200), ema72=EMA(baseCandles,72); if(ema200&&ema72) return { direction: ema72>ema200?'up':'down', ema200, note:'fallback_self_ema' };} return null;} const ema200=EMA(choose,200), ema72=EMA(choose,72); if(!ema200||!ema72) return null; const dir=ema72>ema200?'up':'down'; return { direction:dir, ema200, note:'higher_tf' };}catch(e){return null;} }
function computeNewsPenalty(symbol,news=[]){ 
  try{ 
    if(!Array.isArray(news)||news.length===0) return 0; 
    const windowMs=NEWS_WINDOW_MIN*60*1000; 
    const now=Date.now(); 
    for(const item of news){ 
      if(!item.publishedAt) continue; 
      const t=new Date(item.publishedAt).getTime(); 
      if(Math.abs(now-t)<=windowMs){ 
        const title=(item.title||'').toLowerCase(); 
        if(TOP10_ASSETS.includes(symbol)&&(title.includes(symbol.toLowerCase())||title.includes('fed')||title.includes('cpi')||title.includes('inflation'))) return 0.35; 
        return 0.10; 
      } 
    } 
    return 0; 
  }catch(e){return 0;} 
}
function computeMarketStrength(candles){
  if(candles.length<10) return 0;
  const last10=candles.slice(-10);
  const upVol = last10.filter(c=>c.close>c.open).reduce((a,c)=>a+c.volume,0);
  const downVol = last10.filter(c=>c.close<c.open).reduce((a,c)=>a+c.volume,0);
  return (upVol-downVol)/(upVol+downVol||1); // -1 a 1
}
function computeCorrelationFactor(symbol, correlated={}){ return correlated[symbol] || 0; }
function applyConfidenceModifiers(signal, newsPenalty, higherTrend, marketStrength, correlationFactor, vix){
  let conf = Math.round(Math.max(50, Math.min(100, (signal.weight / MAX_WEIGHT_POSSIBLE) * 100 * (1 - newsPenalty))));
  if(higherTrend && higherTrend.direction){
    if((higherTrend.direction==='up' && signal.side==='VENDA') || (higherTrend.direction==='down' && signal.side==='COMPRA')) conf*=0.45;
    else conf=Math.min(100, conf*1.08);
  }
  conf = Math.round(conf*(1+marketStrength*0.15)*(1-correlationFactor*0.25));
  if(vix>VIX_THRESHOLD) conf = Math.round(conf*0.8); 
  signal.confidence = Math.min(100,Math.max(50,conf));
  return signal.confidence;
}

// -----------------------------
// Export
module.exports = { 
  checkAll, 
  calculateVolatility, // ADICIONADA
  __internals: { WEIGHTS, SIGNAL_EXPIRE_SEC, ASSET_COOLDOWN_SEC, SCALP_GOLD_COOLDOWN_SEC } 
};
