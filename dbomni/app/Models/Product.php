<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    protected $guarded = [];

    protected $casts = [
        'base_price' => 'decimal:2',
        'cost_price' => 'decimal:2',
        'is_active' => 'boolean',
        'is_favorite' => 'boolean', // Gói 10: fix số 0 dư trên mini app ({0 && ...} in ra "0")
        'is_service_fee' => 'boolean',
        'price_on_demand' => 'boolean', // Gói 10c: giá nhập khi chọn món trên POS, ẩn trên Mini App
        'print_label' => 'boolean',
        'sell_on_pos' => 'boolean',
        'sell_on_zalo' => 'boolean',
    ];

    // Gói 1 (2026-10-04): DB dùng cột `base_price` nhưng frontend cũ dùng `product.price`.
    // Thêm accessor để API trả về cả `price` (alias) cho tương thích, khỏi sửa hàng loạt frontend.
    protected $appends = ['price'];

    public function getPriceAttribute(): float
    {
        return (float) ($this->attributes['base_price'] ?? 0);
    }

    // Gói 7h (2026-10-05): image_url lưu tương đối (/images/...) -> trả URL tuyệt đối
    // vì ảnh nằm ở backend (:80), frontend (:3000) không resolve được đường dẫn tương đối.
    // Fix 2026-10-05: dùng host thật của request (APP_URL trong .env đang là :8000, sai cổng).
    public function getImageUrlAttribute($value): ?string
    {
        if (!$value) {
            return $value;
        }
        if (str_starts_with($value, 'http://') || str_starts_with($value, 'https://')) {
            return $value;
        }
        try {
            $base = request()->getSchemeAndHttpHost();
        } catch (\Throwable $e) {
            $base = rtrim(config('app.url', 'http://localhost'), '/');
        }
        return $base . $value;
    }

    // Quan hệ: Sản phẩm thuộc về một danh mục
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    // Quan hệ: Một sản phẩm có nhiều tùy chọn (Topping, Size)
    public function options(): HasMany
    {
        return $this->hasMany(ProductOption::class);
    }

    // Gói 7a: nhóm tùy chọn áp dụng cho món (qua pivot)
    public function optionGroups(): BelongsToMany
    {
        return $this->belongsToMany(OptionGroup::class, 'product_option_group');
    }

    // Gói 7a: thực đơn chứa món này
    public function menus(): BelongsToMany
    {
        return $this->belongsToMany(Menu::class, 'menu_product');
    }

    // Gói 7a: giá theo kênh
    public function prices(): HasMany
    {
        return $this->hasMany(ProductPrice::class);
    }

    // Gói 8a: định mức nguyên liệu (cơ bản + theo từng tùy chọn)
    public function recipes(): HasMany
    {
        return $this->hasMany(Recipe::class);
    }

    // Gói 7a: giá bán theo kênh (mặc định dùng base_price khi chưa có giá kênh)
    // Gói 50c: giá kênh = 0 hoặc trống thì lấy giá cửa hàng (base_price),
    // trừ món price_on_demand (nhập giá thủ công) thì giữ nguyên 0
    // Spec kênh bán hàng (2026-10-19): thêm bước giá phân loại —
    // giá kênh chi tiết -> giá phân loại -> giá gốc (price_on_demand: -> 0)
    public function priceFor(string $channel): float
    {
        // Map tương thích mã kênh cũ (giữ 1 phiên bản, có log deprecated)
        $code = self::resolveChannelCode($channel);
        // Gói 55 p11ac: chỉ áp giá kênh đang is_active=true
        $findActive = function ($c) {
            return $this->prices->first(function ($p) use ($c) {
                return ($p->priceList->code ?? null) === $c && !empty($p->is_active);
            });
        };
        // 1. Giá kênh chi tiết
        $price = $findActive($code);
        if ($price && (float) $price->price > 0) {
            return (float) $price->price;
        }
        // 2. Giá phân loại chứa kênh
        $category = PriceList::categoryOf($code);
        if ($category) {
            $catPrice = $this->categoryPriceFor($category);
            if ($catPrice > 0) {
                return $catPrice;
            }
        }
        // 3. Giá gốc (món nhập giá thủ công: không fallback)
        if (!empty($this->price_on_demand)) {
            return 0.0;
        }
        return (float) $this->base_price;
    }

    // Map tương thích mã kênh cũ: pos -> nha_hang, zalo -> online (giữ 1 phiên bản, log deprecated 1 lần/request)
    public static function resolveChannelCode(string $channel): string
    {
        static $map = ['pos' => 'nha_hang', 'zalo' => 'online'];
        static $logged = [];
        $lc = mb_strtolower(trim($channel));
        if (isset($map[$lc])) {
            if (!isset($logged[$lc])) {
                $logged[$lc] = true;
                \Illuminate\Support\Facades\Log::warning("[deprecated] priceFor: mã kênh cũ '{$channel}' được map sang '{$map[$lc]}' — hãy dùng mã chuẩn.");
            }
            return $map[$lc];
        }
        return $channel;
    }

    // Spec kênh bán hàng (2026-10-19): giá chung theo phân loại kênh
    public function categoryPrices(): HasMany
    {
        return $this->hasMany(ProductCategoryPrice::class);
    }

    public function categoryPriceFor(string $category): float
    {
        $rows = $this->relationLoaded('categoryPrices') ? $this->categoryPrices : $this->categoryPrices()->get();
        $row = $rows->first(fn($r) => $r->category === $category && !empty($r->is_active));
        return $row ? (float) $row->price : 0.0;
    }

    // Gói 49i: giá kênh online cho Zalo Mini App (dùng kèm eager load prices.priceList)
    // Spec kênh bán hàng: dùng mã chuẩn 'online' (map tương thích 'zalo' vẫn giữ trong priceFor)
    public function getOnlinePriceAttribute(): float
    {
        return $this->priceFor('online');
    }
}