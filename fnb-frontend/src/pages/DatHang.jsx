import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api';
import { getStaffSession, staffSessionExpired } from '../utils/staffSession';
import DateInput from '../components/DateInput';
import HubConfirm from '../components/HubConfirm';
import { exportPurchaseOrderImage } from '../utils/purchaseOrderImage';

// Spec Phiếu đặt hàng NCC §6A (2026-11-08) — bề mặt Hub nhân viên, khuôn
// trang NhapKho: chi nhánh KHÓA theo phiên Hub (đổi CN = đăng nhập lại),
// gợi ý sắp hết theo chi nhánh phiên, phiếu đặt KHÔNG qua hàng chờ duyệt.
// API: GET/POST /employee/purchase-orders (+ /{id}, /mark-ordered, /cancel)
const NAVY = '#24305E';
const ORANGE = '#F5A623';

const CSS = `
.dh-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.dh-wrap button{font-family:inherit;}
.dh-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 12px 12px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.dh-hd-user{display:flex;align-items:center;gap:10px;}
.dh-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.dh-name{font-size:15px;font-weight:700;line-height:1.25;}
.dh-sub{font-size:12px;opacity:.75;margin-top:1px;}
.dh-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.dh-back{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:44px;white-space:nowrap;}
.dh-card{background:#fff;border-radius:12px;margin:12px 16px 0;padding:14px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.dh-card h3{font-size:15px;font-weight:700;color:${NAVY};margin-bottom:10px;}
.dh-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.dh-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:6px;box-sizing:border-box;}
.dh-field:focus{outline:none;border-color:${ORANGE};}
.dh-addbtn{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:12px;}
.dh-addbtn:active{transform:scale(.97);}
.dh-addbtn:disabled{opacity:.4;}
.dh-submit{background:${ORANGE};color:#fff;width:100%;min-height:54px;border:none;border-radius:12px;font-size:16px;font-weight:800;margin-top:12px;}
.dh-submit:active{transform:scale(.97);}
.dh-submit:disabled{opacity:.45;}
.dh-ghost{background:#fff;color:${NAVY};width:100%;min-height:50px;border:1.5px solid ${NAVY};border-radius:12px;font-size:15px;font-weight:700;margin-top:10px;}
.dh-item{border:1px solid #e8e9ee;border-radius:10px;padding:10px 12px;margin-bottom:8px;}
.dh-iname{font-weight:700;font-size:14px;line-height:1.4;}
.dh-idetail{font-size:12.5px;color:#6b7280;margin-top:4px;line-height:1.5;}
.dh-del{border:none;background:#fdeeee;color:#a12b2b;font-weight:800;font-size:13px;min-width:44px;min-height:44px;border-radius:10px;padding:0 10px;}
.dh-empty{text-align:center;color:#6b7280;font-size:13.5px;padding:18px 8px;line-height:1.6;}
.dh-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.dh-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%) translateY(10px);background:rgba(26,29,38,.92);color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;z-index:60;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;max-width:92vw;text-align:center;line-height:1.45;border-radius:16px;}
.dh-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.dh-login{padding:40px 24px;}
.dh-send{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:16px;}
.dh-search{position:relative;}
.dh-drop{position:absolute;left:0;right:0;top:100%;background:#fff;border:1.5px solid #e8e9ee;border-top:none;border-radius:0 0 12px 12px;z-index:30;max-height:240px;overflow-y:auto;box-shadow:0 8px 20px rgba(16,24,40,.12);}
.dh-opt{padding:12px;font-size:14px;font-weight:600;border-bottom:1px solid #f1f2f6;min-height:48px;display:flex;align-items:center;}
.dh-opt:last-child{border-bottom:none;}
.dh-chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11.5px;font-weight:700;}
.dh-po{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#fff;border:1px solid #e8e9ee;border-radius:12px;padding:12px;margin-bottom:8px;min-height:56px;}
.dh-po:active{background:#f6f7fb;}
.dh-lowrow{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f5ecd7;}
.dh-lowrow:last-child{border-bottom:none;}
.dh-check{width:22px;height:22px;accent-color:${NAVY};flex-shrink:0;}
.dh-qty{width:84px;min-height:44px;border:1.5px solid #e8e9ee;border-radius:10px;padding:8px;font-size:14px;text-align:right;box-sizing:border-box;}
.dh-unit{width:52px;flex:none;font-size:12.5px;color:#6b7280;}
.dh-2col{display:flex;gap:8px;}
.dh-2col>div{flex:1;min-width:0;}
`;

