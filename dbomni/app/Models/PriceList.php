<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 7a: Bảng giá theo kênh (nha_hang, grabfood, shopeefood, greenfood, online).
class PriceList extends Model
{
    protected $guarded = [];

    // Spec kênh bán hàng (2026-10-19): tra phân loại kênh theo code.
    // Cache theo code trong 1 request (tránh N+1 khi resolve giá).
    protected static array $categoryCache = [];

    public static function categoryOf(string $code): ?string
    {
        $key = mb_strtolower(trim($code));
        if (!array_key_exists($key, static::$categoryCache)) {
            $cat = null;
            if (\Illuminate\Support\Facades\Schema::hasColumn('price_lists', 'category')) {
                $cat = static::whereRaw('LOWER(code) = ?', [$key])->value('category');
            }
            static::$categoryCache[$key] = $cat ?: null;
        }
        return static::$categoryCache[$key];
    }

    public function prices(): HasMany
    {
        return $this->hasMany(ProductPrice::class);
    }

    // Spec danh mục dùng chung (tab payment_channels ẢO): kênh đang active.
    public static function activeCodes(): array
    {
        return static::where('is_active', true)->orderBy('sort_order')->orderBy('id')->pluck('code')->all();
    }

    public static function activeMap(): array
    {
        return static::where('is_active', true)->orderBy('sort_order')->orderBy('id')->pluck('name', 'code')->all();
    }

    // Chuẩn hóa mã kênh PTTT cũ về mã price_lists hiện tại (pos -> nha_hang, zalo -> online)
    public static function normalizeChannelCode(string $code): string
    {
        $lc = mb_strtolower(trim($code));
        return ['pos' => 'nha_hang', 'zalo' => 'online'][$lc] ?? $code;
    }
}
