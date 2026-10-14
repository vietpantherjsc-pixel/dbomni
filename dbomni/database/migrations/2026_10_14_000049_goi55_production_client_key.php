<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11ac: idempotency cho chế biến — client gửi client_key, trùng key thì trả bản ghi cũ
return new class extends Migration {
    public function up(): void {
        Schema::table('productions', function (Blueprint $table) {
            $table->string('client_key', 64)->nullable()->after('note')
                ->comment('Khóa idempotency do client sinh, chống bấm 2 lần');
            $table->unique('client_key');
        });
    }

    public function down(): void {
        Schema::table('productions', function (Blueprint $table) {
            $table->dropUnique(['client_key']);
            $table->dropColumn('client_key');
        });
    }
};
