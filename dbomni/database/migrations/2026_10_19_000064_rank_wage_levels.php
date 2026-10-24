<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 67: Lương cấp bậc — cộng thêm trên lương giờ, lịch sử mức theo ngày hiệu lực
// (pattern giống hệt wage_levels: thêm mức mới tự đóng mức cũ).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('rank_wage_levels')) {
            Schema::create('rank_wage_levels', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->decimal('amount', 12, 2)->comment('Lương cấp bậc/h (cộng thêm vào đơn giá giờ)');
                $table->date('start_date')->comment('Ngày bắt đầu áp dụng');
                $table->date('end_date')->nullable()->comment('Ngày kết thúc (null = đang áp dụng)');
                $table->string('note', 255)->nullable();
                $table->timestamps();
                $table->index(['employee_id', 'start_date']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('rank_wage_levels');
    }
};
