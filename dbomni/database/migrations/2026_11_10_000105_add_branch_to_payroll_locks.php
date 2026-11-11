<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Cây phân quyền 3 tầng (spec đã khóa 10/11/2026 §3.8): đơn vị chốt kỳ lương
// là (kỳ × CN). payroll_locks.branch_id NULL = khóa toàn hệ đời trước.
// Đổi unique(month) -> unique(month, branch_id) để 1 kỳ có nhiều khóa CN.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_locks', function (Blueprint $table) {
            $table->unsignedBigInteger('branch_id')->nullable()->after('month')
                ->comment('CN của khóa kỳ; NULL = khóa toàn hệ đời trước');
        });
        // Bỏ unique cũ trên month rồi lập unique (month, branch_id).
        // MySQL cho nhiều NULL trong unique index nên vẫn chỉ 1 khóa toàn hệ/kỳ.
        Schema::table('payroll_locks', function (Blueprint $table) {
            $table->dropUnique('payroll_locks_month_unique');
        });
        Schema::table('payroll_locks', function (Blueprint $table) {
            $table->unique(['month', 'branch_id']);
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
        });
        Schema::table('payroll_lock_logs', function (Blueprint $table) {
            $table->unsignedBigInteger('branch_id')->nullable()->after('month')
                ->comment('CN của lần chốt/mở khóa (NULL = toàn hệ)');
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('payroll_lock_logs', function (Blueprint $table) {
            $table->dropForeign(['branch_id']);
            $table->dropColumn('branch_id');
        });
        Schema::table('payroll_locks', function (Blueprint $table) {
            $table->dropForeign(['branch_id']);
            $table->dropUnique(['month', 'branch_id']);
            $table->dropColumn('branch_id');
        });
        // Chỉ khôi phục unique(month) khi không còn tháng nào có nhiều khóa.
        $dupes = DB::table('payroll_locks')
            ->select('month')->groupBy('month')->havingRaw('COUNT(*) > 1')->exists();
        if (!$dupes) {
            Schema::table('payroll_locks', function (Blueprint $table) {
                $table->unique('month');
            });
        }
    }
};
