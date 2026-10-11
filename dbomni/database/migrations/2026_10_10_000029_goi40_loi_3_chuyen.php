<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

// Gói 40: Lỗi 3 Chuyên — danh mục lỗi, ghi nhận vi phạm, trừ khác đa khoản,
// salary_records.violation_count NULL được (NULL = tự động cộng từ violations).
return new class extends Migration
{
    public function up(): void
    {
        // 1. Danh mục loại lỗi vi phạm
        if (!Schema::hasTable('violation_types')) {
            Schema::create('violation_types', function (Blueprint $table) {
                $table->id();
                $table->enum('category', ['chuyen_can', 'chuyen_mon', 'chuyen_nghiep']);
                $table->string('name', 255);
                $table->integer('default_points')->default(1);
                $table->integer('sort_order')->default(0);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
                $table->index('category');
            });
        }

        // 2. Bản ghi vi phạm của nhân viên
        if (!Schema::hasTable('violations')) {
            Schema::create('violations', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->foreignId('violation_type_id')->nullable()->constrained('violation_types')->nullOnDelete();
                $table->string('violation_name', 255); // snapshot tên lúc ghi
                $table->integer('points');
                $table->date('date');
                $table->string('note', 255)->nullable();
                $table->enum('source', ['self', 'manager'])->default('manager');
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->timestamps();
                $table->index(['employee_id', 'date']);
            });
        }

        // 3. Khoản trừ khác (nhiều khoản / NV / tháng)
        if (!Schema::hasTable('salary_deductions')) {
            Schema::create('salary_deductions', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->string('month', 7); // YYYY-MM
                $table->string('name', 255);
                $table->decimal('amount', 15, 2)->default(0);
                $table->string('note', 255)->nullable();
                $table->integer('sort_order')->default(0);
                $table->timestamps();
                $table->index(['employee_id', 'month']);
            });
        }

        // 4. violation_count NULL được: NULL = dùng số tự động cộng từ violations
        if (Schema::hasTable('salary_records') && Schema::hasColumn('salary_records', 'violation_count')) {
            DB::statement('ALTER TABLE `salary_records` MODIFY `violation_count` INT NULL DEFAULT NULL');
        }

        // 5. Chuyển other_deduction cũ sang salary_deductions (cột cũ giữ lại)
        if (Schema::hasTable('salary_records') && Schema::hasTable('salary_deductions')) {
            $rows = DB::table('salary_records')
                ->where('other_deduction', '>', 0)
                ->get(['employee_id', 'month', 'other_deduction', 'other_deduction_note']);
            foreach ($rows as $r) {
                $exists = DB::table('salary_deductions')
                    ->where('employee_id', $r->employee_id)
                    ->where('month', $r->month)
                    ->exists();
                if (!$exists) {
                    DB::table('salary_deductions')->insert([
                        'employee_id' => $r->employee_id,
                        'month' => $r->month,
                        'name' => 'Khoản trừ khác',
                        'amount' => $r->other_deduction,
                        'note' => $r->other_deduction_note,
                        'sort_order' => 0,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            }
        }

        // 6. Seed 12 loại lỗi vi phạm (chạy lại không trùng)
        $types = [
            ['category' => 'chuyen_can', 'name' => 'Đi trễ quá 5 phút', 'default_points' => 1],
            ['category' => 'chuyen_can', 'name' => 'Đi trễ/về sớm không xin phép dưới 1 tiếng', 'default_points' => 1],
            ['category' => 'chuyen_can', 'name' => 'Đi trễ/về sớm không xin phép từ 1 tiếng trở lên', 'default_points' => 2],
            ['category' => 'chuyen_can', 'name' => 'Nghỉ làm không xin phép', 'default_points' => 4],
            ['category' => 'chuyen_mon', 'name' => 'Bấm bill sai món/sai tùy chọn', 'default_points' => 1],
            ['category' => 'chuyen_mon', 'name' => 'Làm nhầm/sai món/sai tùy chọn', 'default_points' => 1],
            ['category' => 'chuyen_mon', 'name' => 'Đóng gói không đúng quy cách, thiếu món/thiếu dụng cụ ăn uống', 'default_points' => 1],
            ['category' => 'chuyen_nghiep', 'name' => 'Không tuân thủ quy định về tác phong, đồng phục', 'default_points' => 1],
            ['category' => 'chuyen_nghiep', 'name' => 'Cư xử không đúng chuẩn mực với khách hàng, tài xế', 'default_points' => 1],
            ['category' => 'chuyen_nghiep', 'name' => 'Cư xử không đúng chuẩn mực với cấp trên/đồng nghiệp', 'default_points' => 1],
            ['category' => 'chuyen_nghiep', 'name' => 'Vi phạm lỗi đã bị nhắc nhở trên 2 lần', 'default_points' => 1],
            ['category' => 'chuyen_nghiep', 'name' => 'Không thực hiện công việc đã được phân công', 'default_points' => 1],
        ];
        $order = 0;
        foreach ($types as $t) {
            $row = DB::table('violation_types')
                ->where('category', $t['category'])->where('name', $t['name'])->first();
            if ($row) {
                DB::table('violation_types')->where('id', $row->id)->update([
                    'default_points' => $t['default_points'],
                    'sort_order' => $order++,
                    'updated_at' => now(),
                ]);
            } else {
                DB::table('violation_types')->insert([
                    'category' => $t['category'],
                    'name' => $t['name'],
                    'default_points' => $t['default_points'],
                    'sort_order' => $order++,
                    'is_active' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('salary_deductions');
        Schema::dropIfExists('violations');
        Schema::dropIfExists('violation_types');
        if (Schema::hasTable('salary_records') && Schema::hasColumn('salary_records', 'violation_count')) {
            DB::statement('ALTER TABLE `salary_records` MODIFY `violation_count` INT NOT NULL DEFAULT 0');
        }
    }
};
