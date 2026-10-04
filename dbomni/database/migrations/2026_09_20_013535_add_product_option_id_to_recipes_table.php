<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('recipes', function (Blueprint $table) {
            if (!Schema::hasColumn('recipes', 'product_option_id')) {
                $table->foreignId('product_option_id')
                      ->nullable()
                      ->after('product_id')
                      ->constrained('product_options')
                      ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('recipes', function (Blueprint $table) {
            if (Schema::hasColumn('recipes', 'product_option_id')) {
                $table->dropForeign(['product_option_id']);
                $table->dropColumn('product_option_id');
            }
        });
    }
};