# 🥇 Gold Bot — Bot cập nhật giá vàng

Bot tự động theo dõi giá vàng, chạy hoàn toàn trên cloud (GitHub Actions) — **không phụ thuộc máy tính bật hay tắt**.

## Hoạt động (mọi giờ đều là giờ Việt Nam)

- **Bản tin 3 lần/ngày** (8h00 · 12h30 · 17h00):
  1. Lấy giá **vàng miếng SJC** + **nhẫn trơn 9999** (nguồn PNJ, dự phòng Bảo Tín Minh Châu)
  2. Lấy giá **vàng thế giới** (Yahoo Finance) + **tỷ giá USD/VND**, quy đổi ra triệu/lượng
  3. Tính **chênh lệch SJC − thế giới**, so sánh **TB 7/30 ngày**, biên mua–bán
  4. Kèm **chỉ số vĩ mô**: chỉ số USD (DXY), dầu WTI, quỹ SPDR GLD (Yahoo Finance); lãi suất FED + CPI Mỹ → lãi suất thực (FRED CSV, không cần key). Chỉ số nào lỗi thì tự bỏ qua, không làm hỏng bản tin.
  5. Đưa **tín hiệu tham khảo** 🟢🟡🔴 theo quy tắc minh bạch (kèm lý do — *không phải khuyến nghị đầu tư*)
  6. Lưu lịch sử vào `docs/history.json` → dashboard GitHub Pages tự cập nhật
  7. Gửi bản tin **Telegram** kèm biến động 🔺🔻 so với lần trước
- **Cảnh báo biến động**: mỗi giờ (7h15–22h15) bot kiểm tra giá; nếu SJC / nhẫn / thế giới thay đổi **≥ ±500.000đ/lượng** so với tin nhắn gần nhất → gửi 🚨 cảnh báo ngay. Ngưỡng chỉnh ở `ALERT_THRESHOLD` trong workflow.

## Cấu trúc

| File | Vai trò |
|---|---|
| `fetch.js` | Lấy giá từ các nguồn, ghi `docs/history.json` + `docs/latest.json` |
| `send.js` | Soạn + gửi bản tin Telegram |
| `docs/index.html` | Dashboard biểu đồ (GitHub Pages) |
| `.github/workflows/gold.yml` | Lịch chạy tự động |

## Secrets (Settings → Secrets and variables → Actions)

- `TELEGRAM_TOKEN` — token bot Telegram
- `CHAT_ID` — id người nhận
- `PAGES_URL` — link dashboard (tùy chọn)

## Chỉnh lịch

Sửa `cron` trong `.github/workflows/gold.yml` (giờ UTC = giờ VN − 7).

## Chạy tay

Tab **Actions** → *Gold price bot* → **Run workflow**.
