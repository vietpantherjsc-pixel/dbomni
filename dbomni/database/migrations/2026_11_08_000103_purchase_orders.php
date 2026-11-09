<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec Phiếu đặt hàng NCC (Đại Vương CHỐT 2026-11-08): 2 bảng mới
// purchase_orders / purchase_order_items + cột liên kết
// inbound_receipts.purchase_order_id. Phiếu đặt KHÔNG qua hàng chờ duyệt,
// không động tồn kho/tiền — chỉ là ý định đặt hàng; đóng "Đã nhận hàng"
// khi phiếu nhập liên kết đầu tiên được xác nhận (cơ chế ở model/service).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('purchase_orders')) {
            Schema::create('purchase_orders', function (Blueprint $table) {
                $table->id();
                $table->string('code', 30)->unique()->comment('Mã DDH + YYYYMMDD + 4 số, không gạch');
                $table->foreignId('branch_id')->constrained('branches');
                $table->foreignId('partner_id')->constrained('partners')->comment('NCC (partners.type = supplier)');
                $table->string('status', 20)->default('draft')->comment('draft | ordered | received | cancelled');
                $table->date('order_date');
                $table->text('note')->nullable();
                $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('created_by_employee_id')->nullable()->constrained('employees')->nullOnDelete();
                $table->timestamp('ordered_at')->nullable();
                $table->timestamp('received_at')->nullable();
                $table->timestamp('cancelled_at')->nullable();
                $table->foreignId('cancelled_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('cancelled_by_employee_id')->nullable()->constrained('employees')->nullOnDelete();
                $table->timestamps();
                $table->index(['branch_id', 'status']);
            });
        }
        if (!Schema::hasTable('purchase_order_items')) {
            Schema::create('purchase_order_items', function (Blueprint $table) {
                $table->id();
                $table->foreignId('purchase_order_id')->constrained('purchase_orders')->cascadeOnDelete();
                $table->foreignId('material_id')->constrained('materials');
                $table->decimal('quantity', 14, 4)->comment('Số lượng đặt theo đơn vị ở unit_name');
                $table->string('unit_name', 30)->comment('Snapshot chữ: đơn vị cơ sở hoặc 1 unit_name trong material_units');
                $table->string('note')->nullable()->comment('Ghi chú từng dòng — in trên ảnh phiếu');
                $table->timestamps();
            });
        }
        if (Schema::hasTable('inbound_receipts') && !Schema::hasColumn('inbound_receipts', 'purchase_order_id')) {
            Schema::table('inbound_receipts', function (Blueprint $table) {
                $table->foreignId('purchase_order_id')->nullable()->after('partner_id')
                    ->constrained('purchase_orders')->nullOnDelete()
                    ->comment('Phiếu đặt hàng NCC mà phiếu nhập này nhận hàng cho (spec đặt hàng NCC)');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('inbound_receipts') && Schema::hasColumn('inbound_receipts', 'purchase_order_id')) {
            Schema::table('inbound_receipts', function (Blueprint $table) {
                $table->dropConstrainedForeignId('purchase_order_id');
            });
        }
        Schema::dropIfExists('purchase_order_items');
        Schema::dropIfExists('purchase_orders');
    }
};
