import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import TimeInput, { valid24 } from '../../components/TimeInput'; // Fix L1: ô giờ 24h tự chế (quy ước nhà)
import DateInput from '../../components/DateInput';
import { API } from '../../utils/api';


// =====================================================================
// Gói 5 (2026-10-05): Thẻ thành viên — hạng + tỉ lệ tích điểm từng hạng.
// Loyalty 2.0 (2026-10-21): hạng theo CỬA SỔ TRƯỢT (ngưỡng lên/giữ), hệ số
// tích điểm theo hạng, giảm giá đổi điểm, cờ quyền lợi + khu Cấu hình
// Loyalty toàn cục (cửa sổ, HSD điểm, Double Days, coupon chào hạng).
// Khu "quy đổi điểm" cũ đã gỡ (điểm không còn trừ trực tiếp vào đơn).
// =====================================================================
// Nhãn các khóa cấu hình riêng của game Hứng Trân Châu (Admin Minigame)
const MG_GAME_LABELS = {
    mg_htc_duration_seconds: 'Thời lượng phiên (giây)', mg_htc_points_pearl: 'Điểm trân châu',
    mg_htc_points_leaf: 'Điểm lá trà', mg_htc_points_coffee: 'Điểm hạt cà phê',
    mg_htc_points_sun: 'Điểm mặt trời Daybreak', mg_htc_points_burnt: 'Điểm TRỪ khi hứng hạt cháy',
    mg_htc_max_misses: 'Số lần hụt tối đa', mg_htc_interval_start_ms: 'Nhịp rơi đầu phiên (ms)',
    mg_htc_interval_end_ms: 'Nhịp rơi cuối phiên (ms)', mg_htc_speed_min: 'Tốc độ rơi nhỏ nhất (px/s)',
    mg_htc_speed_max: 'Tốc độ rơi lớn nhất (px/s)', mg_htc_speed_gain_per_s: 'Tăng tốc mỗi giây (px/s)',
    mg_htc_ratio_pearl: 'Tỉ lệ trân châu (%)', mg_htc_ratio_leaf: 'Tỉ lệ lá trà (%)',
    mg_htc_ratio_coffee: 'Tỉ lệ hạt cà phê (%)', mg_htc_ratio_sun: 'Tỉ lệ mặt trời (%)',
    mg_htc_ratio_burnt: 'Tỉ lệ hạt cháy (%)',
};
const MG_FLAG_LABELS = {
    perfect_catch: 'Hứng hoàn hảo', streak_perfect: 'Chuỗi hoàn hảo', sun_ratio: 'Hứng mặt trời bất thường',
    score_mismatch: 'Điểm báo lệch >10%', fast_submit: 'Nộp sát biên thời lượng',
};
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
    const [loadErr, setLoadErr] = useState(false); // UX 2026-10-26 (🟠T1)
    const [promotions, setPromotions] = useState([]);
    const [cfg, setCfg] = useState(null);
    // Chia tab (2026-11-01): 'tiers' mặc định; dữ liệu Minigame tải lười khi mở tab game lần đầu
    const [tab, setTab] = useState('tiers');
    const [mgLoaded, setMgLoaded] = useState(false);
    // Minigame (2026-11-01): thẻ cấu hình + vận hành đặt cạnh khu Loyalty
    const [mg, setMg] = useState(null);
    const [mgStats, setMgStats] = useState(null);
    const [mgSessions, setMgSessions] = useState([]);
    const [mgFlagged, setMgFlagged] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);

    const fetchData = async () => {
        try {
            const res = await axios.get(`${API}/membership-tiers`);
            if (res.data?.success) {
                setTiers(res.data.data); setLoadErr(false);
                if (res.data.loyalty_config) setCfg(res.data.loyalty_config);
            }
            const rp = await axios.get(`${API}/promotions`, { params: { per_page: 200 } });
            if (rp.data?.success) setPromotions(rp.data.data.data || rp.data.data || []);
        } catch (err) { console.error('Lỗi tải hạng:', err); setLoadErr(true); } // UX 2026-10-26 (🟠T1)
    };
    useEffect(() => { fetchData(); }, []);

    // Minigame: tải cấu hình + số liệu hôm nay + danh sách phiên
    const fetchMgSessions = async (flagged) => {
        try {
            const res = await axios.get(`${API}/admin/minigame/sessions`, { params: { flagged: flagged ? 1 : 0, page: 1 } });
            if (res.data?.success) setMgSessions(res.data.data.data || []);
        } catch { /* khu minigame lỗi không làm vỡ trang hạng */ }
    };
    const fetchMg = async () => {
        try {
            const [rc, rs] = await Promise.all([
                axios.get(`${API}/admin/minigame/config`),
                axios.get(`${API}/admin/minigame/stats`),
            ]);
            if (rc.data?.success) setMg(rc.data.data);
            if (rs.data?.success) setMgStats(rs.data.data);
        } catch { /* bỏ qua — trang hạng vẫn dùng bình thường */ }
        fetchMgSessions(true);
    };
    // Badge tab Minigame: chỉ gọi stats nhẹ lúc mở trang để hiện số phiên bị cờ
    useEffect(() => {
        axios.get(`${API}/admin/minigame/stats`).then((rs) => { if (rs.data?.success) setMgStats(rs.data.data); }).catch(() => {});
    }, []);
    // Tải lười: cấu hình + phiên của tab Minigame chỉ tải khi mở tab lần đầu
    useEffect(() => {
        if (tab === 'game' && !mgLoaded) { setMgLoaded(true); fetchMg(); }
    }, [tab, mgLoaded]);
    useEffect(() => { if (mgLoaded) fetchMgSessions(mgFlagged); }, [mgFlagged, mgLoaded]);

    const saveMg = async () => {
        try {
            const res = await axios.post(`${API}/admin/minigame/config`, { shared: mg.shared, games: mg.games });
            if (res.data?.success) { alert(res.data.message); setMg(res.data.data); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu cấu hình Minigame thất bại'); }
    };

    const revokeMgSession = async (s) => {
        const reason = window.prompt(`Thu hồi điểm phiên #${s.id} (${s.customer?.name || ''} · +${s.reward_points} điểm)?\nNhập lý do thu hồi (bắt buộc):`);
        if (!reason || !reason.trim()) return;
        try {
            const res = await axios.post(`${API}/admin/minigame/sessions/${s.id}/revoke`, { reason: reason.trim() });
            if (res.data?.success) { alert(res.data.message); fetchMgSessions(mgFlagged); fetchMg(); }
        } catch (err) { alert(err.response?.data?.message || 'Thu hồi thất bại'); }
    };

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
                // Hệ số theo từng kênh (2026-11-04): chỉ gửi khóa mới; khóa
                // cũ để undefined để JSON bỏ qua — backend giữ nguyên làm dữ
                // liệu trơ, không ghi đè.
                points_channel_multiplier_enabled: !!cfg.points_channel_multiplier_enabled,
                points_channel_rules: cfg.points_channel_rules || {},
                points_channel_default_factor: cfg.points_channel_default_factor === '' || cfg.points_channel_default_factor === null || cfg.points_channel_default_factor === undefined ? null : Number(cfg.points_channel_default_factor),
                points_platform_multiplier: undefined,
                points_own_channels: undefined,
            });
            if (res.data?.success) { alert(res.data.message); if (res.data.loyalty_config) setCfg(res.data.loyalty_config); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const inp = 'w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#24305E]';
    const num = (v) => Number(v || 0).toLocaleString('vi-VN');
    // Bảng quy tắc theo kênh (2026-11-04, spec mục 4): dòng sinh từ
    // points_channels (backend). F1b (2026-11-05): backend đã khử trùng
    // alias online -> zalo ngay ở nguồn nên danh sách chỉ còn 1 dòng zalo;
    // khối gộp zalo/online phía dưới chỉ còn là lưới an toàn cho dữ liệu
    // cấu hình cũ (quy tắc lưu dưới khóa 'online' được backend gập về
    // 'zalo' khi đọc). Kênh có trong price_lists mà chưa có quy tắc thì
    // hiển thị với hệ số mặc định, lưu lần đầu sẽ thành quy tắc riêng;
    // quy tắc của kênh không còn trong danh sách vẫn giữ 1 dòng để không
    // mất cấu hình.
    const CH_CAT_LABEL = { store: 'Tại quán', online: 'Online', partner: 'Đối tác' };
    const channelRows = () => {
        if (!cfg) return [];
        const rules = cfg.points_channel_rules || {};
        const rows = [];
        const seen = new Set();
        for (const s of (cfg.points_channels || [])) {
            const code = String(s.code || '').toLowerCase();
            if (!code || seen.has(code)) continue;
            if (code === 'zalo' || code === 'online') {
                seen.add('zalo'); seen.add('online');
                rows.push({ codes: ['zalo', 'online'], name: 'Zalo Mini App (zalo/online)', category: 'online' });
            } else {
                seen.add(code);
                rows.push({ codes: [code], name: s.name || code, category: s.category || '' });
            }
        }
        for (const code of Object.keys(rules)) {
            if (!seen.has(String(code).toLowerCase())) {
                seen.add(String(code).toLowerCase());
                rows.push({ codes: [String(code).toLowerCase()], name: String(code).toLowerCase(), category: '' });
            }
        }
        return rows;
    };
    const ruleForRow = (row) => {
        const rules = cfg.points_channel_rules || {};
        for (const code of row.codes) {
            if (rules[code]) return rules[code];
        }
        return { enabled: true, factor: cfg.points_channel_default_factor ?? 0.5 };
    };
    const setRowRule = (row, patch) => {
        const rules = { ...(cfg.points_channel_rules || {}) };
        for (const code of row.codes) {
            const cur = rules[code] || { enabled: true, factor: cfg.points_channel_default_factor ?? 0.5 };
            rules[code] = { ...cur, ...patch };
        }
        setCfg({ ...cfg, points_channel_rules: rules });
    };

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex items-center justify-between mb-1">
                    <h1 className="text-xl font-semibold text-gray-800">Thẻ thành viên</h1>
                    <button onClick={() => { setTab('tiers'); resetForm(); setShowForm(true); }} className="px-4 py-2 bg-[#24305E] text-white text-[13px] font-medium rounded hover:bg-[#1B2547]">
                        + Hạng mới
                    </button>
                </div>
                <p className="text-[13px] text-[#6b7280] mb-4">Loyalty 2.0: hạng xét theo chi tiêu trong cửa sổ trượt; điểm chỉ dùng đổi coupon tại Cửa hàng điểm trên Mini App.</p>

                {/* Chia tab (2026-11-01, demo Đại Vương duyệt): giữ nguyên mọi khối, chỉ gom tab */}
                <div className="flex gap-1 border-b-2 border-gray-200 mb-4 overflow-x-auto" role="tablist">
                    <button role="tab" onClick={() => setTab('tiers')} className={`px-4 text-[14px] font-semibold whitespace-nowrap min-h-[46px] border-b-[3px] -mb-[2px] ${tab === 'tiers' ? 'text-[#24305E] border-[#24305E]' : 'text-gray-500 border-transparent'}`}>🎖 Hạng & tích điểm</button>
                    <button role="tab" onClick={() => setTab('game')} className={`px-4 text-[14px] font-semibold whitespace-nowrap min-h-[46px] border-b-[3px] -mb-[2px] flex items-center gap-2 ${tab === 'game' ? 'text-[#24305E] border-[#24305E]' : 'text-gray-500 border-transparent'}`}>
                        🧋 Minigame
                        {mgStats?.flagged > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-500 text-white font-bold">{mgStats.flagged} phiên bị cờ</span>}
                    </button>
                </div>

                {tab === 'tiers' && (<>

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
                                <input type="checkbox" checked={!!cfg.tier_grace_first_cycle} onChange={(e) => setCfg({ ...cfg, tier_grace_first_cycle: e.target.checked })} className="accent-[#24305E]" />
                                Ân hạn chu kỳ đầu (không tụt hạng)</label></div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-gray-100">
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <div className="text-[13px] font-medium text-gray-700">Ngày nhân đôi điểm (Double Days) — áp cho hạng có quyền lợi "Ngày nhân đôi điểm"</div>
                                <label className="flex items-center gap-2 text-[13px] font-medium">
                                    <input type="checkbox" checked={!!cfg.double_points_enabled} onChange={(e) => setCfg({ ...cfg, double_points_enabled: e.target.checked })} className="accent-[#24305E] w-4 h-4" />
                                    Bật sự kiện
                                </label>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <div><label className="text-xs text-gray-500">Ngày bắt đầu</label>
                                    <DateInput value={datePart(cfg.double_points_start)} disabled={!cfg.double_points_enabled}
                                        onChange={(v) => setCfg({ ...cfg, double_points_start: v ? `${v} ${timePart(cfg.double_points_start, '00:00')}` : '' })} className={inp} /></div>
                                <div><label className="text-xs text-gray-500">Giờ bắt đầu (24h)</label>
                                    <TimeInput value={timePart(cfg.double_points_start, '00:00')} disabled={!cfg.double_points_enabled}
                                        onChange={(v) => setCfg({ ...cfg, double_points_start: datePart(cfg.double_points_start) ? `${datePart(cfg.double_points_start)} ${v}` : cfg.double_points_start })} className={inp} /></div>
                                <div><label className="text-xs text-gray-500">Ngày kết thúc</label>
                                    <DateInput value={datePart(cfg.double_points_end)} disabled={!cfg.double_points_enabled}
                                        onChange={(v) => setCfg({ ...cfg, double_points_end: v ? `${v} ${timePart(cfg.double_points_end, '23:59')}` : '' })} className={inp} /></div>
                                <div><label className="text-xs text-gray-500">Giờ kết thúc (24h)</label>
                                    <TimeInput value={timePart(cfg.double_points_end, '23:59')} disabled={!cfg.double_points_enabled}
                                        onChange={(v) => setCfg({ ...cfg, double_points_end: datePart(cfg.double_points_end) ? `${datePart(cfg.double_points_end)} ${v}` : cfg.double_points_end })} className={inp} /></div>
                                <div><label className="text-xs text-gray-500">Hệ số nhân (VD: 2)</label>
                                    <input type="number" min="1" step="0.5" value={cfg.double_points_multiplier ?? ''} disabled={!cfg.double_points_enabled} onChange={(e) => setCfg({ ...cfg, double_points_multiplier: e.target.value })} className={inp} /></div>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-2">Tắt công tắc = sự kiện ngưng ngay dù còn trong khoảng ngày. Giờ để mặc định: bắt đầu 00:00, kết thúc 23:59.</p>
                        </div>
                        <div className="mt-4 pt-3 border-t border-gray-100">
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <div className="text-[13px] font-medium text-gray-700">Hệ số tích điểm theo từng kênh</div>
                                <label className="flex items-center gap-2 text-[13px] font-medium min-h-[40px]">
                                    <input type="checkbox" checked={!!cfg.points_channel_multiplier_enabled} onChange={(e) => setCfg({ ...cfg, points_channel_multiplier_enabled: e.target.checked })} className="accent-[#24305E] w-4 h-4" />
                                    Bật chênh lệch theo kênh
                                </label>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-[13px] border-collapse min-w-[520px]">
                                    <thead><tr className="text-left text-gray-500 border-b">
                                        <th className="py-2 pr-2 font-medium">Kênh</th>
                                        <th className="py-2 pr-2 font-medium">Tích điểm</th>
                                        <th className="py-2 font-medium">Hệ số (0–2)</th>
                                    </tr></thead>
                                    <tbody>
                                        {channelRows().map((row) => {
                                            const rule = ruleForRow(row);
                                            return (
                                                <tr key={row.codes.join('/')} className="border-b border-gray-100">
                                                    <td className="py-2 pr-2">
                                                        <div className="font-medium text-gray-800">{row.name}</div>
                                                        <div className="text-[11px] text-gray-400">{row.codes.join(' / ')}{row.category ? ` · ${CH_CAT_LABEL[row.category] || row.category}` : ''}</div>
                                                    </td>
                                                    <td className="py-2 pr-2">
                                                        <label className="flex items-center gap-2 min-h-[40px]">
                                                            <input type="checkbox" checked={!!rule.enabled} disabled={!cfg.points_channel_multiplier_enabled} onChange={(e) => setRowRule(row, { enabled: e.target.checked })} className="accent-[#24305E] w-4 h-4" />
                                                            {rule.enabled ? 'Đang tích' : 'Đã tắt'}
                                                        </label>
                                                    </td>
                                                    <td className="py-2">
                                                        <input type="number" min="0" max="2" step="0.05" value={rule.factor ?? ''} disabled={!cfg.points_channel_multiplier_enabled} onChange={(e) => setRowRule(row, { factor: e.target.value })} className={`${inp} min-h-[40px] max-w-[140px]`} />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        <tr>
                                            <td className="py-2 pr-2">
                                                <div className="font-medium text-gray-800">Kênh chưa có trong bảng (kênh mới/sàn mới)</div>
                                                <div className="text-[11px] text-gray-400">Hệ số mặc định cho mọi mã kênh chưa có dòng riêng</div>
                                            </td>
                                            <td className="py-2 pr-2 text-gray-400">Luôn tích</td>
                                            <td className="py-2">
                                                <input type="number" min="0" max="2" step="0.05" value={cfg.points_channel_default_factor ?? ''} disabled={!cfg.points_channel_multiplier_enabled} onChange={(e) => setCfg({ ...cfg, points_channel_default_factor: e.target.value })} className={`${inp} min-h-[40px] max-w-[140px]`} />
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-2">Công tắc tổng (Bật chênh lệch theo kênh): tắt = mọi kênh ×1, trừ kênh đã tắt riêng vẫn 0 điểm. Công tắc từng kênh: tắt = kênh đó 0 điểm, thắng mọi công tắc khác. Tắt tích điểm của kênh không ảnh hưởng chi tiêu xét hạng. Kênh mới tạo ở trang Kênh bán hàng sẽ tự xuất hiện thành dòng riêng ở lần tải trang kế tiếp. Cấu hình áp cho đơn tích điểm từ lúc lưu trở đi, không tính lại đơn cũ.</p>
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
                                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="accent-[#24305E]" />
                                Hạng mặc định (khách mới)</label></div>
                        </div>
                        <div className="mt-3">
                            <div className="text-xs text-gray-500 mb-1">Quyền lợi hiển thị (bảng lợi ích trên Mini App)</div>
                            <div className="flex flex-wrap gap-4">
                                {BENEFITS.map(([key, label]) => (
                                    <label key={key} className="flex items-center gap-2 text-[13px]">
                                        <input type="checkbox" checked={!!form.benefits[key]}
                                            onChange={(e) => setForm({ ...form, benefits: { ...form.benefits, [key]: e.target.checked } })}
                                            className="accent-[#24305E]" />
                                        {label}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                            <button onClick={handleSave} className="px-4 py-2 bg-[#24305E] text-white text-[13px] font-medium rounded hover:bg-[#1B2547]">{editing ? 'Cập nhật' : 'Lưu'}</button>
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
                            {loadErr && (<div style={{ color: 'var(--m-danger)', fontSize: 13, marginBottom: 10 }}>⚠ Không tải được danh sách hạng thành viên.<button onClick={fetchData} className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 8 }}>Thử lại</button></div>)}
                            {tiers.map((t) => (
                                <tr key={t.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                    <td className="px-4 py-3">
                                        <span className="text-[#24305E] font-medium">{t.name}</span>
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
                                        <button onClick={() => startEdit(t)} className="text-[#24305E] hover:underline mr-3">Sửa</button>
                                        <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:underline">Xóa</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                </>)}

                {tab === 'game' && (<>
                {/* Minigame (2026-11-01): thẻ cấu hình cạnh khu Loyalty + vận hành */}
                {mg && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                        <h3 className="font-semibold text-[14px] mb-1">Minigame — Hứng Trân Châu</h3>
                        <p className="text-[12px] text-gray-400 mb-3">Điểm game cộng qua lô riêng "minigame", không tính chi tiêu xét hạng. Mọi thay đổi áp cho phiên cấp từ lúc lưu; phiên đang mở giữ cấu hình lúc cấp.</p>
                        <label className="flex items-center gap-2 text-[13px] font-medium mb-3">
                            <input type="checkbox" checked={!!mg.shared.minigame_enabled} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, minigame_enabled: e.target.checked } })} className="accent-[#24305E] w-4 h-4" />
                            Bật Minigame toàn hệ (tắt = thẻ game ẩn ở Mini App, API từ chối cấp phiên)
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div><label className="text-xs text-gray-500">Lượt có thưởng/ngày</label>
                                <input type="number" min="1" value={mg.shared.minigame_daily_plays} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, minigame_daily_plays: e.target.value } })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Trần điểm game/ngày/tài khoản</label>
                                <input type="number" min="0" value={mg.shared.minigame_daily_cap_points} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, minigame_daily_cap_points: e.target.value } })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Trần phát hành toàn hệ/ngày</label>
                                <input type="number" min="0" value={mg.shared.minigame_global_cap_points} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, minigame_global_cap_points: e.target.value } })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Hạn nộp kết quả (giây)</label>
                                <input type="number" min="30" value={mg.shared.minigame_session_ttl_seconds} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, minigame_session_ttl_seconds: e.target.value } })} className={inp} /></div>
                            {[1, 2, 3].map((i) => (
                                <React.Fragment key={i}>
                                    <div><label className="text-xs text-gray-500">Mốc {i} — điểm đạt</label>
                                        <input type="number" min="0" value={mg.shared[`minigame_t${i}_score`]} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, [`minigame_t${i}_score`]: e.target.value } })} className={inp} /></div>
                                    <div><label className="text-xs text-gray-500">Mốc {i} — điểm thưởng</label>
                                        <input type="number" min="0" value={mg.shared[`minigame_t${i}_points`]} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, [`minigame_t${i}_points`]: e.target.value } })} className={inp} /></div>
                                </React.Fragment>
                            ))}
                            <div><label className="text-xs text-gray-500">Nhiệm vụ ngày — điểm đạt</label>
                                <input type="number" min="0" value={mg.shared.minigame_mission_score} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, minigame_mission_score: e.target.value } })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Nhiệm vụ ngày — điểm cộng</label>
                                <input type="number" min="0" value={mg.shared.minigame_mission_points} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, minigame_mission_points: e.target.value } })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Ngưỡng cờ chuỗi hoàn hảo (phiên)</label>
                                <input type="number" min="2" value={mg.shared.minigame_anomaly_streak} onChange={(e) => setMg({ ...mg, shared: { ...mg.shared, minigame_anomaly_streak: e.target.value } })} className={inp} /></div>
                        </div>
                        {Object.entries(mg.games || {}).map(([gameId, game]) => (
                            <div key={gameId} className="mt-4 pt-3 border-t border-gray-100">
                                <label className="flex items-center gap-2 text-[13px] font-medium mb-2">
                                    <input type="checkbox" checked={!!game.enabled} onChange={(e) => setMg({ ...mg, games: { ...mg.games, [gameId]: { ...game, enabled: e.target.checked } } })} className="accent-[#24305E] w-4 h-4" />
                                    Bật game {gameId}
                                </label>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {Object.keys(game.defaults || {}).map((key) => (
                                        <div key={key}><label className="text-xs text-gray-500">{MG_GAME_LABELS[key] || key}</label>
                                            <input type="number" step={Number.isInteger(game.defaults[key]) ? 1 : 0.1} value={game.config[key] ?? ''} onChange={(e) => setMg({ ...mg, games: { ...mg.games, [gameId]: { ...game, config: { ...game.config, [key]: e.target.value } } } })} className={inp} /></div>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <button onClick={saveMg} className="mt-4 px-4 py-2 bg-[#24305E] text-white text-[13px] rounded hover:bg-[#1B2547]">Lưu cấu hình Minigame</button>

                        {mgStats && (
                            <div className="mt-5 pt-3 border-t border-gray-100">
                                <div className="text-[13px] font-medium text-gray-700 mb-2">Vận hành hôm nay ({mgStats.date})</div>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
                                    {[['Phiên đã cấp', mgStats.sessions_issued], ['Phiên đã nộp', mgStats.sessions_submitted], ['Khách đã chơi', mgStats.players], ['Điểm đã phát', mgStats.points_issued], ['Phiên bị gắn cờ', mgStats.flagged]].map(([label, val]) => (
                                        <div key={label} className="bg-gray-50 rounded-lg py-2"><div className="text-[17px] font-bold text-[#24305E]">{num(val)}</div><div className="text-[11px] text-gray-500">{label}</div></div>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2 mt-4 mb-2">
                                    <div className="text-[13px] font-medium text-gray-700">Phiên chơi</div>
                                    <button onClick={() => setMgFlagged(true)} className={`px-3 py-1.5 text-[12px] rounded border min-h-[36px] ${mgFlagged ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-200'}`}>Chỉ phiên bất thường</button>
                                    <button onClick={() => setMgFlagged(false)} className={`px-3 py-1.5 text-[12px] rounded border min-h-[36px] ${!mgFlagged ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-200'}`}>Tất cả phiên</button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-[12.5px]">
                                        <thead><tr className="text-left text-gray-500 border-b">
                                            <th className="py-2 pr-2">Phiên</th><th className="py-2 pr-2">Khách</th><th className="py-2 pr-2">Điểm báo / kiểm chứng</th><th className="py-2 pr-2">Thưởng</th><th className="py-2 pr-2">Cờ bất thường</th><th className="py-2 pr-2">Trạng thái</th><th className="py-2">Thao tác</th>
                                        </tr></thead>
                                        <tbody>
                                            {mgSessions.length === 0 && <tr><td colSpan={7} className="py-3 text-gray-400">Chưa có phiên nào.</td></tr>}
                                            {mgSessions.map((s) => (
                                                <tr key={s.id} className="border-b border-gray-50">
                                                    <td className="py-2 pr-2">#{s.id}<div className="text-[11px] text-gray-400">{s.submitted_at || s.issued_at || ''}</div></td>
                                                    <td className="py-2 pr-2">{s.customer?.name || '—'}<div className="text-[11px] text-gray-400">{s.customer?.phone || ''}</div></td>
                                                    <td className="py-2 pr-2">{s.claimed_score ?? '—'} / <b>{s.verified_score ?? '—'}</b></td>
                                                    <td className="py-2 pr-2">+{s.reward_points}{s.lot_remaining !== null && s.lot_remaining !== undefined ? <div className="text-[11px] text-gray-400">lô còn {s.lot_remaining}</div> : null}</td>
                                                    <td className="py-2 pr-2">{(s.anomaly_flags || []).map((f) => <span key={f} className="inline-block bg-amber-100 text-amber-800 rounded px-1.5 py-0.5 mr-1 mb-1 text-[11px]">{MG_FLAG_LABELS[f] || f}</span>)}</td>
                                                    <td className="py-2 pr-2">{s.status}</td>
                                                    <td className="py-2">{s.status === 'submitted' && s.reward_points > 0 && (
                                                        <button onClick={() => revokeMgSession(s)} className="px-3 py-1.5 text-[12px] rounded bg-red-50 text-red-600 border border-red-200 min-h-[36px]">Thu hồi điểm</button>
                                                    )}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                </>)}
            </div>
        </AdminLayout>
    );
}
