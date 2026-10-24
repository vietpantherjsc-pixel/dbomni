import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api';

// Trang nhân viên xin nghỉ theo ca (public, KHÔNG cần đăng nhập admin)
// Token riêng: localStorage['xinnghi_token'] / ['xinnghi_emp']
// API (base /api, header Authorization: Bearer <token>):
// - POST /employee/phone-login {phone, pin_code}
// - GET  /employee/me
// - GET  /employee/shift-leaves/my-shifts
// - POST /employee/shift-leaves {date, work_shift_id, reason?}
// - GET  /employee/shift-leaves

const NAVY = '#24305E';
const ORANGE = '#F5A623';

const CSS = `
.xn-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.xn-wrap button{font-family:inherit;}
.xn-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 18px 18px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.xn-hd-user{display:flex;align-items:center;gap:10px;}
.xn-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.xn-name{font-size:15px;font-weight:700;line-height:1.25;}
.xn-sub{font-size:12px;opacity:.75;margin-top:1px;}
.xn-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.xn-logout{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:40px;white-space:nowrap;}
.xn-card{background:#fff;border-radius:12px;margin:12px 16px 0;padding:14px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.xn-card h3{font-size:15px;font-weight:700;color:${NAVY};margin-bottom:10px;}
.xn-bigbtn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;border:none;border-radius:14px;background:${NAVY};color:#fff;font-size:16px;font-weight:800;}
.xn-bigbtn:active{transform:scale(.97);}
.xn-bigbtn:disabled{opacity:.45;}
.xn-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:6px;}
.xn-field:focus{outline:none;border-color:${ORANGE};}
.xn-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.xn-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.xn-ok{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;}
.xn-note{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #f5dfae;color:#8a5a00;}
.xn-login{padding:40px 24px;}
.xn-send{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:16px;}
.xn-send:disabled{opacity:.4;}
.xn-row{display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #e8e9ee;border-radius:10px;padding:11px 12px;margin-bottom:8px;}
.xn-badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;}
.xn-b-pending{background:#fef3c7;color:#b45309;}
.xn-b-approved{background:#dcfce7;color:#15803d;}
.xn-b-rejected{background:#fee2e2;color:#b91c1c;}
.xn-empty{text-align:center;color:#6b7280;font-size:13.5px;padding:18px 8px;line-height:1.6;}
`;

const ST_LABEL = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Đã từ chối' };
const ST_CLS = { pending: 'xn-b-pending', approved: 'xn-b-approved', rejected: 'xn-b-rejected' };
const fmtD = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';

