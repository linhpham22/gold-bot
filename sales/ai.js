/*
 * ai.js - Goi Claude API de doc tin nhan / anh chup man hinh comment Facebook
 * va trich xuat don hang thanh du lieu co cau truc.
 * Env: ANTHROPIC_API_KEY (khong co key -> bot van chay, chi mat tinh nang AI)
 */
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';

const SYSTEM = `Ban la tro ly nhap don cho mot shop ban hang online tren Facebook o Viet Nam.
Dau vao la MOT trong hai loai:
1. Anh chup man hinh cac comment Facebook duoi bai dang ban hang.
2. Van ban tu do mo ta don hang (chu shop tu go hoac dan lai comment cua khach).

Nhiem vu: tim cac comment/doan text the hien y dinh CHOT MUA that su (khach chot don,
ghi ro mau/size/so luong, de lai SDT...) va trich xuat thanh don hang.
BO QUA: cau tra loi cua chu shop, comment hoi gia chung chung, comment dao, tag ban be, icon.

Tra ve DUY NHAT mot mang JSON (khong markdown, khong giai thich), moi phan tu:
{
  "customer": "ten khach (ten Facebook hien thi trong comment, hoac ten trong text)",
  "phone": "so dien thoai neu co, khong co thi null",
  "items": "mo ta hang: ten san pham + mau + size + so luong, ngan gon",
  "amount": tong tien don hang bang VND (so nguyen, vi du 350000), khong ro thi null,
  "note": "ghi chu them neu co (dia chi, gio giao...), khong co thi null"
}
Luu y tien Viet: "350k" = 350000, "1tr2" = 1200000, "85" trong ngu canh gia thuong la 85000.
Khong chac chan mot comment co phai don chot hay khong thi van dua vao nhung ghi note "can xac nhan".
Khong co don nao thi tra ve [].`;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

// Lay mang JSON tu text tra ve (phong khi model boc trong ```json ... ```)
function extractJsonArray(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new Error('Khong tim thay JSON trong phan hoi AI');
  const arr = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('Phan hoi AI khong phai mang JSON');
  return arr;
}

/*
 * parseOrders({ text, image }) -> mang don hang [{customer, phone, items, amount, note}]
 *   text  : chuoi van ban (tuy chon)
 *   image : { data: <base64>, mediaType: 'image/jpeg' } (tuy chon)
 */
async function parseOrders({ text, image }) {
  const client = getClient();
  if (!client) throw new Error('Chua cau hinh ANTHROPIC_API_KEY');

  const content = [];
  if (image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    });
  }
  content.push({
    type: 'text',
    text: text && text.trim()
      ? text
      : 'Doc anh chup man hinh comment o tren va trich xuat cac don hang theo huong dan.',
  });

  // fallbacks: "default" -> neu model tu choi vi ly do an toan, API tu chay lai
  // tren model du phong trong cung mot request
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4096, // dau ra chi la mot mang JSON ngan
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('AI tu choi xu ly noi dung nay');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('AI khong tra ve van ban');
  return extractJsonArray(textBlock.text);
}

module.exports = { parseOrders, hasKey: () => Boolean(process.env.ANTHROPIC_API_KEY) };
