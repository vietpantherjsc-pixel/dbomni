<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 57 (2026-10-14): mở rộng bảng transactions cho phân hệ Thu-Chi.
// - occurred_at: ngày thực chi/thực thu (khác created_at là ngày nhập liệu vào hệ thống)
// - attachment: đường dẫn ảnh chứng từ
// - account_id: quỹ tiền liên quan (bảng accounts, Gói 57)
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('transactions')) {
            return;
        }

        Schema::table('transactions', function (Blueprint $table) {
            if (!Schema::hasColumn('transactions', 'occurred_at')) {
                $table->date('occurred_at')->nullable()
                    ->comment('Ngày thực chi/thực thu (khác ngày nhập liệu)');
            }
            if (!Schema::hasColumn('transactions', 'attachment')) {
                $table->string('attachment', 255)->nullable()
                    ->comment('Đường dẫn ảnh chứng từ');
            }
            if (!Schema::hasColumn('transactions', 'account_id')) {
                $table->foreignId('account_id')->nullable()
                    ->constrained('accounts')->nullOnDelete()
                    ->comment('Quỹ tiền liên quan');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('transactions')) {
            return;
        }

        Schema::table('transactions', function (Blueprint $table) {
            if (Schema::hasColumn('transactions', 'account_id')) {
                $table->dropConstrainedForeignId('account_id');
            }
            foreach (['attachment', 'occurred_at'] as $col) {
                if (Schema::hasColumn('transactions', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
