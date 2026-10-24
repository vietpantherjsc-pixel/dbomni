<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// =====================================================================
// Cầu nối Sapo — Phần A (2026-10-21): nền tảng import Excel Sapo → DBOMNI.
// Spec: ~/workspace/dbomni-pm/specs/spec-sapo-cau-noi.md (Đại Vương chốt 2026-10-21)
// - orders: sapo_invoice_code UNIQUE (chống trùng lớp 1) + sapo_created_at + paid_at + source
// - Bảng map — Admin chỉnh được ở Phần B, CẤM hardcode trong code:
//   sapo_product_map / sapo_option_map / sapo_channel_map / sapo_payment_map /
//   sapo_branch_map (anchor text email → chi nhánh) / sapo_column_aliases / sapo_size_map
// - Nhật ký: sapo_import_runs (báo cáo import — Phần D) + sapo_import_suspects
//   (hàng đợi "nghi ngờ" chờ quản lý xử lý → chạy lại ở Phần D)
// - Setting: sapo_suspect_window_minutes = 15 (chốt chặn nghi ngờ trùng đơn DBOMNI)
// =====================================================================
return new class extends Migration
{
    public function up(): void
    {
        // ---- orders: cột Sapo ----
        if (!Schema::hasColumn('orders', 'sapo_invoice_code')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->string('sapo_invoice_code', 50)->nullable()->unique()->after('code')
                    ->comment('Mã hóa đơn Sapo — chống trùng lớp 1 khi import');
            });
        }
        if (!Schema::hasColumn('orders', 'sapo_created_at')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->timestamp('sapo_created_at')->nullable()->after('sapo_invoice_code')
                    ->comment('Thời gian tạo đơn trên Sapo');
            });
        }
        if (!Schema::hasColumn('orders', 'paid_at')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->timestamp('paid_at')->nullable()->after('sapo_created_at')
                    ->comment('Thời gian thanh toán (ngày hạch toán của đơn import)');
            });
        }
        if (!Schema::hasColumn('orders', 'source')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->string('source', 20)->nullable()->after('paid_at')
                    ->comment('Nguồn tạo đơn: null/POS cũ | zalo | sapo');
            });
        }

        // ---- Bảng map món: tên Sapo (nguyên văn) → món DBOMNI ----
        if (!Schema::hasTable('sapo_product_map')) {
            Schema::create('sapo_product_map', function (Blueprint $table) {
                $table->id();
                $table->string('sapo_name', 255)->unique()->comment('Tên mặt hàng trong file Sapo (exact)');
                $table->foreignId('product_id')->nullable()->constrained('products')->nullOnDelete();
                $table->string('note', 255)->nullable();
                $table->timestamps();
            });
        }

        // ---- Bảng map tùy chọn: đoạn text lựa chọn → tùy chọn DBOMNI (gồm size) ----
        if (!Schema::hasTable('sapo_option_map')) {
            Schema::create('sapo_option_map', function (Blueprint $table) {
                $table->id();
                $table->string('sapo_option_text', 255)->unique()->comment('Đoạn text trong cột Tên lựa chọn (exact)');
                $table->foreignId('option_id')->nullable()->constrained('product_options')->nullOnDelete();
                $table->string('note', 255)->nullable();
                $table->timestamps();
            });
        }

        // ---- Bảng map kênh: text Nguồn đơn / Đối tác giao hàng (đã normalize) → mã kênh price_lists ----
        // Giá trị channel_code = 'dbomni' là mã ĐẶC BIỆT: đơn kênh DBOMNI → bỏ qua toàn bộ khi import.
        if (!Schema::hasTable('sapo_channel_map')) {
            Schema::create('sapo_channel_map', function (Blueprint $table) {
                $table->id();
                $table->string('sapo_text', 120)->unique()->comment('Text đã normalize (bỏ dấu, thường)');
                $table->string('channel_code', 50)->comment('Mã kênh trong price_lists; dbomni = kênh DBOMNI trên Sapo');
                $table->string('note', 255)->nullable();
                $table->timestamps();
            });
        }

        // ---- Bảng map phương thức thanh toán: text PTTT Sapo (đã normalize) → payment_method DBOMNI ----
        if (!Schema::hasTable('sapo_payment_map')) {
            Schema::create('sapo_payment_map', function (Blueprint $table) {
                $table->id();
                $table->string('sapo_text', 120)->unique();
                $table->string('payment_method', 50);
                $table->string('note', 255)->nullable();
                $table->timestamps();
            });
        }

        // ---- Bảng map chi nhánh: anchor text của link tải file trong email → chi nhánh DBOMNI (Phần C dùng) ----
        if (!Schema::hasTable('sapo_branch_map')) {
            Schema::create('sapo_branch_map', function (Blueprint $table) {
                $table->id();
                $table->string('anchor_text', 255)->unique()->comment('Anchor text của link tải trong email Sapo');
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->string('note', 255)->nullable();
                $table->timestamps();
            });
        }

        // ---- Bảng alias cột Excel: trường DBOMNI → tên cột chấp nhận (đã normalize) ----
        if (!Schema::hasTable('sapo_column_aliases')) {
            Schema::create('sapo_column_aliases', function (Blueprint $table) {
                $table->id();
                $table->string('field', 60)->comment('Tên trường nội bộ (invoice_code, product_name...)');
                $table->string('alias', 190)->comment('Tên cột đã normalize');
                $table->timestamps();
                $table->unique(['field', 'alias']);
            });
        }

        // ---- Bảng keyword size: nhận diện size trong text lựa chọn (VD "size m" → "M") ----
        if (!Schema::hasTable('sapo_size_map')) {
            Schema::create('sapo_size_map', function (Blueprint $table) {
                $table->id();
                $table->string('keyword', 60)->unique()->comment('Chuỗi con đã normalize để nhận diện (VD: size m)');
                $table->string('size_label', 20)->comment('Nhãn size chuẩn (VD: M)');
                $table->timestamps();
            });
        }

        // ---- Nhật ký lần import (báo cáo import — Phần D hiển thị) ----
        if (!Schema::hasTable('sapo_import_runs')) {
            Schema::create('sapo_import_runs', function (Blueprint $table) {
                $table->id();
                $table->string('source', 20)->default('upload')->comment('upload | imap');
                $table->string('filename', 255)->nullable();
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->string('status', 20)->default('processing')->comment('processing | done | error');
                $table->unsignedInteger('total_rows')->default(0);
                $table->unsignedInteger('invoice_count')->default(0);
                $table->unsignedInteger('created_count')->default(0);
                $table->unsignedInteger('duplicate_count')->default(0)->comment('Bỏ qua (trùng mã hóa đơn)');
                $table->unsignedInteger('dbomni_skipped_count')->default(0)->comment('Bỏ qua (đơn kênh DBOMNI)');
                $table->unsignedInteger('cancelled_count')->default(0)->comment('Bỏ qua (đơn đã hủy)');
                $table->unsignedInteger('suspect_count')->default(0);
                $table->json('warnings')->nullable();
                $table->text('error')->nullable();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }

        // ---- Hàng đợi "nghi ngờ": đơn chưa import được, chờ quản lý map/xác nhận rồi chạy lại (Phần D) ----
        if (!Schema::hasTable('sapo_import_suspects')) {
            Schema::create('sapo_import_suspects', function (Blueprint $table) {
                $table->id();
                $table->foreignId('run_id')->nullable()->constrained('sapo_import_runs')->nullOnDelete();
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->string('sapo_invoice_code', 50)->index();
                $table->string('reason', 60)->comment('unknown_product | unknown_option | missing_required_option | unknown_channel | unknown_payment | missing_payment | total_mismatch | unknown_status | possible_duplicate | insufficient_stock');
                $table->text('detail')->nullable();
                $table->json('payload')->comment('Toàn bộ dòng của hóa đơn (đã parse) để chạy lại sau khi map');
                $table->string('status', 20)->default('pending')->comment('pending | resolved | ignored');
                $table->foreignId('resolved_order_id')->nullable()->constrained('orders')->nullOnDelete();
                $table->timestamps();
            });
        }

        $this->seedAliases();
        $this->seedChannelMap();
        $this->seedPaymentMap();
        $this->seedSizeMap();

        // Chốt chặn nghi ngờ: cửa sổ so khớp đơn DBOMNI sẵn có (phút) — Admin sửa ở Phần B
        if (Schema::hasTable('settings')) {
            DB::table('settings')->updateOrInsert(
                ['key' => 'sapo_suspect_window_minutes'],
                ['value' => '15']
            );
        }
    }

    private function seedAliases(): void
    {
        // field => [alias đã normalize...] — khớp normalize(): thường, bỏ dấu,
        // mọi dãy ký tự không phải chữ/số → 1 khoảng trắng.
        $aliases = [
            'invoice_code'   => ['ma hoa don'],
            'source'         => ['nguon don'],
            'partner'        => ['doi tac giao hang'],
            'status'         => ['trang thai don hang'],
            'created_src'    => ['thoi gian tao don'],
            'paid_src'       => ['thoi gian thanh toan'],
            'price_config'   => ['cau hinh gia mat hang'],
            'product_code'   => ['ma mat hang'],
            'product_name'   => ['ten mat hang combo', 'ten mat hang'],
            'category_name'  => ['danh muc'],
            'quantity'       => ['so luong'],
            'unit'           => ['don vi'],
            'price'          => ['gia ban'],
            'option_text'    => ['ten lua chon', 'lua chon'],
            'option_price'   => ['gia lua chon them'],
            'discount_pct'   => ['giam gia', 'phan tram giam gia'],
            'discount_line'  => ['tong giam gia'],
            'line_amount'    => ['tien hang'],
            'goods_total'    => ['tong tien hang 1', 'tong tien hang'],
            'vat'            => ['thue vat 2', 'thue vat'],
            'service_fee'    => ['phi dich vu 3', 'phi dich vu'],
            'discount_total' => ['tong giam gia 4'],
            'shipping_fee'   => ['phi gh thu khach 5', 'phi gh thu khach', 'phi giao hang thu khach 5'],
            'total_payment'  => ['tong tien thanh toan 1 2 3 4 5', 'tong tien thanh toan'],
            'payment_text'   => ['phuong thuc tt', 'phuong thuc thanh toan'],
            'tip'            => ['tien tip'],
            'customer_name'  => ['khach hang'],
            'customer_phone' => ['so dien thoai'],
            'member_card'    => ['the thanh vien'],
            'address'        => ['dia chi giao hang'],
            'customer_note'  => ['ghi chu khach hang'],
            'service_type'   => ['loai hinh phuc vu'],
            'area'           => ['khu vuc'],
            'table_name'     => ['ban'],
            'cashier_name'   => ['thu ngan'],
        ];
        foreach ($aliases as $field => $list) {
            foreach ($list as $alias) {
                DB::table('sapo_column_aliases')->updateOrInsert(
                    ['field' => $field, 'alias' => $alias],
                    ['created_at' => now(), 'updated_at' => now()]
                );
            }
        }
    }

    private function seedChannelMap(): void
    {
        // key = text Sapo đã normalize → mã kênh price_lists ('dbomni' = kênh DBOMNI trên Sapo, bỏ qua khi import)
        $map = [
            'dbomni'       => 'dbomni',
            'grabfood'     => 'grabfood',
            'grab food'    => 'grabfood',
            'grab food tt' => 'grabfood',
            'shopeefood'   => 'shopeefood',
            'shopee food'  => 'shopeefood',
            'green food'   => 'greenfood',
            'greenfood'    => 'greenfood',
            'befood'       => 'befood',
            'be food'      => 'befood',
            'delivery k'   => 'delivery_k',
            'deliveryk'    => 'delivery_k',
            'capichi'      => 'capichi',
            'oneu'         => 'oneu',
            'tai nha hang' => 'nha_hang',
            'tai cua hang' => 'nha_hang',
        ];
        foreach ($map as $text => $code) {
            DB::table('sapo_channel_map')->updateOrInsert(
                ['sapo_text' => $text],
                ['channel_code' => $code, 'created_at' => now(), 'updated_at' => now()]
            );
        }
    }

    private function seedPaymentMap(): void
    {
        // key = text PTTT Sapo đã normalize → payment_method DBOMNI (Đại Vương chốt: TM/CK mặc định transfer)
        $map = [
            'grab food'              => 'grabfood',
            'grabfood'               => 'grabfood',
            'grab food tt'           => 'grabfood',
            'grab voucher'           => 'grabfood',
            'shopeefood'             => 'shopeefood',
            'shopee food'            => 'shopeefood',
            'green food'             => 'greenfood',
            'greenfood'              => 'greenfood',
            'befood'                 => 'befood',
            'oneu'                   => 'oneu',
            'capichi'                => 'capichi',
            'capichi ck'             => 'transfer',
            'vietqr'                 => 'transfer',
            'vietqr pro'             => 'transfer',
            'techcombank vietqr pro' => 'transfer',
            'deliveryk ck'           => 'transfer',
            'tm ck'                  => 'transfer',
            'ck'                     => 'transfer',
            'chuyen khoan'           => 'transfer',
            'tm'                     => 'cash',
            'tien mat'               => 'cash',
            'cash'                   => 'cash',
        ];
        foreach ($map as $text => $method) {
            DB::table('sapo_payment_map')->updateOrInsert(
                ['sapo_text' => $text],
                ['payment_method' => $method, 'created_at' => now(), 'updated_at' => now()]
            );
        }
    }

    private function seedSizeMap(): void
    {
        $map = [
            'size s' => 'S',
            'size m' => 'M',
            'size l' => 'L',
            'size xl' => 'XL',
        ];
        foreach ($map as $keyword => $label) {
            DB::table('sapo_size_map')->updateOrInsert(
                ['keyword' => $keyword],
                ['size_label' => $label, 'created_at' => now(), 'updated_at' => now()]
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sapo_import_suspects');
        Schema::dropIfExists('sapo_import_runs');
        Schema::dropIfExists('sapo_size_map');
        Schema::dropIfExists('sapo_column_aliases');
        Schema::dropIfExists('sapo_branch_map');
        Schema::dropIfExists('sapo_payment_map');
        Schema::dropIfExists('sapo_channel_map');
        Schema::dropIfExists('sapo_option_map');
        Schema::dropIfExists('sapo_product_map');

        foreach (['source', 'paid_at', 'sapo_created_at', 'sapo_invoice_code'] as $col) {
            if (Schema::hasColumn('orders', $col)) {
                Schema::table('orders', function (Blueprint $table) use ($col) {
                    $table->dropColumn($col);
                });
            }
        }

        if (Schema::hasTable('settings')) {
            DB::table('settings')->where('key', 'sapo_suspect_window_minutes')->delete();
        }
    }
};
