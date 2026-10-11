<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

// Gói 38: bảo mật PIN 6 số — bỏ unique index (hash có salt, DB không check trùng được),
// nới cột char(6) -> varchar(255) để chứa hash bcrypt, hash toàn bộ PIN plaintext hiện có.
// LƯU Ý: dùng query builder (DB::table) để tránh cast 'hashed' của model hash 2 lần.
return new class extends Migration
{
    public function up(): void
    {
        // 1. Bỏ unique index trên pin_code
        Schema::table('employees', function (Blueprint $table) {
            $table->dropUnique(['pin_code']);
        });

        // 2. Nới cột để chứa hash bcrypt (60 ký tự). Dùng lệnh trực tiếp, không cần doctrine/dbal.
        DB::statement('ALTER TABLE `employees` MODIFY `pin_code` VARCHAR(255) NOT NULL');

        // 3. Hash toàn bộ PIN plaintext hiện có
        $rows = DB::table('employees')->select('id', 'pin_code')->get();
        foreach ($rows as $r) {
            if ($r->pin_code && !Hash::isHashed($r->pin_code)) {
                DB::table('employees')->where('id', $r->id)->update(['pin_code' => Hash::make($r->pin_code)]);
            }
        }
    }

    public function down(): void
    {
        // Không thể khôi phục PIN plaintext từ hash — down() chỉ dựng lại unique index.
        Schema::table('employees', function (Blueprint $table) {
            $table->unique('pin_code');
        });
    }
};
