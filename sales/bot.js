/*
 * bot.js - Bot chot don + so tien hang qua Telegram, chay bang GitHub Actions.
 * Che do:
 *   node sales/bot.js poll    -> doc tin nhan Telegram moi (getUpdates) va xu ly
 *   node sales/bot.js report  -> gui bao cao tien hang cuoi ngay
 *
 * Cach dung (nhan tin cho bot):
 *   - Gui ANH chup man hinh comment Facebook  -> AI trich xuat don, ghi so
 *   - Gui text tu do ("chi Lan chot 2 ao thun size M 350k, 09xx...") -> AI ghi so
 *   - don Ten | hang | tien | sdt             -> ghi so khong can AI
 *   - thu 12 [350k]  -> danh dau da thu tien don #12
 *   - gui 12         -> danh dau da gui hang don #12
 *   - huy 12         -> huy don #12
 *   - ds / no / bc   -> danh sach don mo / cong no / bao cao
 *
 * Env: TELEGRAM_TOKEN, CHAT_ID, GIST_TOKEN, GIST_ID, ANTHROPIC_API_KEY (tuy chon)
 */
const store = require('./store');
const ai = require('./ai');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT = process.env.CHAT_ID;
const MODE = (process.argv[2] || 'poll').toLowerCase();
const TZ = 'Asia/Ho_Chi_Minh';
const OVERDUE_DAYS = 3; // don gui qua so ngay nay chua thu tien -> nhac

// ---------- tien ich ----------
const money = (n) => (n == null ? '?' : Math.round(n).toLocaleString('vi-VN') + 'đ');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// bo dau tieng Viet + thuong hoa, de go lenh khong dau van hieu
const plain = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const vnDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD theo gio VN
const vnTime = (d) => new Date(d).toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

// "350k" -> 350000, "1tr2" -> 1200000, "1.200.000" -> 1200000, "350" -> 350000
function parseMoney(raw) {
  if (raw == null) return null;
  const s = plain(String(raw)).replace(/\s/g, '').replace(/,/g, '.').replace(/vnd$|d$/i, '');
  let m = s.match(/^(\d+)tr(\d+)?$/);
  if (m) return Number(m[1]) * 1e6 + (m[2] ? Number((m[2] + '00').slice(0, 3)) * 1000 : 0);
  m = s.match(/^(\d+)[.](\d+)tr$/);
  if (m) return Number(m[1]) * 1e6 + Number((m[2] + '00').slice(0, 3)) * 1000;
  m = s.match(/^(\d+)k$/);
  if (m) return Number(m[1]) * 1000;
  const digits = s.replace(/\./g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return n < 1000 ? n * 1000 : n; // "350" hieu la 350k
}

// ---------- telegram ----------
async function tg(method, params) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method} loi: ${j.description}`);
  return j.result;
}

const reply = (text) => tg('sendMessage', { chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true });

async function downloadPhoto(msg) {
  const sizes = msg.photo || [];
  if (!sizes.length) return null;
  const file = await tg('getFile', { file_id: sizes[sizes.length - 1].file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
  if (!r.ok) throw new Error(`Tai anh loi ${r.status}`);
  const ext = (file.file_path.split('.').pop() || 'jpg').toLowerCase();
  const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { data: Buffer.from(await r.arrayBuffer()).toString('base64'), mediaType };
}

// ---------- so don hang ----------
const STATUS = { new: '🆕 Chốt', shipped: '📦 Đã gửi', paid: '💰 Đã thu', cancelled: '❌ Hủy' };
const active = (o) => o.status === 'new' || o.status === 'shipped';

function addOrder(book, data, source) {
  book.seq += 1;
  const o = {
    id: book.seq,
    created: new Date().toISOString(),
    customer: data.customer || 'Khách lẻ',
    phone: data.phone || null,
    items: data.items || '',
    amount: data.amount != null ? Math.round(Number(data.amount)) : null,
    note: data.note || null,
    status: 'new',
    shippedAt: null,
    paidAt: null,
    source,
  };
  book.orders.push(o);
  return o;
}

const orderLine = (o) => {
  let s = `<b>#${o.id}</b> ${esc(o.customer)}${o.phone ? ' · ' + esc(o.phone) : ''} — ${esc(o.items)} — <b>${money(o.amount)}</b>`;
  if (o.note) s += ` <i>(${esc(o.note)})</i>`;
  return s;
};

