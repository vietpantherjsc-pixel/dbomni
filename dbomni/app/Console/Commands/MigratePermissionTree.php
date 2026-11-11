<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Support\PermissionTree;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

// Cây phân quyền chi tiết §5 (khóa 10/11/2026) — chuyển đổi 1 lần khi áp gói:
// đọc từng role, thay khóa cũ bằng tập lá theo bảng §5, ghi log trước/sau.
// Idempotent: chạy lại không đổi (lá mới ánh xạ về chính nó).
//
// NGUYÊN TẮC: không chức vụ nào mất quyền đang dùng — trừ 2 ngoại lệ CÓ
// CHỦ ĐÍCH theo phán §7 (ghi log riêng các role bị rút):
//  - toàn bộ cụm staff.salary.* KHÔNG nở vào bất kỳ role nào (mô hình 3
//    tầng — lương chỉ thuộc 2 tầng tài khoản). Lưu ý: dòng staff.edit trong
//    bảng §5 còn liệt kê staff.salary.edit/money/config/lock — ngoại lệ (a)
//    ở đầu §5 THẮNG, lệnh này không nở các lá đó.
//  - settings.secrets KHÔNG nở (phán (d) = A); settings.edit chỉ nở sang 4
//    mục settings còn lại.
// Khóa ma (vd inventory.view, menus.*, transactions.*, promotions.*,
// orders.delete) ánh xạ theo nghĩa gần nhất; orders.delete bị bỏ (chưa
// từng có thực thi). Khóa '*' / wildcard cũ nở ra lá cấp được (không để
// '*' lọt qua làm rò lương/bí mật).
class MigratePermissionTree extends Command
{
    protected $signature = 'permissions:migrate-tree';

    protected $description = 'Chuyển đổi quyền role từ khóa cũ sang cây phân quyền chi tiết §5 (idempotent)';

    // Bảng ánh xạ §5 — khóa cũ => tập lá. Khóa lá mới không có trong bảng
    // này thì ánh xạ về chính nó (giữ nguyên khi chạy lại).
    private const MAP = [
        'dashboard.view' => ['dashboard.view'],
        'orders.view' => ['orders.list.view'],
        'orders.create' => ['orders.create'],
        'orders.edit' => ['orders.edit'],
        'orders.bulk' => ['orders.bulk'],
        'orders.discount' => ['orders.discount'],
        'products.bulk' => ['products.list.bulk'],
        'inventory.adjust' => ['inventory.stock.adjust'],
        'customers.view' => ['customers.list.view'],
        // Khóa ma: inventory.view = xem tồn kho (không phải xem phiếu).
        'inventory.view' => ['inventory.stock.view'],
    ];

    // Tiền tố wildcard ma => tiền tố lá thật.
    private const GHOST_PREFIXES = [
        'menus.' => 'products.menus.',
        'transactions.' => 'finance.transactions.',
        'promotions.' => 'products.promotions.',
    ];

    public function handle(): int
    {
        $grantable = PermissionTree::grantableLeaves();
        $order = array_flip($grantable);
        $roles = Role::orderBy('id')->get();
        if ($roles->isEmpty()) {
            $this->info('Không có chức vụ nào để chuyển đổi.');
            return self::SUCCESS;
        }

        $changed = 0;
        $revoked = [];
        foreach ($roles as $role) {
            $before = array_values($role->permissions ?? []);
            [$after, $notes, $dropped] = $this->expandAll($before, $grantable, $order);
            $beforeSet = array_values(array_unique($before));
            sort($beforeSet);
            $afterSet = array_values(array_unique($after));
            sort($afterSet);
            if ($beforeSet === $afterSet) {
                $this->line("Role #{$role->id} {$role->name}: không đổi (" . count($after) . ' lá).');
                continue;
            }
            // Ghi log trước/sau (console + laravel.log).
            $this->info("Role #{$role->id} {$role->name}: " . count($before) . ' khóa cũ → ' . count($after) . ' lá.');
            $this->line('  Trước: ' . implode(', ', $before));
            $this->line('  Sau:   ' . implode(', ', $after));
            foreach ($notes as $n) $this->line('  Ghi chú: ' . $n);
            Log::info('permissions:migrate-tree', [
                'role_id' => $role->id, 'role' => $role->name,
                'before' => $before, 'after' => $after, 'notes' => $notes,
            ]);
            $role->permissions = $after;
            $role->save();
            $changed++;
            if ($dropped !== []) {
                $revoked[] = ['role_id' => $role->id, 'role' => $role->name, 'dropped' => $dropped];
            }
        }

        // Log riêng các role bị rút (mất quyền CÓ CHỦ ĐÍCH theo phán §7).
        if ($revoked !== []) {
            $this->warn('Các role bị rút quyền theo phán §7 (lương/bí mật chỉ tầng tài khoản):');
            foreach ($revoked as $r) {
                $this->warn("  Role #{$r['role_id']} {$r['role']}: rút " . implode(', ', $r['dropped']));
                Log::warning('permissions:migrate-tree revoked', $r);
            }
        }
        $this->info("Xong: {$changed}/" . $roles->count() . ' role thay đổi. Chạy lại lệnh sẽ không đổi thêm.');
        return self::SUCCESS;
    }

