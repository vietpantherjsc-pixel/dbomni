<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Chương trình chỉ số 360 — Đợt 2, N-5 (Phụ lục khóa 2026-11-15): nhật ký
// đổi cấu hình — 3 họ: channel_pricing (chiết khấu bảng giá + phí
// marketing đối soát sàn) · membership_tier (ngưỡng hạng) · point_value
// (giá trị quy đổi điểm). Chỉ ghi khi giá trị thật sự đổi.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('config_change_logs', function (Blueprint $table) {
            $table->id();
            $table->string('family', 30)->comment('channel_pricing | membership_tier | point_value');
            $table->string('entity_type', 50)->comment('price_list | channel_monthly_adjustment | membership_tier | setting');
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('label', 255)->nullable()->comment('Nhãn thực thể: tên bảng giá/hạng, hoặc "kênh · CN · tháng" của dòng đối soát');
            $table->string('field', 50);
            $table->text('old_value')->nullable();
            $table->text('new_value')->nullable();
            $table->unsignedBigInteger('changed_by')->nullable();
            $table->string('changed_by_type', 20)->nullable();
            $table->string('changed_by_name', 100)->nullable();
            $table->timestamp('changed_at')->useCurrent();
            $table->index(['family', 'changed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('config_change_logs');
    }
};
