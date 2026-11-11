<?php

namespace App\Support;

// Cây phân quyền chi tiết — MỘT nguồn sự thật duy nhất (spec đã khóa
// 10/11/2026, §1.1): ma trận UI + danh sách trắng role + lệnh chuyển đổi
// đều sinh từ cây này. Không còn khóa ma, không còn khóa thật thiếu ô tick.
//
// Quy ước lá: module.mụcon.hànhđộng (vd inventory.inbound.approve).
// Mục con chỉ có 1 hành động thì dùng 'leaf' (vd orders.create).
// 'tier_only' = chỉ 2 tầng tài khoản (Chủ Sở Hữu · Chủ Chi Nhánh), KHÔNG
// cấp qua chức vụ (cụm lương §3.3 + settings.secrets §3.4(d)).
// 'scope': 'branch' = dữ kiện theo CN phân công · 'system' = toàn hệ thống.
class PermissionTree
{
    public const ACTION_LABELS = [
        'view' => 'Xem',
        'create' => 'Thêm',
        'edit' => 'Sửa',
        'delete' => 'Xóa',
        'approve' => 'Duyệt',
        'pay' => 'Ghi thanh toán',
        'adjust' => 'Điều chỉnh',
        'export' => 'Xuất',
        'bulk' => 'Hàng loạt',
        'discount' => 'Giảm giá',
        'points' => 'Thao tác điểm',
    ];

