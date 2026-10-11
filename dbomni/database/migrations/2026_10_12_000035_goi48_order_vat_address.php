<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 48: hóa đơn VAT cho đơn online + ghi chú giao hàng + địa chỉ chi tiết.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'need_vat_invoice')) {
                $table->boolean('need_vat_invoice')->default(false)->after('note');
            }
            if (!Schema::hasColumn('orders', 'vat_tax_code')) {
                $table->string('vat_tax_code', 30)->nullable()->after('need_vat_invoice');
            }
            if (!Schema::hasColumn('orders', 'vat_company_name')) {
                $table->string('vat_company_name', 200)->nullable()->after('vat_tax_code');
            }
            if (!Schema::hasColumn('orders', 'vat_company_address')) {
                $table->string('vat_company_address', 255)->nullable()->after('vat_company_name');
            }
            if (!Schema::hasColumn('orders', 'vat_email')) {
                $table->string('vat_email', 150)->nullable()->after('vat_company_address');
            }
            if (!Schema::hasColumn('orders', 'delivery_note')) {
                $table->string('delivery_note', 500)->nullable()->after('vat_email')->comment('Ghi chú khi giao hàng');
            }
            if (!Schema::hasColumn('orders', 'province')) {
                $table->string('province', 100)->nullable()->after('delivery_note');
            }
            if (!Schema::hasColumn('orders', 'ward')) {
                $table->string('ward', 100)->nullable()->after('province');
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['need_vat_invoice', 'vat_tax_code', 'vat_company_name', 'vat_company_address', 'vat_email', 'delivery_note', 'province', 'ward']);
        });
    }
};
