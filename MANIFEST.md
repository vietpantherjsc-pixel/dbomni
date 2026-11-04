# GÓI CHUẨN HÓA ĐƯỜNG DẪN ẢNH (2026-11-04)

Thiết lập rule vĩnh viễn trong code để ảnh tải lên không còn lỗi đường dẫn tiếng Việt có dấu, kèm lệnh dọn dữ liệu cũ. Gồm 5 file (3 mới + 2 sửa), đã qua TESTER. **KHÔNG có migration.**

## A — RULE TÊN FILE DÙNG CHUNG (mới: `dbomni/app/Support/MediaFilename.php`)

Helper duy nhất sinh tên file lưu trữ cho toàn hệ thống: bỏ dấu tiếng Việt đầy đủ (ă/â/đ/ê/ô/ơ/ư + thanh điệu, cả chữ hoa), chữ thường, khoảng trắng/ký tự lạ → `-` (giữ `_` và `-`), giữ đúng đuôi file, hậu tố thời gian + ngẫu nhiên chống trùng như cơ chế cũ, trùng nữa thì `-2`, `-3`.
Ví dụ: tải lên "Trà Sữa Trân Châu.JPG" → lưu thành `product_tra-sua-tran-chau_<time>_<mã>.jpg`.

Đã áp tại mọi điểm lưu file (sửa 2 controller):
- `dbomni/app/Http/Controllers/Api/UploadController.php` — cả 4 đường: ảnh bìa Mini App (cover), banner khuyến mãi, ảnh mặt hàng, logo thương hiệu (đường thay/thay thế ảnh cũng qua các endpoint này).
- `dbomni/app/Http/Controllers/Api/MinigameController.php` — ảnh thẻ chia sẻ kết quả game.

Từ nay mọi ảnh tải lên đều mang tên ASCII sạch ở phía server, bất kể tên gốc trên máy người tải.

## B — LỆNH DỌN DỮ LIỆU CŨ (mới: `dbomni/app/Console/Commands/NormalizeMediaPaths.php`)

Lệnh `media:normalize-paths` quét các cột lưu đường dẫn ảnh (`products.image_url`, `rd_products.image_url`, `promotions.banner_url`, `branches.cover_url`, `employees.avatar`, settings `shop_cover_url`/`brand_logo`) và các thư mục ảnh public:
- Tên file có dấu/khoảng trắng → đổi tên file trên đĩa + cập nhật đường dẫn trong DB.
- URL tuyệt đối mang host nội bộ (localhost / 127.0.0.1 / ::1 / host của APP_URL) → đổi thành đường dẫn tương đối + khử dấu tên file, liệt kê riêng 1 mục trong báo cáo.
- Bản ghi trỏ tới file không còn trên đĩa → chỉ cảnh báo, không sửa. URL host ngoài → bỏ qua.
- **Mặc định chỉ dry-run in báo cáo**; chạy thật phải thêm `--apply`. Chạy lại nhiều lần an toàn (tên đã sạch thì bỏ qua).

Kèm test: `dbomni/tests/Unit/MediaFilenameTest.php` (4 test cho helper).

## CÁCH ÁP

1. Giải nén đè vào thư mục gốc repo: `D:\WORK\VIBE`
2. Restart backend — chạy tại `D:\WORK\VIBE\dbomni`:
   `docker compose restart laravel.test`
3. KHÔNG cần migration · KHÔNG cần rebuild frontend.

## KIỂM SAU KHI ÁP — LÀM ĐÚNG THỨ TỰ

1. Chạy test thật — tại `D:\WORK\VIBE\dbomni`:
   `docker compose exec laravel.test php artisan test --filter=MediaFilenameTest`
   → phải xanh **4/4**.
2. Chạy **dry-run** lệnh dọn dữ liệu — tại `D:\WORK\VIBE\dbomni`:
   `docker compose exec laravel.test php artisan media:normalize-paths`
   → **gửi lại toàn bộ báo cáo** (các mục: URL host nội bộ → tương đối · chuẩn hóa tên file · cảnh báo thiếu file · tổng kết).
   ⚠️ **TUYỆT ĐỐI chưa chạy `--apply` ở bước này** — chờ Đại Vương duyệt danh sách đổi trong báo cáo dry-run mới chạy thật.
3. Kiểm nhanh giao diện: tải thử 1 ảnh mặt hàng có tên tiếng Việt có dấu → ảnh hiện bình thường, tên file lưu trên server là dạng không dấu.

## ROLLBACK

Giải nén lại 2 file controller (UploadController, MinigameController) từ bản trước + xóa 3 file mới (MediaFilename.php, NormalizeMediaPaths.php, MediaFilenameTest.php), rồi restart backend tại `D:\WORK\VIBE\dbomni`: `docker compose restart laravel.test`.