    /** Nở toàn bộ khóa của 1 role => [lá đã sắp theo thứ tự cây, ghi chú, khóa bị rút]. */
    private function expandAll(array $perms, array $grantable, array $order): array
    {
        $out = [];
        $notes = [];
        $dropped = [];
        foreach ($perms as $perm) {
            $perm = (string) $perm;
            [$leaves, $note, $drop] = $this->expandOne($perm, $grantable);
            foreach ($leaves as $l) $out[$l] = true;
            if ($note !== null) $notes[] = $note;
            foreach ($drop as $d) $dropped[$d] = true;
        }
        $leaves = array_keys($out);
        usort($leaves, fn ($a, $b) => ($order[$a] ?? 9999) <=> ($order[$b] ?? 9999));
        return [$leaves, array_values(array_unique($notes)), array_keys($dropped)];
    }

    /** Nở 1 khóa => [lá, ghi chú|null, khóa bị rút]. */
    private function expandOne(string $perm, array $grantable): array
    {
        // Lá cấp được đã đúng cây -> giữ nguyên (idempotent).
        if (in_array($perm, $grantable, true)) return [[$perm], null, []];
        // Lá tier_only lọt vào role -> rút (không nở thay thế).
        if (PermissionTree::isTierOnly($perm)) {
            return [[], "Rút {$perm} khỏi role (chỉ 2 tầng tài khoản).", [$perm]];
        }
        if (isset(self::MAP[$perm])) return [self::MAP[$perm], null, []];
        // products.manage = toàn bộ lá products.* trừ products.list.bulk
        // (bulk có khóa riêng products.bulk).
        if ($perm === 'products.manage') {
            $leaves = array_values(array_filter(
                PermissionTree::leavesUnder('products.'),
                fn ($l) => $l !== 'products.list.bulk'
            ));
            return [$leaves, null, []];
        }
        if ($perm === 'inventory.manage') return [PermissionTree::leavesUnder('inventory.'), null, []];
        if ($perm === 'finance.manage') return [PermissionTree::leavesUnder('finance.'), null, []];
        if ($perm === 'customers.manage') {
            return [array_values(array_filter(
                PermissionTree::leavesUnder('customers.'),
                fn ($l) => !str_starts_with($l, 'customers.invite.')
            )), null, []];
        }
        if ($perm === 'branches.manage') return [PermissionTree::leavesUnder('branches.'), null, []];
        if ($perm === 'reports.view') {
            $leaves = array_values(array_filter(
                PermissionTree::leavesUnder('reports.'),
                fn ($l) => str_ends_with($l, '.view') || $l === 'reports.revenue.export'
            ));
            return [$leaves, null, []];
        }
        if ($perm === 'settings.edit') {
            $leaves = [];
            foreach (['general', 'online', 'payments', 'sapo'] as $child) {
                $leaves[] = "settings.{$child}.view";
                $leaves[] = "settings.{$child}.edit";
            }
            return [$leaves, 'settings.edit không nở sang settings.secrets (phán (d) = A).', ['settings.secrets.view', 'settings.secrets.edit']];
        }
        if ($perm === 'staff.view') {
            $leaves = [
                'staff.employees.view', 'staff.violations.view', 'staff.roles.view',
                'staff.config.view', 'customers.invite.view',
            ];
            foreach (PermissionTree::leavesUnder('attendance.') as $l) {
                if (str_ends_with($l, '.view')) $leaves[] = $l;
            }
            return [$leaves, 'staff.view không nở sang bất kỳ khóa staff.salary.* nào (mô hình 3 tầng).', PermissionTree::SALARY_LEAVES];
        }
        if ($perm === 'staff.edit') {
            $leaves = [
                'staff.employees.edit',
                'staff.violations.create', 'staff.violations.edit', 'staff.violations.delete',
                'staff.roles.edit', 'staff.config.edit',
                'attendance.shifts.edit', 'attendance.schedules.edit',
                'attendance.grid.edit', 'attendance.notes.edit',
                'attendance.registrations.approve', 'attendance.leaves.approve',
            ];
            return [$leaves, 'staff.edit không nở sang staff.salary.* (ngoại lệ (a) §5 thắng bảng).', PermissionTree::SALARY_LEAVES];
        }
        // orders.delete: bỏ hẳn (chưa từng có thực thi).
        if ($perm === 'orders.delete') {
            return [[], 'Bỏ orders.delete (chưa từng có thực thi).', []];
        }
        // Wildcard '*' hoặc 'module.*' / 'module.child.*' (kể cả tiền tố ma).
        if ($perm === '*') {
            return [$grantable, "Nở '*' thành toàn bộ lá cấp được.", []];
        }
        if (str_ends_with($perm, '.*')) {
            $prefix = substr($perm, 0, -1);
            foreach (self::GHOST_PREFIXES as $ghost => $real) {
                if (str_starts_with($prefix, $ghost)) {
                    $prefix = $real . substr($prefix, strlen($ghost));
                    break;
                }
            }
            return [PermissionTree::leavesUnder($prefix), null, []];
        }
        // Khóa lạ không nhận diện được -> bỏ + ghi log.
        return [[], "Bỏ khóa lạ không nhận diện được: {$perm}.", []];
    }
}