// ---------- xu ly lenh ----------
const HELP = `🛒 <b>Bot chốt đơn — lệnh</b>
• Gửi <b>ảnh chụp comment</b> hoặc <b>mô tả đơn</b> → bot tự ghi sổ
• <code>don Tên | hàng | tiền | sđt</code> — ghi sổ không cần AI
• <code>thu 12</code> hoặc <code>thu 12 350k</code> — đã thu tiền đơn #12
• <code>gui 12</code> — đã gửi hàng · <code>huy 12</code> — hủy đơn
• <code>ds</code> — đơn đang mở · <code>no</code> — công nợ · <code>bc</code> — báo cáo`;

function findOrder(book, idRaw) {
  const id = Number(String(idRaw || '').replace('#', ''));
  const o = book.orders.find((x) => x.id === id);
  if (!o) throw new Error(`Không tìm thấy đơn #${idRaw}. Gõ <code>ds</code> để xem danh sách.`);
  return o;
}

async function createOrders(book, list, source) {
  if (!list.length) return '🤷 Không nhận ra đơn hàng nào trong nội dung vừa gửi.';
  const created = list.map((d) => addOrder(book, d, source));
  const lines = created.map((o) => '✅ ' + orderLine(o));
  const noAmount = created.filter((o) => o.amount == null).map((o) => o.id);
  let s = `🛒 <b>Đã ghi ${lines.length} đơn:</b>\n` + lines.join('\n');
  if (noAmount.length) s += `\n\n⚠️ Đơn chưa có giá: ${noAmount.map((i) => '#' + i).join(', ')} — bổ sung bằng <code>thu &lt;số đơn&gt; &lt;tiền&gt;</code> khi thu.`;
  return s;
}

async function handleText(book, text) {
  const p = plain(text);
  const [cmd, ...rest] = p.split(/\s+/);

  if (['help', '?', '/start', '/help', 'menu'].includes(cmd)) return HELP;

  if (cmd === 'thu') {
    const o = findOrder(book, rest[0]);
    const amt = rest[1] != null ? parseMoney(rest[1]) : null;
    if (amt != null) o.amount = amt;
    if (o.amount == null) return `⚠️ Đơn #${o.id} chưa có giá. Gõ <code>thu ${o.id} 350k</code> kèm số tiền.`;
    o.status = 'paid';
    o.paidAt = new Date().toISOString();
    return `💰 Đã thu <b>${money(o.amount)}</b> — ${orderLine(o)}`;
  }
  if (cmd === 'gui') {
    const o = findOrder(book, rest[0]);
    o.status = 'shipped';
    o.shippedAt = new Date().toISOString();
    return `📦 Đã gửi hàng — ${orderLine(o)}`;
  }
  if (cmd === 'huy') {
    const o = findOrder(book, rest[0]);
    o.status = 'cancelled';
    return `❌ Đã hủy — ${orderLine(o)}`;
  }
  if (cmd === 'ds') {
    const list = book.orders.filter(active).slice(-30);
    if (!list.length) return '🎉 Không có đơn nào đang mở.';
    return `📋 <b>Đơn đang mở (${list.length}):</b>\n` + list.map((o) => `${STATUS[o.status]} ${orderLine(o)}`).join('\n');
  }
  if (cmd === 'no') {
    const list = book.orders.filter(active);
    if (!list.length) return '🎉 Không còn công nợ.';
    const total = list.reduce((s, o) => s + (o.amount || 0), 0);
    return `💸 <b>Chưa thu ${money(total)} (${list.length} đơn):</b>\n` + list.slice(-30).map((o) => `${STATUS[o.status]} ${orderLine(o)} · từ ${vnTime(o.created)}`).join('\n');
  }
  if (cmd === 'bc') return buildReport(book);

  // "don Ten | hang | tien | sdt" -> nhap tay, khong can AI
  if (cmd === 'don') {
    const parts = text.replace(/^\s*\S+\s*/, '').split('|').map((x) => x.trim());
    if (!parts[0]) return 'Cú pháp: <code>don Tên | hàng | tiền | sđt</code>';
    return createOrders(book, [{ customer: parts[0], items: parts[1] || '', amount: parseMoney(parts[2]), phone: parts[3] || null }], 'manual');
  }

  // van ban tu do -> nho AI trich xuat
  if (!ai.hasKey()) {
    return '🤖 Chưa cấu hình <code>ANTHROPIC_API_KEY</code> nên bot không tự đọc được văn bản tự do.\nDùng cú pháp: <code>don Tên | hàng | tiền | sđt</code>';
  }
  return createOrders(book, await ai.parseOrders({ text }), 'ai-text');
}

