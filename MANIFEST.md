# MANIFEST — Gói mật khẩu đăng nhập lần đầu của nhân viên (#102)

- **Ngày:** 2026-11-07
- **Kiểm duyệt:** TESTER ✅ Tĩnh (§BR) + ✅ Sống (§BS) trên máy thử — 6/6 ca sống đạt trọn.
- **Nội dung:** 7 file code (gồm 1 migration mới 000102) + file MANIFEST này.
- **Cách áp:** giải nén đè thẳng vào thư mục gốc `D:\WORK\VIBE` (giữ nguyên cấu trúc `dbomni/` + `fnb-frontend/`).

## Gói này làm gì

- Cổng đăng nhập Hub thành **SĐT + PIN + mật khẩu** (áp cho mọi bề mặt của phone-login): khóa chống dò mật khẩu riêng (sai 5 lần → khóa 15 phút, độc lập với khóa PIN), thông báo lỗi gộp không lộ yếu tố nào sai.
- Nhân viên mới: Admin tạo hồ sơ → hệ thống **tự sinh mật khẩu tạm**, hiện đúng 1 lần trong hộp thoại kết quả tạo; mật khẩu tạm sống 72 giờ, nhân viên **bị ép đổi ở lần đăng nhập đầu** qua vé đổi dùng 1 lần (không có phiên nào được cấp trước khi đổi xong).
- Quên mật khẩu: quản lý bấm **"Cấp mật khẩu"** ở Admin → hệ thống tự sinh mật khẩu tạm mới, phiên cũ của nhân viên bị thu hồi ngay.
- Nhân viên cũ chưa có mật khẩu: trong phiên Hub đang sống có thẻ **"Thiết lập mật khẩu đăng nhập"** (xác nhận bằng PIN); Admin có bộ lọc + huy hiệu **"Chưa có mật khẩu"**.
- Chuẩn mật khẩu khi đặt mới: tối thiểu 8, tối đa 72 ký tự (mật khẩu cũ 6–7 ký tự vẫn đăng nhập được).

## Các bước áp gói (theo thứ tự)

1. Giải nén đè vào `D:\WORK\VIBE`.
2. **Chạy migration 000102** — chạy tại `D:\WORK\VIBE\dbomni`:
   `docker compose exec laravel.test php artisan migrate`
   (thêm 5 cột vòng đời mật khẩu cho bảng `employees`: `must_change_password`, `password_changed_at`, `password_reset_at`, `password_reset_by_user_id`, `password_reset_by_employee_id`)
3. **Restart backend** — chạy tại `D:\WORK\VIBE\dbomni`:
   `docker compose restart laravel.test`
4. **Rebuild giao diện Admin** (Hub nằm trong cùng bản build này) — chạy tại `D:\WORK\VIBE\fnb-frontend`:
   `npm run build`

## Hai lưu ý quan trọng (từ vòng kiểm của TESTER)

1. **Áp gói này SAU gói phiên Hub** — gói phiên Hub đã có trong zip tổng cuối `goi-tong-cuoi-20261107.zip`. Nếu máy đã áp zip tổng cuối thì áp tiếp gói này là đúng thứ tự.
2. **Áp gói KHÔNG thu hồi các phiên nhân viên đang đăng nhập** — đây là hành vi ĐÚNG theo thiết kế (để nhân viên cũ tự đặt mật khẩu ngay trong phiên đang sống), không phải lỗi. Cổng mật khẩu chỉ bắt đầu áp từ lần đăng nhập lạnh tiếp theo của mỗi nhân viên.

## Route mới (+2: tổng 532 → 534, đã chạy `php artisan route:list` thật trên máy thử)

- `POST /employee/password/change-with-ticket` — đổi mật khẩu bắt buộc bằng vé (chưa cần token).
- `POST /employee/password/setup` — tự đặt mật khẩu trong phiên (token nhân viên + PIN xác nhận).

## Bảng SHA-256 của các file trong zip (sinh bằng script)

| File | SHA-256 |
|---|---|
| `dbomni/app/Http/Controllers/Api/EmployeeAuthController.php` | `8a263757156c75b032eea6e28969f89ae90e43805f58ba09581692f702e16c49` |
| `dbomni/app/Http/Controllers/Api/EmployeeController.php` | `173b586471627bd7e80bc90cdc426e0c5009503a3300045d46e470bbb24be2a0` |
| `dbomni/app/Models/Employee.php` | `b7de499cd237eeb9e33821d564fbf11881884dc4b77c97fbd46e8eb0444f9798` |
| `dbomni/database/migrations/2026_11_07_000102_employee_password_lifecycle.php` | `e91edb5d64b3c61301611f08d4efd146a6794ed7a392072e0c3ac9f1315c5df1` |
| `dbomni/routes/api.php` | `5c203ad5d0563fa4469c8017a22f45f945ddb4ac67ae635277e0589f41ede530` |
| `fnb-frontend/src/pages/StaffHub.jsx` | `0243bf9d8e39775f3201eaa4536b0a99e3ffb33aca6ef2d0d6ebfb1e986651e0` |
| `fnb-frontend/src/pages/admin/Staff.jsx` | `f515a694ae2a6a1a05b5efc297588851d24b54533307c84785b715293f4d9177` |
