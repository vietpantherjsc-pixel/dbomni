<?php

namespace App\Console\Commands;

use App\Models\OptionGroup;
use App\Models\Product;
use App\Models\ProductOption;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

// Gói 7b (2026-10-05): Import nhóm tùy chọn từ hệ thống cũ của quán
// (Size, Độ Ngọt, Đá, Topping, Thêm Matcha/Houjicha/Cà Phê...).
// Dữ liệu: database/seeders/data/option_groups_import.json
// Chạy: php artisan import:option-groups
// Idempotent: bỏ qua nhóm đã tồn tại (theo code).
class ImportOptionGroups extends Command
{
    protected $signature = 'import:option-groups';
    protected $description = 'Import nhóm tùy chọn và gán vào món';

    public function handle(): int
    {
        $path = database_path('seeders/data/option_groups_import.json');
        if (!file_exists($path)) {
            $this->error("Không tìm thấy file: {$path}");
            return 1;
        }
        $data = json_decode(file_get_contents($path), true);

        DB::transaction(function () use ($data) {
            $groupIds = [];
            foreach ($data['groups'] as $i => $g) {
                $group = OptionGroup::firstOrCreate(
                    ['code' => $g['code']],
                    [
                        'name' => $g['name'],
                        'type' => $g['type'],
                        'is_required' => $g['is_required'],
                        'sort_order' => $i,
                        'is_active' => true,
                    ]
                );
                $groupIds[$g['code']] = $group->id;

                // Options của nhóm (giá 0 — điều chỉnh trong admin)
                foreach ($g['options'] as $optName) {
                    ProductOption::firstOrCreate(
                        ['option_group_id' => $group->id, 'name' => $optName],
                        ['product_id' => null, 'additional_price' => 0, 'is_required' => false]
                    );
                }
            }
            $this->info('Nhóm tùy chọn: ' . count($groupIds));

            // Gán nhóm vào món (theo tên)
            $linked = 0;
            $missing = 0;
            foreach ($data['assignments'] as $productName => $codes) {
                $product = Product::where('name', $productName)->first();
                if (!$product) {
                    $missing++;
                    continue;
                }
                $ids = array_values(array_filter(array_map(
                    fn($c) => $groupIds[$c] ?? null,
                    $codes
                )));
                $product->optionGroups()->syncWithoutDetaching($ids);
                $linked++;
            }
            $this->info("Gán nhóm: {$linked} món | Không tìm thấy món: {$missing}");
        });

        $this->info('Import nhóm tùy chọn hoàn tất.');
        return 0;
    }
}
