// Server tinh don gian de xem thu dashboard gold-bot (chi dung khi test local)
const http = require('http'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'docs');
const PORT = process.env.PORT || 8788;
const TYPES = { '.html':'text/html; charset=utf-8', '.json':'application/json; charset=utf-8', '.js':'text/javascript', '.css':'text/css' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(DIR, p);
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Serving docs on http://localhost:' + PORT));
