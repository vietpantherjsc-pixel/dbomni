<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 7e (2026-10-05): bổ sung timestamps cho product_prices.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('product_prices', 'created_at')) {
            Schema::table('product_prices', function (Blueprint $table) {
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('product_prices', 'created_at')) {
            Schema::table('product_prices', function (Blueprint $table) {
                $table->dropTimestamps();
            });
        }
    }
};
