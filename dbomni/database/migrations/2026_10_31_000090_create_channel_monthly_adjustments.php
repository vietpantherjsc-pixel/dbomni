<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói "PNL kênh sàn đầy đủ" (2026-10-31): bảng nhập phí marketing sàn theo
// (kênh × chi nhánh × tháng) từ báo cáo đối soát sàn gửi ngày đầu tháng sau.
// Chỉ 1 con số duy nhất: marketing_fee (không có trường tài trợ/thực nhận nào
// — đã bác theo sự thật nghiệp vụ Đại Vương xác nhận 09:18 31/10).
// Kỷ luật 000083: migration thuần TẠO bảng mới + FK mới, không drop/change
// index hay cột nào của bảng hiện hữu nên không có rủi ro đỡ FK.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('channel_monthly_adjustments', function (Blueprint $table) {
            $table->id();
            $table->string('channel_code', 50); // mã kênh theo price_lists.code (chỉ kênh nhóm partner)
            $table->foreignId('branch_id')->constrained('branches');
            $table->date('month'); // ngày 1 của tháng đối soát
            $table->decimal('marketing_fee', 15, 2)->default(0);
            $table->string('note', 500)->nullable();
            $table->string('status', 10)->default('active'); // active | void
            // Vết kiểm toán: actor có thể là User (admin) hoặc Employee nên lưu
            // kèm loại actor để tra lại đúng người, không khóa FK cứng.
            $table->unsignedBigInteger('created_by')->nullable();
            $table->string('created_by_type', 10)->nullable(); // user | employee
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->string('updated_by_type', 10)->nullable();
            $table->unsignedBigInteger('voided_by')->nullable();
            $table->string('voided_by_type', 10)->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->string('void_reason', 500)->nullable();
            $table->timestamps();
            // Đúng 1 dòng cho mỗi (kênh × chi nhánh × tháng) — kể cả dòng void
            // (nhập lại sau hủy = mở lại chính dòng đó, không tạo dòng thứ hai).
            $table->unique(['channel_code', 'branch_id', 'month'], 'cma_channel_branch_month_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('channel_monthly_adjustments');
    }
};
