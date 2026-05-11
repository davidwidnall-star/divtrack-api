const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

const T212_BASE    = 'https://live.trading212.com/api/v0';
const INVEST_KEY   = process.env.T212_INVEST_KEY;
const ISA_KEY      = process.env.T212_ISA_KEY;
const FINN_KEY     = process.env.FINNHUB_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// Helper: fetch all pages from T212
async function fetchAll(key, path) {
  let items = [];
  let url   = T212_BASE + path + '?limit=50';
  while (url) {
    const r    = await fetch(url, { headers: { Authorization: key } });
    const data = await r.json();
    const page = Array.isArray(data) ? data : (data.items || []);
    items = items.concat(page);
    url   = data.nextPagePath ? T212_BASE + data.nextPagePath : null;
  }
  return items;
}

// Helper: single T212 fetch
async function t212(key, path) {
  const r = await fetch(T212_BASE + path, { headers: { Authorization: key } });
  if (!r.ok) throw new Error('T212 error ' + r.status + ' ' + path);
  return r.json();
}

// GET /sync — returns all portfolio data for both accounts
app.get('/sync', async (req, res) => {
  try {
    const [
      investPositions, investCash, investDividends,
      isaPositions,    isaCash,    isaDividends
    ] = await Promise.all([
      t212(INVEST_KEY, '/equity/portfolio'),
      t212(INVEST_KEY, '/equity/account/cash'),
      fetchAll(INVEST_KEY, '/equity/history/dividends'),
      t212(ISA_KEY,    '/equity/portfolio'),
      t212(ISA_KEY,    '/equity/account/cash'),
      fetchAll(ISA_KEY,    '/equity/history/dividends'),
    ]);

    res.json({
      invest: {
        positions:  Array.isArray(investPositions) ? investPositions : (investPositions.items || []),
        cash:       investCash,
        dividends:  investDividends
      },
      isa: {
        positions:  Array.isArray(isaPositions) ? isaPositions : (isaPositions.items || []),
        cash:       isaCash,
        dividends:  isaDividends
      }
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /prices?tickers=LGEN.L,MSFT,O
app.get('/prices', async (req, res) => {
  const tickers = (req.query.tickers || '').split(',').filter(Boolean);
  if (!tickers.length) return res.json({});
  try {
    const results = {};
    await Promise.all(tickers.map(async (tk) => {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(tk)}&token=${FINN_KEY}`;
      const r   = await fetch(url);
      const d   = await r.json();
      results[tk] = d.c || d.pc || null;
    }));
    res.json(results);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /dividends?ticker=LGEN.L
app.get('/dividends', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.json([]);
  const from = new Date(); from.setFullYear(from.getFullYear()-2);
  const to   = new Date(); to.setFullYear(to.getFullYear()+2);
  const url  = `https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(ticker)}&from=${from.toISOString().split('T')[0]}&to=${to.toISOString().split('T')[0]}&token=${FINN_KEY}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    res.json(Array.isArray(d) ? d : []);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', message: 'DivTrack API running' }));

app.listen(PORT, () => console.log('DivTrack API on port ' + PORT));
