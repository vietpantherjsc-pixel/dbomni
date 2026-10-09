<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

// Gói 26 (2026-10-09): PH Nhân viên — chức vụ, nhân viên, lương theo giờ, ứng lương, thưởng, ngày lễ.
// Idempotent: kiểm tra hasTable trước khi tạo.
return new class extends Migration
{
    public function up(): void
    {
        // 1. Chức vụ + ma trận quyền (JSON: ["orders.view","products.edit","*"] )
        if (!Schema::hasTable('job_roles')) {
            Schema::create('job_roles', function (Blueprint $table) {
                $table->id();
                $table->string('name', 100)->unique()->comment('Tên chức vụ');
                $table->json('permissions')->nullable()->comment('Ma trận quyền, vd ["orders.view","*"]');
                $table->timestamps();
            });
        }

        // 2. Nhân viên
        if (!Schema::hasTable('employees')) {
            Schema::create('employees', function (Blueprint $table) {
                $table->id();
                $table->string('full_name', 150)->comment('Họ tên');
                $table->date('dob')->nullable()->comment('Ngày sinh');
                $table->date('start_date')->comment('Ngày vào làm');
                $table->string('phone', 20)->unique()->comment('SĐT');
                $table->string('email', 150)->nullable()->comment('Email');
                $table->string('education', 150)->nullable()->comment('Học vấn');
                $table->string('qualification', 150)->nullable()->comment('Trình độ');
                $table->string('username', 100)->unique()->nullable()->comment('Tên đăng nhập admin');
                $table->string('password')->nullable()->comment('Mật khẩu đăng nhập (hash)');
                $table->char('pin_code', 6)->unique()->comment('Mã PIN 6 số: chấm công + POS/KDS');
                $table->foreignId('role_id')->nullable()->nullOnDelete()
                    ->constrained('job_roles')->comment('Chức vụ');
                $table->foreignId('branch_id')->constrained('branches')
                    ->comment('Chi nhánh trực thuộc');
                $table->boolean('is_active')->default(true)->comment('Đang làm việc');
                $table->string('avatar', 255)->nullable();
                $table->timestamps();
            });
        }

        // 3. Mức lương theo giờ (thêm mức mới -> tự đóng mức cũ)
        if (!Schema::hasTable('wage_levels')) {
            Schema::create('wage_levels', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->decimal('hourly_rate', 12, 2)->comment('3. Lương cơ bản/h');
                $table->decimal('responsibility_rate', 12, 2)->default(0)->comment('2. Lương trách nhiệm/h (cộng vào đơn giá)');
                $table->date('start_date')->comment('Ngày bắt đầu áp dụng');
                $table->date('end_date')->nullable()->comment('Ngày kết thúc (null = đang áp dụng)');
                $table->string('note', 255)->nullable();
                $table->timestamps();
                $table->index(['employee_id', 'start_date']);
            });
        }
        // Bổ sung cột responsibility_rate nếu bảng đã tồn tại từ bản migrate trước
        if (Schema::hasTable('wage_levels') && !Schema::hasColumn('wage_levels', 'responsibility_rate')) {
            Schema::table('wage_levels', function (Blueprint $table) {
                $table->decimal('responsibility_rate', 12, 2)->default(0)->after('hourly_rate');
            });
        }

        // 4. Ứng lương
        if (!Schema::hasTable('salary_advances')) {
            Schema::create('salary_advances', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->decimal('amount', 12, 2);
                $table->date('date')->comment('Ngày ứng');
                $table->string('note', 255)->nullable();
                $table->timestamps();
            });
        }

        // 5. Thưởng
        if (!Schema::hasTable('bonuses')) {
            Schema::create('bonuses', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->enum('type', ['performance', 'birthday', 'other'])->default('other');
                $table->decimal('amount', 12, 2);
                $table->date('date');
                $table->string('note', 255)->nullable();
                $table->timestamps();
            });
        }

        // 6. Ngày lễ + hệ số nhân lương
        if (!Schema::hasTable('holidays')) {
            Schema::create('holidays', function (Blueprint $table) {
                $table->id();
                $table->date('date')->unique();
                $table->string('name', 150);
                $table->decimal('multiplier', 4, 2)->default(2.00)->comment('Hệ số nhân lương');
                $table->timestamps();
            });
        }

        // 7. Giờ công tháng (nhập tay, dùng tạm khi chưa có module chấm công)
        if (!Schema::hasTable('salary_records')) {
            Schema::create('salary_records', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->char('month', 7)->comment('YYYY-MM');
                $table->decimal('hours', 8, 2)->default(0)->comment('Tổng giờ công tháng');
                $table->integer('work_days')->default(0)->comment('Số ngày công (tính phụ cấp ăn)');
                $table->decimal('holiday_hours', 8, 2)->default(0)->comment('Giờ làm ngày lễ');
                $table->decimal('other_deduction', 12, 2)->default(0)->comment('1. Các khoản trừ khác');
                $table->string('other_deduction_note', 255)->nullable()->comment('Lý do trừ (vd Lỗi 3 chuyền)');
                $table->string('note', 255)->nullable();
                $table->timestamps();
                $table->unique(['employee_id', 'month']);
            });
        }
        // Bổ sung 2 cột trừ khác nếu migrate trước đó chưa có
        if (Schema::hasTable('salary_records') && !Schema::hasColumn('salary_records', 'other_deduction')) {
            Schema::table('salary_records', function (Blueprint $table) {
                $table->decimal('other_deduction', 12, 2)->default(0)->after('holiday_hours');
                $table->string('other_deduction_note', 255)->nullable()->after('other_deduction');
            });
        }

        // 8. Chi tiết chấm công theo ngày (nhập tay / sau này lấy từ module chấm công)
        if (!Schema::hasTable('salary_days')) {
            Schema::create('salary_days', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->date('date');
                $table->string('check_in', 5)->nullable()->comment('Giờ vào HH:MM');
                $table->string('check_out', 5)->nullable()->comment('Giờ ra HH:MM');
                $table->decimal('hours', 6, 2)->default(0)->comment('Tổng số giờ ngày');
                $table->integer('meal_count')->default(0)->comment('Số suất ăn (đánh dấu X, X2...)');
                $table->timestamps();
                $table->unique(['employee_id', 'date']);
                $table->index(['employee_id', 'date']);
            });
        }

        // 9. BHXH nhân viên (chỉ một số NV đóng)
        if (!Schema::hasTable('employee_insurances')) {
            Schema::create('employee_insurances', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->unique()->constrained('employees')->cascadeOnDelete();
                $table->decimal('base_amount', 12, 2)->comment('Mức lương đóng BHXH');
                $table->boolean('employer_pays_all')->default(false)->comment('DN đóng thay cả phần NLĐ');
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        // Sửa FK employees.role_id nếu bản migration lỗi trước đó tạo nhầm sang bảng roles của Spatie.
        // (DB chạy lần đầu: employees vừa tạo đúng FK job_roles ở trên, khối này drop + tạo lại y hệt, vô hại.)
        if (Schema::hasTable('employees') && Schema::hasTable('job_roles')) {
            try {
                Schema::table('employees', function (Blueprint $table) {
                    $table->dropForeign(['role_id']);
                });
            } catch (\Exception $e) {
                // FK chưa tồn tại hoặc tên khác — bỏ qua, tạo mới bên dưới
            }
            Schema::table('employees', function (Blueprint $table) {
                $table->foreign('role_id')->references('id')->on('job_roles')->nullOnDelete();
            });
        }

        // Seed tỷ lệ BHXH + phụ cấp ăn mặc định (chỉ khi chưa có)
        $defaults = [
            'meal_allowance_min_hours' => '8',
            'meal_allowance_amount' => '25000',
            'bhxh_emp_bhxh' => '8',
            'bhxh_emp_bhyt' => '1.5',
            'bhxh_emp_bhtn' => '1',
            'bhxh_employer_rate' => '21.5',
        ];
        foreach ($defaults as $k => $v) {
            if (DB::table('settings')->where('key', $k)->count() === 0) {
                DB::table('settings')->insert(['key' => $k, 'value' => $v, 'created_at' => now(), 'updated_at' => now()]);
            }
        }

        // Seed 3 chức vụ mẫu (chỉ khi bảng roles trống)
        if (Schema::hasTable('job_roles') && DB::table('job_roles')->count() === 0) {
            DB::table('job_roles')->insert([
                [
                    'name' => 'Quản lý cửa hàng',
                    'permissions' => json_encode(['*']),
                    'created_at' => now(), 'updated_at' => now(),
                ],
                [
                    'name' => 'Thu ngân',
                    'permissions' => json_encode([
                        'dashboard.view', 'reports.view',
                        'orders.view', 'orders.create', 'orders.edit',
                        'products.view', 'customers.view', 'customers.create', 'customers.edit',
                        'promotions.view', 'tables.view',
                    ]),
                    'created_at' => now(), 'updated_at' => now(),
                ],
                [
                    'name' => 'Pha chế',
                    'permissions' => json_encode(['dashboard.view', 'orders.view']),
                    'created_at' => now(), 'updated_at' => now(),
                ],
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('salary_records');
        Schema::dropIfExists('holidays');
        Schema::dropIfExists('bonuses');
        Schema::dropIfExists('salary_advances');
        Schema::dropIfExists('wage_levels');
        Schema::dropIfExists('employees');
        Schema::dropIfExists('job_roles');
    }
};
