import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';
import TimeInput from '../../components/TimeInput'; // Gói 55 p2: ô nhập giờ 24h (không dùng input type=time)
import { applyThemeColor, getStoredTheme, DEFAULT_PRIMARY, THEME_PRESETS } from '../../utils/theme';
import { applyFont, getStoredFont, DEFAULT_FONT, FONT_PRESETS } from '../../utils/font';
import { DECIMAL_LABELS } from '../../utils/number';
import PaymentMethodManager from './PaymentMethodManager'; // Gói 52
import ProductAliasManager from './ProductAliasManager'; // Gói 55
import UnitManager from './UnitManager'; // Gói 52
import PrintTemplateSettings from './PrintTemplateSettings'; // Gói 52
import { API } from '../../utils/api';

// Gói 22 (2026-10-09): Quản lý chi nhánh ngay trong Thiết lập.
const BranchManager = () => {
    const [list, setList] = useState([]);
    const [form, setForm] = useState({ code: '', name: '', phone: '', address: '', latitude: '', longitude: '' });
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState('');
    // Gói 55 p2: giờ mở cửa
    const [ohMode, setOhMode] = useState('all'); // 'all' | 'daily'
    const [ohAll, setOhAll] = useState({ open: '06:30', close: '22:00' });
    const [ohDays, setOhDays] = useState({}); // {0:{open,close,off}, 1:..., ...}

    const DAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

    const fetchList = async () => {
        try {
            const res = await axios.get(API + '/branches');
            if (res.data?.success) setList(res.data.data || []);
        } catch (e) { /* bỏ qua */ }
    };
    useEffect(() => { fetchList(); }, []);

    const resetForm = () => {
        setEditingId(null);
        setForm({ code: '', name: '', phone: '', address: '', latitude: '', longitude: '' });
        setOhMode('all');
        setOhAll({ open: '06:30', close: '22:00' });
        setOhDays({});
    };

    const startEdit = (b) => {
        setEditingId(b.id);
        setForm({
            code: b.code || '', name: b.name || '', phone: b.phone || '',
            address: b.address || '', latitude: b.latitude ?? '', longitude: b.longitude ?? '',
        });
        // Gói 55 p2: nạp giờ mở cửa
        const oh = b.opening_hours || {};
        if (oh.mode === 'daily' && oh.days) {
            setOhMode('daily');
            setOhDays(oh.days);
        } else {
            setOhMode('all');
            setOhAll({ open: oh.open || '06:30', close: oh.close || '22:00' });
        }
        setMsg('');
    };

    const save = async () => {
        if (!form.code.trim() || !form.name.trim()) return alert('Nhập mã và tên chi nhánh');
        try {
            // Gói 55 p2: đóng gói giờ mở cửa
            const opening_hours = ohMode === 'daily'
                ? { mode: 'daily', days: ohDays }
                : { mode: 'all', open: ohAll.open, close: ohAll.close };
            const payload = {
                code: form.code.trim(), name: form.name.trim(),
                phone: form.phone.trim() || null, address: form.address.trim() || null,
                latitude: form.latitude === '' ? null : Number(form.latitude),
                longitude: form.longitude === '' ? null : Number(form.longitude),
                opening_hours,
            };
            if (editingId) {
                await axios.patch(API + '/branches/' + editingId, payload);
                setMsg('Đã cập nhật chi nhánh.');
            } else {
                if (!payload.address) return alert('Nhập địa chỉ chi nhánh');
                if (payload.latitude == null || payload.longitude == null) return alert('Nhập vĩ độ / kinh độ để tính phí ship');
                await axios.post(API + '/branches', payload);
                setMsg('Đã thêm chi nhánh.');
            }
            resetForm(); fetchList();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };

    const toggleActive = async (b) => {
        try {
            await axios.patch(API + '/branches/' + b.id, { is_active: !b.is_active });
            fetchList();
        } catch (e) { alert('Đổi trạng thái thất bại'); }
    };

    const inp = 'm-input';
    return (
        <div>
            {msg && <div className="text-sm mb-3" style={{ color: 'var(--m-success)' }}>{msg}</div>}
            <div className="overflow-x-auto border border-gray-100 rounded-lg mb-4">
                <table className="w-full text-[13px] min-w-[640px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                            <th className="px-4 py-3 font-medium">Mã</th>
                            <th className="px-3 py-3 font-medium">Tên chi nhánh</th>
                            <th className="px-3 py-3 font-medium">SĐT</th>
                            <th className="px-3 py-3 font-medium">Địa chỉ</th>
                            <th className="px-3 py-3 font-medium text-center">Trạng thái</th>
                            <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.map((b) => (
                            <tr key={b.id} className="border-b border-gray-50">
                                <td className="px-4 py-3"><code className="text-xs">{b.code}</code></td>
                                <td className="px-3 py-3"><b>{b.name}</b></td>
                                <td className="px-3 py-3 text-gray-500">{b.phone || '—'}</td>
                                <td className="px-3 py-3 text-gray-500 text-xs max-w-[220px] truncate" title={b.address}>{b.address || '—'}</td>
                                <td className="px-3 py-3 text-center">
                                    {b.is_active
                                        ? <span className="text-emerald-600 text-xs font-medium">Đang hoạt động</span>
                                        : <span className="text-gray-400 text-xs">Đã tắt</span>}
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <button onClick={() => startEdit(b)} className="text-xs font-semibold mr-2 text-[#0d6efd] hover:underline">Sửa</button>
                                    <button onClick={() => toggleActive(b)}
                                        className={'text-xs font-semibold hover:underline ' + (b.is_active ? 'text-red-600' : 'text-emerald-600')}>
                                        {b.is_active ? 'Tắt' : 'Bật'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {list.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Chưa có chi nhánh nào.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <h3 className="text-[14px] font-bold mb-3" style={{ color: 'var(--m-ink)' }}>
                {editingId ? 'Sửa chi nhánh' : 'Thêm chi nhánh mới'}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl">
                <div><label className="m-label">Mã chi nhánh *</label>
                    <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                        placeholder="VD: CN-Q1" className={inp} disabled={!!editingId} /></div>
                <div><label className="m-label">Tên chi nhánh *</label>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="VD: Chi nhánh Quận 1" className={inp} /></div>
                <div><label className="m-label">Số điện thoại</label>
                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className={inp} /></div>
                <div className="col-span-2 md:col-span-3"><label className="m-label">Địa chỉ *</label>
                    <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                        placeholder="Số nhà, đường, phường..." className={inp} /></div>
                <div><label className="m-label">Vĩ độ (tính phí ship) *</label>
                    <input type="number" step="any" value={form.latitude}
                        onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                        placeholder="VD: 10.762622" className={inp} /></div>
                <div><label className="m-label">Kinh độ (tính phí ship) *</label>
                    <input type="number" step="any" value={form.longitude}
                        onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                        placeholder="VD: 106.660172" className={inp} /></div>
            </div>
            {/* Gói 55 p2: giờ mở cửa */}
            <div className="mt-5 max-w-3xl">
                <label className="m-label">🕐 Giờ mở cửa</label>
                <div className="flex gap-2 mt-2 mb-3">
                    <button type="button" onClick={() => setOhMode('all')}
                        className={'px-4 py-2 rounded-lg text-[13px] font-semibold border ' + (ohMode === 'all' ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-200')}>
                        Áp dụng cả tuần
                    </button>
                    <button type="button" onClick={() => setOhMode('daily')}
                        className={'px-4 py-2 rounded-lg text-[13px] font-semibold border ' + (ohMode === 'daily' ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-200')}>
                        Thiết lập từng ngày
                    </button>
                </div>
                {ohMode === 'all' ? (
                    <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium">Cả tuần:</span>
                        <TimeInput value={ohAll.open} onChange={(v) => setOhAll({ ...ohAll, open: v })} className={inp + ' !w-32'} />
                        <span className="text-gray-400">–</span>
                        <TimeInput value={ohAll.close} onChange={(v) => setOhAll({ ...ohAll, close: v })} className={inp + ' !w-32'} />
                    </div>
                ) : (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                        {DAYS.map((d, i) => {
                            const cfg = ohDays[i] || { open: '06:30', close: '22:00', off: false };
                            return (
                                <div key={i} className="flex items-center gap-2 px-3 py-2 border-b border-gray-50 last:border-0">
                                    <span className="text-[13px] font-medium w-16">{d}</span>
                                    <TimeInput value={cfg.open} disabled={cfg.off}
                                        onChange={(v) => setOhDays({ ...ohDays, [i]: { ...cfg, open: v } })}
                                        className={inp + ' !w-28 !py-1.5'} />
                                    <span className="text-gray-400">–</span>
                                    <TimeInput value={cfg.close} disabled={cfg.off}
                                        onChange={(v) => setOhDays({ ...ohDays, [i]: { ...cfg, close: v } })}
                                        className={inp + ' !w-28 !py-1.5'} />
                                    <label className="flex items-center gap-1.5 text-[12px] text-gray-500 ml-auto cursor-pointer">
                                        <input type="checkbox" checked={!!cfg.off}
                                            onChange={(e) => setOhDays({ ...ohDays, [i]: { ...cfg, off: e.target.checked } })} />
                                        Nghỉ
                                    </label>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3 mt-5">
                <button onClick={save} className="m-btn m-btn-primary">
                    {editingId ? 'Cập nhật' : 'Thêm chi nhánh'}
                </button>
                {editingId && <button onClick={resetForm} className="text-sm text-gray-500">Hủy</button>}
            </div>
        </div>
    );
};

// Gói 7p (2026-10-05): Trang Thiết lập — Đại Vương tự pick màu chủ đạo giao diện.
const Settings = () => {
    const [primary, setPrimary] = useState(DEFAULT_PRIMARY);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    // Gói 8a: thuế & giá
    const [defaultTaxRate, setDefaultTaxRate] = useState('8');
    const [savingTax, setSavingTax] = useState(false);
    const [taxMsg, setTaxMsg] = useState('');
    // Gói 8f: số thập phân
    const [decimals, setDecimals] = useState({ price: 0, quantity: 1, tax: 0, discount: 0 });
    const [savingDec, setSavingDec] = useState(false);
    const [decMsg, setDecMsg] = useState('');
    // Gói 47: font chữ
    const [font, setFont] = useState(DEFAULT_FONT);
    const [savingFont, setSavingFont] = useState(false);
    // Gói 49c: thời gian trượt banner KM
    const [slideInt, setSlideInt] = useState('5');
    const [savingSlide, setSavingSlide] = useState(false);
    const [slideMsg, setSlideMsg] = useState('');
    const [fontMsg, setFontMsg] = useState('');
    // Gói 55 p11ab: quy tắc sinh mã
    const CODE_TYPES = [
        { key: 'member', label: 'Mã thành viên', withDate: false },
        { key: 'invoice', label: 'Mã hóa đơn', withDate: false },
        { key: 'material', label: 'Mã nguyên liệu', withDate: false },
        { key: 'product', label: 'Mã mặt hàng', withDate: false },
        { key: 'inbound', label: 'Mã phiếu nhập', withDate: true },
        { key: 'outbound', label: 'Mã phiếu xuất', withDate: true },
        { key: 'transfer', label: 'Mã phiếu chuyển', withDate: true },
        { key: 'stocktake', label: 'Mã phiếu kiểm kê', withDate: false },
    ];
    const CODE_DEFAULTS = {
        member: ['TV', 6], invoice: ['HD', 6], material: ['NL', 4], product: ['SP', 4],
        inbound: ['PN', 4], outbound: ['XK', 4], transfer: ['CK', 4], stocktake: ['KK', 4],
    };
    const [codeRules, setCodeRules] = useState(() => {
        const o = {};
        Object.entries(CODE_DEFAULTS).forEach(([k, [p, d]]) => { o[k] = { prefix: p, digits: d }; });
        return o;
    });
    const [savingCode, setSavingCode] = useState(false);
    const [codeMsg, setCodeMsg] = useState('');

    useEffect(() => {
        setPrimary(getStoredTheme() || DEFAULT_PRIMARY);
        setFont(getStoredFont() || DEFAULT_FONT); // Gói 47
        (async () => {
            try {
                const res = await axios.get(API + '/settings/theme');
                if (res.data && res.data.primary) setPrimary(res.data.primary.toUpperCase());
            } catch (e) { /* giữ màu local */ }
        })();
        // Gói 8a: nạp cấu hình thuế
        (async () => {
            try {
                const res = await axios.get(API + '/settings');
                if (res.data) {
                    setDefaultTaxRate(String(res.data.default_tax_rate ?? '8'));
                    // Gói 8f: số thập phân
                    setDecimals({
                        price: Number(res.data.decimals_price ?? 0),
                        quantity: Number(res.data.decimals_quantity ?? 1),
                        tax: Number(res.data.decimals_tax ?? 0),
                        discount: Number(res.data.decimals_discount ?? 0),
                    });
                    // Gói 47: font chữ
                    if (res.data.font_family) setFont(res.data.font_family);
                    // Gói 49c: thời gian trượt banner
                    if (res.data.promo_slide_interval) setSlideInt(String(res.data.promo_slide_interval));
                    // Gói 55 p11ab: quy tắc sinh mã
                    setCodeRules((prev) => {
                        const next = { ...prev };
                        Object.keys(CODE_DEFAULTS).forEach((k) => {
                            const p = res.data['code_prefix_' + k];
                            const d = res.data['code_digits_' + k];
                            next[k] = {
                                prefix: p !== undefined && p !== '' ? String(p) : CODE_DEFAULTS[k][0],
                                digits: d !== undefined && d !== '' ? Math.max(1, Math.min(10, Number(d) || CODE_DEFAULTS[k][1])) : CODE_DEFAULTS[k][1],
                            };
                        });
                        return next;
                    });
                }
            } catch (e) { /* giữ mặc định */ }
        })();
    }, []);

    const pick = (hex) => {
        const v = hex.toUpperCase();
        setPrimary(v);
        applyThemeColor(v); // xem trước ngay
        setMsg('');
    };

    const save = async () => {
        setSaving(true);
        setMsg('');
        try {
            await axios.post(API + '/settings', { settings: { theme_primary: primary } });
            applyThemeColor(primary);
            setMsg('Đã lưu màu chủ đạo. Áp dụng cho cả web admin, POS và Mini App.');
        } catch (e) {
            setMsg('Lưu thất bại, thử lại.');
        } finally {
            setSaving(false);
        }
    };

    // Gói 47: font chữ
    const pickFont = (family) => {
        setFont(family);
        applyFont(family); // xem trước ngay
        setFontMsg('');
    };
    const saveFont = async () => {
        setSavingFont(true);
        setFontMsg('');
        try {
            await axios.post(API + '/settings', { settings: { font_family: font } });
            applyFont(font);
            setFontMsg('Đã lưu font chữ. Áp dụng cho web admin.');
        } catch (e) {
            setFontMsg('Lưu thất bại, thử lại.');
        } finally {
            setSavingFont(false);
        }
    };

    return (
        <AdminLayout>
            <div className="p-6 max-w-[900px] mx-auto">
                <h1 className="text-[22px] font-bold text-[var(--m-ink)] mb-1">Thiết lập</h1>
                <p className="text-sm mb-6" style={{ color: 'var(--m-ink-soft)' }}>Cấu hình chung của hệ thống</p>

                <div className="m-card p-6">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Màu chủ đạo giao diện</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Chọn màu Đại Vương thích — áp dụng ngay cho sidebar, nút bấm, biểu đồ trên web admin, POS và Zalo Mini App.
                    </p>

                    {/* Màu gợi ý */}
                    <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--m-ink-faint)' }}>Màu gợi ý</div>
                    <div className="flex flex-wrap gap-3 mb-6">
                        {THEME_PRESETS.map((p) => (
                            <button
                                key={p.value}
                                onClick={() => pick(p.value)}
                                title={p.name}
                                className="flex flex-col items-center gap-1 group"
                            >
                                <span
                                    className="w-11 h-11 rounded-full border-2 transition-transform group-hover:scale-110"
                                    style={{
                                        background: p.value,
                                        borderColor: primary === p.value ? 'var(--m-ink)' : 'var(--m-line)',
                                        boxShadow: primary === p.value ? '0 0 0 3px var(--m-accent-soft)' : 'none',
                                    }}
                                />
                                <span className="text-[11px]" style={{ color: 'var(--m-ink-soft)' }}>{p.name}</span>
                            </button>
                        ))}
                    </div>

                    {/* Tự pick */}
                    <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--m-ink-faint)' }}>Tự chọn màu</div>
                    <div className="flex items-center gap-4 mb-6">
                        <input
                            type="color"
                            value={primary}
                            onChange={(e) => pick(e.target.value)}
                            className="w-14 h-14 p-1 rounded-lg cursor-pointer border"
                            style={{ borderColor: 'var(--m-line)', background: 'var(--m-surface)' }}
                        />
                        <div>
                            <div className="font-mono text-sm font-bold text-[var(--m-ink)]">{primary}</div>
                            <div className="text-xs" style={{ color: 'var(--m-ink-faint)' }}>Bấm vào ô màu để mở bảng chọn</div>
                        </div>
                        {/* Preview */}
                        <div className="flex items-center gap-2 ml-4">
                            <span className="m-btn m-btn-primary !py-2 !px-4 text-sm pointer-events-none">Nút bấm</span>
                            <span className="m-badge pointer-events-none" style={{ background: 'var(--m-accent-soft)', color: 'var(--m-primary)' }}>Badge</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={save} disabled={saving} className="m-btn m-btn-primary" style={saving ? { opacity: 0.5 } : {}}>
                            {saving ? 'Đang lưu...' : 'Lưu màu chủ đạo'}
                        </button>
                        {msg && <span className="text-sm" style={{ color: 'var(--m-success)' }}>{msg}</span>}
                    </div>
                </div>

                {/* Gói 47: Font chữ */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Font chữ giao diện</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Tất cả font đều hỗ trợ đầy đủ tiếng Việt. Bấm để xem trước ngay trên toàn trang.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                        {FONT_PRESETS.map((f) => (
                            <button
                                key={f.family}
                                onClick={() => pickFont(f.family)}
                                className="text-left border-2 rounded-xl p-4 transition-all hover:shadow-md"
                                style={{ borderColor: font === f.family ? 'var(--m-primary)' : 'var(--m-line)', background: font === f.family ? 'var(--m-accent-soft)' : '#fff' }}
                            >
                                <div className="text-[18px] font-bold mb-1" style={{ fontFamily: `${f.family}, sans-serif` }}>{f.name}</div>
                                <div className="text-[13px] mb-1" style={{ fontFamily: `${f.family}, sans-serif`, color: 'var(--m-ink-soft)' }}>
                                    Cà phê sữa đá — 45.000đ
                                </div>
                                <div className="text-[11px]" style={{ color: 'var(--m-ink-faint)' }}>{f.desc}</div>
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={saveFont} disabled={savingFont} className="m-btn m-btn-primary" style={savingFont ? { opacity: 0.5 } : {}}>
                            {savingFont ? 'Đang lưu...' : 'Lưu font chữ'}
                        </button>
                        {fontMsg && <span className="text-sm" style={{ color: 'var(--m-success)' }}>{fontMsg}</span>}
                    </div>
                </div>

                {/* Gói 49c: thời gian trượt banner KM */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Banner khuyến mại (Zalo Mini App)</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Banner hiển thị dạng slider trong mục Thành viên trên Mini App. Tải ảnh banner tại trang Khuyến mại.
                    </p>
                    <div className="flex items-center gap-3">
                        <label className="text-sm font-medium" style={{ color: 'var(--m-ink)' }}>Tự chuyển ảnh sau mỗi</label>
                        <input type="number" min="2" max="30" value={slideInt} onChange={(e) => setSlideInt(e.target.value)}
                            className="!w-[76px] m-input text-center" />
                        <span className="text-sm" style={{ color: 'var(--m-ink-soft)' }}>giây</span>
                        <button onClick={async () => {
                            setSavingSlide(true); setSlideMsg('');
                            try {
                                await axios.post(API + '/settings', { settings: { promo_slide_interval: slideInt } });
                                setSlideMsg('Đã lưu.');
                            } catch (e) { setSlideMsg('Lưu thất bại.'); }
                            finally { setSavingSlide(false); }
                        }} disabled={savingSlide} className="m-btn m-btn-primary" style={savingSlide ? { opacity: 0.5 } : {}}>
                            {savingSlide ? 'Đang lưu...' : 'Lưu'}
                        </button>
                        {slideMsg && <span className="text-sm" style={{ color: 'var(--m-success)' }}>{slideMsg}</span>}
                    </div>
                </div>

                {/* Gói 8a: Thuế & giá */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Thuế & giá</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Cấu hình chung về thuế GTGT. Món nào có thuế suất riêng thì đặt tại form Mặt hàng (tab Thuế).
                    </p>
                    <div className="space-y-4 max-w-md">
                        <div>
                            <label className="m-label">Thuế suất mặc định (%)</label>
                            <input type="number" min="0" max="100" step="0.5" value={defaultTaxRate}
                                onChange={(e) => setDefaultTaxRate(e.target.value)}
                                className="m-input !w-40" placeholder="VD: 8" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 mt-5">
                        <button
                            onClick={async () => {
                                setSavingTax(true); setTaxMsg('');
                                try {
                                    await axios.post(API + '/settings', {
                                        settings: {
                                            default_tax_rate: String(Number(defaultTaxRate) || 0),
                                        },
                                    });
                                    setTaxMsg('Đã lưu cấu hình thuế.');
                                } catch (e) { setTaxMsg('Lưu thất bại, thử lại.'); }
                                finally { setSavingTax(false); }
                            }}
                            disabled={savingTax} className="m-btn m-btn-primary" style={savingTax ? { opacity: 0.5 } : {}}>
                            {savingTax ? 'Đang lưu...' : 'Lưu cấu hình thuế'}
                        </button>
                        {taxMsg && <span className="text-sm" style={{ color: 'var(--m-success)' }}>{taxMsg}</span>}
                    </div>
                </div>

                {/* Gói 8f: Số thập phân */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Số thập phân</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Tùy chỉnh số chữ số thập phân hiển thị cho từng loại số liệu (0–4).
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl">
                        {DECIMAL_LABELS.map((d) => (
                            <div key={d.key}>
                                <label className="m-label">{d.label}</label>
                                <input type="number" min="0" max="4" step="1"
                                    value={decimals[d.key]}
                                    onChange={(e) => {
                                        const v = Math.max(0, Math.min(4, Number(e.target.value) || 0));
                                        setDecimals((p) => ({ ...p, [d.key]: v }));
                                    }}
                                    className="m-input" />
                                <span className="text-xs" style={{ color: 'var(--m-ink-faint)' }}>{d.hint}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-3 mt-5">
                        <button
                            onClick={async () => {
                                setSavingDec(true); setDecMsg('');
                                try {
                                    await axios.post(API + '/settings', {
                                        settings: {
                                            decimals_price: String(decimals.price),
                                            decimals_quantity: String(decimals.quantity),
                                            decimals_tax: String(decimals.tax),
                                            decimals_discount: String(decimals.discount),
                                        },
                                    });
                                    try { localStorage.setItem('number_decimals', JSON.stringify(decimals)); } catch (e) {}
                                    setDecMsg('Đã lưu. Tải lại trang để áp dụng hiển thị.');
                                } catch (e) { setDecMsg('Lưu thất bại, thử lại.'); }
                                finally { setSavingDec(false); }
                            }}
                            disabled={savingDec} className="m-btn m-btn-primary" style={savingDec ? { opacity: 0.5 } : {}}>
                            {savingDec ? 'Đang lưu...' : 'Lưu số thập phân'}
                        </button>
                        {decMsg && <span className="text-sm" style={{ color: 'var(--m-success)' }}>{decMsg}</span>}
                    </div>
                </div>

                {/* Gói 55 p11ab: Quy tắc sinh mã */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Quy tắc sinh mã</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Cấu hình tiền tố và số chữ số cho từng loại mã. Áp dụng cho mã mới sinh ra sau khi lưu.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px] min-w-[560px]">
                            <thead>
                                <tr className="text-left text-gray-500 border-b border-gray-100">
                                    <th className="py-2 pr-3 font-medium">Loại mã</th>
                                    <th className="py-2 pr-3 font-medium" style={{ width: 130 }}>Tiền tố</th>
                                    <th className="py-2 pr-3 font-medium" style={{ width: 110 }}>Số chữ số</th>
                                    <th className="py-2 font-medium">Xem trước</th>
                                </tr>
                            </thead>
                            <tbody>
                                {CODE_TYPES.map((t) => {
                                    const r = codeRules[t.key] || { prefix: '', digits: 4 };
                                    const datePart = t.withDate ? new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' : '';
                                    const preview = r.prefix + '-' + datePart + '1'.padStart(Math.max(1, r.digits), '0');
                                    return (
                                        <tr key={t.key} className="border-b border-gray-50">
                                            <td className="py-2 pr-3 font-medium">{t.label}</td>
                                            <td className="py-2 pr-3">
                                                <input value={r.prefix}
                                                    onChange={(e) => setCodeRules((p) => ({ ...p, [t.key]: { ...p[t.key], prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) } }))}
                                                    className="m-input !py-1.5" placeholder="VD: XK" />
                                            </td>
                                            <td className="py-2 pr-3">
                                                <input type="number" min="1" max="10"
                                                    value={r.digits}
                                                    onChange={(e) => {
                                                        const v = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                                                        setCodeRules((p) => ({ ...p, [t.key]: { ...p[t.key], digits: v } }));
                                                    }}
                                                    className="m-input !py-1.5" />
                                            </td>
                                            <td className="py-2">
                                                <code className="px-2 py-1 rounded text-[12px] font-semibold" style={{ background: 'var(--m-bg-soft)', color: 'var(--m-primary)' }}>{preview}</code>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center gap-3 mt-5">
                        <button
                            onClick={async () => {
                                setSavingCode(true); setCodeMsg('');
                                try {
                                    const settings = {};
                                    Object.keys(CODE_DEFAULTS).forEach((k) => {
                                        settings['code_prefix_' + k] = codeRules[k].prefix;
                                        settings['code_digits_' + k] = String(codeRules[k].digits);
                                    });
                                    await axios.post(API + '/settings', { settings });
                                    setCodeMsg('Đã lưu quy tắc sinh mã. Áp dụng cho mã mới.');
                                } catch (e) { setCodeMsg('Lưu thất bại, thử lại.'); }
                                finally { setSavingCode(false); }
                            }}
                            disabled={savingCode} className="m-btn m-btn-primary" style={savingCode ? { opacity: 0.5 } : {}}>
                            {savingCode ? 'Đang lưu...' : 'Lưu quy tắc sinh mã'}
                        </button>
                        {codeMsg && <span className="text-sm" style={{ color: 'var(--m-success)' }}>{codeMsg}</span>}
                    </div>
                </div>

                {/* Gói 22: Quản lý chi nhánh */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Chi nhánh</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Thêm/sửa/bật-tắt chi nhánh. Tọa độ dùng để tính phí ship cho đơn Zalo Mini App.
                    </p>
                    <BranchManager />
                </div>

                {/* Gói 52: Phương thức thanh toán */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Phương thức thanh toán</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Thêm/sửa/xóa phương thức. Bấm chip POS/Zalo để bật/tắt theo kênh bán.
                    </p>
                    <PaymentMethodManager />
                </div>

                {/* Gói 55: Tên thay thế món (alias) */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Tên thay thế món</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Map tên món cũ (từ file Excel/app khác) về món hiện tại để import đúng.
                    </p>
                    <ProductAliasManager />
                </div>

                {/* Gói 52: Đơn vị tính */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Đơn vị tính</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Dùng chung toàn hệ thống — chọn trong các chức năng nhập liệu.
                    </p>
                    <UnitManager />
                </div>

                {/* Gói 52: Mẫu in */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Mẫu in Bill & Tem</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Bật/tắt từng dòng và sửa nội dung. Bill khổ K80, tem 50×30.
                    </p>
                    <PrintTemplateSettings />
                </div>
            </div>
        </AdminLayout>
    );
};

export default Settings;
