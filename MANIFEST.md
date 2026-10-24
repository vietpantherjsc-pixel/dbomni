# MANIFEST — HOTFIX migration 000083 (lỗi 1553 khi áp gói tổng Audit 2026-10-23)

**Vấn đề:** khi chạy migrate cho gói tổng Audit, migration `2026_10_23_000083_audit_nhan_su` báo lỗi:
`Cannot drop index 'uniq_att_emp_branch_date': needed in a foreign key constraint`
Nguyên nhân: index unique (nhân viên, chi nhánh, ngày) của bảng chấm công đang là index đỡ cho khóa ngoại của bảng đó — MySQL không cho xóa khi chưa có index khác đỡ thay.

**Bản sửa:** trước khi xóa unique, migration tạo sẵn 1 index thường trên đúng 3 cột đó (`idx_att_emp_branch_date`) để khóa ngoại có index đỡ, rồi mới xóa unique. Mọi phần còn lại của migration giữ nguyên không đổi.

## Cách áp (2 phút)

1. Giải nén zip này đè vào `D:\WORK\VIBE` — chỉ ghi đè đúng 1 file:
   `dbomni\database\migrations\2026_10_23_000083_audit_nhan_su.php`
2. Chạy lại migrate — tại thư mục `D:\WORK\VIBE\dbomni`:
   ```
   docker compose exec laravel.test php artisan migrate
   ```
   Lần chạy trước: 000082 đã DONE, 000083 FAIL ngay ở lệnh đầu tiên nên **chưa có thay đổi nào của 000083 lọt vào database** — chạy lại sẽ chạy tiếp 000083 → 000084 → 000085 đến hết, không cần dọn dẹp gì.
3. Sau khi migrate xong, **tiếp tục đúng các bước còn lại trong MANIFEST của gói tổng Audit** (bản đính kèm khi giao gói tổng): chạy tay lệnh backfill snapshot lương → restart backend → dựng lại Admin + Mini App → cấp quyền cho role thu ngân/quản lý ca → chạy checklist kiểm nhanh 7 bước.

## Rollback

Nếu migrate vẫn lỗi ở 000083 (hãy gửi nguyên văn lỗi): khôi phục file migration từ trong zip gói tổng Audit, database vẫn ở trạng thái sau 000082 — an toàn, không mất dữ liệu.
