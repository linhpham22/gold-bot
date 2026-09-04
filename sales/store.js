/*
 * store.js - Luu tru so don hang trong mot Gist RIENG TU (secret gist).
 * Ly do khong luu vao repo: repo nay public, khong duoc de lo ten/SDT khach hang.
 * Env: GIST_TOKEN (Personal Access Token co quyen "gist"), GIST_ID (id cua gist)
 *
 * Gist gom 2 file:
 *   orders.json  -> { seq: <so thu tu don cuoi>, orders: [ ... ] }
 *   state.json   -> { offset: <telegram update offset> }
 */
const TOKEN = process.env.GIST_TOKEN;
const GIST_ID = process.env.GIST_ID;

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'sales-bot',
};

const EMPTY = { orders: { seq: 0, orders: [] }, state: { offset: 0 } };

async function readFileContent(file) {
  if (!file) return null;
  // gist API cat bot noi dung file > ~1MB -> phai tai tu raw_url
  if (file.truncated) {
    const r = await fetch(file.raw_url, { headers: HEADERS });
    if (!r.ok) throw new Error(`Tai raw gist loi ${r.status}`);
    return r.text();
  }
  return file.content;
}

async function load() {
  const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`Doc gist loi ${r.status}: ${await r.text()}`);
  const g = await r.json();
  const ordersRaw = await readFileContent(g.files['orders.json']);
  const stateRaw = await readFileContent(g.files['state.json']);
  return {
    orders: ordersRaw ? JSON.parse(ordersRaw) : { ...EMPTY.orders },
    state: stateRaw ? JSON.parse(stateRaw) : { ...EMPTY.state },
  };
}

async function save({ orders, state }) {
  const body = {
    files: {
      'orders.json': { content: JSON.stringify(orders, null, 1) },
      'state.json': { content: JSON.stringify(state, null, 1) },
    },
  };
  const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Ghi gist loi ${r.status}: ${await r.text()}`);
}

module.exports = { load, save };
