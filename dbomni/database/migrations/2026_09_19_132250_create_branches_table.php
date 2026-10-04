<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('branches', function (Blueprint $table) {
            $table->id();
            $table->string('code', 50)->unique()->comment('Mã chi nhánh duy nhất');
            $table->string('name', 150)->comment('Tên chi nhánh cửa hàng');
            $table->string('phone', 20)->nullable()->comment('Số điện thoại hotline chi nhánh');
            $table->string('address', 255)->comment('Địa chỉ chi nhánh');
            $table->decimal('latitude', 10, 8)->comment('Tọa độ vĩ độ (Lat)');
            $table->decimal('longitude', 11, 8)->comment('Tọa độ kinh độ (Lng)');
            $table->boolean('is_active')->default(true)->comment('Trạng thái hoạt động (1: Hoạt động, 0: Tạm đóng)');
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('branches');
    }
};