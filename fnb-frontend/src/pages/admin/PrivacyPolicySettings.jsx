import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';
import { confirmInApp } from '../../utils/confirmInApp';

// Gói chính sách Mini App vào Cài đặt Admin (spec đã chốt 2026-11-05):
// thẻ sửa nội dung "Chính sách — Điều khoản Mini App" — ĐÚNG 5 mục riêng
// biệt (tiêu đề + nội dung từng mục), lưu qua đường RIÊNG
// POST /settings/privacy-policy (đường lưu chung chặn 255 ký tự).
// Chưa từng sửa → server trả bản mặc định + is_default; khôi phục mặc
// định = POST /settings/privacy-policy/reset (xóa khóa phía server).
const TITLE_MAX = 120;
const CONTENT_MAX = 5000;

export default function PrivacyPolicySettings({ onDirty, onSaved } = {}) {
    const [sections, setSections] = useState([]);
    const [isDefault, setIsDefault] = useState(true);
    const [updatedText, setUpdatedText] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadErr, setLoadErr] = useState(false); // lỗi tải -> khóa Lưu, tránh ghi đè nội dung thật
    const [saving, setSaving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [preview, setPreview] = useState(false);

    const applyData = (d) => {
        if (!d || !Array.isArray(d.sections)) return;
        setSections(d.sections.map((s) => ({ title: s.title ?? '', content: s.content ?? '' })));
        setIsDefault(!!d.is_default);
        setUpdatedText(d.updated_text ?? '');
    };

    useEffect(() => {
        axios.get(`${API}/settings`)
            .then((r) => {
                const d = r.data?.data || r.data || {};
                applyData(d.miniapp_privacy_policy);
            })
            .catch(() => setLoadErr(true))
            .finally(() => setLoading(false));
    }, []);

    const setSection = (i, field, value) => {
        onDirty?.();
        setSections((prev) => prev.map((s, j) => (j === i ? { ...s, [field]: value } : s)));
    };

    const save = async () => {
        if (sections.some((s) => !s.title.trim() || !s.content.trim())) {
            alert('Chưa lưu được: cả 5 mục đều cần tiêu đề và nội dung, không được để trống.');
            return;
        }
        setSaving(true);
        try {
            const r = await axios.post(`${API}/settings/privacy-policy`, { sections });
            applyData(r.data?.data);
            onSaved?.();
            alert('Đã lưu chính sách.');
        } catch (e) {
            alert(e.response?.data?.message || 'Không lưu được chính sách.');
        } finally {
            setSaving(false);
        }
    };

    const reset = async () => {
        const ok = await confirmInApp('Khôi phục nội dung mặc định? Nội dung đã sửa sẽ bị xóa, popup Mini App quay về bản gốc.');
        if (!ok) return;
        setResetting(true);
        try {
            const r = await axios.post(`${API}/settings/privacy-policy/reset`);
            applyData(r.data?.data);
            onSaved?.();
            alert('Đã khôi phục nội dung mặc định.');
        } catch (e) {
            alert(e.response?.data?.message || 'Không khôi phục được.');
        } finally {
            setResetting(false);
        }
    };

    if (loading) return <div className="text-gray-400 text-[13px]">Đang tải...</div>;
    if (loadErr) return <div className="text-[13px]" style={{ color: 'var(--m-danger)' }}>Không tải được nội dung chính sách hiện tại — đã khóa nút Lưu để tránh ghi đè. Tải lại trang để thử lại.</div>;

    return (
        <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--m-ink-soft)' }}>
                Nội dung popup "Chính sách — Điều khoản" khách thấy trong Mini App (trang Tài khoản + Minigame).
                Đúng 5 mục theo cấu trúc Zalo kiểm duyệt yêu cầu — sửa tiêu đề và nội dung từng mục, không thêm/bớt mục.
                Nội dung là văn bản thuần (không chèn HTML), xuống dòng được giữ khi hiển thị.
            </p>
            {isDefault && (
                <div className="text-[12.5px] p-3 rounded-lg" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                    Đang dùng nội dung mặc định — chưa từng sửa.
                </div>
            )}

            {sections.map((s, i) => (
                <div key={i} className="border rounded-lg p-4" style={{ borderColor: 'var(--m-line)' }}>
                    <div className="font-bold text-[14px] mb-3">Mục {i + 1}</div>
                    <div>
                        <label className="text-[12.5px] font-medium" style={{ color: 'var(--m-ink-soft)' }}>
                            Tiêu đề <span style={{ color: 'var(--m-ink-faint)' }}>({s.title.length}/{TITLE_MAX} ký tự)</span>
                        </label>
                        <input value={s.title} onChange={(e) => setSection(i, 'title', e.target.value)}
                            className="m-input w-full mt-1" placeholder="VD: Đơn vị chủ quản" />
                    </div>
                    <div className="mt-3">
                        <label className="text-[12.5px] font-medium" style={{ color: 'var(--m-ink-soft)' }}>
                            Nội dung <span style={{ color: 'var(--m-ink-faint)' }}>({s.content.length}/{CONTENT_MAX} ký tự)</span>
                        </label>
                        <textarea value={s.content} onChange={(e) => setSection(i, 'content', e.target.value)}
                            className="m-input w-full mt-1" rows={5} style={{ resize: 'vertical' }} />
                    </div>
                </div>
            ))}

            <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={save} disabled={saving}
                    className="px-4 py-2 rounded-lg font-bold text-[13.5px] text-white disabled:opacity-50"
                    style={{ background: '#24305E' }}>
                    {saving ? 'Đang lưu...' : 'Lưu chính sách'}
                </button>
                <button type="button" onClick={() => setPreview(true)}
                    className="px-4 py-2 rounded-lg font-bold text-[13.5px]"
                    style={{ border: '1px solid var(--m-line)', color: 'var(--m-ink)' }}>
                    Xem trước
                </button>
                <button type="button" onClick={reset} disabled={resetting || isDefault}
                    className="px-4 py-2 rounded-lg font-bold text-[13.5px] disabled:opacity-50"
                    style={{ border: '1px solid var(--m-line)', color: 'var(--m-danger, #b91c1c)' }}>
                    {resetting ? 'Đang khôi phục...' : 'Khôi phục nội dung mặc định'}
                </button>
            </div>

            {preview && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                    onClick={() => setPreview(false)}>
                    <div onClick={(e) => e.stopPropagation()}
                        style={{ background: '#fff', borderRadius: 16, width: 380, maxWidth: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '16px 20px 24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <div style={{ fontWeight: 800, fontSize: 16, color: '#24305E' }}>Chính sách — Điều khoản Mini App Daybreak Đặt món</div>
                            <button type="button" onClick={() => setPreview(false)} style={{ border: 'none', background: '#f3f4f6', borderRadius: 20, width: 32, height: 32, fontSize: 16, cursor: 'pointer' }}>✕</button>
                        </div>
                        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#333' }}>
                            {sections.map((s, i) => (
                                <React.Fragment key={i}>
                                    <h4 style={{ margin: '0 0 6px', color: '#24305E' }}>{i + 1}. {s.title}</h4>
                                    <p style={{ margin: '0 0 12px', whiteSpace: 'pre-line' }}>{s.content}</p>
                                </React.Fragment>
                            ))}
                            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#888' }}>{updatedText}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