export default function XinNghi() {
  const goHub = () => { let t = ''; try { t = new URLSearchParams(window.location.search).get('t') || localStorage.getItem('staff_hub_t') || ''; } catch (e) {} window.location.href = '/nhan-vien' + (t ? '?t=' + encodeURIComponent(t) : ''); };
    const [token, setToken] = useState(() => localStorage.getItem('xinnghi_token') || '');
    const [emp, setEmp] = useState(() => { try { return JSON.parse(localStorage.getItem('xinnghi_emp') || 'null'); } catch (e) { return null; } });
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [loginErr, setLoginErr] = useState('');
    const [shifts, setShifts] = useState([]);
    const [myReqs, setMyReqs] = useState([]);
    const [sel, setSel] = useState('');
    const [reason, setReason] = useState('');
    const [msg, setMsg] = useState(null); // {ok, text}
    const [tab, setTab] = useState('leave'); // 'leave' | 'swap'

    const api = (path, opts = {}) => axios({ url: API + path, headers: { Authorization: 'Bearer ' + token }, ...opts });

    const loadAll = async () => {
        try {
            const [s, r] = await Promise.all([
                api('/employee/shift-leaves/my-shifts'),
                api('/employee/shift-leaves'),
            ]);
            setShifts(s.data?.data || []);
            setMyReqs(r.data?.data || []);
        } catch (e) { /* bỏ qua */ }
    };
    useEffect(() => { if (token) loadAll(); }, [token]); // eslint-disable-line

    const doLogin = async () => {
        setLoginErr('');
        try {
            const r = await axios.post(API + '/employee/phone-login', { phone: phone.trim(), pin_code: pin.trim() });
            const tk = r.data?.token || r.data?.data?.token;
            const info = r.data?.employee || r.data?.data?.employee;
            if (!tk) throw new Error('Đăng nhập thất bại');
            localStorage.setItem('xinnghi_token', tk);
            localStorage.setItem('xinnghi_emp', JSON.stringify(info));
            setToken(tk); setEmp(info);
        } catch (e) { setLoginErr(e.response?.data?.message || 'SĐT hoặc PIN chưa đúng'); }
    };
    const logout = () => {
        localStorage.removeItem('xinnghi_token');
        localStorage.removeItem('xinnghi_emp');
        setToken(''); setEmp(null);
    };

    const submit = async () => {
        setMsg(null);
        if (!sel) return setMsg({ ok: false, text: 'Hãy chọn ca muốn xin nghỉ.' });
        const [date, wsid] = sel.split('|');
        try {
            const r = await api('/employee/shift-leaves', { method: 'post', data: { date, work_shift_id: Number(wsid), reason: reason.trim() || undefined } });
            setMsg({ ok: true, text: r.data?.message || 'Đã gửi yêu cầu.' });
            setSel(''); setReason('');
            loadAll();
        } catch (e) {
            setMsg({ ok: false, text: e.response?.data?.message || 'Gửi thất bại' });
        }
    };

    return (
        <div className="xn-wrap">
            <style>{CSS}</style>
            {!token ? (
                <div className="xn-login">
                    <button onClick={goHub} aria-label="Quay lại hub"
                      style={{ background: '#eef0f6', border: 'none', color: NAVY, fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 10, minHeight: 36, marginBottom: 12 }}>‹ Về Cổng nhân viên</button>
                    <h2 style={{ color: NAVY, fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Xin nghỉ theo ca</h2>
                    <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>Đăng nhập bằng SĐT + PIN để gửi yêu cầu nghỉ cho ca đã đăng ký.</p>
                    <label className="xn-label">Số điện thoại</label>
                    <input className="xn-field" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="VD: 0901234567" />
                    <label className="xn-label">Mã PIN</label>
                    <input className="xn-field" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN của bạn" />
                    {loginErr && <div className="xn-msg" style={{ margin: '12px 0 0' }}>{loginErr}</div>}
                    <button className="xn-send" onClick={doLogin} disabled={!phone.trim() || !pin.trim()}>Đăng nhập</button>
                </div>
            ) : (
                <>
                    <div className="xn-hd">
                        <div className="xn-hd-user">
                            <div className="xn-avatar">{(emp?.full_name || 'N')[0]}</div>
                            <div style={{ flex: 1 }}>
                                <div className="xn-name">{emp?.full_name || 'Nhân viên'}</div>
                                <div className="xn-sub">Xin nghỉ theo ca</div>
                            </div>
                            <button className="xn-logout" onClick={() => { let t = ''; try { t = new URLSearchParams(window.location.search).get('t') || localStorage.getItem('staff_hub_t') || ''; } catch (e) {} window.location.href = '/nhan-vien' + (t ? '?t=' + encodeURIComponent(t) : ''); }} aria-label="Quay lại hub">‹ Hub</button>
                            <button className="xn-logout" onClick={logout}>Đăng xuất</button>
                        </div>
                    </div>

                    <div className="xn-note">⏰ Chỉ được xin nghỉ trước giờ bắt đầu ca <b>ít nhất 48 giờ</b>. Sát giờ, vui lòng liên hệ quản lý trực tiếp.</div>

                    <div style={{ display: 'flex', gap: 8, margin: '12px 16px 0' }}>
                        {[['leave', 'Xin nghỉ'], ['swap', 'Đổi ca']].map(([k, l]) => (
                            <button key={k} onClick={() => setTab(k)} className="xn-bigbtn" style={{ minHeight: 44, fontSize: 14, background: tab === k ? NAVY : '#e8e9ee', color: tab === k ? '#fff' : '#6b7280' }}>{l}</button>
                        ))}
                    </div>

                    {tab === 'leave' ? (<>
                    <div className="xn-card">
                        <h3>📝 Tạo yêu cầu nghỉ</h3>
                        <label className="xn-label">Ca đã đăng ký / đã xếp</label>
                        <select className="xn-field" value={sel} onChange={(e) => setSel(e.target.value)}>
                            <option value="">— Chọn ca —</option>
                            {shifts.map((s) => (
                                <option key={s.date + '|' + s.work_shift_id} value={s.date + '|' + s.work_shift_id}>
                                    {fmtD(s.date)} — {s.shift_name} ({s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)})
                                </option>
                            ))}
                        </select>
                        {shifts.length === 0 && <div className="xn-empty">Không có ca nào sắp tới.</div>}
                        <label className="xn-label">Lý do</label>
                        <input className="xn-field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: việc gia đình" />
                        <button className="xn-bigbtn" style={{ marginTop: 14 }} onClick={submit} disabled={!sel}>Gửi yêu cầu nghỉ</button>
                    </div>

                    {msg && <div className={msg.ok ? 'xn-ok' : 'xn-msg'}>{msg.text}</div>}

                    <div className="xn-card">
                        <h3>📋 Yêu cầu của tôi</h3>
                        {myReqs.length === 0 ? <div className="xn-empty">Chưa có yêu cầu nào.</div> : myReqs.map((r) => (
                            <div key={r.id} className="xn-row">
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtD(typeof r.date === 'string' ? r.date : r.date?.slice(0, 10))} — {r.work_shift?.name}</div>
                                    <div style={{ fontSize: 12, color: '#6b7280' }}>{r.reason || 'Không có lý do'}</div>
                                </div>
                                <span className={`xn-badge ${ST_CLS[r.status] || ''}`}>{ST_LABEL[r.status] || r.status}</span>
                            </div>
                        ))}
                    </div>
                    </>) : <SwapTab api={api} shifts={shifts} fmtD={fmtD} />}
                </>
            )}
        </div>
    );
}

