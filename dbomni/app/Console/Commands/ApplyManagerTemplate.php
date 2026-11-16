<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Support\PermissionTree;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

// Áp mẫu Quản lý cửa hàng §6 (spec cây phân quyền chi tiết) — Đại Vương
// chốt 2026-11-13 (cụm treo cũ, qua PM), theo đúng khuôn lệnh
// permissions:apply-cashier-template của mẫu Thu ngân.
//
// Mẫu chốt §6 cho QLCH (89 lá theo chữ spec + dashboard.view giữ lại = 90):
//   orders.* trừ bulk · inventory.* (gồm approve) · finance.transactions.*
//   (gồm approve + pay) · finance.categories.view · customers.* trừ
//   minigame.edit · attendance.* (gồm approve) · staff.employees.view/edit
//   · staff.violations.* · reports.* trừ reports.pnl · products.list.view
//   · KHÔNG settings.* · KHÔNG khóa lương nào (cụm staff.salary.* vốn là
//   tier_only, không cấp qua chức vụ) · KHÔNG branches.* / staff.roles /
//   staff.config / finance.channels (không nằm trong mẫu §6).
// dashboard.view: §6 không liệt kê riêng cho QLCH nhưng GIỮ LẠI — đây là
// màn hình nhà của Admin, cả 2 mẫu đã chốt (Thu ngân · Pha chế) đều có;
// bỏ đi không nằm trong danh sách thu hẹp PM truyền (pnl · settings ·
// products). **PM ĐÃ DUYỆT GIỮ (2026-11-13, đối chiếu độc lập đợt 1):
// quyết định có chủ đích — bỏ đi là QLCH đăng nhập vào màn hình gãy.**
//
// Mẫu Pha chế §6: Đại Vương chốt cùng lượt 2026-11-13 GIỮ NGUYÊN hiện
// trạng 2 lá (dashboard.view · orders.list.view) — không cần lệnh áp.
//
// GÁC AN TOÀN — không đè tùy biến (khuôn lệnh Thu ngân): chỉ áp khi tập
// lá hiện tại của role ĐÚNG BẰNG tập mặc định sau chuyển đổi §5. Với QLCH,
// tập mặc định đó = TOÀN BỘ lá cấp được (154 lá — seed gốc ['*'] nở qua
// permissions:migrate-tree; TESTER đếm sống §EY 10/11/2026: QLCH 154 lá,
// khớp PermissionTree::grantableLeaves()). Tập lệch (đã tùy biến tay qua
// UI) -> bỏ qua + log cảnh báo, không sửa gì. Role đã ở mẫu -> không đổi
// (chạy lại idempotent). Chỉ đụng role tên "Quản lý cửa hàng".
class ApplyManagerTemplate extends Command
{
    protected $signature = 'permissions:apply-manager-template';

    protected $description = 'Áp tập quyền mẫu §6 cho chức vụ Quản lý cửa hàng (idempotent, có gác không-đè-tùy-biến)';

    private const ROLE_NAME = 'Quản lý cửa hàng';

    // Tập mẫu chốt §6 (90 lá) — liệt kê tường minh để đối chiếu với spec.
    private const TEMPLATE = [
        // Tổng quan (giữ lại — xem ghi chú đầu file)
        'dashboard.view',
        // Hóa đơn: orders.* trừ bulk
        'orders.list.view', 'orders.create', 'orders.edit', 'orders.discount',
        // Mặt hàng: chỉ xem danh sách
        'products.list.view',
        // Kho: inventory.* gồm các approve
        'inventory.stock.view', 'inventory.stock.adjust',
        'inventory.inbound.view', 'inventory.inbound.create', 'inventory.inbound.edit', 'inventory.inbound.delete', 'inventory.inbound.approve',
        'inventory.outbound.view', 'inventory.outbound.create', 'inventory.outbound.edit', 'inventory.outbound.delete', 'inventory.outbound.approve',
        'inventory.transfer.view', 'inventory.transfer.create', 'inventory.transfer.approve', 'inventory.transfer.delete',
        'inventory.stocktake.view', 'inventory.stocktake.create', 'inventory.stocktake.edit', 'inventory.stocktake.approve',
        'inventory.production.view', 'inventory.production.create', 'inventory.production.edit', 'inventory.production.delete',
        'inventory.purchase.view', 'inventory.purchase.create', 'inventory.purchase.edit', 'inventory.purchase.delete',
        'inventory.materials.view', 'inventory.materials.create', 'inventory.materials.edit', 'inventory.materials.delete',
        'inventory.partners.view', 'inventory.partners.create', 'inventory.partners.edit', 'inventory.partners.delete',
        // Thu chi: transactions.* gồm approve + pay · categories chỉ view
        'finance.transactions.view', 'finance.transactions.create', 'finance.transactions.edit', 'finance.transactions.delete', 'finance.transactions.approve', 'finance.transactions.pay',
        'finance.categories.view',
        // Khách hàng: customers.* trừ minigame.edit
        'customers.list.view', 'customers.list.create', 'customers.list.edit', 'customers.list.delete', 'customers.list.points',
        'customers.tiers.view', 'customers.tiers.edit',
        'customers.exchange.view', 'customers.exchange.create', 'customers.exchange.edit', 'customers.exchange.delete',
        'customers.minigame.view',
        'customers.invite.view',
        // Báo cáo: reports.* trừ reports.pnl
        'reports.overview.view', 'reports.revenue.view', 'reports.revenue.export',
        'reports.cash.view', 'reports.inventory.view', 'reports.hr.view',
        'reports.operations.view', 'reports.menu.view', 'reports.cancelled.view',
        // Nhân sự phi-lương: employees view/edit · violations.*
        'staff.employees.view', 'staff.employees.edit',
        'staff.violations.view', 'staff.violations.create', 'staff.violations.edit', 'staff.violations.delete',
        // Chấm công & ca: attendance.* gồm approve ca/nghỉ
        'attendance.shifts.view', 'attendance.shifts.edit',
        'attendance.schedules.view', 'attendance.schedules.edit',
        'attendance.registrations.view', 'attendance.registrations.approve',
        'attendance.leaves.view', 'attendance.leaves.approve',
        'attendance.grid.view', 'attendance.grid.edit',
        'attendance.qr.view',
        'attendance.notes.view', 'attendance.notes.edit',
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

        // Tập mặc định sau chuyển đổi §5 của QLCH = toàn bộ lá cấp được.
        $defaultSet = $grantable;
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
                Log::warning('permissions:apply-manager-template skipped', [
                    'role_id' => $role->id, 'role' => $role->name, 'before' => $before,
                    'reason' => 'tap-quyen-lech-mac-dinh',
                ]);
                continue;
            }

            // Đúng tập mặc định -> áp mẫu, log trước/sau như migrate-tree.
            $this->info("Role #{$role->id} {$role->name}: " . count($before) . ' lá mặc định → ' . count($template) . ' lá mẫu §6.');
            $this->line('  Trước: ' . implode(', ', $before));
            $this->line('  Sau:   ' . implode(', ', $template));
            Log::info('permissions:apply-manager-template', [
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
