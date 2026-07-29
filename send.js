/*
 * send.js - Soan + gui tin Telegram. Moi thoi gian hien thi theo gio Viet Nam.
 * Che do:
 *   node send.js            -> ban tin day du (3 lan/ngay), luon gui, cap nhat moc so sanh (docs/state.json)
 *   node send.js alert      -> kiem tra bien dong: chi gui khi gia doi >= ALERT_THRESHOLD (mac dinh 500.000 d/luong)
 *                              so voi lan GUI TIN gan nhat; khong du bien do thi im lang.
 * Env: TELEGRAM_TOKEN, CHAT_ID, PAGES_URL (tuy chon), ALERT_THRESHOLD (tuy chon)
 */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.CHAT_ID;
const URL = process.env.PAGES_URL || '';
const THRESHOLD = Number(process.env.ALERT_THRESHOLD || 500000); // dong/luong
const MODE = (process.argv[2] || 'bulletin').toLowerCase();
const TZ = 'Asia/Ho_Chi_Minh';

if (!TOKEN || !CHAT) { console.error('Thieu TELEGRAM_TOKEN / CHAT_ID'); process.exit(1); }

const docs = path.join(__dirname, 'docs');
const hist = JSON.parse(fs.readFileSync(path.join(docs, 'history.json'), 'utf8'));
const latest = JSON.parse(fs.readFileSync(path.join(docs, 'latest.json'), 'utf8'));
const cur = hist[hist.length - 1];
const prev = hist.length > 1 ? hist[hist.length - 2] : null;
const A = latest.analysis || {};
const stateFile = path.join(docs, 'state.json');

