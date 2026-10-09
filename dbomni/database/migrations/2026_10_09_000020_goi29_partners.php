<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Gói 29 (2026-10-09): Đối tác + công nợ phải thu/phải trả.
// - partners: dùng chung toàn chuỗi (KHÔNG có branch_id) — Đại Vương chốt.
// - transactions: thêm partner_id + paid_amount (còn nợ = amount - paid_amount).
// - transaction_payments: lịch sử thanh toán trừ dần công nợ.
// Idempotent: hasTable/hasColumn trước khi tạo/thêm.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('partners')) {
            Schema::create('partners', function (Blueprint $table) {
                $table->id();
                $table->string('code', 30)->unique()->comment('Mã đối tác');
                $table->string('name', 150)->comment('Tên đối tác');
                $table->enum('type', ['supplier', 'customer', 'other'])->default('supplier')
                    ->comment('supplier: NCC, customer: khách hàng, other: khác');
                $table->string('phone', 20)->nullable();
                $table->string('email', 150)->nullable();
                $table->string('address', 255)->nullable();
                $table->string('tax_code', 30)->nullable()->comment('Mã số thuế');
                $table->text('note')->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        if (Schema::hasTable('transactions')) {
            Schema::table('transactions', function (Blueprint $table) {
                if (!Schema::hasColumn('transactions', 'partner_id')) {
                    $table->foreignId('partner_id')->nullable()->after('branch_id')
                        ->constrained('partners')->nullOnDelete();
                }
                if (!Schema::hasColumn('transactions', 'paid_amount')) {
                    $table->decimal('paid_amount', 15, 2)->default(0)->after('amount')
                        ->comment('Số đã thanh toán; còn nợ = amount - paid_amount');
                }
            });
            // Backfill: phiếu paid cũ -> paid_amount = amount (còn nợ = 0).
            DB::table('transactions')
                ->where('status', 'paid')
                ->where('paid_amount', 0)
                ->update(['paid_amount' => DB::raw('amount')]);
        }

        if (!Schema::hasTable('transaction_payments')) {
            Schema::create('transaction_payments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('transaction_id')->constrained('transactions')->cascadeOnDelete();
                $table->decimal('amount', 15, 2)->comment('Số tiền thanh toán lần này');
                $table->date('paid_at')->nullable();
                $table->string('payment_method', 30)->nullable()->comment('cash/transfer/card');
                $table->text('note')->nullable();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->index('transaction_id');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('transaction_payments');
        // Giữ lại bảng partners và cột partner_id/paid_amount để an toàn dữ liệu.
    }
};
