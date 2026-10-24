<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Rà quy tắc tạo mã 2026-10-20: phiếu kiểm kê đã có cấu hình mã trong Thiết lập
// (CodeGenerator type 'stocktake', KK-0001) nhưng bảng stocktakes chưa có cột code.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('stocktakes') && !Schema::hasColumn('stocktakes', 'code')) {
            Schema::table('stocktakes', function (Blueprint $table) {
                $table->string('code', 30)->nullable()->index();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('stocktakes') && Schema::hasColumn('stocktakes', 'code')) {
            Schema::table('stocktakes', function (Blueprint $table) {
                $table->dropColumn('code');
            });
        }
    }
};
