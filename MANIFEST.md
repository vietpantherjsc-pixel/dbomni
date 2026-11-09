# MANIFEST — Gói vá phiên khách (`goi-va-phien-khach-20261109.zip`)

Gói thuần backend, đúng 1 file. TESTER đã ký ✅ Sống đạt trọn (§EN — tái hiện độc lập qua API trên máy thử). Bản vá đã sống trên máy thử từ 19:47 ngày 09/11/2026. Cấu trúc giữ nguyên từ gốc repo: giải nén đè thẳng vào `D:\WORK\VIBE`.

## Nội dung gói

**Sửa lỗi giới hạn phiên khách cắt nhầm phiên mới nhất:** hàm `enforceLimit()` trong `CustomerSessionService` phải thu hồi các phiên CŨ NHẤT khi khách vượt trần 10 phiên, nhưng truy vấn bị thứ tự giảm dần ghim sẵn của relation `sessions()` chi phối (orderBy của Eloquent chỉ nối tiếp, không thay thế) → phần vượt trần cắt trúng các phiên **mới nhất, gồm cả phiên vừa đăng nhập** — khách chạm trần là bị khóa mềm tài khoản. Bản vá chèn `reorder()` trước `orderBy('id')` để ép thứ tự cũ → mới thật. Không đổi trần 10 phiên, không đổi hành vi cấp/thu hồi/đăng xuất phiên.

## Danh sách file + SHA-256 (sinh bằng script từ file đã stage)

| File | SHA-256 |
|---|---|
| `dbomni/app/Services/CustomerSessionService.php` | `260219b10b9ca07752ddf7da093b7257157aec205a9051e4517d50f94089f441` |

## Bước áp

1. Giải nén đè vào `D:\WORK\VIBE` (giữ nguyên cấu trúc thư mục trong zip).
2. Chạy tại `D:\WORK\VIBE\dbomni`:
   `docker compose restart laravel.test`
3. Gói thuần backend — **KHÔNG migration, KHÔNG build frontend, không đụng Mini App.**
