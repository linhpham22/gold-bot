/*
 * send.js - Doc docs/history.json, soan ban tin gia vang + bien dong, gui Telegram.
 * Env: TELEGRAM_TOKEN, CHAT_ID, PAGES_URL (link dashboard, tuy chon).
 */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.CHAT_ID;
const URL = process.env.PAGES_URL || '';
const TZ = 'Asia/Ho_Chi_Minh';

if (!TOKEN || !CHAT) { console.error('Thieu TELEGRAM_TOKEN / CHAT_ID'); process.exit(1); }

const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs', 'history.json'), 'utf8'));
const cur = hist[hist.length - 1];
const prev = hist.length > 1 ? hist[hist.length - 2] : null;

// dinh dang trieu dong: 141500000 -> "141,50"
const tr = (n) => (n / 1e6).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Math.round(n).toLocaleString('vi-VN');

// bien dong so voi lan cap nhat truoc (don vi trieu/luong)
function delta(now, before) {
  if (before == null || now == null) return '';
  const d = now - before;
  if (Math.abs(d) < 1000) return ' (—)';
  const s = (Math.abs(d) / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  return d > 0 ? ` (🔺${s})` : ` (🔻${s})`;
}

const when = new Date(cur.t).toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

let m = `🥇 <b>Giá vàng ${when}</b> <i>(triệu/lượng)</i>\n\n`;
m += `🇻🇳 <b>SJC:</b> ${tr(cur.sjc[0])} – <b>${tr(cur.sjc[1])}</b>${delta(cur.sjc[1], prev && prev.sjc[1])}\n`;
if (cur.ring) m += `💍 <b>Nhẫn 9999:</b> ${tr(cur.ring[0])} – <b>${tr(cur.ring[1])}</b>${delta(cur.ring[1], prev && prev.ring && prev.ring[1])}\n`;
m += `🌍 <b>Thế giới:</b> ${num(cur.xau)} $/oz ≈ <b>${tr(cur.worldLuong)}</b>${delta(cur.worldLuong, prev && prev.worldLuong)}\n`;
m += `📏 Chênh SJC − TG: <b>${cur.spread >= 0 ? '+' : ''}${tr(cur.spread)}</b>\n`;
m += `💱 USD/VND: ${num(cur.usdvnd)}\n`;
if (URL) m += `\n📈 Biểu đồ: ${URL}`;

(async () => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: m, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const b = await r.text();
  console.log('Telegram:', r.status, b.slice(0, 150));
  if (r.status !== 200) process.exit(1);
})().catch((e) => { console.error('SEND LOI:', e.message); process.exit(1); });
