# MANIFEST — HOTFIX: Loại mẫu coupon khỏi phía khuyến mãi chung

Áp ngay, đè thẳng vào thư mục gốc repo `D:\WORK\VIBE` (zip giữ cấu trúc từ repo root: `dbomni/`).
**Gói KHÔNG có migration · KHÔNG cần rebuild frontend** (sửa thuần backend, 2 file).

## Vấn đề và cách sửa

Các mẫu chiến dịch coupon (CP-01…CP-10 — khuôn dùng để phát coupon vào ví khách) đang lọt vào danh sách khuyến mãi chung: khách có thể áp thẳng mẫu bằng mã khuyến mãi như KM thường, và panel Ưu đãi hiện trùng 2 dòng "Coupon hóa đơn kế tiếp" (1 phía KM chung + 1 phía ví). Đây là lỗ hổng thất thoát tiền.

Dấu hiệu phân biệt (đã kiểm chứng): mẫu coupon ⟺ trường `auto_config` có khóa `trigger` không rỗng; KM chung thật do Admin tạo luôn có `auto_config` trống. Sửa đúng 2 điểm:

- `dbomni/app/Services/PromotionService.php` — trong `eligiblePromotions()`: loại mọi promotion có `auto_config.trigger` khỏi tập khuyến mãi đủ điều kiện. Điểm này phủ mọi đường áp KM chung (API eligible, đặt đơn Mini App, POS) — gọi thẳng API đặt đơn với promotion_id là id của mẫu sẽ bị từ chối "Khuyến mại không còn hiệu lực."
- `dbomni/app/Http/Controllers/Api/OnlineOrderController.php` — trong danh sách Ưu đãi hợp nhất (`unifiedOffers()`): loại cùng dấu hiệu đó khỏi phía KM chung.

Không đụng: đường coupon ví (coupon trong ví vẫn áp bình thường), luật cộng dồn, đường voucher gõ tay, dữ kiện nào trong database.

## THỨ TỰ ÁP

1. Giải nén zip đè vào `D:\WORK\VIBE`.
2. Restart backend — chạy tại `D:\WORK\VIBE\dbomni`:
   ```
   docker compose restart laravel.test
   ```
(Không migrate, không rebuild Admin/Mini App.)

## KIỂM NHANH SAU ÁP (~2 phút)

- Mở Mini App → Checkout → panel Ưu đãi: "Coupon hóa đơn kế tiếp" chỉ còn **1 dòng phía coupon ví** (có mã + hạn dùng); các mẫu CP khác biến khỏi danh sách; KM chung thật do quán tạo còn nguyên.
- Coupon trong ví (VD mã CP-10…) vẫn áp được bình thường ở Checkout.

## ROLLBACK

Đè lại 2 file bản cũ (trước hotfix) vào đúng vị trí rồi restart backend tại `D:\WORK\VIBE\dbomni`:
```
docker compose restart laravel.test
```
