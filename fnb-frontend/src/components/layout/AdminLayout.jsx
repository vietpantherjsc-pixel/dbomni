import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import '../../styles/matcha.css';
import { loadTheme } from '../../utils/theme';
import { loadNumberSettings } from '../../utils/number';
import axios from 'axios';

// =====================================================================
// Gói 7d (2026-10-05): Redesign theo phong cách B (Matcha).
// - Sidebar xanh matcha đậm + nền kem, font Inter (vietnamese)
// - Bo góc 8px, kicker in hoa, số tabular — tối giản kiểu Nhật
// =====================================================================

const Icon = ({ name, className = 'w-5 h-5' }) => {
    const paths = {
        home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
        chart: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
        receipt: <path d="M6 2h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1zm3 7h6m-6 4h6" />,
        tag: <path d="M20 12l-8 8-9-9V4a1 1 0 0 1 1-1h7l9 9zM7.5 7.5h.01" />,
        calendar: <path d="M8 2v4m8-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />,
        table: <path d="M3 5h18v3H3zM5 8v11m4-11v11m6-11v11m4-11v11" />,
        users: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />,
        user: <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m16 0h-2m-12 0H4m14-16a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />,
        percent: <path d="M19 5 5 19m14-14h.01M5 5h.01M9 3h6a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z" />,
        box: <path d="m21 8-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5m-9 5v9" />,
        wallet: <path d="M20 7H4a2 2 0 0 1 0-4h14v4m0 0v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5m18 2h-3a1 1 0 0 0 0 2h3v0z" />,
        clock: <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-16v6l4 2" />,
        plug: <path d="M9 7V2m6 5V2M7 7h10v4a5 5 0 0 1-10 0V7zm5 9v5" />,
        globe: <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" />,
        qr: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zm10 0h3v3h-3zm3 3h3v3h-3z" />,
        gear: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z" />,
        pos: <path d="M4 7h16v9H4zM4 7l2-3h12l2 3M8 20h8m-4-4v4M7 11h.01M11 11h.01M15 11h.01" />,
        book: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />,
        kitchen: <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6V13.87zM6 17h12" />,
        bell: <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9m-4.3 13a2 2 0 0 1-3.4 0" />,
        menu: <path d="M4 6h16M4 12h16M4 18h16" />,
        chevron: <path d="m9 18 6-6-6-6" />,
        logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />,
    };
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths[name] || paths.home}
        </svg>
    );
};

// Menu chính (copy Sapo, trừ Kế toán/Thuế) + submenu
const mainMenu = [
    { path: '/admin', label: 'Tổng quan', icon: 'home' },
    { path: '/admin/reports', label: 'Báo cáo', icon: 'chart', children: [
        { label: 'Báo cáo doanh thu', path: '/admin/reports' },
        { label: 'Báo cáo kho', path: '/admin/reports/inventory' },
        { label: 'Báo cáo thu chi / PNL', path: '/admin/reports/pnl' },
    ] },
    { path: '/admin/orders', label: 'Hóa đơn', icon: 'receipt', children: ['Hóa đơn bán hàng', 'Hóa đơn điện tử'] },
    { path: '/admin/products', label: 'Mặt hàng', icon: 'tag', children: [
        { label: 'Danh sách mặt hàng', path: '/admin/products' },
        { label: 'Quản lý hiển thị', path: '/admin/products/visibility' }, // Gói 25: ẩn/hiện món theo CN
        { label: 'Danh mục', path: '/admin/categories' },
        { label: 'Nhóm tùy chọn', path: '/admin/option-groups' },
    ] },
    { path: '/admin/menus', label: 'Thực đơn', icon: 'book', children: [ // Gói 25: tách khỏi Mặt hàng theo demo đã chốt
        { label: 'Danh sách thực đơn', path: '/admin/menus' },
        { label: 'Quản lý hiển thị', path: '/admin/menus/visibility' }, // Gói 25: ẩn/hiện thực đơn theo CN
    ] },
    { path: '/admin/bookings', label: 'Đặt lịch', icon: 'calendar' },
    { path: '/admin/tables', label: 'Bàn', icon: 'table' },
    { path: '/admin/staff', label: 'Nhân viên', icon: 'users', perm: 'staff.view', children: [ // Gói 26
        { label: 'Danh sách nhân viên', path: '/admin/staff' },
        { label: 'Chức vụ & phân quyền', path: '/admin/staff/roles' },
        { label: 'Bảng lương', path: '/admin/staff/salary' },
        { label: 'Lương lễ, Tết & phạt', path: '/admin/staff/holiday-policy' },
    ] },
    { path: '/admin/customers', label: 'Khách hàng', icon: 'user', children: [
        { label: 'Danh sách khách hàng', path: '/admin/customers' },
        { label: 'Thẻ thành viên', path: '/admin/member-tiers' },
    ] },
    { path: '/admin/promotions', label: 'Khuyến mại', icon: 'percent' },
    { path: '/admin/inventory', label: 'Kho hàng', icon: 'box' },
    { path: '/admin/transactions', label: 'Thu chi', icon: 'wallet', children: [ // Gói 29
        { label: 'Danh sách thu chi', path: '/admin/transactions' },
        { label: 'Danh mục thu chi', path: '/admin/transaction-categories' },
        { label: 'Đối tác', path: '/admin/partners' },
    ] },
    { path: '/admin/attendance', label: 'Chấm công', icon: 'clock', perm: 'staff.view', children: [ // Gói 35
        { label: 'Bảng chấm công', path: '/admin/attendance' },
        { label: 'Ca làm việc', path: '/admin/attendance/shifts' },
        { label: 'Đăng ký & Xếp ca', path: '/admin/attendance/scheduling' },
        { label: 'Yêu cầu nghỉ', path: '/admin/attendance/requests' },
        { label: 'QR chấm công', path: '/admin/attendance/qr' },
    ] },
];

