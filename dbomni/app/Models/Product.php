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
    public function priceFor(string $channel): float
    {
        $price = $this->prices->firstWhere('priceList.code', $channel);
        if ($price) {
            return (float) $price->price;
        }
        $map = ['pos' => 'nha_hang', 'zalo' => 'online'];
        $price = $this->prices->firstWhere('priceList.code', $map[$channel] ?? $channel);
        return $price ? (float) $price->price : (float) $this->base_price;
    }
}