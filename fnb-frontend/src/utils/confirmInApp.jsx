import React, { useEffect, useState } from 'react';

// Sổ #23 (2026-11-04): thay hộp thoại confirm() nguyên thủy của trình duyệt cho
// các nút DUYỆT/XÁC NHẬN phía Admin. Hộp thoại nguyên thủy bị các môi trường
// không trưng dialog (trình duyệt kiểm tự động, webview nhúng) nuốt im lặng
// thành "chưa xác nhận" → thao tác chết mà không phát request, không lỗi nào.
// confirmInApp hiện một modal nội bộ trong trang (ConfirmHost gắn 1 lần ở
// AdminLayout) nên bấm được ở mọi môi trường. Nơi nào không có ConfirmHost
// (ngoài các trang Admin) thì tự rơi về window.confirm như cũ.
let host = null; // { open(message) -> Promise<boolean> }

export function confirmInApp(message) {
    if (host) return host.open(String(message ?? ''));
    try { return Promise.resolve(window.confirm(String(message ?? ''))); }
    catch { return Promise.resolve(false); }
}

export function ConfirmHost() {
    const [dlg, setDlg] = useState(null); // { message, resolve }
    useEffect(() => {
        host = {
            open: (message) => new Promise((resolve) => {
                setDlg((prev) => {
                    if (prev) prev.resolve(false); // hộp mới tới: hộp cũ coi như Hủy
                    return { message, resolve };
                });
            }),
        };
        return () => { host = null; };
    }, []);
    if (!dlg) return null;
    const close = (ok) => { dlg.resolve(ok); setDlg(null); };
    return (
        <div className="m-modal-backdrop" style={{ zIndex: 200 }} onClick={() => close(false)}>
            <div className="m-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
                <div className="m-modal-head">Xác nhận thao tác</div>
                <div className="m-modal-body" style={{ whiteSpace: 'pre-line', fontSize: 14 }}>{dlg.message}</div>
                <div className="m-modal-foot">
                    <button className="m-btn m-btn-ghost" style={{ minHeight: 40 }} onClick={() => close(false)}>Hủy bỏ</button>
                    <button className="m-btn m-btn-primary" style={{ minHeight: 40 }} onClick={() => close(true)} autoFocus>Đồng ý</button>
                </div>
            </div>
        </div>
    );
}