const channelMenu = [
    { path: '/admin/price-lists', label: 'Kênh bán hàng', icon: 'tag' },
    { path: '/admin/integrations', label: 'Đối tác tích hợp', icon: 'plug' },
    { path: '/admin/online', label: 'Bán online', icon: 'globe', children: ['Đơn online', 'Cấu hình'] },
    { path: '/admin/qr-order', label: 'QR Order', icon: 'qr', children: [ // Gói 28: submenu mở đúng tab
        { label: 'Danh sách QR', path: '/admin/qr-order' },
        { label: 'Tạo QR', path: '/admin/qr-order?tab=tao' },
    ] },
];

// Nghiệp vụ bán hàng của hệ thống (giữ lại từ layout cũ)
const opsMenu = [
    { path: '/pos', label: 'Bán hàng (POS)', icon: 'pos' },
    { path: '/kds', label: 'Bếp (KDS)', icon: 'kitchen' },
];

const AdminLayout = ({ children }) => {
    const { user, logout, can } = useAuth();
    const { branchId, setBranchId } = useBranch();
    const location = useLocation();
    const navigate = useNavigate();
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false); // drawer sidebar trên mobile
    const [openSub, setOpenSub] = useState(null); // path của menu đang mở submenu
    // Gói 18: dropdown chọn chi nhánh
    const [branches, setBranches] = useState([]);
    const [branchOpen, setBranchOpen] = useState(false);

    useEffect(() => {
        axios.get('http://localhost/api/branches')
            .then((r) => { if (r.data?.success) setBranches(r.data.data || []); })
            .catch(() => {});
    }, []);

    const branchName = branchId === '0'
        ? 'Tất cả chi nhánh'
        : (branches.find((b) => String(b.id) === String(branchId))?.name || 'Chi nhánh ' + branchId);

    // Gói 7d: gắn theme Matcha cho body
    useEffect(() => {
        document.body.classList.add('m-theme');
        return () => document.body.classList.remove('m-theme');
    }, []);

    // Gói 7p: áp màu chủ đạo do Đại Vương pick (localStorage trước, server sau)
    // Gói 8f: nạp cấu hình số thập phân
    useEffect(() => {
        loadTheme(axios);
        loadNumberSettings(axios);
    }, []);

    const isActive = (path) => {
        if (path === '/admin') return location.pathname === '/admin';
        return location.pathname === path || location.pathname.startsWith(path + '/');
    };

    // Gói 7m: kiểm tra có submenu nào đang active không
    const isChildActive = (item) => {
        if (!Array.isArray(item.children)) return false;
        return item.children.some((child) => {
            const to = typeof child === 'string' ? item.path : (child.path || item.path);
            return location.pathname === to || location.pathname.startsWith(to + '/');
        });
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const renderItem = (item) => {
        const selfActive = isActive(item.path);
        const childActive = isChildActive(item);
        const active = selfActive || childActive;
        const hasSub = Array.isArray(item.children) && item.children.length > 0;
        // Gói 7m: submenu đang active -> menu mẹ luôn mở rộng (không cho thu gọn) + highlight
        const expanded = childActive || openSub === item.path || (hasSub && selfActive && openSub === null);

        const mainRow = hasSub ? (
            <button
                onClick={() => {
                    if (childActive) return; // đang ở trang con: giữ mở, không cho thu gọn
                    setOpenSub(expanded && openSub === item.path ? null : item.path);
                }}
                title={collapsed ? item.label : undefined}
                className={`m-nav-item w-full ${active ? 'active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
            >
                <Icon name={item.icon} className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
                {!collapsed && (
                    <Icon
                        name="chevron"
                        className={`w-3.5 h-3.5 opacity-60 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    />
                )}
            </button>
        ) : (
            <Link
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={`m-nav-item ${active ? 'active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
            >
                <Icon name={item.icon} className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            </Link>
        );

        return (
            <div key={item.path}>
                {mainRow}
                {hasSub && expanded && !collapsed && (
                    <div className="mt-0.5 mb-1 space-y-0.5">
                        {item.children.map((child) => {
                            // Gói 5: child có thể là string (link về trang cha) hoặc {label, path}
                            // Gói 7l: mục con không thụt vào (tránh nhảy dòng), full-width như mục chính
                            const label = typeof child === 'string' ? child : child.label;
                            const to = typeof child === 'string' ? item.path : (child.path || item.path);
                            const childActive = location.pathname === to;
                            return (
                                <Link
                                    key={label}
                                    to={to}
                                    onClick={() => setMobileOpen(false)}
                                    className={`m-nav-item ${childActive ? 'active' : ''}`}
                                >
                                    {label}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const renderMenu = (items) => (
        // Gói 26: ẩn menu theo quyền (mục nào có perm mà không đủ quyền thì ẩn)
        <div className="space-y-[2px]">{items.filter((it) => !it.perm || can(it.perm)).map(renderItem)}</div>
    );

    return (
        <div className="flex h-screen" style={{ background: 'var(--m-bg)' }}>
            {/* ============ SIDEBAR ============ */}
            <aside
                className={`m-sidebar flex flex-col shrink-0 transition-all duration-200 z-40 fixed md:static inset-y-0 left-0 h-screen md:h-auto ${
                    mobileOpen ? 'translate-x-0' : '-translate-x-full'
                } md:translate-x-0 w-[240px] ${collapsed ? 'md:w-14' : 'md:w-[216px]'}`}
            >
                {/* Logo */}
                <div className="h-[56px] flex items-center justify-center border-b shrink-0" style={{ borderColor: 'var(--m-line)' }}>
                    {!collapsed ? (
                        <span className="text-[19px] font-extrabold tracking-tight flex items-center gap-2">
                            <span style={{ color: 'var(--m-primary)' }}>DBOmni</span>
                            <span className="m-stamp">POS</span>
                        </span>
                    ) : (
                        <span className="text-lg font-extrabold" style={{ color: 'var(--m-primary)' }}>D</span>
                    )}
                </div>

                {/* Chọn chi nhánh — Gói 18: dropdown thật, chọn từng CN hoặc tất cả */}
                {!collapsed ? (
                    <div className="relative mx-2.5 mt-2.5">
                        <button
                            onClick={() => setBranchOpen(!branchOpen)}
                            className="m-nav-item w-full justify-between"
                            style={{ background: 'var(--m-bg-soft)', border: '1px solid var(--m-line)' }}
                        >
                            <span className="truncate font-medium min-w-0">{branchName}</span>
                            <Icon name="chevron" className={`w-3.5 h-3.5 opacity-60 transition-transform ${branchOpen ? '-rotate-90' : 'rotate-90'}`} />
                        </button>
                        {branchOpen && (
                            <>
                                <div className="fixed inset-0 z-30" onClick={() => setBranchOpen(false)} />
                                <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-lg overflow-hidden shadow-xl max-h-64 overflow-y-auto" style={{ background: '#fff', border: '1px solid var(--m-line)' }}>
                                    <button
                                        onClick={() => { setBranchId('0'); setBranchOpen(false); }}
                                        className={`w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 ${branchId === '0' ? 'font-bold' : ''}`}
                                        style={{ color: branchId === '0' ? 'var(--m-primary)' : 'var(--m-ink)' }}
                                    >
                                        {branchId === '0' ? '✓ ' : ''}Tất cả chi nhánh
                                    </button>
                                    {branches.map((b) => (
                                        <button
                                            key={b.id}
                                            onClick={() => { setBranchId(b.id); setBranchOpen(false); }}
                                            className={`w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 ${String(branchId) === String(b.id) ? 'font-bold' : ''}`}
                                            style={{ color: String(branchId) === String(b.id) ? 'var(--m-primary)' : 'var(--m-ink)' }}
                                        >
                                            {String(branchId) === String(b.id) ? '✓ ' : ''}{b.name}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="mx-auto mt-2.5 w-8 h-8 rounded-lg" style={{ background: 'var(--m-bg-soft)', border: '1px solid var(--m-line)' }} />
                )}

                {/* Menu */}
                <nav className="m-scroll flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
                    <div>{renderMenu(mainMenu)}</div>

                    {!collapsed && (
                        <div className="m-kicker px-3" style={{ color: 'var(--m-ink-faint)' }}>
                            Kênh bán hàng
                        </div>
                    )}
                    <div className={collapsed ? '' : '-mt-2.5'}>{renderMenu(channelMenu)}</div>

                    {!collapsed && (
                        <div className="m-kicker px-3" style={{ color: 'var(--m-ink-faint)' }}>
                            Nghiệp vụ
                        </div>
                    )}
                    <div className={collapsed ? '' : '-mt-2.5'}>{renderMenu(opsMenu)}</div>
                </nav>

                {/* Thiết lập (đáy) */}
                <div className="p-2.5 border-t" style={{ borderColor: 'var(--m-line)' }}>
                    {renderItem({ path: '/admin/settings', label: 'Thiết lập', icon: 'gear' })}
                </div>
            </aside>
            {mobileOpen && (
                <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
            )}

            {/* ============ MAIN ============ */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Topbar */}
                <header className="m-topbar h-[56px] flex items-center justify-between px-4 shrink-0 z-10">
                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={() => {
                                if (window.innerWidth < 768) setMobileOpen((v) => !v);
                                else setCollapsed(!collapsed);
                            }}
                            className="p-1.5 rounded-lg text-white/80 hover:bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center"
                            title="Menu"
                        >
                            <Icon name="menu" className="w-5 h-5" />
                        </button>
                        <span className="text-[14px] font-semibold whitespace-nowrap truncate max-w-[140px] text-white">
                            {branchName}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="p-1.5 rounded-lg text-white/80 hover:bg-white/10 relative min-w-[44px] min-h-[44px] flex items-center justify-center" title="Thông báo">
                            <Icon name="bell" className="w-5 h-5" />
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-[13px] font-bold" style={{ background: 'var(--m-stamp)' }}>
                                {(user?.name || 'A').charAt(0).toUpperCase()}
                            </div>
                            <div className="hidden sm:block leading-tight">
                                <div className="text-[12.5px] font-semibold text-white">{user?.name || 'Quản trị'}</div>
                                <div className="text-[10.5px] capitalize text-white/60">
                                    {(user?.roles || []).join(', ') || 'Nhân viên'}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-1 text-[12.5px] px-2 py-1.5 rounded-lg text-white/80 hover:bg-white/10"
                            title="Đăng xuất"
                        >
                            <Icon name="logout" className="w-4 h-4" />
                            <span className="hidden md:inline">Đăng xuất</span>
                        </button>
                    </div>
                </header>

                {/* Nội dung trang */}
                <main className="flex-1 overflow-y-auto m-scroll">{children}</main>
            </div>
        </div>
    );
};

export default AdminLayout;
export { Icon };
