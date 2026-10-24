import React, { useState, useEffect } from 'react';
import { storage } from '../utils/storage';
import { api } from '../api';

// Demo "Quan tâm OA" v2 (Đại Vương chốt 2026-10-19, nút cam #F5A623).
// Card OA dưới card thông tin quán: headline + avatar OA (badge tích) + tên + "Official Account" + nút pill "Quan tâm".
// Đã follow (zmp-sdk) → card tự ẩn. Công tắc + headline cấu hình trong Admin.
const OA_LINK = 'https://zalo.me/1305183010502392508';
// Audit UX 2026-10-21 (hạng 12): OA ID thật — trước đây getFollowStatus({}) không truyền ID
// nên trạng thái follow không đáng tin; nay truyền đúng ID + ẩn theo cờ đã lưu khi bấm Quan tâm.
const OA_ID = '1305183010502392508';

export default function OACard() {
    const [cfg, setCfg] = useState(null);
    const [followed, setFollowed] = useState(false);

    useEffect(() => {
        // Cấu hình OA từ /theme (public)
        fetch((import.meta.env.VITE_API_BASE || '/api/online') + '/theme')
            .then((r) => r.json()).then((s) => setCfg(s)).catch(() => setCfg({}));
        // Đã bấm "Quan tâm" trước đây (cờ lưu local) → ẩn card, khỏi làm phiền lại
        try { if (storage.get('zm_oa_followed') === '1') { setFollowed(true); return; } } catch { /* bỏ qua */ }
        // Kiểm tra đã follow OA chưa (zmp-sdk) — truyền đúng OA ID
        if (storage.isZalo()) {
            import('zmp-sdk/apis').then(async ({ getFollowStatus }) => {
                try {
                    const { isFollowed } = await getFollowStatus({ id: OA_ID });
                    if (isFollowed) setFollowed(true);
                } catch { /* hiện card */ }
            }).catch(() => {});
        }
    }, []);

    if (!cfg) return null;
    if (cfg.oa_card_enabled === false || cfg.oa_card_enabled === '0') return null;
    if (followed) return null;

    const headline = cfg.oa_card_headline || 'Quan tâm để nhận các chương trình ưu đãi đặc quyền !';

    return (
        <div className="zoa-card">
            <div className="zoa-hl">{headline}</div>
            <div className="zoa-body">
                <div className="zoa-avw">
                    <img className="zoa-av" src="/logo.png" alt="Daybreak" />
                    <div className="zoa-tick">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>
                    </div>
                </div>
                <div className="zoa-tx">
                    <div className="zoa-t1">Daybreak</div>
                    <div className="zoa-t2">Official Account</div>
                </div>
                <a className="zoa-btn" href={OA_LINK} target="_blank" rel="noopener"
                    onClick={() => { try { storage.set('zm_oa_followed', '1'); } catch { /* bỏ qua */ } setFollowed(true); }}>Quan tâm</a>
            </div>
            <style>{`
                .zoa-card { margin: 10px 14px 0; background: #fff; border: 1px solid #e3e8f2; border-radius: 16px; padding: 12px 14px; }
                .zoa-hl { font-size: 13.5px; font-weight: 500; color: #1f2937; padding-bottom: 10px; border-bottom: 1px solid #f1f4fa; }
                .zoa-body { display: flex; align-items: center; gap: 10px; padding-top: 10px; }
                .zoa-avw { position: relative; flex-shrink: 0; }
                .zoa-av { width: 46px; height: 46px; border-radius: 50%; object-fit: cover; background: #fff8ec; }
                .zoa-tick { position: absolute; right: -2px; bottom: -2px; width: 18px; height: 18px; border-radius: 50%; background: #F5A623; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; }
                .zoa-tick svg { width: 10px; height: 10px; }
                .zoa-tx { flex: 1; min-width: 0; }
                .zoa-t1 { font-weight: 800; font-size: 14px; color: #1f2937; }
                .zoa-t2 { font-size: 12px; color: #8a93a6; }
                .zoa-btn { border: 0; border-radius: 24px; font-weight: 800; font-size: 13px; padding: 11px 22px; cursor: pointer; flex-shrink: 0; text-decoration: none; display: inline-block; background: #F5A623; color: #3a2a00; }
            `}</style>
        </div>
    );
}
