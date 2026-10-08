<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 19 (2026-10-09): thêm ngày-giờ kiểm kho (lúc chốt phiếu) — vì created_at
// là lúc tạo phiếu nháp, có thể khác thời điểm nhân viên thực hiện kiểm.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('stocktakes') && !Schema::hasColumn('stocktakes', 'checked_at')) {
            Schema::table('stocktakes', function (Blueprint $table) {
                $table->dateTime('checked_at')->nullable()->after('status')
                    ->comment('Ngày-giờ kiểm kho (set lúc chốt phiếu)');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('stocktakes') && Schema::hasColumn('stocktakes', 'checked_at')) {
            Schema::table('stocktakes', function (Blueprint $table) {
                $table->dropColumn('checked_at');
            });
        }
    }
};
