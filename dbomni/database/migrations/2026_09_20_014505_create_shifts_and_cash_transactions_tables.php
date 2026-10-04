<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // 1. Tắt khóa ngoại để dọn dẹp an toàn các bảng cũ nếu đã tồn tại dở dang
        Schema::disableForeignKeyConstraints();
        Schema::dropIfExists('shift_expenses');
        Schema::dropIfExists('shifts');
        Schema::enableForeignKeyConstraints();

        // 2. Tạo bảng shifts
        Schema::create('shifts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('branch_id')->default(1);
            $table->string('cashier_name');
            $table->dateTime('opened_at');
            $table->dateTime('closed_at')->nullable();
            $table->decimal('opening_cash', 12, 2);
            $table->decimal('closing_cash_actual', 12, 2)->nullable();
            $table->decimal('cash_sales', 12, 2)->default(0);
            $table->decimal('transfer_sales', 12, 2)->default(0);
            $table->decimal('cash_out', 12, 2)->default(0);
            $table->decimal('expected_cash', 12, 2)->default(0);
            $table->decimal('difference', 12, 2)->nullable();
            $table->enum('status', ['open', 'closed'])->default('open');
            $table->text('note')->nullable();
            $table->timestamps();
        });

        // 3. Tạo bảng shift_expenses
        Schema::create('shift_expenses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shift_id')->constrained('shifts')->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->string('reason');
            $table->string('performed_by');
            $table->timestamps();
        });

        // 4. Bổ sung shift_id vào orders nếu chưa có
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'shift_id')) {
                $table->foreignId('shift_id')->nullable()->after('id')->constrained('shifts')->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'shift_id')) {
                $table->dropForeign(['shift_id']);
                $table->dropColumn('shift_id');
            }
        });

        Schema::disableForeignKeyConstraints();
        Schema::dropIfExists('shift_expenses');
        Schema::dropIfExists('shifts');
        Schema::enableForeignKeyConstraints();
    }
};