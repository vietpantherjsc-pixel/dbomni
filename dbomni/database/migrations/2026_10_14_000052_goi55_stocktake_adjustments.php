<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11b: đề xuất điều chỉnh kho từ chênh lệch kiểm kê.
// Chốt phiếu kiểm kê chỉ ghi nhận chênh lệch; khi tổng giá trị chênh vượt ngưỡng
// thì tự sinh đề xuất (pending) — quản lý duyệt mới thực hiện điều chỉnh kho thật.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stocktake_adjustments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stocktake_id')->constrained('stocktakes')->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained('branches');
            $table->foreignId('material_id')->constrained('materials');
            $table->decimal('system_qty', 14, 3)->default(0);
            $table->decimal('counted_qty', 14, 3)->default(0);
            $table->decimal('diff_qty', 14, 3)->default(0); // counted - system (âm = thiếu)
            $table->decimal('diff_value', 14, 2)->default(0); // giá trị chênh theo giá vốn BQ
            $table->string('status', 20)->default('pending'); // pending|approved|rejected
            $table->foreignId('requested_by_employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->foreignId('approved_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->text('note')->nullable();
            $table->timestamps();
            $table->index(['branch_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stocktake_adjustments');
    }
};
