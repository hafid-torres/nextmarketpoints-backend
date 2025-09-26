const axios = require("axios");
const xml2js = require("xml2js");
require("dotenv").config();

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
let latestNews = [];

// -----------------------------
// 🔹 FONTES RSS
// -----------------------------
const RSS_SOURCES = [
  { name: "Investing", url: "https://www.investing.com/rss/news.rss" },
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews" },
  { name: "FXStreet", url: "https://www.fxstreet.com/rss/news" },
];

// -----------------------------
// 🔹 MAPA DE SÍMBOLOS
// -----------------------------
const SYMBOL_MAP = {
  GOLD: /(XAUUSD|gold)/i,
  SILVER: /(XAGUSD|silver)/i,
  US500Cash: /(S&P|SPX|US500)/i,
  US30Cash: /(Dow|DJI|US30)/i,
  US100Cash: /(Nasdaq|NDX|US100)/i,
  US2000Cash: /(Russell|RUT|US2000)/i,
  UK100Cash: /(FTSE|UK100)/i,
  GER40Cash: /(DAX|GER40)/i,
  JP225Cash: /(Nikkei|CAC|JP225)/i,
  HK50Cash: /(Hang Seng|HSI|HK50)/i,
  ChinaHCash: /(Shanghai|ChinaH)/i,
  Apple: /(AAPL|Apple)/i,
  MICROSOFT: /(MSFT|Microsoft)/i,
  AMAZON: /(AMZN|Amazon)/i,
  GOOGLE: /(GOOGL|Alphabet|Google)/i,
  TESLA: /(TSLA|Tesla)/i,
  FACEBOOK: /(META|Facebook)/i,
  Nvidia: /(NVDA|Nvidia)/i,
  NETFLIX: /(NFLX|Netflix)/i,
  JPMorgan: /(JPM|JPMorgan|JP Morgan)/i,
  OILCash: /(Oil|Crude|WTI|Brent)/i,
  NGASCash: /(Gas|NGAS|Natural Gas)/i,
  XPTUSD: /(Platinum|XPTUSD)/i,
  XPDUSD: /(Palladium|XPDUSD)/i,
  "VIX-OCT25": /(VIX)/i,
};

// -----------------------------
// 🔹 FUNÇÃO PARA DETECTAR SÍMBOLOS
// -----------------------------
function detectSymbols(text) {
  const found = [];
  for (const [symbol, regex] of Object.entries(SYMBOL_MAP)) {
    if (regex.test(text)) found.push(symbol);
  }
  return found;
}

// -----------------------------
// 🔹 BUSCA NEWSAPI
// -----------------------------
async function fetchNewsAPI() {
  if (!NEWSAPI_KEY) return [];
  try {
    const res = await axios.get("https://newsapi.org/v2/everything", {
      params: {
        q: Object.keys(SYMBOL_MAP).join(" OR "),
        language: "en",
        sortBy: "publishedAt",
        pageSize: 10,
        apiKey: NEWSAPI_KEY,
      },
    });
    return res.data.articles || [];
  } catch (e) {
    console.error("❌ NewsAPI indisponível:", e.message);
    return [];
  }
}

// -----------------------------
// 🔹 BUSCA RSS GENÉRICO
// -----------------------------
async function fetchRSS(source) {
  try {
    const r = await axios.get(source.url);
    const parsed = await xml2js.parseStringPromise(r.data, { mergeAttrs: true });
    const items = parsed.rss?.channel?.[0]?.item || [];
    return items.map(it => {
      const title = it.title?.[0] || "Untitled";
      return {
        title,
        url: it.link?.[0] || "#",
        source: source.name,
        publishedAt: it.pubDate ? new Date(it.pubDate[0]).toISOString() : new Date().toISOString(),
        timestamp: it.pubDate ? new Date(it.pubDate[0]).getTime() : Date.now(),
        impact: /(FED|CPI|inflation|interest rate)/i.test(title) ? "high" : "low",
        symbols: detectSymbols(title),
      };
    });
  } catch (e) {
    console.warn(`⚠️ RSS indisponível (${source.name}):`, e.message);
    return [];
  }
}

// -----------------------------
// 🔹 COMBINAÇÃO DE FONTES
// -----------------------------
async function doFetch() {
  try {
    const newsapiArticles = await fetchNewsAPI();
    const formattedNewsAPI = newsapiArticles.map(a => {
      const title = a.title || "Untitled";
      return {
        title,
        url: a.url || "#",
        source: a.source?.name || "NewsAPI",
        publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : new Date().toISOString(),
        timestamp: a.publishedAt ? new Date(a.publishedAt).getTime() : Date.now(),
        impact: /(FED|CPI|inflation|interest rate)/i.test(title) ? "high" : "low",
        symbols: detectSymbols(title),
      };
    });

    const rssResults = await Promise.all(RSS_SOURCES.map(src => fetchRSS(src).catch(() => [])));
    const allRSS = rssResults.flat();

    const combined = [...formattedNewsAPI, ...allRSS];
    combined.sort((a, b) => b.timestamp - a.timestamp);

    latestNews = combined.slice(0, 20);
    return latestNews;
  } catch (e) {
    console.error("Erro combinando notícias:", e);
    return latestNews;
  }
}

// -----------------------------
// 🔹 EXPORTS
// -----------------------------
module.exports = {
  start: onUpdate => {
    doFetch().then(n => onUpdate(n));
    setInterval(async () => {
      try {
        const n = await doFetch();
        onUpdate(n);
      } catch (e) {
        console.error("Erro atualização news:", e);
      }
    }, 60 * 1000);
  },
  getLatest: () => latestNews,
};