// dinh dang trieu dong: 141500000 -> "141,50"
const tr = (n) => (n / 1e6).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trS = (n) => (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const num = (n) => Math.round(n).toLocaleString('vi-VN');
const pct = (n) => (n >= 0 ? '+' : '') + n.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';

function delta(now, before) {
  if (before == null || now == null) return '';
  const d = now - before;
  if (Math.abs(d) < 1000) return ' (—)';
  // quy uoc VN: xanh = tang, do = giam
  return d > 0 ? ` (🟢▲${trS(Math.abs(d))})` : ` (🔴▼${trS(Math.abs(d))})`;
}

const when = new Date(cur.t).toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const SIGNAL_ICON = { green: '🟢', yellow: '🟡', red: '🔴' };

function priceBlock(base) {
  // base = moc so sanh (snapshot truoc hoac baseline canh bao)
  let s = `🇻🇳 <b>SJC:</b> ${tr(cur.sjc[0])} – <b>${tr(cur.sjc[1])}</b>${delta(cur.sjc[1], base && base.sjcSell)}\n`;
  if (cur.ring) s += `💍 <b>Nhẫn 9999:</b> ${tr(cur.ring[0])} – <b>${tr(cur.ring[1])}</b>${delta(cur.ring[1], base && base.ringSell)}\n`;
  s += `🌍 <b>Thế giới:</b> ${num(cur.xau)} $/oz ≈ <b>${tr(cur.worldLuong)}</b>${delta(cur.worldLuong, base && base.worldLuong)}\n`;
  s += `📏 Chênh SJC − TG: <b>${cur.spread >= 0 ? '+' : ''}${tr(cur.spread)}</b>\n`;
  s += `💱 USD/VND: ${num(cur.usdvnd)}\n`;
  return s;
}

function macroBlock() {
  const M = cur.macro;
  if (!M) return '';
  const f = (n, d) => n.toLocaleString('vi-VN', { maximumFractionDigits: d == null ? 2 : d });
  const chg = (o) => (o && o.chgPct != null ? (o.chgPct >= 0 ? ` (🟢▲${f(Math.abs(o.chgPct), 2)}%)` : ` (🔴▼${f(Math.abs(o.chgPct), 2)}%)`) : '');
  let s = '';
  if (M.dxy) s += `• USD (DXY): <b>${f(M.dxy.v)}</b>${chg(M.dxy)}${M.dxy.chgPct < 0 ? ' — USD yếu, hỗ trợ vàng' : M.dxy.chgPct > 0 ? ' — USD mạnh, ép giá vàng' : ''}\n`;
  if (M.oil) s += `• Dầu WTI: <b>${f(M.oil.v)} $/thùng</b>${chg(M.oil)}\n`;
  if (M.gld) s += `• Quỹ SPDR GLD: <b>${f(M.gld.v)} $</b>${chg(M.gld)}${M.gld.vol ? ` · KL ${f(M.gld.vol / 1e6, 1)}tr cp` : ''}\n`;
  if (M.fed != null) {
    s += `• Lãi suất FED: <b>${f(M.fed)}%</b>`;
    if (M.cpiYoY != null) s += ` · CPI Mỹ: ${f(M.cpiYoY, 1)}% → LS thực <b>${M.realRate >= 0 ? '+' : ''}${f(M.realRate, 1)}%</b>${M.realRate < 0 ? ' (âm — có lợi cho vàng)' : ''}`;
    s += `\n`;
  }
  if (!s) return '';
  return `\n🌐 <b>Vĩ mô</b> <i>(so phiên trước)</i>\n` + s;
}

function analysisBlock() {
  if (!A.avg7) return '';
  let s = `\n📊 <b>So sánh</b>\n`;
  s += `• So TB 7 ngày: <b>${pct(A.pct7)}</b> · TB 30 ngày: <b>${pct(A.pct30)}</b>\n`;
  s += `• Chênh TG hiện tại ${trS(cur.spread)} tr (TB 30 ngày: ${trS(A.premAvg30)} tr)\n`;
  s += `• Biên mua–bán SJC: ${trS(A.gap)} tr (${A.gapPct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%)\n`;
  s += `\n🧭 <b>Tín hiệu:</b> ${SIGNAL_ICON[A.signal] || '🟡'} <b>${A.label}</b>\n`;
  if (A.reasons && A.reasons.length) s += `<i>Lý do: ${A.reasons.join('; ')}.</i>\n`;
  s += `<i>⚠️ Tín hiệu máy tính theo quy tắc, chỉ để tham khảo — không phải khuyến nghị đầu tư.</i>\n`;
  return s;
}

function baselineFromCur(type) {
  return { t: cur.t, type, sjcSell: cur.sjc[1], ringSell: cur.ring ? cur.ring[1] : null, worldLuong: cur.worldLuong };
}

async function send(text) {
  if (process.env.DRY_RUN) { console.log('--- DRY RUN (khong gui) ---\n' + text); return; }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const b = await r.text();
  console.log('Telegram:', r.status, b.slice(0, 150));
  if (r.status !== 200) process.exit(1);
}

(async () => {
  if (MODE === 'alert') {
    let state = null;
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { /* chua co */ }
    if (!state) {
      // Lan dau: chi ghi moc, khong gui
      fs.writeFileSync(stateFile, JSON.stringify(baselineFromCur('init'), null, 2));
      console.log('Chua co moc so sanh -> tao moc, khong gui.');
      return;
    }
    const moves = [];
    const chk = (label, now, before) => {
      if (now == null || before == null) return;
      const d = now - before;
      if (Math.abs(d) >= THRESHOLD) moves.push({ label, d });
    };
    chk('SJC bán', cur.sjc[1], state.sjcSell);
    chk('Nhẫn 9999 bán', cur.ring && cur.ring[1], state.ringSell);
    chk('Thế giới quy đổi', cur.worldLuong, state.worldLuong);

    if (!moves.length) {
      console.log('Bien dong < ' + num(THRESHOLD) + ' d/luong -> khong gui.');
      return;
    }
    const sinceT = new Date(state.t).toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    let m = `🚨 <b>CẢNH BÁO GIÁ VÀNG ${when}</b> <i>(triệu/lượng)</i>\n`;
    m += `<i>Biến động ≥ ${num(THRESHOLD)} đ/lượng so với bản tin ${sinceT}:</i>\n`;
    for (const mv of moves) m += `• ${mv.label}: ${mv.d > 0 ? '🟢▲ TĂNG' : '🔴▼ GIẢM'} <b>${trS(Math.abs(mv.d))} triệu</b>\n`;
    m += `\n` + priceBlock(state);
    if (URL) m += `\n📈 Biểu đồ: ${URL}`;
    await send(m);
    fs.writeFileSync(stateFile, JSON.stringify(baselineFromCur('alert'), null, 2));
    return;
  }

  // Ban tin day du
  let m = `🥇 <b>Giá vàng ${when}</b> <i>(triệu/lượng)</i>\n\n`;
  m += priceBlock(prev ? { sjcSell: prev.sjc[1], ringSell: prev.ring && prev.ring[1], worldLuong: prev.worldLuong } : null);
  m += macroBlock();
  m += analysisBlock();
  if (URL) m += `\n📈 Biểu đồ: ${URL}`;
  await send(m);
  fs.writeFileSync(stateFile, JSON.stringify(baselineFromCur('bulletin'), null, 2));
})().catch((e) => { console.error('SEND LOI:', e.message); process.exit(1); });
