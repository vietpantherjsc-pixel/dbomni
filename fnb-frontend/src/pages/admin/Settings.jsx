import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';
import { applyThemeColor, getStoredTheme, DEFAULT_PRIMARY, THEME_PRESETS } from '../../utils/theme';
import { DECIMAL_LABELS } from '../../utils/number';

// Gói 26 (2026-10-09): Cấu hình phụ cấp ăn, tỷ lệ BHXH, ngày lễ.
const PayrollConfig = () => {
    const [cfg, setCfg] = useState({ meal_allowance_min_hours: '8', meal_allowance_amount: '25000', bhxh_emp_bhxh: '8', bhxh_emp_bhyt: '1.5', bhxh_emp_bhtn: '1', bhxh_employer_rate: '21.5' });
    const [holidays, setHolidays] = useState([]);
    const [hForm, setHForm] = useState({ date: '', name: '', multiplier: '2' });
    const [msg, setMsg] = useState('');

    const fetchAll = async () => {
        try {
            const [s, h] = await Promise.all([axios.get('http://localhost/api/settings'), axios.get('http://localhost/api/holidays')]);
            const data = s.data?.data || s.data || {};
            const get = (k, d) => data[k] ?? data?.settings?.[k] ?? d;
            setCfg({
                meal_allowance_min_hours: String(get('meal_allowance_min_hours', '8')),
                meal_allowance_amount: String(get('meal_allowance_amount', '25000')),
                bhxh_emp_bhxh: String(get('bhxh_emp_bhxh', '8')),
                bhxh_emp_bhyt: String(get('bhxh_emp_bhyt', '1.5')),
                bhxh_emp_bhtn: String(get('bhxh_emp_bhtn', '1')),
                bhxh_employer_rate: String(get('bhxh_employer_rate', '21.5')),
            });
            setHolidays(h.data?.data || []);
        } catch (e) { /* bỏ qua */ }
    };
    useEffect(() => { fetchAll(); }, []);

    const save = async () => {
        try {
            await axios.post('http://localhost/api/settings', { settings: cfg });
            setMsg('Đã lưu cấu hình.');
        } catch (e) { setMsg('Lưu thất bại.'); }
    };
    const addHoliday = async () => {
        if (!hForm.date || !hForm.name.trim()) return alert('Nhập ngày và tên ngày lễ');
        try {
            await axios.post('http://localhost/api/holidays', { date: hForm.date, name: hForm.name.trim(), multiplier: Number(hForm.multiplier) || 2 });
            setHForm({ date: '', name: '', multiplier: '2' }); fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Thêm thất bại'); }
    };

    const F = [
        ['meal_allowance_min_hours', 'Số giờ tối thiểu/ngày để hưởng phụ cấp ăn'],
        ['meal_allowance_amount', 'Mức phụ cấp ăn/suất (đ)'],
        ['bhxh_emp_bhxh', 'BHXH NLĐ đóng (%)'],
        ['bhxh_emp_bhyt', 'BHYT NLĐ đóng (%)'],
        ['bhxh_emp_bhtn', 'BHTN NLĐ đóng (%)'],
        ['bhxh_employer_rate', 'DN đóng (%)'],
    ];
    return (
        <div>
            <div className="grid sm:grid-cols-2 gap-4 max-w-xl mb-4">
                {F.map(([k, label]) => (
                    <div key={k}><label className="m-label">{label}</label>
                        <input type="number" step="any" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} className="m-input w-40" /></div>
                ))}
            </div>
            <button onClick={save} className="m-btn m-btn-primary">Lưu cấu hình</button>
            {msg && <span className="text-sm ml-3" style={{ color: 'var(--m-success)' }}>{msg}</span>}

            <h3 className="font-bold text-[14px] mt-6 mb-2">Ngày lễ & hệ số nhân lương</h3>
            <div className="overflow-x-auto border border-gray-100 rounded-lg mb-3">
                <table className="w-full text-[13px] min-w-[480px]">
                    <thead><tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-2.5 font-medium">Ngày</th><th className="px-3 py-2.5 font-medium">Tên</th>
                        <th className="px-3 py-2.5 font-medium text-center">Hệ số</th><th className="px-4 py-2.5"></th>
                    </tr></thead>
                    <tbody>
                        {holidays.map((h) => (
                            <tr key={h.id} className="border-b border-gray-50">
                                <td className="px-4 py-2.5">{fmtDate(h.date)}</td><td className="px-3 py-2.5">{h.name}</td>
                                <td className="px-3 py-2.5 text-center">×{h.multiplier}</td>
                                <td className="px-4 py-2.5 text-right"><button onClick={async () => { if (window.confirm('Xóa ngày lễ này?')) { await axios.delete('http://localhost/api/holidays/' + h.id); fetchAll(); } }} className="text-red-500 text-[12px]">Xóa</button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap gap-2 items-end">
                <div><label className="m-label">Ngày</label><DateInput value={hForm.date} onChange={(v) => setHForm({ ...hForm, date: v })} className="m-input" /></div>
                <div><label className="m-label">Tên ngày lễ</label><input value={hForm.name} onChange={(e) => setHForm({ ...hForm, name: e.target.value })} placeholder="VD: Tết Dương lịch" className="m-input w-48" /></div>
                <div><label className="m-label">Hệ số</label><input type="number" step="0.5" min="1" value={hForm.multiplier} onChange={(e) => setHForm({ ...hForm, multiplier: e.target.value })} className="m-input w-24" /></div>
                <button onClick={addHoliday} className="m-btn m-btn-primary">+ Thêm</button>
            </div>
        </div>
    );
};

// Gói 22 (2026-10-09): Quản lý chi nhánh ngay trong Thiết lập.
const BranchManager = () => {
    const [list, setList] = useState([]);
    const [form, setForm] = useState({ code: '', name: '', phone: '', address: '', latitude: '', longitude: '' });
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState('');

    const fetchList = async () => {
        try {
            const res = await axios.get('http://localhost/api/branches');
            if (res.data?.success) setList(res.data.data || []);
        } catch (e) { /* bỏ qua */ }
    };
    useEffect(() => { fetchList(); }, []);

    const resetForm = () => {
        setEditingId(null);
        setForm({ code: '', name: '', phone: '', address: '', latitude: '', longitude: '' });
    };

    const startEdit = (b) => {
        setEditingId(b.id);
        setForm({
            code: b.code || '', name: b.name || '', phone: b.phone || '',
            address: b.address || '', latitude: b.latitude ?? '', longitude: b.longitude ?? '',
        });
        setMsg('');
    };

    const save = async () => {
        if (!form.code.trim() || !form.name.trim()) return alert('Nhập mã và tên chi nhánh');
        try {
            const payload = {
                code: form.code.trim(), name: form.name.trim(),
                phone: form.phone.trim() || null, address: form.address.trim() || null,
                latitude: form.latitude === '' ? null : Number(form.latitude),
                longitude: form.longitude === '' ? null : Number(form.longitude),
            };
            if (editingId) {
                await axios.patch('http://localhost/api/branches/' + editingId, payload);
                setMsg('Đã cập nhật chi nhánh.');
            } else {
                if (!payload.address) return alert('Nhập địa chỉ chi nhánh');
                if (payload.latitude == null || payload.longitude == null) return alert('Nhập vĩ độ / kinh độ để tính phí ship');
                await axios.post('http://localhost/api/branches', payload);
                setMsg('Đã thêm chi nhánh.');
            }
            resetForm(); fetchList();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };

    const toggleActive = async (b) => {
        try {
            await axios.patch('http://localhost/api/branches/' + b.id, { is_active: !b.is_active });
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
    const [priceIncludesTax, setPriceIncludesTax] = useState(true);
    const [defaultTaxRate, setDefaultTaxRate] = useState('8');
    const [savingTax, setSavingTax] = useState(false);
    const [taxMsg, setTaxMsg] = useState('');
    // Gói 8f: số thập phân
    const [decimals, setDecimals] = useState({ price: 0, quantity: 1, tax: 0, discount: 0 });
    const [savingDec, setSavingDec] = useState(false);
    const [decMsg, setDecMsg] = useState('');

    useEffect(() => {
        setPrimary(getStoredTheme() || DEFAULT_PRIMARY);
        (async () => {
            try {
                const res = await axios.get('http://localhost/api/settings/theme');
                if (res.data && res.data.primary) setPrimary(res.data.primary.toUpperCase());
            } catch (e) { /* giữ màu local */ }
        })();
        // Gói 8a: nạp cấu hình thuế
        (async () => {
            try {
                const res = await axios.get('http://localhost/api/settings');
                if (res.data) {
                    setPriceIncludesTax(res.data.price_includes_tax !== '0');
                    setDefaultTaxRate(String(res.data.default_tax_rate ?? '8'));
                    // Gói 8f: số thập phân
                    setDecimals({
                        price: Number(res.data.decimals_price ?? 0),
                        quantity: Number(res.data.decimals_quantity ?? 1),
                        tax: Number(res.data.decimals_tax ?? 0),
                        discount: Number(res.data.decimals_discount ?? 0),
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
            await axios.post('http://localhost/api/settings', { settings: { theme_primary: primary } });
            applyThemeColor(primary);
            setMsg('Đã lưu màu chủ đạo. Áp dụng cho cả web admin, POS và Mini App.');
        } catch (e) {
            setMsg('Lưu thất bại, thử lại.');
        } finally {
            setSaving(false);
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

                {/* Gói 8a: Thuế & giá */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Thuế & giá</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Cấu hình chung về thuế GTGT. Món nào có thuế suất riêng thì đặt tại form Mặt hàng (tab Thuế).
                    </p>
                    <div className="space-y-4 max-w-md">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" checked={priceIncludesTax}
                                onChange={(e) => setPriceIncludesTax(e.target.checked)}
                                className="w-4 h-4 mt-1 accent-[#24305E]" />
                            <span>
                                <span className="block text-sm font-semibold" style={{ color: 'var(--m-ink)' }}>Giá bán đã bao gồm thuế</span>
                                <span className="block text-xs" style={{ color: 'var(--m-ink-faint)' }}>Bật = giá niêm yết đã gồm VAT · Tắt = VAT tính cộng thêm khi thanh toán</span>
                            </span>
                        </label>
                        <div>
                            <label className="m-label">Thuế suất mặc định (%)</label>
                            <input type="number" min="0" max="100" step="0.5" value={defaultTaxRate}
                                onChange={(e) => setDefaultTaxRate(e.target.value)}
                                className="m-input w-40" placeholder="VD: 8" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 mt-5">
                        <button
                            onClick={async () => {
                                setSavingTax(true); setTaxMsg('');
                                try {
                                    await axios.post('http://localhost/api/settings', {
                                        settings: {
                                            price_includes_tax: priceIncludesTax ? '1' : '0',
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
                                    await axios.post('http://localhost/api/settings', {
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

                {/* Gói 26: Phụ cấp ăn & tỷ lệ BHXH */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Phụ cấp ăn & BHXH</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Mức phụ cấp tiền ăn/suất, tỷ lệ BHXH (NLĐ + DN) và danh sách ngày lễ với hệ số nhân lương.
                    </p>
                    <PayrollConfig />
                </div>

                {/* Gói 22: Quản lý chi nhánh */}
                <div className="m-card p-6 mt-4">
                    <h2 className="text-[16px] font-bold text-[var(--m-ink)] mb-1">Chi nhánh</h2>
                    <p className="text-sm mb-5" style={{ color: 'var(--m-ink-soft)' }}>
                        Thêm/sửa/bật-tắt chi nhánh. Tọa độ dùng để tính phí ship cho đơn Zalo Mini App.
                    </p>
                    <BranchManager />
                </div>
            </div>
        </AdminLayout>
    );
};

export default Settings;
