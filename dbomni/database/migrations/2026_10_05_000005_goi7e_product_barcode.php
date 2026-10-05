<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 7e (2026-10-05): bổ sung cột barcode cho products (file Excel có "Mã Barcode").
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('products', 'barcode')) {
            Schema::table('products', function (Blueprint $table) {
                $table->string('barcode', 100)->nullable()->after('sku');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('products', 'barcode')) {
            Schema::table('products', function (Blueprint $table) {
                $table->dropColumn('barcode');
            });
        }
    }
};
