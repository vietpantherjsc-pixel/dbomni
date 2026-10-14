<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11c: thêm số lượng BTP mỗi mẻ chế biến vào định mức
// VD: 1 mẻ Kem Buôn Mê → 500gr (định mức NL tính cho 500gr này)
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('production_recipes')) return;
        if (!Schema::hasColumn('production_recipes', 'batch_output_qty')) {
            Schema::table('production_recipes', function (Blueprint $table) {
                $table->decimal('batch_output_qty', 12, 2)->nullable()->after('quantity')
                    ->comment('Số lượng BTP tạo ra mỗi mẻ (VD: 500gr kem/mẻ)');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('production_recipes') && Schema::hasColumn('production_recipes', 'batch_output_qty')) {
            Schema::table('production_recipes', function (Blueprint $table) {
                $table->dropColumn('batch_output_qty');
            });
        }
    }
};