// Spec P4-B5: tab đổi ca — A tạo yêu cầu → B xác nhận → quản lý duyệt
function SwapTab({ api, shifts, fmtD }) {
    const [mySched, setMySched] = useState('');
    const [date, setDate] = useState('');
    const [cols, setCols] = useState([]);
    const [theirSched, setTheirSched] = useState('');
    const [pending, setPending] = useState([]);
    const [mine, setMine] = useState([]);
    const [msg, setMsg] = useState(null);

    const loadLists = async () => {
        try {
            const [p, m] = await Promise.all([
                api('/employee/shift-swaps/pending-for-me'),
                api('/employee/shift-swaps/my-requests'),
            ]);
            setPending(p.data?.data || []);
            setMine(m.data?.data || []);
        } catch (e) { /* bỏ qua */ }
    };
    useEffect(() => { loadLists(); }, []); // eslint-disable-line

    const loadCols = async (d) => {
        setDate(d); setTheirSched(''); setCols([]);
        if (!d) return;
        try {
            const r = await api('/employee/shift-swaps/colleagues', { params: { date: d } });
            setCols(r.data?.data || []);
        } catch (e) { setMsg({ ok: false, text: e.response?.data?.message || 'Tải ca đồng nghiệp thất bại' }); }
    };

    const submit = async () => {
        setMsg(null);
        if (!mySched || !theirSched) return setMsg({ ok: false, text: 'Chọn ca của bạn và ca muốn đổi.' });
        const col = cols.find((c) => String(c.work_schedule_id) === theirSched);
        try {
            const r = await api('/employee/shift-swaps', { method: 'post', data: {
                requester_schedule_id: Number(mySched),
                target_employee_id: col.employee_id,
                target_schedule_id: Number(theirSched),
            }});
            setMsg({ ok: true, text: r.data?.message || 'Đã gửi yêu cầu.' });
            setMySched(''); setTheirSched(''); setDate(''); setCols([]);
            loadLists();
        } catch (e) { setMsg({ ok: false, text: e.response?.data?.message || 'Gửi thất bại' }); }
    };

    const confirm = async (id, accept) => {
        try {
            const r = await api(`/employee/shift-swaps/${id}/confirm`, { method: 'post', data: { accept } });
            setMsg({ ok: true, text: r.data?.message || 'Đã xử lý.' });
            loadLists();
        } catch (e) { setMsg({ ok: false, text: e.response?.data?.message || 'Thất bại' }); }
    };

    const ST = { pending: 'Chờ B xác nhận', target_confirmed: 'Chờ quản lý duyệt', approved: 'Đã duyệt', rejected: 'Đã từ chối' };
    return (
        <div>
            <div className="xn-card">
                <h3>🔄 Tạo yêu cầu đổi ca</h3>
                <label className="xn-label">Ca của bạn</label>
                <select className="xn-field" value={mySched} onChange={(e) => setMySched(e.target.value)}>
                    <option value="">— Chọn ca của bạn —</option>
                    {shifts.filter((s) => s.work_schedule_id).map((s) => (
                        <option key={s.work_schedule_id} value={s.work_schedule_id}>
                            {fmtD(s.date)} — {s.shift_name} ({s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)})
                        </option>
                    ))}
                </select>
                <label className="xn-label">Ngày muốn đổi (ca của đồng nghiệp)</label>
                <input className="xn-field" type="date" value={date} onChange={(e) => loadCols(e.target.value)} />
                {cols.length > 0 && (<>
                    <label className="xn-label">Ca của đồng nghiệp</label>
                    <select className="xn-field" value={theirSched} onChange={(e) => setTheirSched(e.target.value)}>
                        <option value="">— Chọn ca —</option>
                        {cols.map((c) => (
                            <option key={c.work_schedule_id} value={c.work_schedule_id}>
                                {c.employee_name} — {c.shift_name} ({c.start_time}–{c.end_time})
                            </option>
                        ))}
                    </select>
                </>)}
                <button className="xn-bigbtn" style={{ marginTop: 14 }} onClick={submit} disabled={!mySched || !theirSched}>Gửi yêu cầu đổi ca</button>
            </div>

            {msg && <div className={msg.ok ? 'xn-ok' : 'xn-msg'}>{msg.text}</div>}

            {pending.length > 0 && (
                <div className="xn-card">
                    <h3>📥 Chờ bạn xác nhận</h3>
                    {pending.map((r) => (
                        <div key={r.id} className="xn-row">
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.requester?.full_name} muốn đổi ca</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>
                                    Ca bạn: {r.target_schedule?.work_shift?.name} — Ca họ: {r.requester_schedule?.work_shift?.name}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => confirm(r.id, true)} style={{ background: '#dcfce7', color: '#15803d', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Đồng ý</button>
                                <button onClick={() => confirm(r.id, false)} style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Từ chối</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="xn-card">
                <h3>📋 Yêu cầu của tôi</h3>
                {mine.length === 0 ? <div className="xn-empty">Chưa có yêu cầu nào.</div> : mine.map((r) => (
                    <div key={r.id} className="xn-row">
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>Đổi với {r.target?.full_name}</div>
                            <div style={{ fontSize: 12, color: '#6b7280' }}>{r.requester_schedule?.work_shift?.name} ↔ {r.target_schedule?.work_shift?.name}</div>
                        </div>
                        <span className="xn-badge xn-b-pending">{ST[r.status] || r.status}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
