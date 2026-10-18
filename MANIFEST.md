# MANIFEST — Gói fix 9 lỗi đỏ audit 5 phân hệ

> Audit: `dbomni-pm/audit-5-phan-he.md` (2026-10-17)
> Ngày đóng gói: 2026-10-17. Người code: MAIN (chat DBOMNI - MAIN).
> **Trạng thái: CHƯA QUA TESTER** — gửi PM chuyển TESTER kiểm thử.

## Gói này gồm

**Fix 9 lỗi đỏ** (theo lệnh Đại Vương "tiến hành sửa lại"):

1. **K-R1** (Kho): Phiếu nhập draft của NV không còn cộng kho/sinh phiếu chi ngay.
   Thêm `POST /inbound-receipts/{id}/approve` (quản lý duyệt → mới cộng kho + sinh phiếu chi).
   Nới `update()`/`cancel()` cho phép draft. Frontend: nút Duyệt/Hủy ở tab Nhập kho,
   màn "Phiếu của tôi" trong NhapKho.jsx + endpoint `GET /employee/inbound-receipts`.

2. **NV-R1** (Nhân viên): Thống nhất code loại nghỉ phép `nghi/doica/khac`
   (frontend LeaveRequests.jsx trước đây dùng `annual/sick/...` không khớp backend).

3. **CC-R1** (Chấm công): Middleware `employee.active` chặn NV đã tắt (`is_active=false`)
   dùng token cũ (403). Khi tắt NV trong EmployeeController → revoke toàn bộ token.

4. **CC-R2** (Chấm công): NV gửi lại đăng ký ca không xóa dòng đã duyệt;
   chỉ xóa/sửa dòng chưa duyệt, bỏ qua selection trùng dòng approved.

5. **HD-R1** (Hóa đơn): Đơn nhóm delivery gọi báo giá hãng (quote + chọn gói như Checkout),
   gửi `delivery_package`/`delivery_quoted_fee`/`delivery_provider` qua GroupOrderController → store.

6. **HD-R2** (Hóa đơn): `confirmPayment` tạo đơn hãng cho đơn online delivery
   (luồng chính Mini App, trước đây bypass `updateStatus` nên không bao giờ tạo đơn hãng).

7. **HD-R3** (Hóa đơn): Xóa đơn (bulk) hoàn điểm đã đổi + thu hồi điểm tích + hoàn voucher
   như khi hủy (trước đây xóa làm mất tài sản khách).

8. **MH-R1** (Mặt hàng): `bulkUpdate` validate MỌI dòng (trước đây `$rules` nằm trong
   foreach nên chỉ validate dòng cuối).

9. **MH-R2** (Mặt hàng): Bảng cuộn ngang trên mobile (`overflow-x-auto` + `min-w-[900px]`),
   thêm ô tìm kiếm theo tên/SKU + lọc danh mục/trạng thái (UI-MAP quy tắc 5).

**Không làm trong gói này:** NV-R2/R3 (hardcode nhóm lỗi 3 Chuyên + loại thưởng) —
chờ spec Danh mục dùng chung theo lệnh PM.

## 1. Thứ tự apply

Giải nén đè vào `D:\WORK\VIBE` (cấu trúc từ repo root).
Không phụ thuộc gói chưa apply nào (Gói 61c đã apply + push git).

## 2. Migration + lệnh chạy

**Không có migration mới** trong gói này.

## 3. Lệnh restart

Backend (tại `D:\WORK\VIBE\dbomni`):
```powershell
docker compose restart laravel.test
```

Frontend: không cần restart đặc biệt (Vite HMR tự nhận), hoặc restart container frontend nếu chạy Docker.

## 4. Đại Vương cần test gì trong 10 phút

1. **K-R1:** NV tạo phiếu nhập trên điện thoại → trạng thái "Nháp — chờ duyệt",
   kho KHÔNG tăng. Admin vào Kho → Nhập kho → thấy phiếu "Nháp" → bấm Duyệt → kho tăng.
2. **CC-R1:** Tắt 1 NV (is_active=false) → NV đó không chấm công được nữa (báo 403).
3. **HD-R2:** Đặt đơn delivery trên Mini App → KDS bấm xác nhận thanh toán
   → đơn hãng được tạo (kiểm tra cột delivery_provider/delivery_order_id).
4. **MH-R2:** Trang Mặt hàng trên điện thoại → bảng cuộn ngang được, ô tìm kiếm hoạt động.

## 5. Cách rollback

Git revert các file trong gói, hoặc giải nén đè bản backup trước khi apply.
Không có migration nên không cần rollback DB.
