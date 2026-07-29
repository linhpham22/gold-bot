/*
 * fetch.js - Lay gia vang trong nuoc + the gioi + ty gia, ghi vao docs/history.json + docs/latest.json.
 * Chay tren GitHub Actions (Node 20, khong can thu vien ngoai).
 * Nguon:
 *  - Trong nuoc: edge-api.pnj.io (PNJ, chinh) / api.btmc.vn (Bao Tin Minh Chau, du phong)
 *  - The gioi:   Yahoo Finance GC=F (USD/oz), du phong stooq.com
 *  - Ty gia:     Yahoo Finance VND=X, du phong open.er-api.com
 */
const fs = require('fs');
const path = require('path');

const GRAM_PER_LUONG = 37.5;
const GRAM_PER_OZ = 31.1034768;
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

async function getJson(url, headers) {
  const r = await fetch(url, { headers: headers || UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.json();
}

async function getText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.text();
}

// --- Gia trong nuoc: PNJ (chinh) ---
// Gia PNJ tinh bang NGHIN dong / CHI -> x10000 = dong / LUONG
async function fetchPNJ() {
  const d = await getJson('https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=00');
  const find = (masp) => {
    const r = (d.data || []).find((x) => x.masp === masp);
    if (r && r.giamua > 0 && r.giaban > 0) return { buy: r.giamua * 10000, sell: r.giaban * 10000, at: d.updateAt || '' };
    return null;
  };
  const sjc = find('SJC');
  const ring = find('N24K'); // Nhan Tron PNJ 999.9
  if (!sjc) throw new Error('PNJ: khong co gia SJC');
  return { sjc, ring };
}

// --- Gia trong nuoc: BTMC (du phong) ---
async function fetchBTMC() {
  const d = await getJson('http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v');
  const rows = d.DataList.Data;
  const pick = (needle) => {
    for (const row of rows) {
      const i = row['@row'];
      const name = (row['@n_' + i] || '').toUpperCase();
      if (name.includes(needle)) {
        const buy = Number(row['@pb_' + i]) * 10;  // gia/chi -> gia/luong
        const sell = Number(row['@ps_' + i]) * 10;
        if (buy > 0 && sell > 0) return { buy, sell, at: row['@d_' + i] || '' };
      }
    }
    return null;
  };
  const sjc = pick('VÀNG MIẾNG SJC');
  const ring = pick('NHẪN TRÒN TRƠN');
  if (!sjc) throw new Error('BTMC: khong co gia SJC');
  return { sjc, ring };
}

async function fetchDomestic() {
  try { return await fetchPNJ(); }
  catch (e) {
    console.error('PNJ loi (' + e.message + '), dung BTMC du phong...');
    return fetchBTMC();
  }
}

// --- Vang the gioi (USD/oz) ---
async function fetchXau() {
  try {
    const d = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1d&interval=1d');
    const p = d.chart.result[0].meta.regularMarketPrice;
    if (p > 500 && p < 100000) return p;
    throw new Error('gia GC=F bat thuong: ' + p);
  } catch (e) {
    console.error('Yahoo GC=F loi (' + e.message + '), dung stooq du phong...');
    const csv = await getText('https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=csv');
    const p = Number(csv.trim().split('\n')[1].split(',')[6]); // cot Close
    if (p > 500 && p < 100000) return p;
    throw new Error('stooq cung loi: ' + csv.slice(0, 120));
  }
}

// --- Ty gia USD/VND ---
async function fetchUsdVnd() {
  try {
    const d = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/VND=X?range=1d&interval=1d');
    const p = d.chart.result[0].meta.regularMarketPrice;
    if (p > 15000 && p < 50000) return p;
    throw new Error('ty gia bat thuong: ' + p);
  } catch (e) {
    console.error('Yahoo VND=X loi (' + e.message + '), dung er-api du phong...');
    const d = await getJson('https://open.er-api.com/v6/latest/USD');
    const p = d.rates && d.rates.VND;
    if (p > 15000 && p < 50000) return p;
    throw new Error('er-api cung loi');
  }
}

async function labeled(name, p) {
  try { return await p; }
  catch (e) { throw new Error(name + ': ' + e.message); }
}

(async () => {
  const [dom, xau, usdvnd] = await Promise.all([
    labeled('TRONG NUOC', fetchDomestic()),
    labeled('THE GIOI', fetchXau()),
    labeled('TY GIA', fetchUsdVnd()),
  ]);

  const worldLuong = Math.round(xau * usdvnd * GRAM_PER_LUONG / GRAM_PER_OZ / 1000) * 1000;
  const snap = {
    t: new Date().toISOString(),
    sjc: [dom.sjc.buy, dom.sjc.sell],
    ring: dom.ring ? [dom.ring.buy, dom.ring.sell] : null,
    xau: Math.round(xau * 100) / 100,
    usdvnd: Math.round(usdvnd),
    worldLuong,
    spread: dom.sjc.sell - worldLuong,
    srcAt: dom.sjc.at,
  };

  const docs = path.join(__dirname, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const histFile = path.join(docs, 'history.json');
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch (e) { /* lan dau chua co */ }
  hist.push(snap);
  if (hist.length > 2500) hist = hist.slice(-2500); // ~ 2 nam voi 3 lan/ngay
  fs.writeFileSync(histFile, JSON.stringify(hist));
  fs.writeFileSync(path.join(docs, 'latest.json'), JSON.stringify(snap, null, 2));

  console.log('OK:', JSON.stringify(snap));
})().catch((e) => { console.error('FETCH LOI:', e.message); process.exit(1); });
