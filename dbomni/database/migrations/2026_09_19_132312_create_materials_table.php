<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('materials', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150)->comment('Tên nguyên vật liệu');
            $table->string('unit', 20)->comment('Đơn vị tính (g, ml, cái,...)');
            $table->enum('type', ['raw', 'semi_finished', 'consumable'])->comment('Cấp nguyên liệu: raw (thô), semi_finished (bán thành phẩm), consumable (tiêu hao: ly, ống hút)');
            $table->decimal('minimum_stock', 10, 2)->default(0)->comment('Mức tồn kho tối thiểu để cảnh báo nhập hàng');
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('materials');
    }
};