    // 11 module · 47 mục con (spec §2).
    public const MODULES = [
        [
            'key' => 'dashboard', 'label' => 'Tổng quan', 'scope' => 'branch',
            'children' => [
                ['key' => 'root', 'label' => 'Tổng quan', 'actions' => ['view'], 'leaf' => 'dashboard.view', 'scope' => 'branch'],
            ],
        ],
        [
            'key' => 'orders', 'label' => 'Hóa đơn', 'scope' => 'branch',
            'children' => [
                ['key' => 'list', 'label' => 'Danh sách & chi tiết đơn', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'create', 'label' => 'Tạo đơn (POS)', 'actions' => ['create'], 'leaf' => 'orders.create', 'scope' => 'branch'],
                ['key' => 'edit', 'label' => 'Xử lý đơn', 'actions' => ['edit'], 'leaf' => 'orders.edit', 'scope' => 'branch'],
                ['key' => 'bulk', 'label' => 'Thao tác hàng loạt + nhập Excel đơn', 'actions' => ['bulk'], 'leaf' => 'orders.bulk', 'scope' => 'branch'],
                ['key' => 'discount', 'label' => 'Cho phép giảm giá trực tiếp trên đơn', 'actions' => ['discount'], 'leaf' => 'orders.discount', 'scope' => 'branch'],
            ],
        ],
        [
            'key' => 'products', 'label' => 'Mặt hàng', 'scope' => 'system',
            'children' => [
                ['key' => 'list', 'label' => 'Mặt hàng', 'actions' => ['view', 'create', 'edit', 'delete', 'bulk'], 'scope' => 'system'],
                ['key' => 'categories', 'label' => 'Danh mục mặt hàng', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'options', 'label' => 'Nhóm tùy chọn & tùy chọn', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'menus', 'label' => 'Thực đơn + hiển thị POS/App', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'prices', 'label' => 'Bảng giá', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'promotions', 'label' => 'Khuyến mại', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'vouchers', 'label' => 'Voucher/Coupon', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'rd', 'label' => 'R&D (món nháp · chi phí cố định · hòa vốn)', 'actions' => ['view', 'create', 'edit', 'delete', 'approve'], 'scope' => 'system'],
            ],
        ],
        [
            'key' => 'inventory', 'label' => 'Kho hàng', 'scope' => 'branch',
            'children' => [
                ['key' => 'stock', 'label' => 'Tồn kho & lô', 'actions' => ['view', 'adjust'], 'scope' => 'branch'],
                ['key' => 'inbound', 'label' => 'Phiếu nhập (theo hóa đơn)', 'actions' => ['view', 'create', 'edit', 'delete', 'approve'], 'scope' => 'branch'],
                ['key' => 'outbound', 'label' => 'Phiếu xuất', 'actions' => ['view', 'create', 'edit', 'delete', 'approve'], 'scope' => 'branch'],
                ['key' => 'transfer', 'label' => 'Chuyển kho', 'actions' => ['view', 'create', 'approve', 'delete'], 'scope' => 'branch'],
                ['key' => 'stocktake', 'label' => 'Kiểm kê + phiếu điều chỉnh kiểm kê', 'actions' => ['view', 'create', 'edit', 'approve'], 'scope' => 'branch'],
                ['key' => 'production', 'label' => 'Chế biến (định mức + phiếu sản xuất)', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'branch'],
                ['key' => 'purchase', 'label' => 'Phiếu đặt hàng NCC', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'branch'],
                ['key' => 'materials', 'label' => 'Nguyên liệu + danh mục NL + nhập Excel NL', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'partners', 'label' => 'Nhà cung cấp / đối tác kho', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
            ],
        ],
        [
            'key' => 'finance', 'label' => 'Thu chi', 'scope' => 'branch',
            'children' => [
                ['key' => 'transactions', 'label' => 'Phiếu thu/chi (gồm công nợ)', 'actions' => ['view', 'create', 'edit', 'delete', 'approve', 'pay'], 'scope' => 'branch'],
                ['key' => 'categories', 'label' => 'Danh mục thu/chi', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'channels', 'label' => 'Điều chỉnh kênh (Sapo)', 'actions' => ['view', 'create', 'edit'], 'scope' => 'system'],
            ],
        ],
        [
            'key' => 'customers', 'label' => 'Khách hàng', 'scope' => 'system',
            'children' => [
                ['key' => 'list', 'label' => 'Danh sách & hồ sơ khách', 'actions' => ['view', 'create', 'edit', 'delete', 'points'], 'scope' => 'system'],
                ['key' => 'tiers', 'label' => 'Hạng thành viên + cấu hình loyalty', 'actions' => ['view', 'edit'], 'scope' => 'system'],
                ['key' => 'exchange', 'label' => 'Cửa hàng điểm (vật phẩm đổi điểm)', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'minigame', 'label' => 'Minigame (cấu hình · thống kê · phiên chơi)', 'actions' => ['view', 'edit'], 'scope' => 'system'],
                ['key' => 'invite', 'label' => 'Mời bạn / affiliate', 'actions' => ['view'], 'scope' => 'system'],
            ],
        ],
        [
            'key' => 'reports', 'label' => 'Báo cáo', 'scope' => 'branch',
            'children' => [
                ['key' => 'overview', 'label' => 'Tổng quan', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'revenue', 'label' => 'Doanh thu (+ xuất Excel doanh thu)', 'actions' => ['view', 'export'], 'scope' => 'branch'],
                ['key' => 'pnl', 'label' => 'Lãi lỗ (P&L)', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'cash', 'label' => 'Thu chi / dòng tiền', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'inventory', 'label' => 'Báo cáo kho', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'hr', 'label' => 'Báo cáo nhân sự', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'operations', 'label' => 'Vận hành', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'menu', 'label' => 'Menu engineering', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'cancelled', 'label' => 'Đơn hủy theo nhân viên', 'actions' => ['view'], 'scope' => 'branch'],
            ],
        ],
        [
            'key' => 'staff', 'label' => 'Nhân sự', 'scope' => 'branch',
            'children' => [
                ['key' => 'employees', 'label' => 'Danh sách & hồ sơ nhân viên', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'branch'],
                ['key' => 'salary.summary', 'label' => 'Lương — Xem tổng hợp', 'group' => 'Lương', 'actions' => ['view'], 'tier_only' => true, 'scope' => 'branch'],
                ['key' => 'salary.detail', 'label' => 'Lương — Xem chi tiết từng NV', 'group' => 'Lương', 'actions' => ['view'], 'tier_only' => true, 'scope' => 'branch'],
                ['key' => 'salary.edit', 'label' => 'Lương — Nhập/sửa giờ công & bản ghi lương', 'group' => 'Lương', 'actions' => ['edit'], 'leaf' => 'staff.salary.edit', 'tier_only' => true, 'scope' => 'branch'],
                ['key' => 'salary.money', 'label' => 'Lương — Các khoản tiền theo NV', 'group' => 'Lương', 'actions' => ['money'], 'leaf' => 'staff.salary.money', 'tier_only' => true, 'scope' => 'branch'],
                ['key' => 'salary.config', 'label' => 'Lương — Cấu hình lương', 'group' => 'Lương', 'actions' => ['config'], 'leaf' => 'staff.salary.config', 'tier_only' => true, 'scope' => 'branch'],
                ['key' => 'salary.lock', 'label' => 'Lương — Chốt khóa / mở khóa kỳ lương', 'group' => 'Lương', 'actions' => ['lock'], 'leaf' => 'staff.salary.lock', 'tier_only' => true, 'scope' => 'branch'],
                ['key' => 'salary.export', 'label' => 'Lương — Xuất ảnh phiếu lương', 'group' => 'Lương', 'actions' => ['export'], 'leaf' => 'staff.salary.export', 'tier_only' => true, 'scope' => 'branch'],
                ['key' => 'violations', 'label' => 'Vi phạm (ghi nhận + tổng hợp)', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'branch'],
                ['key' => 'roles', 'label' => 'Chức vụ & phân quyền', 'actions' => ['view', 'edit'], 'scope' => 'system'],
                ['key' => 'config', 'label' => 'Cấu hình nhân sự phi-lương', 'actions' => ['view', 'edit'], 'scope' => 'system'],
            ],
        ],
        [
            'key' => 'attendance', 'label' => 'Chấm công & ca', 'scope' => 'branch',
            'children' => [
                ['key' => 'shifts', 'label' => 'Ca làm việc (định nghĩa ca)', 'actions' => ['view', 'edit'], 'scope' => 'system'],
                ['key' => 'schedules', 'label' => 'Xếp ca', 'actions' => ['view', 'edit'], 'scope' => 'branch'],
                ['key' => 'registrations', 'label' => 'Đăng ký ca', 'actions' => ['view', 'approve'], 'scope' => 'branch'],
                ['key' => 'leaves', 'label' => 'Đơn nghỉ / đổi ca', 'actions' => ['view', 'approve'], 'scope' => 'branch'],
                ['key' => 'grid', 'label' => 'Lưới chấm công', 'actions' => ['view', 'edit'], 'scope' => 'branch'],
                ['key' => 'qr', 'label' => 'Mã QR chấm công theo chi nhánh', 'actions' => ['view'], 'scope' => 'branch'],
                ['key' => 'notes', 'label' => 'Ghi chú lịch', 'actions' => ['view', 'edit'], 'scope' => 'branch'],
            ],
        ],
        [
            'key' => 'branches', 'label' => 'Chi nhánh', 'scope' => 'system',
            'children' => [
                ['key' => 'list', 'label' => 'Chi nhánh', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
                ['key' => 'tables', 'label' => 'Bàn', 'actions' => ['view', 'create', 'edit', 'delete'], 'scope' => 'system'],
            ],
        ],
        [
            'key' => 'settings', 'label' => 'Thiết lập & cấu hình', 'scope' => 'system',
            'children' => [
                ['key' => 'general', 'label' => 'Thiết lập chung', 'actions' => ['view', 'edit'], 'scope' => 'system'],
                ['key' => 'online', 'label' => 'Cấu hình online & giao hàng', 'actions' => ['view', 'edit'], 'scope' => 'system'],
                ['key' => 'payments', 'label' => 'Phương thức thanh toán + tài khoản nhận tiền', 'actions' => ['view', 'edit'], 'scope' => 'system'],
                ['key' => 'sapo', 'label' => 'Cầu nối Sapo (trừ cấu hình hộp mail)', 'actions' => ['view', 'edit'], 'scope' => 'system'],
                ['key' => 'secrets', 'label' => 'Bí mật / nguy hiểm', 'actions' => ['view', 'edit'], 'tier_only' => true, 'scope' => 'system'],
            ],
        ],
    ];

    // Các khóa lá lương của tầng tài khoản (CheckPermission cho Chủ Chi Nhánh
    // đi qua đúng 7 năng lực này trong CN mình — spec §3.3/§8.3).
    public const SALARY_LEAVES = [
        'staff.salary.summary.view',
        'staff.salary.detail.view',
        'staff.salary.edit',
        'staff.salary.money',
        'staff.salary.config',
        'staff.salary.lock',
        'staff.salary.export',
    ];

    /** Mọi khóa lá trong cây (kể cả tier_only), theo thứ tự cây. */
    public static function leaves(): array
    {
        $out = [];
        foreach (self::MODULES as $m) {
            foreach ($m['children'] as $c) {
                $out[] = self::childLeaves($m['key'], $c);
            }
        }
        return array_values(array_merge(...$out));
    }

    /** Khóa lá cấp được qua chức vụ = mọi lá trừ cụm tier_only. */
    public static function grantableLeaves(): array
    {
        $out = [];
        foreach (self::MODULES as $m) {
            foreach ($m['children'] as $c) {
                if (!empty($c['tier_only'])) continue;
                $out[] = self::childLeaves($m['key'], $c);
            }
        }
        return array_values(array_merge(...$out));
    }

    /** Lá của 1 mục con: 'leaf' có sẵn thì dùng, còn lại module.mụcon.hànhđộng. */
    public static function childLeaves(string $moduleKey, array $child): array
    {
        if (!empty($child['leaf'])) return [$child['leaf']];
        return array_map(fn ($a) => $moduleKey . '.' . $child['key'] . '.' . $a, $child['actions']);
    }

    /** Mọi lá có tiền tố cho trước (vd 'inventory.' — dùng cho lệnh chuyển đổi). */
    public static function leavesUnder(string $prefix): array
    {
        return array_values(array_filter(
            self::grantableLeaves(),
            fn ($l) => str_starts_with($l, $prefix)
        ));
    }

    public static function isTierOnly(string $leaf): bool
    {
        foreach (self::MODULES as $m) {
            foreach ($m['children'] as $c) {
                if (!empty($c['tier_only']) && in_array($leaf, self::childLeaves($m['key'], $c), true)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Hình dạng trả cho GET /roles/matrix (kèm lá + nhãn phạm vi + cờ tier_only). */
    public static function matrix(): array
    {
        $out = [];
        foreach (self::MODULES as $m) {
            $children = [];
            foreach ($m['children'] as $c) {
                $children[] = [
                    'key' => $c['key'],
                    'label' => $c['label'],
                    'group' => $c['group'] ?? null,
                    'actions' => $c['actions'],
                    'leaves' => self::childLeaves($m['key'], $c),
                    'scope' => $c['scope'] ?? $m['scope'],
                    'tier_only' => !empty($c['tier_only']),
                ];
            }
            $out[] = [
                'key' => $m['key'],
                'label' => $m['label'],
                'scope' => $m['scope'],
                'children' => $children,
            ];
        }
        return $out;
    }
}
