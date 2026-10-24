import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';

// Gói 60: Cấu hình giao hàng AhaMove / Lalamove trong Thiết lập.
// - Bật/tắt từng hãng, hãng chính, ngưỡng failover, trần chênh failover,
//   ngưỡng + mức hỗ trợ phí ship. API key nằm trong .env (chỉ hiện trạng thái).
const DeliverySettings = ({ onDirty, onSaved } = {}) => {
    const [cfg, setCfg] = useState(null);
    const [form, setForm] = useState({
        delivery_ahamove_enabled: true,
        delivery_lalamove_enabled: true,
        delivery_primary: 'ahamove',
        delivery_failover_timeout_minutes: 5,
        delivery_failover_max_diff: 10000,
        delivery_support_threshold: 150000,
        delivery_support_amount: 15000,
    });
    const [msg, setMsg] = useState('');
    const [saving, setSaving] = useState(false);

    const fetchCfg = async () => {
        try {
            const res = await axios.get(API + '/delivery/config');
            if (res.data?.success) {
                setCfg(res.data.data);
                const p = res.data.data.providers || {};
                setForm((f) => ({
                    ...f,
                    delivery_ahamove_enabled: p.ahamove ? !!p.ahamove.enabled : true,
                    delivery_lalamove_enabled: p.lalamove ? !!p.lalamove.enabled : true,
                    delivery_primary: res.data.data.primary || 'ahamove',
                    delivery_failover_timeout_minutes: res.data.data.failover_timeout_minutes ?? 5,
                    delivery_failover_max_diff: res.data.data.failover_max_diff ?? 10000,
                    delivery_support_threshold: res.data.data.support_threshold ?? 150000,
                    delivery_support_amount: res.data.data.support_amount ?? 15000,
                }));
            }
        } catch (e) { /* bỏ qua */ }
    };
    useEffect(() => { fetchCfg(); }, []);

    // Audit toàn diện 2026-10-21 🟠5: báo thẻ cha (Settings) mỗi lần đổi để gắn badge "● Chưa lưu"
    const set = (k, v) => { onDirty?.(); setForm((f) => ({ ...f, [k]: v })); };

    const save = async () => {
        setSaving(true); setMsg('');
        try {
            const settings = {};
            for (const [k, v] of Object.entries(form)) settings[k] = String(v);
            await axios.post(API + '/settings', { settings });
            onSaved?.(); // 🟠5: tắt badge "Chưa lưu" ở thẻ cha sau khi lưu thành công
            setMsg('Đã lưu cấu hình giao hàng.');
            fetchCfg();
        } catch (e) {
            setMsg('Lưu thất bại: ' + (e.response?.data?.message || e.message));
        } finally { setSaving(false); }
    };

    const row = (label, desc, control) => (
        <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
            <div>
                <div className="text-[13px] font-medium text-gray-800">{label}</div>
                {desc && <div className="text-[12px] text-gray-500 mt-0.5">{desc}</div>}
            </div>
            <div className="shrink-0">{control}</div>
        </div>
    );

    const toggle = (k) => (
        <button
            onClick={() => set(k, !form[k])}
            className={`w-11 h-6 rounded-full transition ${form[k] ? 'bg-emerald-500' : 'bg-gray-300'}`}
        >
            <span className={`block w-5 h-5 bg-white rounded-full shadow transition ${form[k] ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
        </button>
    );

    const num = (k, suffix) => (
        <span className="flex items-center gap-1">
            <input
                type="number" min="0"
                value={form[k]}
                onChange={(e) => set(k, Number(e.target.value))}
                className="w-28 text-[13px] border border-gray-300 rounded px-2 py-1.5 text-right"
            />
            {suffix && <span className="text-[12px] text-gray-500">{suffix}</span>}
        </span>
    );

    return (
        <div>
            {/* Gói 61b: cảnh báo đỏ khi chưa cấu hình webhook secret */}
            {cfg?.webhook_secrets && Object.entries(cfg.webhook_secrets).some(([, ok]) => !ok) && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13, color: '#991b1b' }}>
                    ⚠️ <b>Chưa cấu hình webhook secret</b> cho: {Object.entries(cfg.webhook_secrets).filter(([, ok]) => !ok).map(([code]) => code === 'ahamove' ? 'AhaMove' : 'Lalamove').join(', ')}.
                    Webhook sẽ bị từ chối cho đến khi thêm <code>AHAMOVE_WEBHOOK_SECRET</code> / <code>LALAMOVE_WEBHOOK_SECRET</code> vào file .env của backend.
                </div>
            )}
            {cfg && (
                <div className="mb-3 text-[12px] space-y-1">
                    {Object.entries(cfg.providers || {}).map(([code, p]) => (
                        <div key={code} className="flex items-center gap-2">
                            <span className={`inline-block w-2 h-2 rounded-full ${p.configured ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                            <span className="text-gray-600">
                                {p.label}: {p.configured ? 'đã cấu hình API key' : 'chưa có API key (thêm vào file .env của backend)'}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {row('Bật AhaMove (hãng chính)', 'Tắt thì đơn mới dùng hãng còn lại', toggle('delivery_ahamove_enabled'))}
            {row('Bật Lalamove (dự phòng)', 'Tắt thì failover báo "không có hãng dự phòng"', toggle('delivery_lalamove_enabled'))}
            {row(
                'Hãng chính',
                'Đơn mới tạo ở hãng này trước',
                <select value={form.delivery_primary} onChange={(e) => set('delivery_primary', e.target.value)}
                    className="text-[13px] border border-gray-300 rounded px-2 py-1.5">
                    <option value="ahamove">AhaMove</option>
                    <option value="lalamove">Lalamove</option>
                </select>
            )}
            {row('Ngưỡng failover (phút)', 'Quá thời gian chưa có tài xế → tự chuyển hãng dự phòng', num('delivery_failover_timeout_minutes', 'phút'))}
            {row('Trần chênh failover (đ/đơn)', 'Quán chịu chênh trong trần; vượt trần báo khách xác nhận lại', num('delivery_failover_max_diff', 'đ'))}
            {row('Ngưỡng hỗ trợ phí ship (đ)', 'Đơn từ mức này → quán hỗ trợ phí ship', num('delivery_support_threshold', 'đ'))}
            {row('Mức hỗ trợ phí ship (đ)', 'Số tiền quán hỗ trợ mỗi đơn đạt ngưỡng', num('delivery_support_amount', 'đ'))}
            <div className="mt-4 flex items-center gap-3">
                <button
                    onClick={save} disabled={saving}
                    className="text-[13px] bg-[#24305E] text-white rounded px-5 py-2 font-medium disabled:opacity-50"
                >
                    {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
                </button>
                {msg && <span className="text-[13px] text-gray-600">{msg}</span>}
            </div>
            <p className="text-[12px] text-gray-400 mt-3">
                Lưu ý: cron <code>schedule:run</code> mỗi phút phải chạy trên server để failover tự động hoạt động.
            </p>
        </div>
    );
};

export default DeliverySettings;
