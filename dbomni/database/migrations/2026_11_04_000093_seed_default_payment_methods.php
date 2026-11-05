<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Lát 1e (rà soát đêm 2026-11-04): nạp sẵn 2 phương thức thanh toán mặc định
// khi bảng payment_methods RỖNG — đúng 2 mục của danh sách dự phòng cứng mà
// trang thanh toán Mini App đang dùng khi bảng trống (Chuyển khoản/QR qua
// type=transfer; Trả tại quán qua type=cash vì phía khách ánh xạ cash →
// pay_at_store). Máy nào đã có dữ liệu thì migration này không đụng vào.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('payment_methods')) {
            return;
        }
        if (DB::table('payment_methods')->count() > 0) {
            return;
        }
        DB::table('payment_methods')->insert([
            [
                'name' => 'Chuyển khoản / QR',
                'type' => 'transfer',
                'channels' => null,
                'is_active' => true,
                'sort_order' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'name' => 'Thanh toán tại quán',
                'type' => 'cash',
                'channels' => null,
                'is_active' => true,
                'sort_order' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('payment_methods')) {
            return;
        }
        DB::table('payment_methods')
            ->whereIn('name', ['Chuyển khoản / QR', 'Thanh toán tại quán'])
            ->whereIn('type', ['transfer', 'cash'])
            ->delete();
    }
};
