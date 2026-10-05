<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 4 (2026-10-04): Kho nâng cao.
// - materials: thêm đơn vị nhập + tỉ lệ quy đổi (VD: 1 chai = 750ml)
// - production_recipes: định mức chế biến bán thành phẩm (ủ cốt cà phê/trà, nấu trân châu, làm kem...)
// - productions + production_items: phiếu chế biến
// - stocktakes + stocktake_items: kiểm kê kho (ngày/tuần/tháng/đột xuất)
return new class extends Migration
{
    public function up(): void
    {
        // 1. Quy đổi đơn vị trên nguyên liệu
        Schema::table('materials', function (Blueprint $table) {
            $table->string('purchase_unit', 20)->nullable()->after('unit')
                ->comment('Đơn vị nhập hàng (chai, kg, túi...) — null = nhập theo đơn vị cơ sở');
            $table->decimal('conversion_rate', 10, 4)->default(1)->after('purchase_unit')
                ->comment('Tỉ lệ quy đổi: 1 purchase_unit = N đơn vị cơ sở (VD: 1 chai = 750ml)');
        });

        // 2. Định mức chế biến: bán thành phẩm <- nguyên liệu thô
        Schema::create('production_recipes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('material_id')->constrained('materials')->onDelete('cascade')
                ->comment('Bán thành phẩm đầu ra (cốt cà phê, cốt trà, trân châu...)');
            $table->foreignId('raw_material_id')->constrained('materials')->onDelete('cascade')
                ->comment('Nguyên liệu thô đầu vào');
            $table->decimal('quantity', 10, 2)->comment('Lượng nguyên liệu thô cho 1 ĐƠN VỊ bán thành phẩm (đơn vị cơ sở)');
            $table->timestamps();
            $table->unique(['material_id', 'raw_material_id']);
        });

        // 3. Phiếu chế biến
        Schema::create('productions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained('branches')->onDelete('cascade');
            $table->foreignId('material_id')->constrained('materials')->onDelete('cascade')
                ->comment('Bán thành phẩm được chế biến');
            $table->decimal('quantity', 10, 2)->comment('Số lượng thành phẩm (đơn vị cơ sở)');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('production_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('production_id')->constrained('productions')->onDelete('cascade');
            $table->foreignId('material_id')->constrained('materials')->onDelete('cascade')
                ->comment('Nguyên liệu thô đã tiêu hao');
            $table->decimal('quantity', 10, 2)->comment('Số lượng đã trừ (đơn vị cơ sở)');
            $table->timestamps();
        });

        // 4. Kiểm kê kho
        Schema::create('stocktakes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained('branches')->onDelete('cascade');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('type', 20)->default('spontaneous')
                ->comment('daily: ngày, weekly: tuần, monthly: tháng, spontaneous: đột xuất');
            $table->string('status', 20)->default('draft')->comment('draft: đang kiểm, confirmed: đã chốt');
            $table->string('note', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('stocktake_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stocktake_id')->constrained('stocktakes')->onDelete('cascade');
            $table->foreignId('material_id')->constrained('materials')->onDelete('cascade');
            $table->decimal('system_qty', 10, 2)->comment('Tồn hệ thống lúc tạo phiếu');
            $table->decimal('counted_qty', 10, 2)->nullable()->comment('Số lượng thực đếm');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stocktake_items');
        Schema::dropIfExists('stocktakes');
        Schema::dropIfExists('production_items');
        Schema::dropIfExists('productions');
        Schema::dropIfExists('production_recipes');
        Schema::table('materials', function (Blueprint $table) {
            $table->dropColumn(['purchase_unit', 'conversion_rate']);
        });
    }
};
