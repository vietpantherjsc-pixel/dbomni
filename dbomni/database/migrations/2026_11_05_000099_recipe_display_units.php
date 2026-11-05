<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec định mức chọn đơn vị quy đổi (Đại Vương chốt chuyển hẳn 2026-11-05
// ~15:01; BA khóa Q1–Q3 15:37): số lưu vẫn là đơn vị cơ sở; mỗi dòng nhớ
// thêm đơn vị hiển thị đã chọn + hệ số chụp tại lúc lưu để mở sửa thấy lại
// đúng con số đã nhập. Nới quantity lên decimal(14,4) — ca 5 Gram = 0,0050 Kg
// sẽ bị nuốt nếu giữ 2 số lẻ. Không drop index/FK nào trong migration này.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('recipes')) {
            Schema::table('recipes', function (Blueprint $table) {
                if (!Schema::hasColumn('recipes', 'display_unit_name')) {
                    $table->string('display_unit_name', 30)->nullable()->after('quantity');
                }
                if (!Schema::hasColumn('recipes', 'display_factor')) {
                    $table->decimal('display_factor', 12, 4)->nullable()->after('display_unit_name');
                }
                $table->decimal('quantity', 14, 4)->change();
            });
        }

        if (Schema::hasTable('production_recipes')) {
            Schema::table('production_recipes', function (Blueprint $table) {
                if (!Schema::hasColumn('production_recipes', 'display_unit_name')) {
                    $table->string('display_unit_name', 30)->nullable()->after('quantity');
                }
                if (!Schema::hasColumn('production_recipes', 'display_factor')) {
                    $table->decimal('display_factor', 12, 4)->nullable()->after('display_unit_name');
                }
                if (!Schema::hasColumn('production_recipes', 'batch_display_unit_name')) {
                    $table->string('batch_display_unit_name', 30)->nullable()->after('batch_output_qty');
                }
                if (!Schema::hasColumn('production_recipes', 'batch_display_factor')) {
                    $table->decimal('batch_display_factor', 12, 4)->nullable()->after('batch_display_unit_name');
                }
                $table->decimal('quantity', 14, 4)->change();
                $table->decimal('batch_output_qty', 14, 4)->nullable()->change();
            });
        }

        if (Schema::hasTable('rd_recipes')) {
            Schema::table('rd_recipes', function (Blueprint $table) {
                if (!Schema::hasColumn('rd_recipes', 'display_unit_name')) {
                    $table->string('display_unit_name', 30)->nullable()->after('quantity');
                }
                if (!Schema::hasColumn('rd_recipes', 'display_factor')) {
                    $table->decimal('display_factor', 12, 4)->nullable()->after('display_unit_name');
                }
                $table->decimal('quantity', 14, 4)->change();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('recipes')) {
            Schema::table('recipes', function (Blueprint $table) {
                if (Schema::hasColumn('recipes', 'display_factor')) {
                    $table->dropColumn('display_factor');
                }
                if (Schema::hasColumn('recipes', 'display_unit_name')) {
                    $table->dropColumn('display_unit_name');
                }
                $table->decimal('quantity', 10, 2)->change();
            });
        }

        if (Schema::hasTable('production_recipes')) {
            Schema::table('production_recipes', function (Blueprint $table) {
                if (Schema::hasColumn('production_recipes', 'batch_display_factor')) {
                    $table->dropColumn('batch_display_factor');
                }
                if (Schema::hasColumn('production_recipes', 'batch_display_unit_name')) {
                    $table->dropColumn('batch_display_unit_name');
                }
                if (Schema::hasColumn('production_recipes', 'display_factor')) {
                    $table->dropColumn('display_factor');
                }
                if (Schema::hasColumn('production_recipes', 'display_unit_name')) {
                    $table->dropColumn('display_unit_name');
                }
                $table->decimal('quantity', 10, 2)->change();
                $table->decimal('batch_output_qty', 12, 2)->nullable()->change();
            });
        }

        if (Schema::hasTable('rd_recipes')) {
            Schema::table('rd_recipes', function (Blueprint $table) {
                if (Schema::hasColumn('rd_recipes', 'display_factor')) {
                    $table->dropColumn('display_factor');
                }
                if (Schema::hasColumn('rd_recipes', 'display_unit_name')) {
                    $table->dropColumn('display_unit_name');
                }
                $table->decimal('quantity', 10, 2)->change();
            });
        }
    }
};