async function handleMessage(book, msg) {
  if (msg.photo && msg.photo.length) {
    if (!ai.hasKey()) return '🤖 Chưa cấu hình <code>ANTHROPIC_API_KEY</code> nên bot chưa đọc được ảnh.';
    const image = await downloadPhoto(msg);
    return createOrders(book, await ai.parseOrders({ text: msg.caption, image }), 'ai-photo');
  }
  if (msg.text) return handleText(book, msg.text);
  return null; // sticker, voice... bo qua
}

// ---------- bao cao ----------
function buildReport(book) {
  const today = vnDate(new Date());
  const notCancelled = book.orders.filter((o) => o.status !== 'cancelled');
  const todayOrders = notCancelled.filter((o) => vnDate(o.created) === today);
  const todayPaid = book.orders.filter((o) => o.paidAt && vnDate(o.paidAt) === today);
  const open = book.orders.filter(active);
  const openTotal = open.reduce((s, o) => s + (o.amount || 0), 0);
  const overdue = open.filter((o) => Date.now() - new Date(o.created).getTime() > OVERDUE_DAYS * 864e5);

  let s = `🧾 <b>BÁO CÁO TIỀN HÀNG</b> · ${new Date().toLocaleDateString('vi-VN', { timeZone: TZ })}\n\n`;
  s += `🛒 Đơn hôm nay: <b>${todayOrders.length}</b> — doanh thu chốt <b>${money(todayOrders.reduce((x, o) => x + (o.amount || 0), 0))}</b>\n`;
  s += `💰 Đã thu hôm nay: <b>${money(todayPaid.reduce((x, o) => x + (o.amount || 0), 0))}</b> (${todayPaid.length} đơn)\n`;
  s += `💸 Còn phải thu: <b>${money(openTotal)}</b> (${open.length} đơn)\n`;
  if (overdue.length) {
    s += `\n⏰ <b>Quá ${OVERDUE_DAYS} ngày chưa thu:</b>\n` + overdue.slice(-15).map((o) => `${STATUS[o.status]} ${orderLine(o)} · từ ${vnTime(o.created)}`).join('\n');
  }
  return s;
}

// ---------- main ----------
async function poll() {
  const data = await store.load();
  const updates = await tg('getUpdates', { offset: data.state.offset || 0, timeout: 0, allowed_updates: ['message'] });
  if (!updates.length) { console.log('Khong co tin nhan moi.'); return; }

  for (const u of updates) {
    data.state.offset = u.update_id + 1;
    const msg = u.message;
    if (!msg || String(msg.chat.id) !== String(CHAT)) continue; // chi nhan lenh tu chu shop
    try {
      const out = await handleMessage(data.orders, msg);
      if (out) await reply(out);
    } catch (e) {
      console.error(e);
      await reply(`⚠️ Lỗi: ${esc(e.message)}`).catch(() => {});
    }
  }
  await store.save(data);
  console.log(`Da xu ly ${updates.length} update.`);
}

async function report() {
  const data = await store.load();
  const book = data.orders;
  const today = vnDate(new Date());
  const hasToday = book.orders.some((o) => vnDate(o.created) === today || (o.paidAt && vnDate(o.paidAt) === today));
  const hasOpen = book.orders.some(active);
  if (!hasToday && !hasOpen) { console.log('Khong co gi de bao cao.'); return; }
  await reply(buildReport(book));
  console.log('Da gui bao cao.');
}

(async () => {
  for (const [k, v] of Object.entries({ TELEGRAM_TOKEN: TOKEN, CHAT_ID: CHAT, GIST_TOKEN: process.env.GIST_TOKEN, GIST_ID: process.env.GIST_ID })) {
    if (!v) { console.log(`Chua cau hinh secret ${k} -> bo qua lan chay nay.`); return; } // chua setup xong thi im lang
  }
  if (MODE === 'report') await report();
  else await poll();
})().catch((e) => { console.error(e); process.exit(1); });
