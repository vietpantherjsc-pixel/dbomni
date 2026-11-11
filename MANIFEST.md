# MANIFEST — Gói tổng đợt 2026-11-11: Chế biến theo mẻ · Ẩn nút Đặt Giao Hàng KDS · Vá chuông KDS + POS

- **Zip:** `goi-tong-che-bien-an-nut-chuong-20261111.zip` — đúng **8 file code + MANIFEST này**, cấu trúc từ repo root (`dbomni/…` · `fnb-frontend/…`), giải nén đè thẳng vào `D:\WORK\VIBE`.
- **Không có file routes** trong gói này (không đổi route). **Không chứa migration 000108** của gói Checkout SDK — gói đó vẫn đóng riêng theo phán Đ5.

## Nội dung 3 gói + mốc kiểm duyệt

**1. Chế biến theo mẻ** (Đại Vương chốt 2026-11-11 ~13:57) — TESTER ✅ Tĩnh §FK · ✅ Sống §FN
- Form tạo phiếu chế biến (Hub + trang Admin) chỉ nhập **Số mẻ** — cho phép mẻ lẻ bước 0,5 — server tự tính sản lượng = số mẻ × sản lượng mỗi mẻ đã cấu hình trong định mức; phiếu lưu thêm số mẻ (migration **000109** thêm cột `batches` vào bảng `productions`).
- Bán thành phẩm chưa cấu hình sản lượng mỗi mẻ → hệ thống chặn tạo phiếu và báo bổ sung cấu hình ở tab Định mức.
- Ô chọn bán thành phẩm để chế biến chỉ hiển thị món thuộc loại nguyên liệu **"Bán thành phẩm"** và có định mức chế biến.

**2. Ẩn nút "Đặt Giao Hàng" trên KDS khi chưa có API hãng** (Đại Vương chốt 2026-11-11 ~14:04) — TESTER ✅ Tĩnh §FL · ✅ Sống §FO
- Khi chưa có hãng giao hàng nào được bật + cấu hình khóa API (theo `GET /delivery/config`), KDS ẩn hẳn nút "🚚 Đặt Giao Hàng" ở cả 2 vị trí trên thẻ đơn; chỉ còn "🛵 Quán Tự Đặt Giao Hàng". Sau này nạp khóa hãng, nút tự hiện lại theo cấu hình — không cần sửa code.

**3. Vá chuông báo đơn KDS + POS** (Đại Vương chốt 2026-11-11 ~14:08) — TESTER ✅ Tĩnh §FM · §FO phần quan sát được
- Cả 2 màn hình chuyển sang dùng **một AudioContext chung**, tự mở khóa ở lần chạm/gõ phím đầu tiên và tự resume trước mỗi lần kêu — hết cảnh chuông im tiếng khi vừa mở trang chưa ai chạm vào.
- KDS đổi cách kích hoạt chuông: kêu khi có **mã đơn mới xuất hiện** (không còn đếm tổng số đơn — hết hụt ca đơn cũ vừa xong + đơn mới vào cùng nhịp); lượt nạp đầu tiên chỉ ghi mốc, không kêu.
- Mục chưa kiểm chứng **#110**: tiếng chuông thật trên thiết bị tại quầy — chủ Đại Vương kiểm khi dùng thật, không chặn gói này.

## Bảng SHA-256 (sinh bằng script từ file đã đóng gói)

