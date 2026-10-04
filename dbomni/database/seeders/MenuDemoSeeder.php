<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Schema;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductOption;

class MenuDemoSeeder extends Seeder
{
    public function run(): void
    {
        // 1. TẠO 3 DANH MỤC THỰC ĐƠN
        $categoriesData = [
            ['name' => 'Cà Phê & Cold Brew', 'desc' => 'Cà phê nguyên chất, pha máy & pha phin'],
            ['name' => 'Trà & Trà Sữa Tươi', 'desc' => 'Đậm vị trà mộc, hương hoa tự nhiên'],
            ['name' => 'Bánh & Tráng Miệng', 'desc' => 'Bánh tươi mỗi ngày nướng giòn'],
        ];

        $categoryMap = [];

        foreach ($categoriesData as $cat) {
            $catPayload = ['name' => $cat['name']];

            // Tự động kiểm tra schema thực tế của bảng categories
            if (Schema::hasColumn('categories', 'slug')) {
                $catPayload['slug'] = Str::slug($cat['name']);
            }
            if (Schema::hasColumn('categories', 'description')) {
                $catPayload['description'] = $cat['desc'];
            }

            $createdCat = Category::firstOrCreate(['name' => $cat['name']], $catPayload);
            $categoryMap[$cat['name']] = $createdCat->id;
        }

        // 2. DANH SÁCH 10 MÓN DEMO (Ảnh vuông 1:1)
        $products = [
            // --- 3 MÓN DEAL CHỚP NHOÁNG ---
            [
                'cat_name' => 'Cà Phê & Cold Brew',
                'sku' => 'DEAL-CB01',
                'name' => 'Cold Brew Cam Vàng (Deal)',
                'description' => 'Cold brew ủ lạnh 16h phối cam sành tươi mọng nước, thanh mát.',
                'price' => 39000,
                'image_url' => 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=500&h=500&fit=crop',
                'options' => [
                    ['name' => 'Size M (Tiêu chuẩn)', 'additional_price' => 0],
                    ['name' => 'Size L (Ly lớn)', 'additional_price' => 8000],
                ]
            ],
            [
                'cat_name' => 'Trà & Trà Sữa Tươi',
                'sku' => 'DEAL-TS02',
                'name' => 'Trà Sữa Ô Long Nướng (Deal)',
                'description' => 'Vị trà nướng đậm đà kết hợp sữa béo ngậy, giảm ngọt thanh khiết.',
                'price' => 35000,
                'image_url' => 'https://images.unsplash.com/photo-1558857563-b371f32a76ef?w=500&h=500&fit=crop',
                'options' => [
                    ['name' => 'Trân châu giòn (+8k)', 'additional_price' => 8000],
                    ['name' => 'Pudding trứng (+10k)', 'additional_price' => 10000],
                ]
            ],
            [
                'cat_name' => 'Bánh & Tráng Miệng',
                'sku' => 'DEAL-BA03',
                'name' => 'Croissant Bơ Tỏi Nướng (Deal)',
                'description' => 'Bánh sừng bò nướng giòn rụm ngập sốt bơ tỏi thơm lừng.',
                'price' => 29000,
                'image_url' => 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&h=500&fit=crop',
                'options' => []
            ],

            // --- CÀ PHÊ & COLD BREW (3 món) ---
            [
                'cat_name' => 'Cà Phê & Cold Brew',
                'sku' => 'CF-DUA',
                'name' => 'Cà Phê Sữa Tươi Cốt Dừa',
                'description' => 'Espresso Robusta phối sữa tươi béo và sốt cốt dừa thơm ngọt.',
                'price' => 45000,
                'image_url' => 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500&h=500&fit=crop',
                'options' => [
                    ['name' => 'Ít cốt dừa', 'additional_price' => 0],
                    ['name' => 'Thêm 1 Shot Espresso', 'additional_price' => 10000],
                ]
            ],
            [
                'cat_name' => 'Cà Phê & Cold Brew',
                'sku' => 'CF-MUOI',
                'name' => 'Cà Phê Muối Biển Kem Béo',
                'description' => 'Lớp kem béo mặn sánh mịn hòa cùng cốt cà phê đậm vị.',
                'price' => 42000,
                'image_url' => 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=500&h=500&fit=crop',
                'options' => []
            ],
            [
                'cat_name' => 'Cà Phê & Cold Brew',
                'sku' => 'CF-AME',
                'name' => 'Americano Đá Tươi Mát',
                'description' => 'Chiết xuất từ hạt Arabica Cầu Đất hậu vị chua thanh, không gắt.',
                'price' => 35000,
                'image_url' => 'https://images.unsplash.com/photo-1551030173-122aabc4489c?w=500&h=500&fit=crop',
                'options' => []
            ],

            // --- TRÀ & TRÀ SỮA (2 món) ---
            [
                'cat_name' => 'Trà & Trà Sữa Tươi',
                'sku' => 'TEA-DAO',
                'name' => 'Trà Đào Cam Sả Mát Lạnh',
                'description' => 'Nước cốt trà lài thơm nồng cùng đào ngâm giòn và tinh dầu sả tươi.',
                'price' => 45000,
                'image_url' => 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&h=500&fit=crop',
                'options' => [
                    ['name' => 'Thêm miếng đào (+8k)', 'additional_price' => 8000],
                ]
            ],
            [
                'cat_name' => 'Trà & Trà Sữa Tươi',
                'sku' => 'TEA-MATCHA',
                'name' => 'Matcha Latte Sữa Yến Mạch',
                'description' => 'Matcha Uji Nhật Bản đánh tay cùng sữa yến mạch thuần chay dịu ngọt.',
                'price' => 55000,
                'image_url' => 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=500&h=500&fit=crop',
                'options' => []
            ],

            // --- BÁNH & TRÁNG MIỆNG (2 món) ---
            [
                'cat_name' => 'Bánh & Tráng Miệng',
                'sku' => 'CAKE-TIRA',
                'name' => 'Bánh Phô Mai Tươi Tiramisu',
                'description' => 'Lớp bánh xốp thấm rượu cà phê phủ kem Mascarpone ngậy béo.',
                'price' => 48000,
                'image_url' => 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=500&h=500&fit=crop',
                'options' => []
            ],
            [
                'cat_name' => 'Bánh & Tráng Miệng',
                'sku' => 'CAKE-MUFF',
                'name' => 'Muffin Chocolate Chip',
                'description' => 'Bánh nướng xốp mềm đầy ắp sô-cô-la chip tan chảy bên trong.',
                'price' => 32000,
                'image_url' => 'https://images.unsplash.com/photo-1607958996333-41aef7caefaa?w=500&h=500&fit=crop',
                'options' => []
            ],
        ];

        // 3. THỰC HIỆN SEED SẢN PHẨM VỚI BỘ LỌC CỘT TỰ ĐỘNG
        foreach ($products as $item) {
            $productPayload = [
                'category_id' => $categoryMap[$item['cat_name']],
                'price' => $item['price'],
            ];

            // Tự động gán các cột nếu bảng products có tồn tại
            if (Schema::hasColumn('products', 'description')) {
                $productPayload['description'] = $item['description'];
            }
            if (Schema::hasColumn('products', 'image_url')) {
                $productPayload['image_url'] = $item['image_url'];
            }
            if (Schema::hasColumn('products', 'is_active')) {
                $productPayload['is_active'] = true;
            }
            if (Schema::hasColumn('products', 'slug')) {
                $productPayload['slug'] = Str::slug($item['name']);
            }
            if (Schema::hasColumn('products', 'sku')) {
                $productPayload['sku'] = $item['sku'];
            }
            if (Schema::hasColumn('products', 'code')) {
                $productPayload['code'] = $item['sku'];
            }

            $product = Product::updateOrCreate(
                ['name' => $item['name']],
                $productPayload
            );

            // 4. SEED PRODUCT OPTIONS
            if (!empty($item['options']) && Schema::hasTable('product_options')) {
                foreach ($item['options'] as $opt) {
                    $optPayload = [];
                    
                    if (Schema::hasColumn('product_options', 'additional_price')) {
                        $optPayload['additional_price'] = $opt['additional_price'];
                    } elseif (Schema::hasColumn('product_options', 'price')) {
                        $optPayload['price'] = $opt['additional_price'];
                    }

                    ProductOption::updateOrCreate(
                        ['product_id' => $product->id, 'name' => $opt['name']],
                        $optPayload
                    );
                }
            }
        }
    }
}