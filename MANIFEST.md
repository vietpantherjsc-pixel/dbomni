# MANIFEST — Gói dọn châm Zalo (2026-11-07)

Zip `goi-don-cham-zalo-20261107.zip` — đúng **2 file**, cấu trúc từ repo root: giải nén đè thẳng vào `D:\WORK\VIBE`. **Không migration, không đổi dữ liệu, không đổi hành vi.**

> Đây là gói **dọn dẹp sau khi đăng nhập Zalo đã thông** (gốc lỗi SĐT đã bắt được và vá xong ở máy chủ: bước đổi số dùng đúng `secret_key` của app). Hai việc duy nhất: gỡ dòng chẩn đoán tạm khỏi app + đưa bản vá phía server về local cho đồng bộ.

## Nội dung

1. **`zalo-miniapp/src/pages/Account.jsx`** — gỡ dòng **"Kỹ thuật: …"** khỏi khung cam "Cần số điện thoại đã xác thực" (cả phần hiển thị lẫn cơ chế nuôi nó trong file này). Khung trở lại nguyên thiết kế gốc: tiêu đề + lời giải thích cho khách + 2 nút **Thử lại / Tiếp tục đặt món vãng lai**. Luồng đăng nhập Zalo không đổi một ly.
2. **`dbomni/app/Services/ZaloAuthService.php`** — nguyên bản vá **đang chạy sống** ở máy chủ (bước đổi SĐT qua `/me/info` dùng `secret_key` thô theo tài liệu Zalo). Zip tổng trước đó ở local đang chứa bản trước vá — **nếu không đưa bản này về, một lần deploy local sau này sẽ làm lỗi 117 sống lại.** File này giống hệt bản trên máy chủ, không sửa thêm chữ nào. Các dòng log chẩn đoán phía server (`ZaloAuthService /me/info …`) vẫn giữ — đó là logging vận hành vĩnh viễn.

## Trình tự áp

1. Giải nén zip đè vào `D:\WORK\VIBE`.
2. Chạy tại `D:\WORK\VIBE\dbomni`:
   `docker compose restart laravel.test`
3. Chạy tại `D:\WORK\VIBE\zalo-miniapp` — dựng lại với 2 biến môi trường:
   `$env:VITE_API_BASE="https://zma.daybreak.vn/api/online"`
   `$env:VITE_MINIAPP_ID="<Mini App ID>"` (chính là giá trị `APP_ID` trong file `.env` của thư mục này)
   `npm run build`
   → cập nhật `app-config` theo tên asset mới (listCSS/listSyncJS/listAsyncJS) → chép thư mục `www` → deploy **Development**:
   `zmp deploy --existing`
   (KHÔNG thêm `-t`/`--testing`.)

## Kiểm nhanh sau khi áp

- Mở app trong Zalo → đăng nhập Zalo bình thường như hiện tại (đã thông) — không cần kiểm gì thêm về đăng nhập.
- Nếu gặp lại khung cam (ví dụ dùng tài khoản Zalo chưa cấp quyền SĐT): khung chỉ còn tiêu đề + lời giải thích + 2 nút, **không còn dòng "Kỹ thuật: …"** ở dưới.

## Bảng SHA-256 (sinh bằng script từ chính file trong zip)

| File | Byte | SHA-256 |
|---|---|---|
| `dbomni/app/Services/ZaloAuthService.php` | 5934 | `63ce063d630151776c0f8eaa7ee6dcda93e650d21ac5080cac612dddcf9ba717` |
| `zalo-miniapp/src/pages/Account.jsx` | 74478 | `560ce50217cfb4711468f1b9dc58a41acafa44dedcd36ef2a1a33e1253768f70` |
