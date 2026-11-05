<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Sổ #84 (2026-11-05): bổ sung cột option_ids cho order_items — cột bị QUÊN
// schema từ Gói 55 (model OrderItem đã khai fillable + cast 'array', đường
// import Excel ghi cột này, audit KHO-06 2026-10-23 coi nó là nguồn option
// ids tin cậy nhất cho trừ/hoàn kho, cầu Sapo + tách đơn cũng ghi) nhưng
// không migration nào từng tạo → mọi đường ghi đều nổ 1054 Unknown column.
// Khuôn cột đúng như group_order_items ở 000010: json nullable.
// Khóa an toàn 2 chiều bằng Schema::hasColumn (tiền lệ Gói 6): máy nào đã
// có cột từ ngoài cây (nghi vấn máy local) thì up() bỏ qua, không nổ
// duplicate; down() chỉ drop khi cột còn tồn tại.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('order_items', 'option_ids')) {
            return;
        }
        Schema::table('order_items', function (Blueprint $table) {
            $table->json('option_ids')->nullable();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('order_items', 'option_ids')) {
            return;
        }
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn('option_ids');
        });
    }
};
