<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

// Gói 27 (2026-10-09): Thu-Chi hoàn thiện.
// - transaction_categories: danh mục thu/chi (seed sẵn, "Nhập hàng" là system).
// - transactions: phiếu thu/chi, liên kết được với phiếu nhập kho (related_type=inbound).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('transaction_categories')) {
            Schema::create('transaction_categories', function (Blueprint $table) {
                $table->id();
                $table->string('name', 100);
                $table->enum('type', ['income', 'expense'])->comment('income: thu, expense: chi');
                $table->boolean('is_system')->default(false)->comment('1: danh mục hệ thống, không cho xóa');
                $table->timestamps();
                $table->unique(['name', 'type']);
            });
        }

        // Seed danh mục mặc định (idempotent).
        $defaults = [
            ['name' => 'Nhập hàng', 'type' => 'expense', 'is_system' => true],
            ['name' => 'Lương', 'type' => 'expense', 'is_system' => false],
            ['name' => 'Mặt bằng', 'type' => 'expense', 'is_system' => false],
            ['name' => 'Điện nước', 'type' => 'expense', 'is_system' => false],
            ['name' => 'Khác', 'type' => 'expense', 'is_system' => false],
            ['name' => 'Bán hàng', 'type' => 'income', 'is_system' => true],
            ['name' => 'Khác', 'type' => 'income', 'is_system' => false],
        ];
        foreach ($defaults as $c) {
            DB::table('transaction_categories')->updateOrInsert(
                ['name' => $c['name'], 'type' => $c['type']],
                ['is_system' => $c['is_system'], 'created_at' => now(), 'updated_at' => now()]
            );
        }

        if (!Schema::hasTable('transactions')) {
            Schema::create('transactions', function (Blueprint $table) {
                $table->id();
                $table->string('code', 30)->unique()->comment('PT-.../PC-...');
                $table->enum('type', ['income', 'expense'])->comment('income: thu, expense: chi');
                $table->foreignId('category_id')->constrained('transaction_categories')->restrictOnDelete();
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->decimal('amount', 15, 2);
                $table->date('paid_at')->nullable()->comment('Ngày thu/chi thực tế');
                $table->enum('status', ['paid', 'pending'])->default('paid')->comment('paid: đã thanh toán, pending: chờ thanh toán');
                $table->string('payment_method', 30)->nullable()->comment('cash/transfer/card');
                $table->string('related_type', 30)->nullable()->comment('VD: inbound (tự sinh từ phiếu nhập kho)');
                $table->unsignedBigInteger('related_id')->nullable();
                $table->text('note')->nullable();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->index(['related_type', 'related_id']);
                $table->index(['type', 'paid_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('transactions');
        Schema::dropIfExists('transaction_categories');
    }
};
