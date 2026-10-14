<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11m: cho phép 1 nguyên liệu có nhiều đơn vị quy đổi
// VD: Sữa tươi — đơn vị cơ sở ml; quy đổi: 1 chai = 1000ml, 1 thùng = 12000ml
return new class extends Migration {
    public function up(): void {
        Schema::create('material_units', function (Blueprint $table) {
            $table->id();
            $table->foreignId('material_id')->constrained('materials')->onDelete('cascade');
            $table->string('unit_name', 30)->comment('Tên đơn vị quy đổi: chai, kg, thùng...');
            $table->decimal('conversion_rate', 12, 4)->comment('1 đơn vị này = ? đơn vị cơ sở');
            $table->timestamps();
            $table->unique(['material_id', 'unit_name']);
        });
        // Migrate dữ liệu cũ: purchase_unit + conversion_rate -> material_units
        if (Schema::hasColumn('materials', 'purchase_unit')) {
            $materials = DB::table('materials')
                ->whereNotNull('purchase_unit')->where('purchase_unit', '!=', '')
                ->whereNotNull('conversion_rate')->where('conversion_rate', '>', 0)
                ->get(['id', 'purchase_unit', 'conversion_rate']);
            foreach ($materials as $m) {
                DB::table('material_units')->updateOrInsert(
                    ['material_id' => $m->id, 'unit_name' => $m->purchase_unit],
                    ['conversion_rate' => $m->conversion_rate, 'created_at' => now(), 'updated_at' => now()]
                );
            }
        }
    }

    public function down(): void {
        Schema::dropIfExists('material_units');
    }
};
