import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import TimeInput, { valid24 } from '../../components/TimeInput'; // Fix L1: ô giờ 24h tự chế (quy ước nhà)
import { API } from '../../utils/api';


// =====================================================================
// Gói 5 (2026-10-05): Thẻ thành viên — hạng + tỉ lệ tích điểm từng hạng.
// Loyalty 2.0 (2026-10-21): hạng theo CỬA SỔ TRƯỢT (ngưỡng lên/giữ), hệ số
// tích điểm theo hạng, giảm giá đổi điểm, cờ quyền lợi + khu Cấu hình
// Loyalty toàn cục (cửa sổ, HSD điểm, Double Days, coupon chào hạng).
// Khu "quy đổi điểm" cũ đã gỡ (điểm không còn trừ trực tiếp vào đơn).
// =====================================================================
const BENEFITS = [
    ['birthday_bonus', 'Ưu đãi sinh nhật'],
    ['early_access_new_item', 'Thử món mới sớm'],
    ['tier_golden_hour', 'Giờ vàng theo hạng'],
    ['double_points_day', 'Ngày nhân đôi điểm'],
];
const EMPTY_FORM = {
    name: '', code: '', min_total_spent: 0, min_spent_window: 0, keep_spent_window: '',
    earn_per_amount: 10000, earn_points: 1, earn_multiplier: 1, points_discount_pct: 0,
    benefits: { birthday_bonus: false, early_access_new_item: false, tier_golden_hour: false, double_points_day: false },
    is_default: false, sort_order: 0,
};
// Fix L1 (2026-10-21): Double Days dùng ô NGÀY + ô GIỜ 24h riêng (bỏ datetime-local).
// Giá trị lưu trong cfg là chuỗi "yyyy-MM-dd HH:mm" (hoặc ngày thuần từ cấu hình cũ).
const datePart = (v) => (v ? String(v).slice(0, 10) : '');
const timePart = (v, dflt) => {
    const s = String(v || '');
    return s.length >= 16 ? s.slice(11, 16) : dflt;
};

