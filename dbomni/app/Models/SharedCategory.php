<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;

// Spec danh mục dùng chung (Đại Vương chốt 2026-10-19): 13 tab danh mục nghiệp vụ,
// thay thế các mảng hardcode trong code. Tab payment_channels là ẢO (đọc từ price_lists).
class SharedCategory extends Model
{
    protected $guarded = [];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public const VIRTUAL_GROUPS = ['payment_channels'];

    // Danh sách code đang active của 1 nhóm (dùng cho validate động). Cache 5 phút.
    // Fallback về DEFAULTS khi bảng chưa migrate/trống để không chặn nghiệp vụ.
    public static function activeCodes(string $group): array
    {
        if (in_array($group, self::VIRTUAL_GROUPS, true)) {
            return PriceList::activeCodes();
        }
        if (!Schema::hasTable('shared_categories')) {
            return self::defaultCodes($group);
        }
        $codes = Cache::remember("shared_cat_codes:{$group}", 300, function () use ($group) {
            return self::where('group', $group)->where('is_active', true)
                ->orderBy('sort_order')->orderBy('id')
                ->pluck('code')->all();
        });
        return $codes ?: self::defaultCodes($group);
    }

    public static function defaultCodes(string $group): array
    {
        return array_map(fn($r) => $r[0], \Database\Seeders\SharedCategorySeeder::DEFAULTS[$group] ?? []);
    }

    // Map code => name đang active (dùng cho dropdown/label). Fallback DEFAULTS khi chưa migrate.
    public static function activeMap(string $group): array
    {
        if (in_array($group, self::VIRTUAL_GROUPS, true)) {
            return PriceList::activeMap();
        }
        if (!Schema::hasTable('shared_categories')) {
            return self::defaultMap($group);
        }
        $map = Cache::remember("shared_cat_map:{$group}", 300, function () use ($group) {
            return self::where('group', $group)->where('is_active', true)
                ->orderBy('sort_order')->orderBy('id')
                ->pluck('name', 'code')->all();
        });
        return $map ?: self::defaultMap($group);
    }

    public static function defaultMap(string $group): array
    {
        $out = [];
        foreach (\Database\Seeders\SharedCategorySeeder::DEFAULTS[$group] ?? [] as [$code, $name]) {
            $out[$code] = $name;
        }
        return $out;
    }

    public static function flushCache(?string $group = null): void
    {
        if ($group) {
            Cache::forget("shared_cat_codes:{$group}");
            Cache::forget("shared_cat_map:{$group}");
        } else {
            foreach (array_keys(\Database\Seeders\SharedCategorySeeder::GROUPS) as $g) {
                Cache::forget("shared_cat_codes:{$g}");
                Cache::forget("shared_cat_map:{$g}");
            }
        }
    }
}
