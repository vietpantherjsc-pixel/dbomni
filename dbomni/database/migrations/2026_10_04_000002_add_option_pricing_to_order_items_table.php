<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 1 (2026-10-04): order_items cần lưu tùy chọn (size/topping) và đơn giá lúc bán
// để KDS/báo cáo hiển thị đúng và không bị mất thông tin khi đổi giá menu.
return new class extends Migration {
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->foreignId('product_option_id')->nullable()->after('product_id')
                ->constrained('product_options')->nullOnDelete()
                ->comment('Tùy chọn đã chọn (size/topping...)');
            $table->decimal('unit_price', 15, 0)->default(0)->after('price')
                ->comment('Đơn giá lúc bán (giá gốc + option)');
            $table->decimal('total_price', 15, 0)->default(0)->after('quantity')
                ->comment('Thành tiền dòng = unit_price * quantity');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropForeign(['product_option_id']);
            $table->dropColumn(['product_option_id', 'unit_price', 'total_price']);
        });
    }
};
