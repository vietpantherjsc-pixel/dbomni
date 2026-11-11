<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói Chế biến theo mẻ (Đại Vương chốt 2026-11-11): phiếu chế biến lưu thêm
// SỐ MẺ đã nhập (cho phép mẻ lẻ, bước 0,5). Sản lượng quantity vẫn do server
// tính = số mẻ × batch_output_qty của định mức — người dùng không nhập sản
// lượng tự do nữa (tránh sai lệch kho). NULL = phiếu tạo theo đường cũ
// (nhập thẳng sản lượng, trước gói này).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('productions', function (Blueprint $table) {
            $table->decimal('batches', 10, 2)->nullable()->after('quantity')
                ->comment('Số mẻ đã chế biến (bước 0,5) — gói chế biến theo mẻ 2026-11-11');
        });
    }

    public function down(): void
    {
        Schema::table('productions', function (Blueprint $table) {
            $table->dropColumn('batches');
        });
    }
};