| # | File | SHA-256 |
|---|---|---|
| 1 | `dbomni/database/migrations/2026_11_11_000109_add_batches_to_productions.php` | `00d4fd418e140153af6a36c8b8cc7b7fade7abceaea4a48024c730b3ed5b40e7` |
| 2 | `dbomni/app/Models/Production.php` | `a135e2ea3dd1168d6ed4dae80025d430193e6fb9bae035312201c3505da59206` |
| 3 | `dbomni/app/Http/Controllers/Api/ProductionController.php` | `5a8211e67de1a14d567ff97461ced3f80a16c838d44323807e62a231c8cbdf00` |
| 4 | `dbomni/app/Http/Controllers/Api/EmployeeInventoryController.php` | `2dc1199f6331b70bbd1b3e3a19b40e509abd73753e2c5ae267db4ca2662a8a1b` |
| 5 | `fnb-frontend/src/pages/CheBien.jsx` | `ebfa2f13cb0a26e7619e85358369f3f709190d672fe601d7eb776309f5ba118b` |
| 6 | `fnb-frontend/src/pages/admin/Inventory.jsx` | `e95520634f1ae9e512cc93c442c3b895cfbce8200d373168ada0c0b3734f5559` |
| 7 | `fnb-frontend/src/KdsScreen.jsx` | `36497b7824314a1d6404bd5dfc5c03ad3a41844a82f81d53343cd27a5ddb2461` |
| 8 | `fnb-frontend/src/components/PosScreen.jsx` | `78dbab60838daefc98dff4c9b84a68ad917925d3cd58244c6fa52cc390bbbcf0` |

## Hướng dẫn áp — làm trọn từng bước theo thứ tự

**Bước 1 — Giải nén đè code.**
Giải nén file zip này và chép đè toàn bộ nội dung vào thư mục `D:\WORK\VIBE` (giữ nguyên cấu trúc thư mục `dbomni\…` và `fnb-frontend\…` bên trong — Windows hỏi ghi đè thì chọn ghi đè tất cả).

**Bước 2 — Chạy migration (tạo cột số mẻ).**
Mở PowerShell, di chuyển vào thư mục Laravel:

```
cd D:\WORK\VIBE\dbomni
docker compose exec laravel.test php artisan migrate
```

Lệnh này chỉ chạy 1 migration mới: `2026_11_11_000109_add_batches_to_productions` (thêm cột `batches` vào bảng `productions`). Thấy dòng `DONE` ở migration này là đạt.

**Bước 3 — Khởi động lại backend.**
Vẫn tại thư mục `D:\WORK\VIBE\dbomni`, chạy:

```
docker compose restart laravel.test
```

**Bước 4 — Dựng lại giao diện (frontend).**
Mở PowerShell mới, di chuyển vào thư mục frontend rồi build:

```
cd D:\WORK\VIBE\fnb-frontend
npm run build
```

Chờ build chạy xong không báo lỗi đỏ là đạt.

**Bước 5 — Kiểm nhanh sau khi áp.**
- Mở trang Chế biến trên Hub và tab Chế biến trong Admin → Kho: ô nhập đã đổi thành **"Số mẻ"** (nhập thử 1,5 mẻ — xem trước hiện đúng sản lượng = 1,5 × sản lượng mỗi mẻ đã cấu hình).
- Ô chọn bán thành phẩm chỉ còn các món thuộc loại **"Bán thành phẩm"** và có định mức. **Lưu ý dữ kiện:** món nào đã có định mức nhưng chưa được gắn loại "Bán thành phẩm" sẽ tạm ẩn khỏi ô chọn — vào Admin → mục Nguyên liệu, gắn lại loại "Bán thành phẩm" cho món đó là hiện lại ngay, không phải lỗi.
- Mở KDS: thẻ đơn giao hàng ở cột Chờ Giao **không còn nút "Đặt Giao Hàng"** — đây là đúng ý (chưa cấu hình hãng giao hàng nào), chỉ còn nút "Quán Tự Đặt Giao Hàng".
- Chuông: mở KDS/POS rồi chạm vào màn hình 1 lần (để trình duyệt mở khóa âm thanh) — từ đó đơn mới về sẽ kêu chuông bình thường.

## Ghi chú thêm
- Gói này thay cho việc áp từng gói lẻ của đợt 2026-11-11 — chỉ áp zip tổng này, không áp thêm zip lẻ nào của 3 gói trên.
- Loại "Bán thành phẩm" được hệ thống nhận diện **theo tên loại**; không đổi tên loại này trong Admin (đổi tên sẽ làm ô chọn chế biến lệch theo).
