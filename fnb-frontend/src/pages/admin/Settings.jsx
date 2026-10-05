import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { applyThemeColor, getStoredTheme, DEFAULT_PRIMARY, THEME_PRESETS } from '../../utils/theme';
import { DECIMAL_LABELS } from '../../utils/number';

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
            </div>
        </AdminLayout>
    );
};

export default Settings;
