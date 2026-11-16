import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../utils/storage';
import { api, getProfile, setProfile, getSession } from '../api';

// Nút "Quan tâm OA" ngay trong Mini App (Đại Vương chốt + duyệt spec
// 2026-11-12, spec-nut-quan-tam-oa-trong-app). Thẻ tự vẽ như bản đã
// duyệt (headline + avatar OA + nút cam #F5A623); bấm là gọi followOA
// của zmp-sdk — quan tâm ngay trong app, không chuyển ra ngoài.
// - Trạng thái thật đọc từ getUserInfo().followedOA (boolean) + idByOA.
//   API getFollowStatus KHÔNG tồn tại trong SDK 2.53.2 — bản cũ gọi nó
//   là code chết, đã dọn. followedOA không phải boolean = CHƯA RÕ →
//   hiện thẻ, không ghi server.
// - followOA CHỈ gọi khi khách CHẠM nút (chính sách duyệt §3.3.4):
//   resolve = đã quan tâm → báo server + toast + ẩn thẻ · reject −201
//   (khách từ chối ở hộp xác nhận của Zalo) = im lặng tuyệt đối · lỗi
//   khác → dự phòng mở link zalo.me như đường cũ.
// - Cờ local zm_oa_followed KHÔNG còn được ghi bởi thao tác chạm — thẻ
//   chỉ ẩn theo trạng thái thật.
// - Đồng bộ khi mở app: đã đăng nhập mà followedOA lệch trạng thái
//   server đang giữ (hồ sơ oa_followed) → báo lại qua endpoint (bắt cả
//   quan tâm từ trước lẫn hủy quan tâm ngoài app).
const OA_ID = '1305183010502392508';
const OA_LINK = `https://zalo.me/${OA_ID}`;

export default function OACard() {
    const [cfg, setCfg] = useState(null);
    const [hidden, setHidden] = useState(false);
    const [toast, setToast] = useState(false);
    const [busy, setBusy] = useState(false);
    const syncDoneRef = useRef(false);

    // Báo trạng thái thật về server + cập nhật hồ sơ lưu tại máy từ
    // payload server trả về (chứa oa_followed mới nhất).
    const report = async (followed, idByOA) => {
        try {
            const data = await api.reportOaFollow(followed, idByOA || null);
            if (data) setProfile({ ...(getProfile() || {}), ...data });
        } catch { /* mất mạng: lần mở app sau đồng bộ lại */ }
    };

    useEffect(() => {
        // Cấu hình OA từ /theme (public)
        fetch((import.meta.env.VITE_API_BASE || '/api/online') + '/theme')
            .then((r) => r.json()).then((s) => setCfg(s)).catch(() => setCfg({}));
        if (!storage.isZalo() || syncDoneRef.current) return;
        syncDoneRef.current = true;
        import('zmp-sdk/apis').then(async ({ getUserInfo }) => {
            try {
                const { userInfo } = await getUserInfo({});
                const f = userInfo?.followedOA;
                if (typeof f !== 'boolean') return; // chưa rõ → hiện thẻ, không ghi
                if (f) setHidden(true);
                if (getSession()?.token) {
                    const serverKnown = getProfile()?.oa_followed;
                    if (typeof serverKnown !== 'boolean' || serverKnown !== f) {
                        report(f, userInfo?.idByOA || null);
                    }
                }
            } catch { /* chưa rõ → hiện thẻ, không ghi */ }
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onFollow = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const { followOA } = await import('zmp-sdk/apis');
            await followOA({ id: OA_ID });
            // Resolve = đã quan tâm. Đã đăng nhập → báo server kèm
            // idByOA (đọc lại từ getUserInfo); khách vãng lai chưa có
            // tài khoản thì đường đồng bộ khi mở app sẽ gắn trạng thái
            // thật vào tài khoản ở lần đăng nhập sau.
            if (getSession()?.token) {
                let idByOA = null;
                try {
                    const { getUserInfo } = await import('zmp-sdk/apis');
                    const { userInfo } = await getUserInfo({});
                    idByOA = userInfo?.idByOA || null;
                } catch { /* uid sẽ được bổ sung ở lần đồng bộ kế */ }
                report(true, idByOA);
            }
            setHidden(true);
            setToast(true);
            setTimeout(() => setToast(false), 3200);
        } catch (e) {
            const code = e?.code ?? e?.error_code ?? e?.error;
            if (String(code) === '-201') {
                // Khách từ chối: im lặng tuyệt đối — giữ thẻ, không
                // toast lỗi, không ghi gì. Bấm lại được bất cứ lúc nào.
            } else {
                // Lỗi khác (môi trường không hỗ trợ, mất mạng...): dự
                // phòng mở trang OA như đường cũ để khách vẫn có đường
                // quan tâm; trạng thái thật sẽ đồng bộ ở lần mở sau.
                try { window.open(OA_LINK, '_blank'); } catch { /* bỏ qua */ }
            }
        } finally {
            setBusy(false);
        }
    };

    if (toast) {
        return (
            <div className="zoa-toast" role="status">
                Đã quan tâm Daybreak — ưu đãi sẽ gửi qua Zalo
                <style>{`
                    .zoa-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 999; background: #24305E; color: #fff; font-size: 13.5px; font-weight: 600; padding: 12px 18px; border-radius: 999px; box-shadow: 0 8px 24px rgba(15,23,42,.28); max-width: calc(100vw - 32px); text-align: center; animation: zoa-toast-in .25s ease-out; }
                    @keyframes zoa-toast-in { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
                `}</style>
            </div>
        );
    }
    if (!cfg) return null;
    if (cfg.oa_card_enabled === false || cfg.oa_card_enabled === '0') return null;
    if (hidden) return null;

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
                <button type="button" className="zoa-btn" onClick={onFollow} disabled={busy}>Quan tâm</button>
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
                .zoa-btn { border: 0; border-radius: 12px; font-weight: 800; font-size: 13px; padding: 11px 22px; cursor: pointer; flex-shrink: 0; background: #F5A623; color: #3a2a00; }
                .zoa-btn:disabled { opacity: .6; }
            `}</style>
        </div>
    );
}