const STATUS = {
    draft: { label: 'Nháp', bg: '#fef3c7', color: '#92400e' },
    ordered: { label: 'Đã đặt', bg: '#dbeafe', color: '#1d4ed8' },
    received: { label: 'Đã nhận hàng', bg: '#dcfce7', color: '#15803d' },
    cancelled: { label: 'Đã hủy', bg: '#e5e7eb', color: '#6b7280' },
};

function auth(token) { return { headers: { Authorization: 'Bearer ' + token } }; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function isoToday() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDMY(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(ymd || '');
}
function qtyNum(s) { const n = parseFloat(String(s == null ? '' : s).trim().replace(',', '.')); return Number.isNaN(n) ? 0 : n; }
function fmtQty(n) { return (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 4 }); }
function errMsg(err, fallback) {
    const data = err?.response?.data;
    if (data?.errors) { const f = Object.values(data.errors)[0]?.[0]; if (f) return f; }
    return data?.message || fallback;
}

export default function DatHang({ embed } = {}) {
    const goHub = () => { window.location.href = '/nhan-vien'; };
    const sess = getStaffSession();
    const [token] = useState(() => (embed && embed.token) || (sess && sess.token) || '');
    const [emp, setEmp] = useState(() => (embed && embed.emp) || (sess && sess.emp) || null);
    useEffect(() => { if (embed && embed.emp) setEmp(embed.emp); }, [embed && embed.emp, embed && embed.branchId]);
    const branchId = (embed && embed.branchId) || (sess && sess.branchId) || (emp && emp.branch_id) || null;
    const branchName = (() => {
        const list = (emp && emp.branches) || [];
        const b = list.find((x) => (x.id || x) === branchId);
        return (b && b.name) || (emp && emp.branch_name) || '';
    })();

    const [view, setView] = useState('list'); // list | form | detail
    const [suppliers, setSuppliers] = useState([]);
    const [materials, setMaterials] = useState([]);
    const [rows, setRows] = useState([]);
    const [listErr, setListErr] = useState(false);
    const [detail, setDetail] = useState(null);
    const [toastMsg, setToastMsg] = useState('');
    const [toastOn, setToastOn] = useState(false);
    const toastTimer = useRef(null);
    const toast = (m, isErr) => {
        setToastMsg(m); setToastOn(true);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToastOn(false), isErr ? 5000 : 2400);
    };
    const expired = (e) => {
        if (e?.response?.status === 401) {
            if (embed && embed.onExpired) embed.onExpired(); else staffSessionExpired();
            return true;
        }
        return false;
    };

    const fetchList = async () => {
        try {
            const r = await axios.get(API + '/employee/purchase-orders', { ...auth(token), params: { branch_id: branchId, per_page: 50 } });
            setRows(r.data?.data?.data || []);
            setListErr(false);
        } catch (e) { if (!expired(e)) setListErr(true); }
    };
    useEffect(() => {
        if (!token) return;
        axios.get(API + '/employee/suppliers', auth(token)).then((r) => setSuppliers(r.data?.data || [])).catch((e) => expired(e));
        axios.get(API + '/employee/materials', auth(token)).then((r) => setMaterials(r.data?.data || [])).catch((e) => expired(e));
        fetchList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const openDetail = async (id) => {
        try {
            const r = await axios.get(API + '/employee/purchase-orders/' + id, { ...auth(token), params: { branch_id: branchId } });
            setDetail(r.data?.data);
            setView('detail');
        } catch (e) { if (!expired(e)) toast(errMsg(e, 'Không tải được phiếu.'), true); }
    };
    const [askAct, setAskAct] = useState(null); // {message, run}
    const doAct = async (path, okMsg) => {
        try {
            await axios.post(API + path, {}, { ...auth(token), params: { branch_id: branchId } });
            toast(okMsg);
            setDetail(null);
            setView('list');
            fetchList();
        } catch (e) { if (!expired(e)) toast(errMsg(e, 'Thao tác thất bại.'), true); }
    };
    const createReceipt = (po) => {
        if (embed && embed.goNhapPo) { embed.goNhapPo(po.id); return; }
        window.location.href = '/nhap-kho?po=' + po.id;
    };

    if (!token) {
        return (
            <div className="dh-wrap">
                <style>{CSS}</style>
                <div className="dh-login">
                    <div className="dh-hd" style={{ borderRadius: 12 }}>
                        <div className="dh-title">🛒 Đặt hàng</div>
                        <div className="dh-sub">Trang này dùng chung phiên đăng nhập của Cổng nhân viên</div>
                    </div>
                    <div className="dh-card">
                        <div style={{ fontSize: 14, lineHeight: 1.6 }}>Bạn chưa đăng nhập, hoặc phiên đã hết hạn. Đăng nhập 1 lần tại Cổng nhân viên là dùng được mọi mục.</div>
                        <button className="dh-send" onClick={goHub}>Đến Cổng nhân viên đăng nhập</button>
                    </div>
                </div>
            </div>
        );
    }

    const avatarLetter = ((emp && emp.full_name) || '?').trim().charAt(0).toUpperCase();
    const myId = emp?.id;
    const isMine = (po) => po && Number(po.created_by_employee_id) === Number(myId);

    return (
        <div className="dh-wrap">
            <style>{CSS}</style>
            <div className="dh-hd">
                <div className="dh-hd-user">
                    <div className="dh-avatar">{avatarLetter}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="dh-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
                        <div className="dh-sub">🏬 {branchName}</div>
                    </div>
                    <button className="dh-back" onClick={() => (embed && embed.onBack ? embed.onBack() : goHub())}>‹ Hub</button>
                </div>
                <div className="dh-title">🛒 Đặt hàng nhà cung cấp</div>
            </div>

            {view === 'list' && (
                <>
                    <div style={{ margin: '12px 16px 0' }}>
                        <button className="dh-addbtn" style={{ marginTop: 0 }} onClick={() => setView('form')}>＋ Tạo phiếu đặt hàng</button>
                    </div>
                    <div className="dh-card">
                        <h3>Phiếu đặt của {branchName || 'chi nhánh'}</h3>
                        {listErr ? (
                            <div className="dh-empty">⚠ Không tải được danh sách.<br />
                                <button className="dh-ghost" style={{ width: 'auto', padding: '0 18px' }} onClick={fetchList}>Thử lại</button>
                            </div>
                        ) : rows.length === 0 ? (
                            <div className="dh-empty">Chưa có phiếu đặt hàng nào ở chi nhánh này.</div>
                        ) : rows.map((po) => {
                            const st = STATUS[po.status] || {};
                            return (
                                <button key={po.id} className="dh-po" onClick={() => openDetail(po.id)}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 800, color: NAVY, fontSize: 14.5 }}>{po.code}</div>
                                        <div className="dh-idetail">{po.partner?.name || ''} · {fmtDMY(po.order_date)} · {po.items_count} mặt hàng · {po.creator_name || ''}</div>
                                    </div>
                                    <span className="dh-chip" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}

            {view === 'form' && (
                <PoFormHub
                    token={token} branchId={branchId} branchName={branchName}
                    suppliers={suppliers} materials={materials}
                    onCancel={() => setView('list')}
                    onDone={(msg) => { setView('list'); fetchList(); toast(msg); }}
                    onExpired={expired} toast={toast}
                />
            )}

            {view === 'detail' && detail && (
                <div className="dh-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h3 style={{ margin: 0, flex: 1 }}>{detail.code}</h3>
                        <span className="dh-chip" style={{ background: STATUS[detail.status]?.bg, color: STATUS[detail.status]?.color }}>{STATUS[detail.status]?.label}</span>
                    </div>
                    <div className="dh-idetail" style={{ fontSize: 13 }}>
                        NCC: <b>{detail.partner?.name}</b> · Ngày đặt {fmtDMY(detail.order_date)}<br />
                        Người tạo: {detail.creator_name} ({detail.creator_role})
                    </div>
                    {detail.note && <div style={{ background: '#fff7e8', borderLeft: '4px solid ' + ORANGE, padding: '8px 10px', fontSize: 13, marginTop: 8 }}><b>Ghi chú:</b> {detail.note}</div>}
                    <div style={{ marginTop: 10 }}>
                        {(detail.items || []).map((it) => (
                            <div key={it.id} className="dh-item" style={{ display: 'flex', gap: 8 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="dh-iname">{it.material_name}</div>
                                    <div className="dh-idetail">
                                        Đặt {fmtQty(it.quantity)} {it.unit_name}
                                        {Number(it.received_quantity) > 0 && <> · Đã nhận {fmtQty(it.received_quantity)}</>}
                                        {it.note && <> · {it.note}</>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    {(detail.inbound_receipts || []).length > 0 && (
                        <div className="dh-idetail" style={{ fontSize: 13 }}>
                            Phiếu nhập liên kết: {detail.inbound_receipts.map((r) => `${r.code} (${r.status === 'confirmed' ? 'đã nhập' : r.status === 'draft' ? 'chờ duyệt' : 'đã hủy'})`).join(' · ')}
                        </div>
                    )}
                    {detail.status === 'draft' && isMine(detail) && (
                        <button className="dh-ghost" onClick={() => setView('edit')}>✎ Sửa phiếu nháp</button>
                    )}
                    {detail.status === 'draft' && (
                        <button className="dh-submit" onClick={() => setAskAct({ message: `Chuyển phiếu ${detail.code} sang Đã đặt?`, run: () => doAct(`/employee/purchase-orders/${detail.id}/mark-ordered`, 'Đã chuyển sang Đã đặt.') })}>Đặt hàng</button>
                    )}
                    {detail.status === 'ordered' && (
                        <button className="dh-submit" onClick={() => createReceipt(detail)}>Tạo phiếu nhập từ phiếu này</button>
                    )}
                    {(detail.status === 'ordered' || detail.status === 'received') && (
                        <button className="dh-ghost" onClick={() => exportPurchaseOrderImage(detail)}>📷 Xuất ảnh gửi NCC</button>
                    )}
                    {(detail.status === 'draft' || detail.status === 'ordered') && isMine(detail) && (
                        <button className="dh-ghost" style={{ borderColor: '#e5b4b4', color: '#a12b2b' }}
                            onClick={() => setAskAct({ message: `Hủy phiếu đặt hàng ${detail.code}?`, run: () => doAct(`/employee/purchase-orders/${detail.id}/cancel`, 'Đã hủy phiếu.') })}>Hủy phiếu</button>
                    )}
                    <button className="dh-ghost" onClick={() => { setDetail(null); setView('list'); }}>‹ Về danh sách</button>
                </div>
            )}

            {view === 'edit' && detail && (
                <PoFormHub
                    token={token} branchId={branchId} branchName={branchName}
                    suppliers={suppliers} materials={materials} editingPo={detail}
                    onCancel={() => setView('detail')}
                    onDone={(msg) => { setView('list'); setDetail(null); fetchList(); toast(msg); }}
                    onExpired={expired} toast={toast}
                />
            )}

            <HubConfirm
                open={!!askAct}
                title="Xác nhận"
                message={askAct ? askAct.message : ''}
                onCancel={() => setAskAct(null)}
                onConfirm={() => { const run = askAct?.run; setAskAct(null); if (run) run(); }}
            />
            <div className={`dh-toast ${toastOn ? 'show' : ''}`}>{toastMsg}</div>
        </div>
    );
}

// ---------- Form tạo / sửa nháp (Hub) ----------
function PoFormHub({ token, branchId, branchName, suppliers, materials, editingPo, onCancel, onDone, onExpired, toast }) {
    const [partnerId, setPartnerId] = useState(editingPo?.partner_id ? String(editingPo.partner_id) : '');
    const [orderDate, setOrderDate] = useState(editingPo?.order_date || isoToday());
    const [note, setNote] = useState(editingPo?.note || '');
    const [lines, setLines] = useState(() => (editingPo?.items || []).map((it) => ({
        key: 'po' + it.id, materialId: it.material_id, name: it.material_name, baseUnit: it.base_unit,
        unitName: it.unit_name, qty: String(it.quantity), note: it.note || '',
    })));
    const [lowRows, setLowRows] = useState([]);
    // Vá chớp-trống (2026-11-08): phân biệt ĐANG TẢI với TRỐNG THẬT ở mục
    // sắp hết — khởi tạo theo branchId để không lóe câu "chưa có" 1 khung.
    const [lowLoading, setLowLoading] = useState(!!branchId);
    const [lowChecked, setLowChecked] = useState({});
    const [query, setQuery] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!branchId) { setLowLoading(false); return; }
        setLowLoading(true);
        axios.get(API + '/inventory/branch/' + branchId, auth(token))
            .then((r) => {
                const rows = (r.data?.data || []).filter((x) => x.is_low_stock && x.is_active);
                setLowRows(rows);
                const init = {};
                rows.forEach((x) => { init[x.material_id] = { checked: false, qty: String(Math.max(1, Math.ceil((Number(x.minimum_stock) || 0) - (Number(x.current_stock) || 0)))) }; });
                setLowChecked(init);
                setLowLoading(false);
            })
            .catch((e) => { setLowLoading(false); onExpired(e); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    const matById = (id) => materials.find((m) => m.id === Number(id));
    const unitOptions = (m) => (m ? [...new Set([m.unit, ...((m.units || []).map((u) => u.unit_name))])] : []);
    const addLine = (m, qty, unitName) => {
        const unit = unitName || m.unit;
        setLines((prev) => {
            const idx = prev.findIndex((l) => l.materialId === m.id && l.unitName === unit);
            if (idx >= 0) {
                const cp = [...prev];
                cp[idx] = { ...cp[idx], qty: String(qtyNum(cp[idx].qty) + (Number(qty) || 0)) };
                return cp;
            }
            return [...prev, { key: Date.now() + '_' + Math.random().toString(36).slice(2, 7), materialId: m.id, name: m.name, baseUnit: m.unit, unitName: unit, qty: String(qty ?? ''), note: '' }];
        });
    };
    const addCheckedLow = () => {
        let n = 0;
        lowRows.forEach((x) => {
            const c = lowChecked[x.material_id];
            if (c?.checked && Number(c.qty) > 0) { const m = matById(x.material_id); if (m) { addLine(m, Number(c.qty), m.unit); n++; } }
        });
        if (n) toast('Đã thêm ' + n + ' dòng sắp hết.');
    };
    const setLine = (key, field, value) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
    const results = query.trim()
        ? materials.filter((m) => m.is_active !== false && m.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
        : [];

    const submit = async (asStatus) => {
        const items = lines.filter((l) => qtyNum(l.qty) > 0);
        if (!partnerId) { toast('Chọn nhà cung cấp trước nhé.', true); return; }
        if (!items.length) { toast('Phiếu phải có ít nhất 1 dòng có số lượng.', true); return; }
        setSaving(true);
        try {
            const payload = {
                branch_id: branchId,
                partner_id: Number(partnerId),
                order_date: orderDate,
                note: note.trim() || null,
                as_status: asStatus,
                items: items.map((l) => ({ material_id: l.materialId, quantity: qtyNum(l.qty), unit_name: l.unitName, note: l.note.trim() || null })),
            };
            if (editingPo) await axios.patch(API + '/employee/purchase-orders/' + editingPo.id, payload, auth(token));
            else await axios.post(API + '/employee/purchase-orders', payload, auth(token));
            onDone(editingPo ? 'Đã cập nhật phiếu đặt.' : (asStatus === 'ordered' ? 'Đã tạo và Đặt hàng.' : 'Đã lưu nháp phiếu đặt.'));
        } catch (e) {
            if (!onExpired(e)) toast(errMsg(e, 'Lưu phiếu thất bại.'), true);
        }
        setSaving(false);
    };

    return (
        <>
            <div className="dh-card">
                <h3>{editingPo ? 'Sửa phiếu ' + editingPo.code : 'Tạo phiếu đặt hàng'} — {branchName}</h3>
                <label className="dh-label" style={{ marginTop: 2 }}>Nhà cung cấp</label>
                <select className="dh-field" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">— Chọn NCC —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <label className="dh-label">Ngày đặt</label>
                <DateInput value={orderDate} onChange={setOrderDate} className="dh-field" />
                <label className="dh-label">Ghi chú chung</label>
                <input className="dh-field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Giao trước 9h sáng mai" />
            </div>

            <div className="dh-card" style={{ background: '#fffbeb', border: '1px solid #f5dfae' }}>
                <h3>⚠ Nguyên liệu sắp hết tại {branchName || 'chi nhánh'}</h3>
                {lowLoading ? (
                    <div className="dh-empty" style={{ padding: 6 }}>Đang tải nguyên liệu sắp hết…</div>
                ) : lowRows.length === 0 ? (
                    <div className="dh-empty" style={{ padding: 6 }}>Chi nhánh này chưa có nguyên liệu nào sắp hết.</div>
                ) : (
                    <>
                        {lowRows.map((x) => {
                            const c = lowChecked[x.material_id] || { checked: false, qty: '' };
                            return (
                                <div key={x.material_id} className="dh-lowrow">
                                    <input type="checkbox" className="dh-check" checked={!!c.checked}
                                        onChange={(e) => setLowChecked({ ...lowChecked, [x.material_id]: { ...c, checked: e.target.checked } })} />
                                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
                                        <b>{x.name}</b>
                                        <div className="dh-idetail">tồn {fmtQty(x.current_stock)} / tối thiểu {fmtQty(x.minimum_stock)} {x.unit}</div>
                                    </div>
                                    <input type="number" min="0" step="any" className="dh-qty" value={c.qty}
                                        onChange={(e) => setLowChecked({ ...lowChecked, [x.material_id]: { ...c, qty: e.target.value } })} />
                                    <span className="dh-unit">{x.unit}</span>
                                </div>
                            );
                        })}
                        <button className="dh-addbtn" onClick={addCheckedLow}>Thêm các dòng đã tích</button>
                    </>
                )}
            </div>

            <div className="dh-card">
                <h3>Dòng đặt hàng ({lines.length})</h3>
                <div className="dh-search">
                    <input className="dh-field" style={{ marginTop: 0 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Gõ tên nguyên liệu để thêm dòng…" />
                    {results.length > 0 && (
                        <div className="dh-drop">
                            {results.map((m) => (
                                <div key={m.id} className="dh-opt" onClick={() => { addLine(m, ''); setQuery(''); }}>
                                    {m.name} <small style={{ color: '#6b7280', marginLeft: 6 }}>({m.unit})</small>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div style={{ marginTop: 10 }}>
                    {lines.map((l) => {
                        const m = matById(l.materialId);
                        return (
                            <div key={l.key} className="dh-item">
                                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                    <div className="dh-iname" style={{ flex: 1 }}>{l.name}</div>
                                    <button className="dh-del" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}>×</button>
                                </div>
                                <div className="dh-2col" style={{ marginTop: 6 }}>
                                    <div>
                                        <div className="dh-idetail">Đơn vị</div>
                                        <select className="dh-field" style={{ minHeight: 44, marginTop: 2 }} value={l.unitName} onChange={(e) => setLine(l.key, 'unitName', e.target.value)}>
                                            {unitOptions(m).map((u) => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <div className="dh-idetail">Số lượng</div>
                                        <input type="number" min="0" step="any" className="dh-field" style={{ minHeight: 44, marginTop: 2, textAlign: 'right' }} value={l.qty} onChange={(e) => setLine(l.key, 'qty', e.target.value)} />
                                    </div>
                                </div>
                                <input className="dh-field" style={{ minHeight: 44 }} value={l.note} onChange={(e) => setLine(l.key, 'note', e.target.value)} placeholder="Ghi chú dòng (in trên ảnh phiếu)" />
                            </div>
                        );
                    })}
                    {lines.length === 0 && <div className="dh-empty" style={{ padding: 8 }}>Chưa có dòng nào — tích từ khối sắp hết hoặc gõ tìm nguyên liệu.</div>}
                </div>
                <button className="dh-ghost" disabled={saving} onClick={() => submit('draft')}>Lưu nháp</button>
                <button className="dh-submit" disabled={saving} onClick={() => submit('ordered')}>{saving ? 'Đang lưu…' : 'Đặt hàng'}</button>
                <button className="dh-ghost" onClick={onCancel}>‹ Hủy bỏ</button>
            </div>
        </>
    );
}
