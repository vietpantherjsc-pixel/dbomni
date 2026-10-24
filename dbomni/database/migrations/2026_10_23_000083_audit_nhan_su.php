<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Audit 2026-10-23 — Nhân sự (Mảng 4):
// - A4-2: attendances bỏ ràng buộc unique (employee, branch, date) -> cho phép
//   2 cặp chấm vào/ra trong cùng 1 ngày tại 1 CN (ca gãy 2 đoạn).
// - A1-1: shift_swap_requests thêm decided_by_employee_id (người duyệt là Employee
//   ghi đúng FK employees thay vì ép id NV vào cột users như trước).
// - A1-10: shift_leave_requests thêm cột ghi vết người duyệt (User/Employee).
// - A3-7: bảng attendance_edits — vết sửa giờ chấm công (ai sửa, cũ -> mới).
// Toàn bộ CỘNG THÊM / nới lỏng, không phá dữ liệu hiện có.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('attendances')) {
            // Hotfix 2026-10-24: unique (employee_id, branch_id, date) đang là
            // index đỡ cho các FK của attendances — MySQL lỗi 1553 khi drop
            // trực tiếp. Tạo index thường trên đúng 3 cột TRƯỚC (Schema::table
            // RIÊNG để lệnh ALTER chạy xong hẳn), rồi mới drop unique.
            if (!Schema::hasIndex('attendances', 'idx_att_emp_branch_date')) {
                Schema::table('attendances', function (Blueprint $table) {
                    $table->index(['employee_id', 'branch_id', 'date'], 'idx_att_emp_branch_date');
                });
            }
            Schema::table('attendances', function (Blueprint $table) {
                $table->dropUnique('uniq_att_emp_branch_date');
            });
        }

        if (Schema::hasTable('shift_swap_requests') && !Schema::hasColumn('shift_swap_requests', 'decided_by_employee_id')) {
            Schema::table('shift_swap_requests', function (Blueprint $table) {
                $table->foreignId('decided_by_employee_id')->nullable()->after('decided_by')
                    ->constrained('employees')->nullOnDelete();
            });
        }

        if (Schema::hasTable('shift_leave_requests')) {
            Schema::table('shift_leave_requests', function (Blueprint $table) {
                if (!Schema::hasColumn('shift_leave_requests', 'handled_by')) {
                    $table->foreignId('handled_by')->nullable()->after('status')
                        ->constrained('users')->nullOnDelete();
                }
                if (!Schema::hasColumn('shift_leave_requests', 'handled_by_employee_id')) {
                    $table->foreignId('handled_by_employee_id')->nullable()->after('handled_by')
                        ->constrained('employees')->nullOnDelete();
                }
            });
        }

        if (!Schema::hasTable('attendance_edits')) {
            Schema::create('attendance_edits', function (Blueprint $table) {
                $table->id();
                $table->foreignId('attendance_id')->constrained('attendances')->cascadeOnDelete();
                $table->foreignId('editor_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('editor_employee_id')->nullable()->constrained('employees')->nullOnDelete();
                $table->dateTime('old_check_in')->nullable();
                $table->dateTime('new_check_in')->nullable();
                $table->dateTime('old_check_out')->nullable();
                $table->dateTime('new_check_out')->nullable();
                $table->string('reason', 500)->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_edits');

        if (Schema::hasTable('shift_leave_requests')) {
            Schema::table('shift_leave_requests', function (Blueprint $table) {
                if (Schema::hasColumn('shift_leave_requests', 'handled_by_employee_id')) {
                    $table->dropConstrainedForeignId('handled_by_employee_id');
                }
                if (Schema::hasColumn('shift_leave_requests', 'handled_by')) {
                    $table->dropConstrainedForeignId('handled_by');
                }
            });
        }

        if (Schema::hasTable('shift_swap_requests') && Schema::hasColumn('shift_swap_requests', 'decided_by_employee_id')) {
            Schema::table('shift_swap_requests', function (Blueprint $table) {
                $table->dropConstrainedForeignId('decided_by_employee_id');
            });
        }

        if (Schema::hasTable('attendances')) {
            // Đảo ngược đúng thứ tự của up(): thêm lại unique TRƯỚC (Schema::table
            // riêng), unique đỡ lại FK rồi mới xóa index thường.
            Schema::table('attendances', function (Blueprint $table) {
                $table->unique(['employee_id', 'branch_id', 'date'], 'uniq_att_emp_branch_date');
            });
            if (Schema::hasIndex('attendances', 'idx_att_emp_branch_date')) {
                Schema::table('attendances', function (Blueprint $table) {
                    $table->dropIndex('idx_att_emp_branch_date');
                });
            }
        }
    }
};
