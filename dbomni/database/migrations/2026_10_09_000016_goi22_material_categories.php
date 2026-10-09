<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Gói 22 (2026-10-09): Loại danh mục nguyên liệu (nhóm kiểm kho động, thay 3 nhóm cứng).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('material_categories')) {
            Schema::create('material_categories', function (Blueprint $table) {
                $table->id();
                $table->string('name', 100);
                $table->integer('sort_order')->default(0);
                $table->timestamps();
            });
        }

        if (!Schema::hasColumn('materials', 'material_category_id')) {
            Schema::table('materials', function (Blueprint $table) {
                $table->foreignId('material_category_id')->nullable()->after('type')
                    ->constrained('material_categories')->nullOnDelete();
            });
        }

        // Seed 3 loại mặc định + backfill từ cột type cũ (chỉ chạy khi bảng còn trống)
        if (DB::table('material_categories')->count() === 0) {
            $raw = DB::table('material_categories')->insertGetId([
                'name' => 'Nguyên liệu thô', 'sort_order' => 1,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $semi = DB::table('material_categories')->insertGetId([
                'name' => 'Bán thành phẩm', 'sort_order' => 2,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $pack = DB::table('material_categories')->insertGetId([
                'name' => 'Bao bì', 'sort_order' => 3,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('materials')->where('type', 'raw')->whereNull('material_category_id')
                ->update(['material_category_id' => $raw]);
            DB::table('materials')->where('type', 'semi_finished')->whereNull('material_category_id')
                ->update(['material_category_id' => $semi]);
            DB::table('materials')->where('type', 'consumable')->whereNull('material_category_id')
                ->update(['material_category_id' => $pack]);
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('materials', 'material_category_id')) {
            Schema::table('materials', function (Blueprint $table) {
                $table->dropForeign(['material_category_id']);
                $table->dropColumn('material_category_id');
            });
        }
        Schema::dropIfExists('material_categories');
    }
};
