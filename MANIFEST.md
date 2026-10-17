# MANIFEST — Gói 61: Tích hợp giao hàng AhaMove / Lalamove

> Spec: `your_files/spec-giao-hang-ahamove-lalamove/spec-giao-hang-ahamove-lalamove.md`
> Ngày đóng gói: 2026-10-17. Người code: MAIN (chat DBOMNI - MAIN).
> **Trạng thái: ĐÃ QUA TESTER DUYỆT** (bản 61b, fix 3 lỗi đỏ + 8 mục vàng).

## 1. Thứ tự apply

- Giải nén đè vào `D:\WORK\VIBE` (giữ cấu trúc `dbomni/`, `fnb-frontend/`, `zalo-miniapp/`).
- **Phụ thuộc:** yêu cầu đã apply `goi-60-hoan-chinh.zip` (Gói 60 hub nhân viên) trước đó.
  Nếu chưa apply gói 60 hub, các file `OrderController.php`, `OnlineOrderController.php`,
  `routes/api.php` trong gói này vẫn đè được (chúng chứa cả phần hub + giao hàng),
  nhưng các trang hub (`StaffHub.jsx`...) sẽ thiếu — nên apply gói 60 hub trước.
- Gói này **đè lên** các file đã có (không xóa file nào).

## 2. Migration + lệnh chạy

Migration mới: `2026_10_17_000060_delivery_integration.php`
- Thêm 19 cột `delivery_*` vào bảng `orders` (gồm `delivery_dropoff_lat/lng`, `delivery_returned`).
- Tạo bảng mới `delivery_logs` (lưu webhook + failover, tra cứu theo `provider_order_id`).
- **Lưu ý:** file migration đã được sửa trực tiếp 1 lần (thêm 3 cột) — chấp nhận được
  vì Gói 61 chưa từng được apply ở bất kỳ đâu.

Chạy tại `D:\WORK\VIBE\dbomni`:
```powershell
docker compose exec laravel.test php artisan migrate
```

## 3. Lệnh restart + cd path

Chạy tại `D:\WORK\VIBE\dbomni`:
```powershell
docker compose restart laravel.test
```

Frontend (admin + Mini App) — chạy tại từng thư mục, **chỉ khi Đại Vương build production**:
- `D:\WORK\VIBE\fnb-frontend`: `npm run build`
- `D:\WORK\VIBE\zalo-miniapp`: `npm run build`

**Bắt buộc cho failover tự động:** cron `schedule:run` mỗi phút trên server.
Nếu chưa có, failover quá 5 phút không tự chạy (đơn vẫn nằm chờ, Admin thấy được).

**Cấu hình API key** (file `.env` của backend, tại `D:\WORK\VIBE\dbomni`):
```dotenv
AHAMOVE_API_KEY=
AHAMOVE_BASE_URL=https://partner-apistg.ahamove.com/v3
AHAMOVE_WEBHOOK_SECRET=
LALAMOVE_API_KEY=
LALAMOVE_API_SECRET=
LALAMOVE_MARKET=VN
LALAMOVE_BASE_URL=
LALAMOVE_WEBHOOK_SECRET=
DELIVERY_FAILOVER_TIMEOUT_MINUTES=5
```
Chưa có key → hệ thống tự dùng cách tính phí ship cũ, không lỗi.
**Lưu ý:** thiếu `*_WEBHOOK_SECRET` thì webhook bị từ chối (fail-closed) —
trang Thiết lập → Giao hàng sẽ hiện cảnh báo đỏ.

## 4. Đại Vương test trong 10 phút

1. **Thiết lập → card "Giao hàng"**: bật/tắt hãng, đổi ngưỡng failover (5 phút),
   trần chênh (mặc định 10.000đ), ngưỡng hỗ trợ (150.000đ → hỗ trợ 15.000đ). Bấm Lưu.
2. **Mini App → đặt đơn giao hàng**: nhập địa chỉ → thấy 2 gói (Nhanh mặc định,
   Siêu Tốc). Phí ship hiện trong ~2 giây. Đặt đơn → tổng tiền tách dòng rõ ràng.
