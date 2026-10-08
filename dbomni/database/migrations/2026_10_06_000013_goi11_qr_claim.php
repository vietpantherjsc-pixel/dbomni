<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 11 (2026-10-06): QR tích điểm tại POS — token để khách quét nhận đơn vào tài khoản.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('orders')) {
            if (!Schema::hasColumn('orders', 'claim_token')) {
                Schema::table('orders', function (Blueprint $table) {
                    $table->string('claim_token', 32)->nullable()->after('customer_id')
                        ->comment('Token QR tích điểm (khách quét để gán TV vào đơn)');
                });
            }
            if (!Schema::hasColumn('orders', 'claim_expires_at')) {
                Schema::table('orders', function (Blueprint $table) {
                    $table->dateTime('claim_expires_at')->nullable()->after('claim_token');
                });
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('orders')) {
            if (Schema::hasColumn('orders', 'claim_token')) {
                Schema::table('orders', function (Blueprint $table) {
                    $table->dropColumn('claim_token');
                });
            }
            if (Schema::hasColumn('orders', 'claim_expires_at')) {
                Schema::table('orders', function (Blueprint $table) {
                    $table->dropColumn('claim_expires_at');
                });
            }
        }
    }
};
