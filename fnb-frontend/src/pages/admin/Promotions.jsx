import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import DateTimeInput from '../../components/DateTimeInput';
import TimeInput from '../../components/TimeInput';
import { fmtDate, fmtDateTime } from '../../utils/format';

const API = 'http://localhost/api';

const TYPE_LABELS = { percent: 'Theo phần trăm', fixed: 'Theo số tiền', fixed_price: 'Đồng giá', gift: 'Tặng món', shipping: '🚚 Giảm/miễn phí vận chuyển' };
const SCOPE_LABELS = { order: 'Hóa đơn', category: 'Danh mục', menu: 'Thực đơn', product: 'Mặt hàng' };
const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// =====================================================================
// Gói 10 (2026-10-05): đồng bộ UI matcha + fix load danh mục/mặt hàng
// (API /categories và /products trả mảng trần, không bọc {data}) +
// thêm phạm vi Thực đơn.
// =====================================================================
export default function Promotions() {
    const [list, setList] = useState([]);
    const [page, setPage] = useState(1);
    const [lastPage, setLastPage] = useState(1);
    const [mode, setMode] = useState('list'); // list | form
    const [editing, setEditing] = useState(null);
    const [categories, setCategories] = useState([]);
    const [menus, setMenus] = useState([]);
    const [products, setProducts] = useState([]);
    const [tiers, setTiers] = useState([]);

    const emptyForm = () => ({
        name: '', type: 'percent', value: '', scope: 'order', scope_ids: [],
        min_order_amount: 0, max_discount_amount: '', gift_product_id: '', gift_quantity: 1,
        target: 'all', tier_ids: [], starts_at: '', expires_at: '', has_expires: false,
        days_of_week: [], use_days: false, time_from: '', time_to: '', use_time: false,
        channels: ['pos'], is_active: true,
    });
    const [form, setForm] = useState(emptyForm());

    const fetchList = async (p = 1) => {
        try {
            const res = await axios.get(`${API}/promotions`, { params: { page: p } });
            if (res.data?.success) {
                setList(res.data.data.data || []);
                setPage(res.data.data.current_page || 1);
                setLastPage(res.data.data.last_page || 1);
            }
        } catch (err) { console.error('Lỗi tải KM:', err); }
    };

    // Gói 10: /categories và /products trả MẢNG TRẦN (không bọc {data}) -> xử lý cả 2 dạng
    const asArray = (res) => {
        const d = res.data;
        if (Array.isArray(d)) return d;
        if (Array.isArray(d?.data)) return d.data;
        return [];
    };

    const fetchMeta = async () => {
        try {
            const [cRes, mRes, pRes, tRes] = await Promise.all([
                axios.get(`${API}/categories`),
                axios.get(`${API}/menus`),
                axios.get(`${API}/products`),
                axios.get(`${API}/membership-tiers`),
            ]);
            setCategories(asArray(cRes));
            const mData = mRes.data?.success ? mRes.data.data : mRes.data;
            setMenus(Array.isArray(mData) ? mData : []);
            setProducts(asArray(pRes));
            setTiers(tRes.data?.data || []);
        } catch (err) { console.error('Lỗi tải meta:', err); }
    };

    useEffect(() => { fetchList(); fetchMeta(); }, []);

    const startCreate = () => { setEditing(null); setForm(emptyForm()); setMode('form'); };
    const startEdit = async (id) => {
        try {
            const res = await axios.get(`${API}/promotions/${id}`);
            if (res.data?.success) {
                const p = res.data.data;
                setEditing(id);
                setForm({
                    name: p.name, type: p.type, value: p.value ?? '', scope: p.scope, scope_ids: p.scope_ids || [],
                    min_order_amount: p.min_order_amount ?? 0, max_discount_amount: p.max_discount_amount ?? '',
                    gift_product_id: p.gift_product_id || '', gift_quantity: p.gift_quantity || 1,
                    target: p.target, tier_ids: p.tier_ids || [],
                    starts_at: p.starts_at ? p.starts_at.slice(0, 16) : '', expires_at: p.expires_at ? p.expires_at.slice(0, 16) : '',
                    has_expires: !!p.expires_at,
                    days_of_week: p.days_of_week || [], use_days: !!(p.days_of_week && p.days_of_week.length),
                    time_from: p.time_from ? p.time_from.slice(0, 5) : '', time_to: p.time_to ? p.time_to.slice(0, 5) : '',
                    use_time: !!(p.time_from && p.time_to),
                    channels: p.channels || ['pos'], is_active: !!p.is_active,
                });
                setMode('form');
            }
        } catch (err) { alert('Tải KM thất bại'); }
    };

    const toggleArr = (arr, v) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

    const handleSave = async () => {
        if (!form.name.trim()) return alert('Nhập tên khuyến mại');
        if (form.type !== 'gift' && form.type !== 'shipping' && !(Number(form.value) > 0)) return alert('Nhập giá trị khuyến mại');
        if (form.type === 'gift' && !form.gift_product_id) return alert('Chọn món tặng');
        if (form.type !== 'shipping' && form.scope !== 'order' && form.scope_ids.length === 0) return alert(`Chọn ít nhất 1 ${SCOPE_LABELS[form.scope].toLowerCase()} áp dụng`);
        try {
            const payload = {
                name: form.name.trim(), type: form.type,
                value: form.type === 'gift' ? null : Number(form.value),
                scope: form.type === 'shipping' ? 'order' : form.scope, // Gói 10c: KM ship luôn áp dụng cả hóa đơn
                scope_ids: form.scope === 'order' ? null : form.scope_ids,
                min_order_amount: Number(form.min_order_amount) || 0,
                max_discount_amount: form.max_discount_amount ? Number(form.max_discount_amount) : null,
                gift_product_id: form.type === 'gift' ? Number(form.gift_product_id) : null,
                gift_quantity: Number(form.gift_quantity) || 1,
                target: form.target, tier_ids: form.target === 'tier' ? form.tier_ids : null,
                starts_at: form.starts_at || null,
                expires_at: form.has_expires ? (form.expires_at || null) : null,
                days_of_week: form.use_days ? form.days_of_week : null,
                time_from: form.use_time ? form.time_from : null,
                time_to: form.use_time ? form.time_to : null,
                channels: form.channels, is_active: form.is_active,
            };
            const res = editing
                ? await axios.patch(`${API}/promotions/${editing}`, payload)
                : await axios.post(`${API}/promotions`, payload);
            if (res.data?.success) { setMode('list'); fetchList(page); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Xóa khuyến mại này?')) return;
        await axios.delete(`${API}/promotions/${id}`);
        fetchList(page);
    };

    const toggleActive = async (p) => {
        await axios.patch(`${API}/promotions/${p.id}`, { is_active: !p.is_active });
        fetchList(page);
    };

    const valueLabel = () => {
        switch (form.type) {
            case 'percent': return 'Giảm giá (%)';
            case 'fixed': return 'Giảm giá (đ)';
            case 'fixed_price': return 'Giá đồng giá (đ)';
            case 'shipping': return 'Số tiền giảm phí ship (để 0 = miễn phí hoàn toàn)';
            default: return '';
        }
    };

    const summaryText = () => {
        if (form.type === 'percent') return `${form.value || 0}%`;
        if (form.type === 'fixed') return `${Number(form.value || 0).toLocaleString('vi-VN')}đ`;
        if (form.type === 'fixed_price') return `Đồng giá ${Number(form.value || 0).toLocaleString('vi-VN')}đ`;
        if (form.type === 'shipping') return Number(form.value) > 0 ? `Giảm ${Number(form.value).toLocaleString('vi-VN')}đ phí ship` : 'Miễn phí vận chuyển';
        const gp = products.find((p) => p.id === Number(form.gift_product_id));
        return `Tặng ${form.gift_quantity} × ${gp?.name || '...'}`;
    };

    const scopeItems = () => {
        if (form.scope === 'category') return categories;
        if (form.scope === 'menu') return menus;
        if (form.scope === 'product') return products;
        return [];
    };

    const Switch = ({ on, onClick }) => (
        <button type="button" onClick={onClick}
            style={{ width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: on ? 'var(--m-primary)' : '#d1d5db', transition: 'background .2s' }}>
            <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
        </button>
    );

    // ================= FORM =================
    if (mode === 'form') {
        return (
            <AdminLayout>
                <div className="p-6 max-w-[1200px] mx-auto">
                    <button onClick={() => setMode('list')} className="text-xs font-semibold hover:underline mb-2" style={{ color: 'var(--m-ink-soft)' }}>‹ Quay lại danh sách khuyến mại</button>
                    <h1 className="text-xl font-bold mb-4" style={{ color: 'var(--m-ink)' }}>{editing ? 'Sửa khuyến mại' : 'Thêm mới khuyến mại'}</h1>

                    <div className="grid lg:grid-cols-3 gap-4 items-start">
                        <div className="lg:col-span-2 space-y-4">
                            <div className="m-card p-4">
                                <label className="m-label">Tên khuyến mại <span style={{ color: 'var(--m-danger)' }}>*</span></label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="Nhập tên khuyến mại" className="m-input w-full" />
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Tùy chọn khuyến mại</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="m-label">Loại khuyến mại</label>
                                        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="m-input m-select w-full">
                                            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                        </select>
                                    </div>
                                    {form.type !== 'gift' ? (
                                        <div>
                                            <label className="m-label">{valueLabel()} <span style={{ color: 'var(--m-danger)' }}>*</span></label>
                                            <input type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                                                placeholder={form.type === 'percent' ? '0 %' : '0 đ'} className="m-input w-full" />
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="m-label">Món tặng <span style={{ color: 'var(--m-danger)' }}>*</span></label>
                                                <select value={form.gift_product_id} onChange={(e) => setForm({ ...form, gift_product_id: e.target.value })} className="m-input m-select w-full">
                                                    <option value="">-- Chọn món --</option>
                                                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="m-label">Số lượng tặng</label>
                                                <input type="number" min="1" value={form.gift_quantity} onChange={(e) => setForm({ ...form, gift_quantity: e.target.value })} className="m-input w-full" />
                                            </div>
                                        </>
                                    )}
                                </div>
                                {form.type === 'percent' && (
                                    <div className="grid grid-cols-2 gap-4 mt-3">
                                        <div>
                                            <label className="m-label">Giảm giá tối đa (đ)</label>
                                            <input type="number" min="0" value={form.max_discount_amount} onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value })}
                                                placeholder="Không giới hạn" className="m-input w-full" />
                                        </div>
                                        <div>
                                            <label className="m-label">Đơn tối thiểu (đ)</label>
                                            <input type="number" min="0" value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} className="m-input w-full" />
                                        </div>
                                    </div>
                                )}
                                {(form.type === 'fixed' || form.type === 'fixed_price' || form.type === 'shipping') && (
                                    <div className="mt-3 w-1/2 pr-2">
                                        <label className="m-label">Tổng tiền hóa đơn tối thiểu (đ) <span style={{ color: 'var(--m-danger)' }}>*</span></label>
                                        <input type="number" min="0" value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} className="m-input w-full" placeholder="VD: 100000" />
                                    </div>
                                )}
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Thời gian áp dụng</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="m-label">Ngày bắt đầu</label>
                                        <DateTimeInput value={form.starts_at} onChange={(v) => setForm({ ...form, starts_at: v })} className="m-input w-full" /></div>
                                    <div>
                                        <label className="flex items-center gap-2 text-xs mt-6" style={{ color: 'var(--m-ink-soft)' }}>
                                            <input type="checkbox" checked={form.has_expires} onChange={(e) => setForm({ ...form, has_expires: e.target.checked })} />
                                            Thời gian kết thúc
                                        </label>
                                        {form.has_expires && (
                                            <DateTimeInput value={form.expires_at} onChange={(v) => setForm({ ...form, expires_at: v })} className="m-input w-full" />
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid var(--m-line)' }}>
                                    <span className="text-sm">Áp dụng theo thứ trong tuần</span>
                                    <Switch on={form.use_days} onClick={() => setForm({ ...form, use_days: !form.use_days })} />
                                </div>
                                {form.use_days && (
                                    <div className="flex gap-2 mt-2">
                                        {DAYS.map((d, i) => (
                                            <button key={i} type="button" onClick={() => setForm({ ...form, days_of_week: toggleArr(form.days_of_week, i) })}
                                                className="m-btn m-btn-sm"
                                                style={form.days_of_week.includes(i)
                                                    ? { background: 'var(--m-primary)', color: '#fff', borderColor: 'var(--m-primary)' }
                                                    : {}}>
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--m-line)' }}>
                                    <span className="text-sm">Áp dụng theo khung giờ</span>
                                    <Switch on={form.use_time} onClick={() => setForm({ ...form, use_time: !form.use_time })} />
                                </div>
                                {form.use_time && (
                                    <div className="grid grid-cols-2 gap-4 mt-2">
                                        <div><label className="m-label">Từ</label>
                                            <TimeInput value={form.time_from} onChange={(v) => setForm({ ...form, time_from: v })} className="m-input w-full" /></div>
                                        <div><label className="m-label">Đến</label>
                                            <TimeInput value={form.time_to} onChange={(v) => setForm({ ...form, time_to: v })} className="m-input w-full" /></div>
                                    </div>
                                )}
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Áp dụng với</h3>
                                {form.type === 'shipping' ? (
                                    <div className="text-sm" style={{ color: 'var(--m-ink-soft)' }}>🚚 KM phí vận chuyển luôn áp dụng cho <b>cả hóa đơn</b> (không chọn phạm vi).</div>
                                ) : (
                                <div className="space-y-2">
                                    {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                                        <label key={k} className="flex items-center gap-2 text-sm">
                                            <input type="radio" checked={form.scope === k} onChange={() => setForm({ ...form, scope: k, scope_ids: [] })} />
                                            {v}
                                        </label>
                                    ))}
                                </div>
                                )}
                                {form.scope !== 'order' && (
                                    <div className="mt-3 max-h-44 overflow-y-auto rounded p-2" style={{ border: '1px solid var(--m-line)' }}>
                                        {scopeItems().map((it) => (
                                            <label key={it.id} className="flex items-center gap-2 text-sm py-1">
                                                <input type="checkbox" checked={form.scope_ids.includes(it.id)} onChange={() => setForm({ ...form, scope_ids: toggleArr(form.scope_ids, it.id) })} />
                                                {it.name}
                                            </label>
                                        ))}
                                        {scopeItems().length === 0 && <div className="text-xs py-2" style={{ color: 'var(--m-ink-faint)' }}>Chưa có dữ liệu.</div>}
                                    </div>
                                )}
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Đối tượng áp dụng</h3>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="radio" checked={form.target === 'all'} onChange={() => setForm({ ...form, target: 'all' })} />
                                        Tất cả khách hàng
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="radio" checked={form.target === 'tier'} onChange={() => setForm({ ...form, target: 'tier' })} />
                                        Thẻ thành viên
                                    </label>
                                </div>
                                {form.target === 'tier' && (
                                    <div className="mt-3 rounded p-2" style={{ border: '1px solid var(--m-line)' }}>
                                        {tiers.map((t) => (
                                            <label key={t.id} className="flex items-center gap-2 text-sm py-1">
                                                <input type="checkbox" checked={form.tier_ids.includes(t.id)} onChange={() => setForm({ ...form, tier_ids: toggleArr(form.tier_ids, t.id) })} />
                                                {t.name}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Áp dụng với kênh bán hàng</h3>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={form.channels.includes('pos')} onChange={() => setForm({ ...form, channels: toggleArr(form.channels, 'pos') })} />
                                        Bán tại cửa hàng
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={form.channels.includes('online')} onChange={() => setForm({ ...form, channels: toggleArr(form.channels, 'online') })} />
                                        Bán online
                                    </label>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button onClick={handleSave} className="m-btn m-btn-primary">Lưu</button>
                                <button onClick={() => setMode('list')} className="m-btn m-btn-ghost">Hủy</button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="m-card p-4">
                                <h3 className="text-xs mb-3" style={{ color: 'var(--m-ink-soft)' }}>Tổng quan</h3>
                                <div className="rounded-lg p-4 mb-3 text-white" style={{ background: 'linear-gradient(135deg, var(--m-primary), var(--m-primary-deep))' }}>
                                    <div className="text-2xl font-bold">{summaryText()}</div>
                                    <div className="text-xs opacity-80 mt-1">{SCOPE_LABELS[form.scope]} · {TYPE_LABELS[form.type]}</div>
                                </div>
                                <div className="text-xs space-y-1" style={{ color: 'var(--m-ink-soft)' }}>
                                    <div>Bắt đầu<br /><b style={{ color: 'var(--m-ink)' }}>{fmtDateTime(form.starts_at) || '—'}</b></div>
                                    <div>Kết thúc<br /><b style={{ color: 'var(--m-ink)' }}>{(form.has_expires && form.expires_at) ? fmtDateTime(form.expires_at) : '—'}</b></div>
                                    <div className="pt-1">• {form.target === 'all' ? 'Tất cả khách hàng' : 'Thẻ thành viên'}</div>
                                </div>
                            </div>
                            <div className="m-card p-4 flex items-center justify-between">
                                <span className="text-sm">Đang hoạt động</span>
                                <Switch on={form.is_active} onClick={() => setForm({ ...form, is_active: !form.is_active })} />
                            </div>
                        </div>
                    </div>
                </div>
            </AdminLayout>
        );
    }

    // ================= LIST =================
    return (
        <AdminLayout>
            <div className="p-6 max-w-[1200px] mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-xl font-bold" style={{ color: 'var(--m-ink)' }}>Khuyến mại</h1>
                        <p className="text-sm" style={{ color: 'var(--m-ink-soft)' }}>Tự động áp dụng khi đơn hàng đủ điều kiện.</p>
                    </div>
                    <button onClick={startCreate} className="m-btn m-btn-primary">+ Khuyến mại</button>
                </div>

                <div className="m-card overflow-x-auto">
                    <table className="m-table min-w-[800px]">
                        <thead>
                            <tr>
                                <th>Tên khuyến mại</th>
                                <th>Loại</th>
                                <th>Phạm vi</th>
                                <th>Giá trị</th>
                                <th>Thời gian</th>
                                <th>Trạng thái</th>
                                <th className="text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((p) => (
                                <tr key={p.id}>
                                    <td className="font-medium">{p.name}</td>
                                    <td><span className="m-badge m-badge-green">{TYPE_LABELS[p.type]}</span></td>
                                    <td><span className="m-badge m-badge-gray">{SCOPE_LABELS[p.scope] || p.scope}</span></td>
                                    <td className="font-semibold m-num">
                                        {p.type === 'percent' ? `${p.value}%` : p.type === 'gift' ? `Tặng ${p.gift_quantity} × ${p.gift_product?.name || ''}` : p.type === 'shipping' ? (Number(p.value) > 0 ? `Giảm ${Number(p.value).toLocaleString('vi-VN')}đ ship` : 'Miễn phí ship') : `${Number(p.value).toLocaleString('vi-VN')}đ`}
                                    </td>
                                    <td className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>
                                        {fmtDate(p.starts_at) || '—'}
                                        {' → '}
                                        {fmtDate(p.expires_at) || 'không giới hạn'}
                                    </td>
                                    <td>
                                        <button onClick={() => toggleActive(p)} title="Bật/tắt" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                            <span className={`m-badge ${p.is_active ? 'm-badge-green' : 'm-badge-red'}`}>
                                                {p.is_active ? 'Đang chạy' : 'Tắt'}
                                            </span>
                                        </button>
                                    </td>
                                    <td className="text-right whitespace-nowrap">
                                        <button onClick={() => startEdit(p.id)} className="text-xs font-semibold hover:underline mr-3" style={{ color: 'var(--m-primary)' }}>Sửa</button>
                                        <button onClick={() => handleDelete(p.id)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--m-danger)' }}>Xóa</button>
                                    </td>
                                </tr>
                            ))}
                            {list.length === 0 && <tr><td colSpan={7} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có khuyến mại nào.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {lastPage > 1 && (
                    <div className="flex justify-center gap-2 mt-4">
                        <button disabled={page <= 1} onClick={() => fetchList(page - 1)} className="m-btn m-btn-sm m-btn-ghost">‹ Trước</button>
                        <span className="text-xs py-2" style={{ color: 'var(--m-ink-soft)' }}>{page} / {lastPage}</span>
                        <button disabled={page >= lastPage} onClick={() => fetchList(page + 1)} className="m-btn m-btn-sm m-btn-ghost">Sau ›</button>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}