3. **KDS**: đơn mới hiện, bấm xác nhận (pending → processing) → đơn hãng được tạo
   (cần API key thật hoặc kiểm tra log `delivery_logs`).
4. **Admin → Hóa đơn**: lọc theo hãng giao (AhaMove/Lalamove), trạng thái giao,
   tick "Đã failover". Mở chi tiết đơn → thấy badge hãng + nút "Thử tạo lại đơn hãng".
5. **Mini App → Theo dõi đơn**: thấy timeline giao hàng (tìm tài xế → đang giao...),
   tên/SĐT tài xế, link theo dõi (poll 5 giây tự cập nhật).

## 5. Rollback nếu lỗi

1. Xóa các file mới:
   - `dbomni/app/Services/Delivery/` (cả thư mục)
   - `dbomni/app/Models/DeliveryLog.php`
   - `dbomni/app/Http/Controllers/Api/DeliveryController.php`
   - `dbomni/app/Http/Controllers/Api/DeliveryWebhookController.php`
   - `dbomni/app/Console/Commands/CheckDeliveryFailover.php`
   - `dbomni/config/delivery.php`
   - `fnb-frontend/src/pages/admin/DeliverySettings.jsx`
2. Rollback migration (chạy tại `D:\WORK\VIBE\dbomni`):
   ```powershell
   docker compose exec laravel.test php artisan migrate:rollback --step=1
   ```
3. Khôi phục các file đã sửa từ Git:
   ```powershell
   git checkout HEAD -- dbomni/app/Models/Order.php dbomni/app/Http/Controllers/Api/OrderController.php dbomni/app/Http/Controllers/Api/OnlineOrderController.php dbomni/routes/api.php dbomni/routes/console.php fnb-frontend/src/KdsScreen.jsx fnb-frontend/src/pages/admin/Orders.jsx fnb-frontend/src/pages/admin/Settings.jsx zalo-miniapp/src/api.js zalo-miniapp/src/pages/Checkout.jsx zalo-miniapp/src/pages/TrackOrder.jsx
   ```
   (chạy tại `D:\WORK\VIBE`)
4. Restart backend: `docker compose restart laravel.test` tại `D:\WORK\VIBE\dbomni`.

## Ghi chú quyết định

- **Trần chênh failover mặc định 10.000đ/đơn** (DELIVERY chưa cho số cụ thể).
  Chênh điển hình ~2.140đ ở 5km nên 10.000đ là trần an toàn.
  Đại Vương chỉnh trong Thiết lập → Giao hàng.
- **Trạng thái giao nội bộ** map vào 7 giá trị mới ở cột `delivery_status`
  (không dùng chung enum `status` của đơn): `searching_driver`, `driver_assigned`,
  `picked_up`, `delivering`, `delivered`, `failed`, `cancelled`.
- **Thông báo cho khách**: qua trang Theo dõi đơn (poll 5s), chưa có push/Zalo OA.

## 3 lưu ý runtime của TESTER (bắt buộc đọc)

(a) **Failover tự động + dọn log cần cron `schedule:run` mỗi phút.**
Trên máy Đại Vương chưa xác nhận đã có cron này — nếu chưa có, đơn quá 5 phút
không tự chuyển hãng (vẫn nằm chờ, Admin thấy được để xử lý tay).

(b) **Bắt buộc test sandbox với API key thật trước khi mở production** (checklist #31).
Đăng ký key ở developers.ahamove.com và developers.lalamove.com, chạy thử
end-to-end các kịch bản (đặt thường, failover, hủy, cả 2 hãng không có tài xế)
rồi mới đổi sang key production.

(c) **Webhook bị từ chối 401 cho đến khi set đủ 2 webhook secret** (đúng thiết kế
fail-closed chống giả mạo). Thêm vào `.env` (xem mục 3):
`AHAMOVE_WEBHOOK_SECRET` và `LALAMOVE_WEBHOOK_SECRET`.
Trang Thiết lập → Giao hàng sẽ hiện cảnh báo đỏ khi thiếu.
