<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11b: ngưỡng hao hụt cho phép từng nguyên liệu (%)
// Dùng trong báo cáo hao hụt để đánh dấu đỏ khi vượt ngưỡng.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('materials', function (Blueprint $table) {
            $table->decimal('waste_threshold_pct', 5, 2)->default(5)->after('minimum_stock')
                ->comment('Ngưỡng hao hụt cho phép (%)');
        });
    }

    public function down(): void
    {
        Schema::table('materials', function (Blueprint $table) {
            $table->dropColumn('waste_threshold_pct');
        });
    }
};
