# 🛒 Sales Bot — Bot chốt đơn + sổ tiền hàng

Bot Telegram giúp thay Excel thủ công: ghi sổ đơn hàng, theo dõi tiền đã thu / chưa thu, báo cáo cuối ngày. Chạy hoàn toàn trên GitHub Actions (miễn phí, không cần bật máy) — cùng kiến trúc với gold-bot.

## Quy trình sử dụng hằng ngày

1. Khách comment chốt đơn trên Facebook → bạn **chụp màn hình** comment.
2. Gửi ảnh (hoặc gõ mô tả đơn) vào chat Telegram với bot.
3. AI đọc ảnh, trích xuất đơn (tên, SĐT, hàng, tiền) và **tự ghi sổ**, trả lời xác nhận.
4. Khi gửi hàng / thu tiền: nhắn `gui 12`, `thu 12` — không cần mở Excel.
5. **20h mỗi tối** bot gửi báo cáo: đơn hôm nay, doanh thu, đã thu, còn nợ, đơn quá hạn.

> ⏱ Bot đọc tin nhắn theo chu kỳ ~5 phút (GitHub Actions có thể trễ 5–15 phút), nên trả lời không tức thì. Đây là đánh đổi để chạy miễn phí không cần server.

## Lệnh

| Lệnh | Ý nghĩa |
|---|---|
| *(gửi ảnh chụp comment)* | AI trích xuất đơn và ghi sổ |
| *(gõ mô tả tự do)* | AI trích xuất đơn từ văn bản |
| `don Tên \| hàng \| tiền \| sđt` | Ghi sổ thủ công, không cần AI |
| `thu 12` / `thu 12 350k` | Đánh dấu đã thu tiền đơn #12 (kèm giá nếu đơn chưa có) |
| `gui 12` | Đánh dấu đã gửi hàng |
| `huy 12` | Hủy đơn |
| `ds` | Danh sách đơn đang mở |
| `no` | Công nợ — tổng tiền chưa thu |
| `bc` | Báo cáo ngay |
| `help` | Trợ giúp |

Lệnh gõ không dấu hay có dấu đều được (`gui`/`gửi`, `huy`/`hủy`).

## Cài đặt (một lần, ~15 phút)

Dữ liệu đơn hàng chứa tên + SĐT khách nên **không lưu trong repo public** — bot lưu vào một **secret gist** (chỉ bạn xem được).

1. **Tạo secret gist**: vào <https://gist.github.com> → tạo gist mới, chọn **Create secret gist**, tên file `orders.json`, nội dung `{"seq":0,"orders":[]}`. Lưu lại **ID gist** (chuỗi dài trong URL).
2. **Tạo token gist**: <https://github.com/settings/tokens> → *Generate new token (classic)* → chỉ tick quyền **gist** → tạo và copy token.
3. **Thêm secrets** vào repo (Settings → Secrets and variables → Actions):
   - `GIST_ID` — ID gist ở bước 1
   - `GIST_TOKEN` — token ở bước 2
   - `ANTHROPIC_API_KEY` — API key Claude, lấy tại <https://console.anthropic.com> (tùy chọn — không có thì vẫn dùng được lệnh `don ...`, chỉ mất tính năng AI đọc ảnh/văn bản)
   - `TELEGRAM_TOKEN`, `CHAT_ID` — đã có sẵn từ gold-bot
4. Nhắn `help` cho bot trên Telegram, đợi vài phút để bot trả lời — xong.

## Chi phí

- GitHub Actions + Gist: miễn phí.
- Claude API: chỉ tốn khi gửi ảnh/văn bản cho AI đọc, cỡ vài trăm đồng mỗi ảnh.

## Cấu trúc

| File | Vai trò |
|---|---|
| `sales/bot.js` | Nhận lệnh Telegram, ghi sổ, báo cáo |
| `sales/ai.js` | Gọi Claude API đọc ảnh/văn bản → đơn hàng |
| `sales/store.js` | Đọc/ghi sổ đơn trong secret gist |
| `.github/workflows/sales.yml` | Lịch chạy tự động |
