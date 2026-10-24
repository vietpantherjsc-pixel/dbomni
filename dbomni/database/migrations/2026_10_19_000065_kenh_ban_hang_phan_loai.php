<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Spec phân loại kênh bán hàng (Đại Vương chốt 2026-10-19):
// - price_lists.category: store | online | partner (default partner — an toàn cho kênh import tự tạo)
// - Bảng product_category_prices: giá chung theo phân loại (fallback giữa giá kênh và giá gốc)
// - Seed kênh "website"; chuẩn hóa tên kênh "online" = "Zalo Mini App"
// - Migrate promotions.channels: mảng code chuỗi (pos/online/...) -> mảng ID price_lists
return new class extends Migration {
    // Map code -> category theo spec mục 2.2 (idempotent: chạy lại cho cùng kết quả)
    private const CATEGORY_MAP = [
        'nha_hang' => 'store',
        'event' => 'store',
        'online' => 'online',
        'website' => 'online',
        'grabfood' => 'partner',
        'shopeefood' => 'partner',
        'greenfood' => 'partner',
        'befood' => 'partner',
        'delivery_k' => 'partner',
        'capichi' => 'partner',
        'oneu' => 'partner',
    ];

    public function up(): void
    {
        // 1. Cột phân loại kênh
        if (Schema::hasTable('price_lists') && !Schema::hasColumn('price_lists', 'category')) {
            Schema::table('price_lists', function (Blueprint $table) {
                $table->string('category', 20)->default('partner')->after('code');
            });
        }

        // 2. Bảng giá theo phân loại kênh
        if (!Schema::hasTable('product_category_prices')) {
            Schema::create('product_category_prices', function (Blueprint $table) {
                $table->id();
                $table->foreignId('product_id')->constrained()->cascadeOnDelete();
                $table->string('category', 20); // store | online | partner
                $table->decimal('price', 15, 0)->default(0);
                $table->boolean('is_active')->default(true);
                $table->unique(['product_id', 'category']);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('price_lists')) {
            return;
        }

        // 3. Seed kênh "Website đặt hàng" (kênh mới duy nhất theo spec)
        if (!DB::table('price_lists')->where('code', 'website')->exists()) {
            $maxSort = (int) (DB::table('price_lists')->max('sort_order') ?? -1);
            DB::table('price_lists')->insert([
                'code' => 'website',
                'name' => 'Website đặt hàng',
                'category' => 'online',
                'is_active' => true,
                'sort_order' => $maxSort + 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // 4. Gán category cho kênh cũ theo bảng 2.2
        foreach (self::CATEGORY_MAP as $code => $category) {
            DB::table('price_lists')->where('code', $code)->update(['category' => $category]);
        }

        // 5. Chuẩn hóa tên kênh online = "Zalo Mini App" (không tạo trùng kênh mới)
        DB::table('price_lists')->where('code', 'online')->update(['name' => 'Zalo Mini App']);

        // 6. Migrate promotions.channels: code chuỗi -> ID
        $this->migratePromotionChannels();
    }

    private function migratePromotionChannels(): void
    {
        if (!Schema::hasTable('promotions') || !Schema::hasColumn('promotions', 'channels')) {
            return;
        }
        // code (lowercase) -> id, để map cả code cũ lẫn code chuẩn
        $idByCode = DB::table('price_lists')->pluck('id', 'code')
            ->mapWithKeys(fn($id, $code) => [mb_strtolower(trim((string) $code)) => (int) $id])
            ->all();
        $storeIds = DB::table('price_lists')->where('category', 'store')->pluck('id')->map(fn($i) => (int) $i)->all();
        $onlineIds = DB::table('price_lists')->where('category', 'online')->pluck('id')->map(fn($i) => (int) $i)->all();
        // Map tương thích mã cũ — spec mục 3: tick "Bán online" ('online'/'zalo') -> CẢ NHÓM online
        // (gồm kênh 'online' + 'website' mới), không phải 1 kênh đơn lẻ.
        $legacy = ['pos' => $storeIds, 'zalo' => $onlineIds, 'online' => $onlineIds];

        foreach (DB::table('promotions')->whereNotNull('channels')->get(['id', 'channels']) as $promo) {
            $raw = json_decode((string) $promo->channels, true);
            if (!is_array($raw)) {
                continue;
            }
            $ids = [];
            foreach ($raw as $c) {
                if (is_numeric($c)) {
                    $ids[] = (int) $c;
                    continue;
                }
                $lc = mb_strtolower(trim((string) $c));
                if (isset($legacy[$lc])) {
                    $ids = array_merge($ids, $legacy[$lc]);
                } elseif (isset($idByCode[$lc])) {
                    $ids[] = $idByCode[$lc];
                }
                // code lạ không map được -> bỏ qua
            }
            $ids = array_values(array_unique($ids));
            // Idempotent + sửa dữ liệu đã map sai (bản migration cũ chỉ cho 1 kênh 'online'):
            // nếu có bất kỳ ID nhóm online nào thì bổ sung đủ cả nhóm online (gồm website).
            // Chạy lại nhiều lần kết quả không đổi — không phá dữ liệu KM mới (migration chỉ chạy 1 lần
            // tại thời điểm deploy, form KM mới chưa tồn tại lúc đó).
            if ($onlineIds && count(array_intersect($ids, $onlineIds)) > 0) {
                $ids = array_values(array_unique(array_merge($ids, $onlineIds)));
            }
            // Không map được gì -> null (mọi kênh) để không vô tình tắt KM
            DB::table('promotions')->where('id', $promo->id)
                ->update(['channels' => $ids ? json_encode($ids) : null]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('product_category_prices');
        if (Schema::hasTable('price_lists') && Schema::hasColumn('price_lists', 'category')) {
            Schema::table('price_lists', function (Blueprint $table) {
                $table->dropColumn('category');
            });
        }
        // Không xóa kênh website đã seed và không revert channels (dữ liệu nghiệp vụ)
    }
};
