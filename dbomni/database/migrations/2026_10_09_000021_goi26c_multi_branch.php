<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

// Gói 26c (2026-10-09): 1 nhân viên gán được NHIỀU chi nhánh.
// - Giữ employees.branch_id làm CHI NHÁNH CHÍNH (bắt buộc).
// - Pivot branch_employee: các chi nhánh nhân viên làm việc (luôn gồm chi nhánh chính).
// Idempotent: hasTable + backfill chỉ chèn dòng thiếu.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('branch_employee')) {
            Schema::create('branch_employee', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->foreignId('branch_id')->constrained('branches')->cascadeOnDelete();
                $table->timestamps();
                $table->unique(['employee_id', 'branch_id']);
            });
        }

        // Backfill: mỗi NV hiện tại có ít nhất 1 dòng pivot = chi nhánh chính
        if (Schema::hasTable('branch_employee') && Schema::hasTable('employees')) {
            $rows = DB::table('employees')->whereNotNull('branch_id')->select('id', 'branch_id')->get();
            foreach ($rows as $r) {
                $exists = DB::table('branch_employee')
                    ->where('employee_id', $r->id)
                    ->where('branch_id', $r->branch_id)
                    ->exists();
                if (!$exists) {
                    DB::table('branch_employee')->insert([
                        'employee_id' => $r->id,
                        'branch_id' => $r->branch_id,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_employee');
    }
};
