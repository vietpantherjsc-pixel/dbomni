<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Support\PermissionTree;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

// Áp mẫu Thu ngân §6 — Đại Vương chốt 2026-11-10 (bỏ P&L khỏi mẫu Thu ngân),
// PM chốt Đường 1 (lệnh artisan idempotent) cùng ngày.
//
// Mẫu chốt (8 lá): bỏ `reports.pnl.view` + các lá báo cáo còn lại, cấp thêm
// `orders.discount` (Thu ngân hiện chưa có — khớp ca nghiệm thu S-02 "đặt
// đơn + giảm giá được"); thu-chi không cấp.
//
// GÁC AN TOÀN — không đè tùy biến: chỉ áp khi tập lá hiện tại của role ĐÚNG
// BẰNG tập mặc định sau chuyển đổi §5 (15 lá = kết quả permissions:migrate-tree
// trên bộ khóa gốc của Thu ngân gieo ở migration 000018). Tập lệch (đã tùy
// biến tay qua UI) -> bỏ qua + log cảnh báo, không sửa gì. Role đã ở mẫu ->
// không đổi (chạy lại idempotent). Chỉ đụng role tên "Thu ngân"; Quản lý cửa
// hàng + Pha chế KHÔNG thuộc lệnh này (mẫu §6 của 2 role đó chưa có phán riêng).
class ApplyCashierTemplate extends Command
{
    protected $signature = 'permissions:apply-cashier-template';

    protected $description = 'Áp tập quyền mẫu §6 cho chức vụ Thu ngân (idempotent, có gác không-đè-tùy-biến)';

    private const ROLE_NAME = 'Thu ngân';

    // Tập mẫu chốt §6 (8 lá).
    private const TEMPLATE = [
        'dashboard.view',
        'orders.list.view',
        'orders.create',
        'orders.edit',
        'orders.discount',
        'customers.list.view',
        'reports.overview.view',
        'reports.revenue.view',
    ];

    // Tập mặc định sau chuyển đổi §5 (15 lá) — điều kiện tiên quyết để áp:
    // dashboard.view + (orders.view/create/edit nở) + customers.list.view
    // + reports.view nở thành 10 lá reports (9 lá *.view + revenue.export);
    // 5 khóa chết của bộ khóa gốc (products.view · customers.create ·
    // customers.edit · promotions.view · tables.view) đã bị migrate-tree bỏ.
    private const DEFAULT_AFTER_MIGRATION = [
        'dashboard.view',
        'orders.list.view',
        'orders.create',
        'orders.edit',
        'customers.list.view',
        'reports.overview.view',
        'reports.revenue.view',
        'reports.revenue.export',
        'reports.pnl.view',
        'reports.cash.view',
        'reports.inventory.view',
        'reports.hr.view',
        'reports.operations.view',
        'reports.menu.view',
        'reports.cancelled.view',
    ];

    public function handle(): int
    {
        // Sanity: mọi lá mẫu phải là lá cấp được trong cây (không tier_only,
        // không khóa lạ) — sai thì dừng, không ghi gì.
        $grantable = PermissionTree::grantableLeaves();
        $bad = array_values(array_diff(self::TEMPLATE, $grantable));
        if ($bad !== []) {
            $this->error('Lá mẫu không thuộc cây cấp được: ' . implode(', ', $bad) . ' — dừng, không áp.');
            return self::FAILURE;
        }

        // Lưu theo thứ tự cây cho khớp lệ migrate-tree.
        $order = array_flip($grantable);
        $template = self::TEMPLATE;
        usort($template, fn ($a, $b) => ($order[$a] ?? 9999) <=> ($order[$b] ?? 9999));
        $templateSet = $template;
        sort($templateSet);
        $defaultSet = self::DEFAULT_AFTER_MIGRATION;
        sort($defaultSet);

        $roles = Role::where('name', self::ROLE_NAME)->orderBy('id')->get();
        if ($roles->isEmpty()) {
            $this->warn('Không tìm thấy chức vụ "' . self::ROLE_NAME . '" — không áp gì.');
            return self::SUCCESS;
        }

        foreach ($roles as $role) {
            $before = array_values(array_unique($role->permissions ?? []));
            $beforeSet = $before;
            sort($beforeSet);

            // Đã ở mẫu -> idempotent, không đổi.
            if ($beforeSet === $templateSet) {
                $this->line("Role #{$role->id} {$role->name}: đã ở mẫu §6 (" . count($template) . ' lá), không đổi.');
                continue;
            }

            // Lệch cả mẫu lẫn tập mặc định -> đã tùy biến tay: bỏ qua + cảnh báo.
            if ($beforeSet !== $defaultSet) {
                $this->warn("Role #{$role->id} {$role->name}: tập quyền hiện tại (" . count($before) . ' lá) lệch tập mặc định sau chuyển đổi — BỎ QUA, không đè tùy biến.');
                $this->line('  Hiện tại: ' . implode(', ', $before));
                Log::warning('permissions:apply-cashier-template skipped', [
                    'role_id' => $role->id, 'role' => $role->name, 'before' => $before,
                    'reason' => 'tap-quyen-lech-mac-dinh',
                ]);
                continue;
            }

            // Đúng tập mặc định -> áp mẫu, log trước/sau như migrate-tree.
            $this->info("Role #{$role->id} {$role->name}: " . count($before) . ' lá mặc định → ' . count($template) . ' lá mẫu §6.');
            $this->line('  Trước: ' . implode(', ', $before));
            $this->line('  Sau:   ' . implode(', ', $template));
            Log::info('permissions:apply-cashier-template', [
                'role_id' => $role->id, 'role' => $role->name,
                'before' => $before, 'after' => $template,
            ]);
            $role->permissions = $template;
            $role->save();
        }

        $this->info('Xong. Chạy lại lệnh sẽ không đổi thêm (idempotent).');
        return self::SUCCESS;
    }
}
