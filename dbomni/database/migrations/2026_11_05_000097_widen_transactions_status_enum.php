<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Vá khẩn F4 (2026-11-05, TESTER bắt sống): transactions.status là
// enum('paid','pending') từ migration gốc 000019 và KHÔNG migration nào
// nới từ đó tới nay — trong khi code đã ghi 'cancelled' ở nhiều đường
// (Spec P4-B2: validation store/update cho in:paid,pending,cancelled +
// SalaryController::unlock hủy phiếu lương; F4: TransactionController::reject).
// MySQL strict cắt giá trị ngoài enum -> 500 mọi lần ghi 'cancelled'.
// Rà chuỗi ALTER: 000020/000058/000059/000080 đụng bảng transactions nhưng
// không migration nào ALTER cột status; không có ALTER/MODIFY thô nào lên
// cột này. Bẫy index đỡ FK (bài học 000083): cột status KHÔNG nằm trong
// index hay FK nào của bảng (unique chỉ ở code; index ở related_type+
// related_id và type+paid_at) và phép MODIFY tại chỗ không drop index nào
// -> an toàn. Viết bằng DB::statement MODIFY như tiền lệ 000002/000008.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE `transactions` MODIFY `status` ENUM('paid','pending','cancelled') NOT NULL DEFAULT 'paid' COMMENT 'paid: đã thanh toán, pending: chờ thanh toán, cancelled: đã hủy'");
    }

    public function down(): void
    {
        // Thu về enum gốc. Nếu đã có phiếu 'cancelled', MySQL sẽ chặn
        // (lỗi cắt dữ liệu) — đúng ý: không cho rollback lặng lẽ mất trạng thái hủy.
        DB::statement("ALTER TABLE `transactions` MODIFY `status` ENUM('paid','pending') NOT NULL DEFAULT 'paid' COMMENT 'paid: đã thanh toán, pending: chờ thanh toán'");
    }
};
