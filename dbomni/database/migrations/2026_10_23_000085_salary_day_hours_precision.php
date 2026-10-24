<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Bổ sung Mảng 4 theo rà soát TESTER (A4-12a): giờ công từng dòng
// salary_days.hours đang decimal(6,2) — mỗi dòng bị làm tròn tới ~36 giây,
// cộng dồn cả tháng cho nhiều NV gây lệch nhỏ nhưng hệ thống. Nới lên
// decimal(7,3) (đơn vị ~3,6 giây) và các điểm tính giờ trong SalaryController
// làm tròn 3 số lẻ. Migration cộng thêm, không đụng dữ liệu.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salary_days', function (Blueprint $table) {
            $table->decimal('hours', 7, 3)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('salary_days', function (Blueprint $table) {
            $table->decimal('hours', 6, 2)->nullable()->change();
        });
    }
};
