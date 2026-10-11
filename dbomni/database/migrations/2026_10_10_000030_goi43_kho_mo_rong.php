<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 43 (2026-10-10): mở rộng kho — chuyển kho CN, phiếu nhập theo hóa đơn,
// employee_id cho kiểm kê/chế biến, receipt_id cho batches.
return new class extends Migration
{
    public function up(): void
    {
        // 1. Phiếu chuyển kho giữa các chi nhánh
        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique();
            $table->foreignId('from_branch_id')->constrained('branches');
            $table->foreignId('to_branch_id')->constrained('branches');
            $table->string('status', 20)->default('draft'); // draft/confirmed/cancelled
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('confirmed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable();
            $table->decimal('total_cost', 15, 2)->default(0);
            $table->text('note')->nullable();
            $table->timestamps();
        });

        Schema::create('stock_transfer_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_transfer_id')->constrained('stock_transfers')->cascadeOnDelete();
            $table->foreignId('material_id')->constrained('materials');
            $table->decimal('quantity', 12, 3);
            $table->decimal('unit_cost', 15, 2)->default(0);
            $table->foreignId('from_batch_id')->nullable()->constrained('batches')->nullOnDelete();
            $table->foreignId('to_batch_id')->nullable()->constrained('batches')->nullOnDelete();
            $table->timestamps();
        });

        // 2. Phiếu nhập hàng theo hóa đơn
        Schema::create('inbound_receipts', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique();
            $table->foreignId('branch_id')->constrained('branches');
            $table->foreignId('partner_id')->nullable()->constrained('partners')->nullOnDelete();
            $table->string('invoice_no')->nullable();
            $table->date('receipt_date');
            $table->boolean('tax_included')->default(true);
            $table->decimal('tax_rate', 5, 2)->default(0);
            $table->decimal('discount_amount', 15, 2)->default(0);
            $table->decimal('shipping_fee', 15, 2)->default(0);
            $table->decimal('subtotal', 15, 2)->default(0);
            $table->decimal('vat_amount', 15, 2)->default(0);
            $table->decimal('grand_total', 15, 2)->default(0);
            $table->string('payment_type', 10)->default('paid'); // paid/debt
            $table->string('status', 20)->default('confirmed'); // confirmed/cancelled
            $table->text('note')->nullable();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('created_by_employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('inbound_receipt_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('inbound_receipt_id')->constrained('inbound_receipts')->cascadeOnDelete();
            $table->foreignId('material_id')->constrained('materials');
            $table->foreignId('batch_id')->nullable()->constrained('batches')->nullOnDelete();
            $table->decimal('purchase_quantity', 12, 3);
            $table->string('purchase_unit')->nullable();
            $table->decimal('conversion_rate', 12, 4)->default(1);
            $table->decimal('unit_cost', 15, 2)->default(0);
            $table->decimal('line_total', 15, 2)->default(0);
            $table->date('expired_at')->nullable();
            $table->string('batch_code')->nullable();
            $table->timestamps();
        });

        // 3. Ghi nhận NV thực hiện kiểm kê / chế biến
        Schema::table('stocktakes', function (Blueprint $table) {
            $table->foreignId('employee_id')->nullable()->after('user_id')->constrained('employees')->nullOnDelete();
        });
        Schema::table('productions', function (Blueprint $table) {
            $table->foreignId('employee_id')->nullable()->after('user_id')->constrained('employees')->nullOnDelete();
        });

        // 4. Liên kết batch với phiếu nhập
        Schema::table('batches', function (Blueprint $table) {
            $table->foreignId('receipt_id')->nullable()->after('branch_id')->constrained('inbound_receipts')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('batches', function (Blueprint $table) {
            $table->dropConstrainedForeignId('receipt_id');
        });
        Schema::table('productions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('employee_id');
        });
        Schema::table('stocktakes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('employee_id');
        });
        Schema::dropIfExists('inbound_receipt_items');
        Schema::dropIfExists('inbound_receipts');
        Schema::dropIfExists('stock_transfer_items');
        Schema::dropIfExists('stock_transfers');
    }
};
