<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 59 (2026-10-15): duyệt phiếu thu/chi.
// - Phiếu do NV tạo ở trạng thái "Chờ duyệt" (approved_by null).
// - Quản lý duyệt trong admin → set approved_by + approved_at.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('transactions')) {
            return;
        }
        Schema::table('transactions', function (Blueprint $table) {
            if (!Schema::hasColumn('transactions', 'approved_by')) {
                $table->foreignId('approved_by')->nullable()->after('created_by')
                    ->constrained('users')->nullOnDelete()
                    ->comment('Người duyệt (null = chờ duyệt)');
            }
            if (!Schema::hasColumn('transactions', 'approved_at')) {
                $table->dateTime('approved_at')->nullable()->after('approved_by')
                    ->comment('Thời điểm duyệt');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('transactions')) {
            return;
        }
        Schema::table('transactions', function (Blueprint $table) {
            if (Schema::hasColumn('transactions', 'approved_by')) {
                $table->dropConstrainedForeignId('approved_by');
            }
            if (Schema::hasColumn('transactions', 'approved_at')) {
                $table->dropColumn('approved_at');
            }
        });
    }
};