export default function MemberTiers() {
    const [tiers, setTiers] = useState([]);
    const [promotions, setPromotions] = useState([]);
    const [cfg, setCfg] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);

    const fetchData = async () => {
        try {
            const res = await axios.get(`${API}/membership-tiers`);
            if (res.data?.success) {
                setTiers(res.data.data);
                if (res.data.loyalty_config) setCfg(res.data.loyalty_config);
            }
            const rp = await axios.get(`${API}/promotions`, { params: { per_page: 200 } });
            if (rp.data?.success) setPromotions(rp.data.data.data || rp.data.data || []);
        } catch (err) { console.error('Lỗi tải hạng:', err); }
    };
    useEffect(() => { fetchData(); }, []);

    const resetForm = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(false); };

    const startEdit = (t) => {
        setEditing(t.id);
        setForm({
            name: t.name, code: t.code || '',
            min_total_spent: t.min_total_spent, min_spent_window: t.min_spent_window ?? 0,
            keep_spent_window: t.keep_spent_window ?? '',
            earn_per_amount: t.earn_per_amount, earn_points: t.earn_points,
            earn_multiplier: t.earn_multiplier ?? 1, points_discount_pct: t.points_discount_pct ?? 0,
            benefits: { ...EMPTY_FORM.benefits, ...(t.benefits || {}) },
            is_default: !!t.is_default, sort_order: t.sort_order,
        });
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) return alert('Nhập tên hạng');
        try {
            const payload = {
                ...form,
                min_total_spent: Number(form.min_total_spent) || 0,
                min_spent_window: Number(form.min_spent_window) || 0,
                keep_spent_window: form.keep_spent_window === '' ? null : Number(form.keep_spent_window),
                earn_per_amount: Number(form.earn_per_amount) || 10000,
                earn_points: Number(form.earn_points) || 1,
                earn_multiplier: Number(form.earn_multiplier) || 1,
                points_discount_pct: Number(form.points_discount_pct) || 0,
                code: form.code.trim() || undefined,
            };
            const res = editing
                ? await axios.patch(`${API}/membership-tiers/${editing}`, payload)
                : await axios.post(`${API}/membership-tiers`, payload);
            if (res.data?.success) { resetForm(); fetchData(); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Xóa hạng này?')) return;
        try {
            const res = await axios.delete(`${API}/membership-tiers/${id}`);
            if (res.data?.success) fetchData();
            else alert(res.data?.message || 'Xóa thất bại');
        } catch (err) { alert(err.response?.data?.message || 'Xóa thất bại'); }
    };

    const handleSaveCfg = async () => {
        // Fix L1: kiểm ô giờ 24h + khi BẬT sự kiện phải có đủ khoảng ngày
        const tStart = timePart(cfg.double_points_start, '00:00');
        const tEnd = timePart(cfg.double_points_end, '23:59');
        if ((tStart && !valid24(tStart)) || (tEnd && !valid24(tEnd))) {
            return alert('Giờ bắt đầu/kết thúc phải đúng định dạng 24h HH:MM (VD: 08:00, 23:59).');
        }
        if (cfg.double_points_enabled && (!datePart(cfg.double_points_start) || !datePart(cfg.double_points_end))) {
            return alert('Đã bật Double Days thì cần chọn đủ ngày bắt đầu và ngày kết thúc.');
        }
        try {
            const res = await axios.post(`${API}/membership-tiers/loyalty-config`, {
                ...cfg,
                tier_up_promotion_id: cfg.tier_up_promotion_id ? Number(cfg.tier_up_promotion_id) : null,
                // Fix L1: khóa MỚI double_points_* (backend ghi khóa mới + xóa khóa cũ)
                double_points_enabled: !!cfg.double_points_enabled,
                double_points_start: datePart(cfg.double_points_start) ? `${datePart(cfg.double_points_start)} ${tStart}` : null,
                double_points_end: datePart(cfg.double_points_end) ? `${datePart(cfg.double_points_end)} ${tEnd}` : null,
                double_points_multiplier: cfg.double_points_multiplier === '' || cfg.double_points_multiplier === null || cfg.double_points_multiplier === undefined ? null : Number(cfg.double_points_multiplier),
            });
            if (res.data?.success) { alert(res.data.message); if (res.data.loyalty_config) setCfg(res.data.loyalty_config); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const inp = 'w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]';
    const num = (v) => Number(v || 0).toLocaleString('vi-VN');

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex items-center justify-between mb-1">
                    <h1 className="text-xl font-semibold text-gray-800">Thẻ thành viên</h1>
                    <button onClick={() => { resetForm(); setShowForm(true); }} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                        + Hạng mới
                    </button>
                </div>
                <p className="text-[13px] text-[#6b7280] mb-4">Loyalty 2.0: hạng xét theo chi tiêu trong cửa sổ trượt; điểm chỉ dùng đổi coupon tại Cửa hàng điểm trên Mini App.</p>

                {/* Cấu hình Loyalty toàn cục */}
                {cfg && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                        <h3 className="font-semibold text-[14px] mb-3">Cấu hình Loyalty</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div><label className="text-xs text-gray-500">Cửa sổ xét hạng (ngày)</label>
                                <input type="number" min="1" value={cfg.tier_window_days} onChange={(e) => setCfg({ ...cfg, tier_window_days: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Báo trước tụt hạng (ngày)</label>
                                <input type="number" min="0" value={cfg.tier_downgrade_notice_days} onChange={(e) => setCfg({ ...cfg, tier_downgrade_notice_days: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Hạn dùng điểm (tháng)</label>
                                <input type="number" min="1" value={cfg.points_expire_months} onChange={(e) => setCfg({ ...cfg, points_expire_months: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Cảnh báo điểm sắp hết hạn (ngày)</label>
                                <input type="number" min="1" value={cfg.points_expiry_warn_days} onChange={(e) => setCfg({ ...cfg, points_expiry_warn_days: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Giá trị tham chiếu 1 điểm (đ)</label>
                                <input type="number" min="0" value={cfg.points_point_value} onChange={(e) => setCfg({ ...cfg, points_point_value: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Coupon chào hạng khi lên hạng</label>
                                <select value={cfg.tier_up_promotion_id || ''} onChange={(e) => setCfg({ ...cfg, tier_up_promotion_id: e.target.value })} className={inp}>
                                    <option value="">— Không phát —</option>
                                    {promotions.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                                </select></div>
                            <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-[13px]">
                                <input type="checkbox" checked={!!cfg.tier_grace_first_cycle} onChange={(e) => setCfg({ ...cfg, tier_grace_first_cycle: e.target.checked })} className="accent-[#0d6efd]" />
                                Ân hạn chu kỳ đầu (không tụt hạng)</label></div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-gray-100">
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <div className="text-[13px] font-medium text-gray-700">Ngày nhân đôi điểm (Double Days) — áp cho hạng có quyền lợi "Ngày nhân đôi điểm"</div>
                                <label className="flex items-center gap-2 text-[13px] font-medium">
                                    <input type="checkbox" checked={!!cfg.double_points_enabled} onChange={(e) => setCfg({ ...cfg, double_points_enabled: e.target.checked })} className="accent-[#0d6efd] w-4 h-4" />
                                    Bật sự kiện
                                </label>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <div><label className="text-xs text-gray-500">Ngày bắt đầu</label>
                                    <input type="date" value={datePart(cfg.double_points_start)} disabled={!cfg.double_points_enabled}
                                        onChange={(e) => setCfg({ ...cfg, double_points_start: e.target.value ? `${e.target.value} ${timePart(cfg.double_points_start, '00:00')}` : '' })} className={inp} /></div>
                                <div><label className="text-xs text-gray-500">Giờ bắt đầu (24h)</label>
                                    <TimeInput value={timePart(cfg.double_points_start, '00:00')} disabled={!cfg.double_points_enabled}
                                        onChange={(v) => setCfg({ ...cfg, double_points_start: datePart(cfg.double_points_start) ? `${datePart(cfg.double_points_start)} ${v}` : cfg.double_points_start })} className={inp} /></div>
                                <div><label className="text-xs text-gray-500">Ngày kết thúc</label>
                                    <input type="date" value={datePart(cfg.double_points_end)} disabled={!cfg.double_points_enabled}
                                        onChange={(e) => setCfg({ ...cfg, double_points_end: e.target.value ? `${e.target.value} ${timePart(cfg.double_points_end, '23:59')}` : '' })} className={inp} /></div>
                                <div><label className="text-xs text-gray-500">Giờ kết thúc (24h)</label>
                                    <TimeInput value={timePart(cfg.double_points_end, '23:59')} disabled={!cfg.double_points_enabled}
                                        onChange={(v) => setCfg({ ...cfg, double_points_end: datePart(cfg.double_points_end) ? `${datePart(cfg.double_points_end)} ${v}` : cfg.double_points_end })} className={inp} /></div>
                                <div><label className="text-xs text-gray-500">Hệ số nhân (VD: 2)</label>
                                    <input type="number" min="1" step="0.5" value={cfg.double_points_multiplier ?? ''} disabled={!cfg.double_points_enabled} onChange={(e) => setCfg({ ...cfg, double_points_multiplier: e.target.value })} className={inp} /></div>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-2">Tắt công tắc = sự kiện ngưng ngay dù còn trong khoảng ngày. Giờ để mặc định: bắt đầu 00:00, kết thúc 23:59.</p>
                        </div>
                        <button onClick={handleSaveCfg} className="mt-4 px-4 py-2 bg-gray-800 text-white text-[13px] rounded hover:bg-gray-700">Lưu cấu hình</button>
                    </div>
                )}

                {showForm && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                        <h3 className="font-semibold text-[14px] mb-3">{editing ? 'Sửa hạng' : 'Thêm hạng mới'}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div><label className="text-xs text-gray-500">Tên hạng *</label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Bình Minh" className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Mã nội bộ (không dấu, duy nhất)</label>
                                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="VD: binh_minh" className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Thứ tự</label>
                                <input type="number" min="0" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Ngưỡng LÊN hạng — chi tiêu trong cửa sổ (đ)</label>
                                <input type="number" min="0" value={form.min_spent_window} onChange={(e) => setForm({ ...form, min_spent_window: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Ngưỡng GIỮ hạng (đ) — trống = 50% ngưỡng lên</label>
                                <input type="number" min="0" value={form.keep_spent_window} onChange={(e) => setForm({ ...form, keep_spent_window: e.target.value })} placeholder="50% ngưỡng lên" className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Tiền tích lũy tối thiểu cũ (đ) — chỉ tham khảo lịch sử</label>
                                <input type="number" min="0" value={form.min_total_spent} onChange={(e) => setForm({ ...form, min_total_spent: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Cứ bao nhiêu đồng...</label>
                                <input type="number" min="1" value={form.earn_per_amount} onChange={(e) => setForm({ ...form, earn_per_amount: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">...được bao nhiêu điểm (mốc cơ sở)</label>
                                <input type="number" min="1" value={form.earn_points} onChange={(e) => setForm({ ...form, earn_points: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Hệ số tích điểm của hạng (×)</label>
                                <input type="number" min="0" step="0.5" value={form.earn_multiplier} onChange={(e) => setForm({ ...form, earn_multiplier: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Giảm giá đổi điểm (%)</label>
                                <input type="number" min="0" max="100" value={form.points_discount_pct} onChange={(e) => setForm({ ...form, points_discount_pct: e.target.value })} className={inp} /></div>
                            <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-[13px]">
                                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="accent-[#0d6efd]" />
                                Hạng mặc định (khách mới)</label></div>
                        </div>
                        <div className="mt-3">
                            <div className="text-xs text-gray-500 mb-1">Quyền lợi hiển thị (bảng lợi ích trên Mini App)</div>
                            <div className="flex flex-wrap gap-4">
                                {BENEFITS.map(([key, label]) => (
                                    <label key={key} className="flex items-center gap-2 text-[13px]">
                                        <input type="checkbox" checked={!!form.benefits[key]}
                                            onChange={(e) => setForm({ ...form, benefits: { ...form.benefits, [key]: e.target.checked } })}
                                            className="accent-[#0d6efd]" />
                                        {label}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                            <button onClick={handleSave} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">{editing ? 'Cập nhật' : 'Lưu'}</button>
                            <button onClick={resetForm} className="px-4 py-2 text-[13px] text-gray-500">Hủy</button>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded shadow-sm overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[900px]">
                        <thead>
                            <tr className="text-left text-gray-500 border-b border-gray-100">
                                <th className="px-4 py-3 font-medium">Thẻ thành viên</th>
                                <th className="px-3 py-3 font-medium text-right">Ngưỡng lên (cửa sổ)</th>
                                <th className="px-3 py-3 font-medium text-right">Ngưỡng giữ</th>
                                <th className="px-3 py-3 font-medium text-right">Tỷ lệ tích điểm</th>
                                <th className="px-3 py-3 font-medium text-right">Hệ số</th>
                                <th className="px-3 py-3 font-medium text-right">Giảm giá đổi điểm</th>
                                <th className="px-3 py-3 font-medium text-right">Số thành viên</th>
                                <th className="px-4 py-3 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tiers.map((t) => (
                                <tr key={t.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                    <td className="px-4 py-3">
                                        <span className="text-[#0d6efd] font-medium">{t.name}</span>
                                        {t.is_default && <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600">Mặc định</span>}
                                        {t.code && <div className="text-[11px] text-gray-400">{t.code}</div>}
                                    </td>
                                    <td className="px-3 py-3 text-right">{num(t.min_spent_window)}đ</td>
                                    <td className="px-3 py-3 text-right">{t.keep_spent_window != null ? `${num(t.keep_spent_window)}đ` : `${num((t.min_spent_window || 0) * 0.5)}đ (50%)`}</td>
                                    <td className="px-3 py-3 text-right">{num(t.earn_per_amount)}đ = {t.earn_points} điểm</td>
                                    <td className="px-3 py-3 text-right">×{Number(t.earn_multiplier ?? 1)}</td>
                                    <td className="px-3 py-3 text-right">{(t.points_discount_pct ?? 0) > 0 ? `−${t.points_discount_pct}%` : '—'}</td>
                                    <td className="px-3 py-3 text-right">{t.customers_count ?? 0}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => startEdit(t)} className="text-[#0d6efd] hover:underline mr-3">Sửa</button>
                                        <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:underline">Xóa</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </AdminLayout>
    );
}
