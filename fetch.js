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

// --- Chi so vi mo tham khao: DXY, dau WTI, quy GLD (Yahoo), lai suat FED + CPI My (FRED CSV, khong can key) ---
async function yahooQuote(sym) {
  const d = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=10d&interval=1d');
  const r = d.chart.result[0];
  const closes = ((r.indicators.quote[0] || {}).close || []).filter((x) => x != null);
  const v = r.meta.regularMarketPrice != null ? r.meta.regularMarketPrice : closes[closes.length - 1];
  // gia dong cua gan nhat KHAC v ro rang (bo qua chinh phien hien tai, ke ca lech lam tron cuc nho)
  let prev = null;
  for (let i = closes.length - 1; i >= 0; i--) { if (Math.abs(closes[i] - v) / v > 1e-4) { prev = closes[i]; break; } }
  const chgPct = prev ? ((v - prev) / prev) * 100 : null;
  return { v, chgPct, vol: r.meta.regularMarketVolume || null };
}

async function fredCsv(id) {
  const txt = await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + id);
  return txt.trim().split('\n').slice(1).map((l) => l.split(','))
    .filter((p) => p[1] && p[1] !== '.').map((p) => [p[0], Number(p[1])]);
}

async function fetchFedCpi() {
  const [dff, cpi] = await Promise.all([fredCsv('DFF'), fredCsv('CPIAUCSL')]);
  const fed = dff[dff.length - 1][1];
  const [curDate, curV] = cpi[cpi.length - 1];
  const yAgo = cpi.find((p) => p[0] === (Number(curDate.slice(0, 4)) - 1) + curDate.slice(4));
  const cpiYoY = yAgo ? (curV / yAgo[1] - 1) * 100 : null;
  return { fed, cpiYoY, cpiMonth: curDate.slice(0, 7), realRate: cpiYoY != null ? fed - cpiYoY : null };
}

// Moi chi so hong rieng le thi bo qua (null), khong lam do bot
async function fetchMacro() {
  const [dxy, oil, gld, fedcpi] = await Promise.allSettled([
    yahooQuote('DX-Y.NYB'), yahooQuote('CL=F'), yahooQuote('GLD'), fetchFedCpi(),
  ]).then((rs) => rs.map((r) => (r.status === 'fulfilled' ? r.value : (console.error('VI MO loi:', r.reason.message), null))));
  return { dxy, oil, gld, ...(fedcpi || {}) };
}

// --- Chi so so sanh + tin hieu tham khao (quy tac minh bach, KHONG phai loi khuyen dau tu) ---
function analyze(hist) {
  const cur = hist[hist.length - 1];
  const now = new Date(cur.t).getTime();
  const win = (days) => hist.filter((x) => now - new Date(x.t).getTime() <= days * 864e5);
  const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);
  const w7 = win(7), w30 = win(30);
  const avg7 = avg(w7, (x) => x.sjc[1]);
  const avg30 = avg(w30, (x) => x.sjc[1]);
  const premAvg30 = avg(w30, (x) => x.spread);
  const pct7 = avg7 ? ((cur.sjc[1] - avg7) / avg7) * 100 : null;
  const pct30 = avg30 ? ((cur.sjc[1] - avg30) / avg30) * 100 : null;
  const gap = cur.sjc[1] - cur.sjc[0]; // bien mua-ban
  const gapPct = (gap / cur.sjc[1]) * 100;

  let score = 0;
  const reasons = [];
  if (pct7 != null) {
    if (pct7 < 0) { score++; reasons.push('giá thấp hơn TB 7 ngày'); }
    else if (pct7 > 1) { score--; reasons.push('giá cao hơn TB 7 ngày >1%'); }
  }
  if (pct30 != null) {
    if (pct30 < -1) { score++; reasons.push('giá thấp hơn TB 30 ngày >1%'); }
    else if (pct30 > 3) { score--; reasons.push('giá cao hơn TB 30 ngày >3%'); }
  }
  if (premAvg30 != null) {
    if (cur.spread <= premAvg30) { score++; reasons.push('chênh với thế giới thấp hơn mức bình thường'); }
    else if (cur.spread > premAvg30 + 1e6) { score--; reasons.push('chênh với thế giới cao hơn bình thường >1 triệu'); }
  }
  if (gapPct > 3.5) { score--; reasons.push('biên mua–bán rộng (rủi ro thanh khoản)'); }

  let signal, label;
  if (score >= 2) { signal = 'green'; label = 'Tương đối thuận lợi để mua'; }
  else if (score <= -1) { signal = 'red'; label = 'Giá đang cao — cân nhắc chờ'; }
  else { signal = 'yellow'; label = 'Trung lập — chưa có lợi thế rõ rệt'; }
  return { avg7, avg30, pct7, pct30, premAvg30, gap, gapPct, score, signal, label, reasons };
}

const TZ = 'Asia/Ho_Chi_Minh';
const vnTime = (iso) => new Date(iso).toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

(async () => {
  const [dom, xau, usdvnd, macro] = await Promise.all([
    labeled('TRONG NUOC', fetchDomestic()),
    labeled('THE GIOI', fetchXau()),
    labeled('TY GIA', fetchUsdVnd()),
    fetchMacro(), // khong bao gio throw
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
    macro,
  };

  const docs = path.join(__dirname, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const histFile = path.join(docs, 'history.json');
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch (e) { /* lan dau chua co */ }
  hist.push(snap);
  if (hist.length > 6000) hist = hist.slice(-6000); // ~10 thang voi ~19 lan/ngay
  fs.writeFileSync(histFile, JSON.stringify(hist));

  const analysis = analyze(hist);
  const latest = { ...snap, tVN: vnTime(snap.t), analysis };
  fs.writeFileSync(path.join(docs, 'latest.json'), JSON.stringify(latest, null, 2));

  console.log('OK:', JSON.stringify(snap));
  console.log('PHAN TICH:', JSON.stringify(analysis));
})().catch((e) => { console.error('FETCH LOI:', e.message); process.exit(1); });
