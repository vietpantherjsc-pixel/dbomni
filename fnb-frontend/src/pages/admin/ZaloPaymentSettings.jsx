import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';

// SPEC-01: Card cấu hình thanh toán Zalo Mini App (đặt trong Settings.jsx).
// Công tắc kênh BANK/COD + thông tin STK + mẫu nội dung CK + quy tắc COD.
const KEYS = [
    'zalo_pay_bank_enabled',
    'zalo_pay_cod_enabled',
    'zalo_pay_bank_account',
    'zalo_pay_bank_name',
    'zalo_pay_bank_bank',
    // Spec QR 2026-10-21: mã NH (BIN) cho VietQR + ngưỡng cảnh báo chờ tiền
    'zalo_pay_bank_bin',
    'zalo_pay_wait_alert_minutes',
    'zalo_pay_transfer_template',
    'zalo_pay_cod_takeaway_only',
];

export default function ZaloPaymentSettings({ onDirty, onSaved } = {}) {
    const [vals, setVals] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios.get(`${API}/settings`, { params: { keys: KEYS.join(',') } })
            .then((r) => {
                const d = r.data?.data || {};
                setVals({
                    zalo_pay_bank_enabled: d.zalo_pay_bank_enabled ?? '1',
                    zalo_pay_cod_enabled: d.zalo_pay_cod_enabled ?? '1',
                    zalo_pay_bank_account: d.zalo_pay_bank_account ?? '',
                    zalo_pay_bank_name: d.zalo_pay_bank_name ?? '',
                    zalo_pay_bank_bank: d.zalo_pay_bank_bank ?? '',
                    zalo_pay_bank_bin: d.zalo_pay_bank_bin ?? '',
                    zalo_pay_wait_alert_minutes: d.zalo_pay_wait_alert_minutes ?? '15',
                    zalo_pay_transfer_template: d.zalo_pay_transfer_template ?? 'DAYBREAK {order_code}',
                    zalo_pay_cod_takeaway_only: d.zalo_pay_cod_takeaway_only ?? '1',
                });
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    // Audit toàn diện 2026-10-21 🟠5: báo thẻ cha (Settings) mỗi lần đổi để gắn badge "● Chưa lưu"
    const set = (k, v) => { onDirty?.(); setVals((prev) => ({ ...prev, [k]: v })); };

    // Spec QR 2026-10-21: đủ 4 trường mới được bật kênh BANK (STK + chủ TK + tên NH + mã BIN)
    const bankComplete = ['zalo_pay_bank_account', 'zalo_pay_bank_name', 'zalo_pay_bank_bank', 'zalo_pay_bank_bin']
        .every((k) => String(vals[k] ?? '').trim() !== '');

    const save = async () => {
        if (vals.zalo_pay_bank_enabled === '1' && !bankComplete) {
            alert('Chưa bật được kênh Chuyển khoản: cần điền đủ Số tài khoản, Chủ tài khoản, Ngân hàng và Mã ngân hàng (BIN) để khách quét VietQR.');
            return;
        }
        setSaving(true);
        try {
            await axios.post(`${API}/settings`, { settings: vals });
            onSaved?.(); // 🟠5: tắt badge "Chưa lưu" ở thẻ cha sau khi lưu thành công
            alert('Đã lưu cấu hình thanh toán.');
        } catch (e) {
            alert(e.response?.data?.message || 'Không lưu được.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="text-gray-400 text-[13px]">Đang tải...</div>;

    const toggle = (k) => (
        <label className="flex items-center gap-2 cursor-pointer">
            <input
                type="checkbox"
                checked={vals[k] === '1'}
                onChange={(e) => set(k, e.target.checked ? '1' : '0')}
                className="w-4 h-4 accent-[#24305E]"
            />
        </label>
    );

    return (
        <div className="space-y-4">
            <div className="text-[12.5px] p-3 rounded-lg" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                ⚠️ Thông tin STK/chủ TK/ngân hàng phải <b>khớp với cấu hình trên Mini App Center</b> (kênh BANK).
                PrivateKey ký mac cấu hình trong file .env của backend (<code>ZALO_PAYMENT_PRIVATE_KEY</code>), không nhập ở đây.
            </div>

            {/* Kênh BANK */}
            <div className="border rounded-lg p-4" style={{ borderColor: 'var(--m-line)' }}>
                <div className="flex items-center justify-between mb-3">
                    <div className="font-bold text-[14px]">Chuyển khoản (BANK)</div>
                    {toggle('zalo_pay_bank_enabled')}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="text-[12.5px] font-medium" style={{ color: 'var(--m-ink-soft)' }}>Số tài khoản</label>
                        <input value={vals.zalo_pay_bank_account} onChange={(e) => set('zalo_pay_bank_account', e.target.value)}
                            className="m-input w-full mt-1" placeholder="VD: 1234567890" />
                    </div>
                    <div>
                        <label className="text-[12.5px] font-medium" style={{ color: 'var(--m-ink-soft)' }}>Chủ tài khoản</label>
                        <input value={vals.zalo_pay_bank_name} onChange={(e) => set('zalo_pay_bank_name', e.target.value)}
                            className="m-input w-full mt-1" placeholder="VD: NGUYEN VAN A" />
                    </div>
                    <div>
                        <label className="text-[12.5px] font-medium" style={{ color: 'var(--m-ink-soft)' }}>Ngân hàng</label>
                        <input value={vals.zalo_pay_bank_bank} onChange={(e) => set('zalo_pay_bank_bank', e.target.value)}
                            className="m-input w-full mt-1" placeholder="VD: Vietcombank" />
                    </div>
                    <div>
                        <label className="text-[12.5px] font-medium" style={{ color: 'var(--m-ink-soft)' }}>Mã ngân hàng (BIN) — cho VietQR *</label>
                        <input value={vals.zalo_pay_bank_bin} onChange={(e) => set('zalo_pay_bank_bin', e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                            className="m-input w-full mt-1" placeholder="VD: 970436 (Vietcombank)" inputMode="numeric" />
                        <div className="text-[11.5px] mt-1" style={{ color: 'var(--m-ink-faint)' }}>
                            6 số đầu trên thẻ ATM. VD: Vietcombank 970436 · Techcombank 970407 · MB 970422 · ACB 970416 · BIDV 970418 · VietinBank 970415.
                        </div>
                    </div>
                    <div>
                        <label className="text-[12.5px] font-medium" style={{ color: 'var(--m-ink-soft)' }}>Cảnh báo đơn chờ tiền quá (phút)</label>
                        <input value={vals.zalo_pay_wait_alert_minutes} onChange={(e) => set('zalo_pay_wait_alert_minutes', e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
                            className="m-input w-full mt-1" placeholder="15" inputMode="numeric" />
                        <div className="text-[11.5px] mt-1" style={{ color: 'var(--m-ink-faint)' }}>
                            Đơn chuyển khoản chờ xác nhận quá số phút này sẽ tô cảnh báo ở Hóa đơn/KDS để NV đối chiếu sao kê.
                        </div>
                    </div>
                    <div>
                        <label className="text-[12.5px] font-medium" style={{ color: 'var(--m-ink-soft)' }}>Mẫu nội dung chuyển khoản</label>
                        <input value={vals.zalo_pay_transfer_template} onChange={(e) => set('zalo_pay_transfer_template', e.target.value)}
                            className="m-input w-full mt-1" placeholder="DAYBREAK {order_code}" />
                        <div className="text-[11.5px] mt-1" style={{ color: 'var(--m-ink-faint)' }}>
                            {'{order_code}'} sẽ được thay bằng mã đơn (VD: DAYBREAK HD-1042)
                        </div>
                    </div>
                </div>
            </div>

            {/* Kênh COD */}
            <div className="border rounded-lg p-4" style={{ borderColor: 'var(--m-line)' }}>
                <div className="flex items-center justify-between mb-3">
                    <div className="font-bold text-[14px]">Trả tại quán (COD)</div>
                    {toggle('zalo_pay_cod_enabled')}
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={vals.zalo_pay_cod_takeaway_only === '1'}
                        onChange={(e) => set('zalo_pay_cod_takeaway_only', e.target.checked ? '1' : '0')}
                        className="w-4 h-4 mt-0.5 accent-[#24305E]"
                    />
                    <span className="text-[13px]">
                        Chỉ cho phép trả tại quán với đơn <b>mang về / hẹn giờ</b> (mặc định BẬT — giảm bùng đơn)
                    </span>
                </label>
            </div>

            <button onClick={save} disabled={saving} className="m-btn m-btn-primary">
                {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
            </button>
        </div>
    );
}
