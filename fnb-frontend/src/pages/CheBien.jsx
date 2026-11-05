import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api'; // API tương đối — chạy được trên điện thoại (IP LAN)
import HubPinPrompt from '../components/HubPinPrompt'; // Gói phiên Hub (2026-11-05): PIN step-up chạy sản xuất
import { getStaffSession, clearStaffSession, staffSessionExpired, staffBranchName } from '../utils/staffSession';
import { ensurePinToken, cachedPinToken, clearPinToken } from '../utils/staffPin';

// Trang nhân viên nhập phiếu Chế biến (bán thành phẩm) trên điện thoại (public, KHÔNG cần đăng nhập admin)
// Phiên CHUNG của Hub (gói phiên Hub 2026-11-05): staff_token/staff_emp/staff_branch_id — đăng nhập 1 lần tại /nhan-vien
// API: GET /employee/me, GET /employee/production-materials,
//      GET /employee/production-recipes?material_id=, POST /employee/productions, GET /employee/productions

const NAVY = '#24305E';
const ORANGE = '#F5A623';

const CSS = `
.cb-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.cb-wrap button{font-family:inherit;}
.cb-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 12px 12px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.cb-hd-user{display:flex;align-items:center;gap:10px;}
.cb-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.cb-name{font-size:15px;font-weight:700;line-height:1.25;}
.cb-sub{font-size:12px;opacity:.75;margin-top:1px;}
.cb-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.cb-logout{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:44px;white-space:nowrap;}
.cb-logout:active{transform:scale(.95);}
.cb-card{background:#fff;border-radius:12px;margin:12px 16px 0;padding:14px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.cb-card h3{font-size:15px;font-weight:700;color:${NAVY};margin-bottom:10px;}
.cb-empty{text-align:center;color:#6b7280;font-size:13.5px;padding:18px 8px;line-height:1.6;}
.cb-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:6px;}
.cb-field:focus{outline:none;border-color:${ORANGE};}
.cb-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.cb-confirm{background:${ORANGE};color:#fff;width:100%;min-height:52px;border:none;border-radius:12px;font-size:15.5px;font-weight:800;margin-top:14px;}
.cb-confirm:active{transform:scale(.97);}
.cb-confirm:disabled{opacity:.45;}
.cb-note{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #f5dfae;color:#8a5a00;}
.cb-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%) translateY(10px);background:rgba(26,29,38,.92);color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;border-radius:999px;z-index:60;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;max-width:92vw;text-align:center;line-height:1.45;border-radius:16px;}
.cb-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.cb-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.cb-login{padding:40px 24px;}
.cb-pin{font-size:30px;font-weight:800;letter-spacing:12px;text-align:center;}
.cb-send{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:16px;}
.cb-send:active{transform:scale(.97);}
.cb-send:disabled{opacity:.4;}
.cb-tbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;}
.cb-tbl th{text-align:left;font-size:11.5px;color:#6b7280;font-weight:700;padding:6px 4px;border-bottom:1px solid #e8e9ee;}
.cb-tbl td{padding:8px 4px;border-bottom:1px solid #f1f2f5;vertical-align:top;line-height:1.45;}
.cb-tbl tr:last-child td{border-bottom:none;}
.cb-short{background:#fef2f2;}
.cb-short .cb-need{color:#dc2626;font-weight:800;}
.cb-need{font-weight:700;color:${NAVY};}
.cb-stock{font-size:12px;color:#6b7280;}
.cb-stock.bad{color:#dc2626;font-weight:700;}
.cb-hrow{display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #e8e9ee;border-radius:10px;padding:10px 12px;margin-bottom:8px;}
.cb-hrow:last-child{margin-bottom:0;}
.cb-hn{font-weight:600;font-size:13.5px;line-height:1.4;}
.cb-hd2{font-size:12px;color:#6b7280;margin-top:3px;}
.cb-hq{font-weight:800;color:${NAVY};font-size:14px;white-space:nowrap;}
`;

function auth(token) {
  return { headers: { Authorization: 'Bearer ' + token } };
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
// "2026-10-10 14:35:22" hoặc ISO → "14:35"
function fmtHM(dt) {
  const m = String(dt || '').match(/(\d{2}):(\d{2})/);
  return m ? m[1] + ':' + m[2] : '';
}
// "2026-10-10 14:35:22" → "10/10"
function fmtDM(dt) {
  const m = String(dt || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] : '';
}
function fmtQty(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}

export default function CheBien() {
  const goHub = () => { window.location.href = '/nhan-vien'; }; // Gói phiên Hub 2026-11-05: không gắn ?t=
  const session = getStaffSession();
  const [token, setToken] = useState(() => (session ? session.token : ''));
  const [emp, setEmp] = useState(() => (session ? session.emp : null));

  const [materials, setMaterials] = useState([]); // [{id, name, unit}]
  const [hist, setHist] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);

  const [materialId, setMaterialId] = useState('');
  const [recipe, setRecipe] = useState(null); // {material, recipes:[{raw_material, quantity, stock_qty}]}
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');

  // Spec P4-A1: mở từ cảnh báo BTP thiếu (?material_id=) → chọn sẵn BTP
  useEffect(() => {
    try {
      const mid = new URLSearchParams(window.location.search).get('material_id');
      if (mid && materials.some((m) => String(m.id) === String(mid))) onPickMaterial(mid);
    } catch (e) {}
  }, [materials]); // eslint-disable-line

  const toastTimer = React.useRef(null); // UX 2026-10-26 (🟡L29): toast lỗi hiện lâu hơn toast thường
  const toast = (m, isErr) => {
    setToastMsg(m);
    setToastOn(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastOn(false), isErr ? 5000 : 2600);
  };
  const toastErr = (m) => toast(m, true);

  const logout = () => { // Gói phiên Hub 2026-11-05: đăng xuất = hủy phiên chung tại Hub
    clearStaffSession();
    setToken(''); setEmp(null);
    window.location.href = '/nhan-vien';
  };

  const expired = (e) => { // Gói phiên Hub 2026-11-05: hết phiên xử lý tập trung tại Hub
    if (e && e.response && e.response.status === 401) {
      staffSessionExpired();
      return true;
    }
    return false;
  };

  const loadBase = async (tk) => {
    setLoading(true);
    try {
      const [m, h] = await Promise.all([
        axios.get(API + '/employee/production-materials', auth(tk)),
        axios.get(API + '/employee/productions', auth(tk)),
      ]);
      setMaterials((m.data && m.data.data) || []);
      setHist((h.data && h.data.data) || []);
    } catch (e) {
      if (expired(e)) return;
      toastErr(errMsg(e, 'Không tải được dữ liệu.'));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (token) loadBase(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);


  const onPickMaterial = async (id) => {
    setMaterialId(id);
    setRecipe(null);
    if (!id) return;
    setRecipeLoading(true);
    try {
      const r = await axios.get(API + '/employee/production-recipes', { ...auth(token), params: { material_id: id } });
      setRecipe((r.data && r.data.data) || null);
    } catch (e) {
      if (expired(e)) return;
      toastErr(errMsg(e, 'Không tải được định mức.'));
    } finally { setRecipeLoading(false); }
  };

  const qtyNum = parseFloat(String(qty).replace(',', '.')) || 0;
  // Gói 55 p11c: định mức theo mẻ — quantity là NL cho 1 mẻ (batch_output_qty đơn vị BTP)
  const batchOut = recipe?.batch_output_qty ? Number(recipe.batch_output_qty) : 1;
  const batches = batchOut > 0 ? qtyNum / batchOut : 0;
  const rows = (recipe && recipe.recipes ? recipe.recipes : []).map((rc) => {
    const need = Number(rc.quantity || 0) * batches;
    const stock = Number(rc.stock_qty || 0);
    return { ...rc, need, stock, short: need - stock > 1e-9 };
  });
  const anyShort = rows.some((r) => r.short);
  const canConfirm = materialId && qtyNum > 0 && rows.length > 0 && !anyShort && !saving;

  const [confirming, setConfirming] = useState(false); // UX 2026-10-26 (🟠27): bước xác nhận riêng trước khi trừ kho FIFO thật (trước đây bấm 1 nút là trừ ngay)
  // Gói phiên Hub (2026-11-05): chạy sản xuất chạy thẳng không qua duyệt →
  // PIN step-up (purpose 'production', token Cache 5 phút phía server).
  const [pinPrompt, setPinPrompt] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinErr, setPinErr] = useState('');
  const onConfirmProduce = () => {
    if (!canConfirm) return;
    const cached = cachedPinToken('production');
    if (cached) { submit(cached); return; }
    setPinErr(''); setPinPrompt(true);
  };
  const submitPin = async (pinCode) => {
    setPinBusy(true); setPinErr('');
    try {
      const t = await ensurePinToken(token, 'production', pinCode);
      setPinPrompt(false);
      await submit(t);
    } catch (e) {
      if (e && e.response && e.response.status === 401) { expired(e); return; }
      setPinErr(errMsg(e, 'Mã PIN không đúng.'));
    } finally { setPinBusy(false); }
  };
  const submit = async (pinToken) => {
    if (!canConfirm) return;
    setSaving(true);
    try {
      const r = await axios.post(API + '/employee/productions', {
        material_id: parseInt(materialId, 10),
        quantity: qtyNum,
        note: note.trim() || undefined,
        pin_token: pinToken,
      }, auth(token));
      toast((r.data && r.data.message) || 'Đã tạo phiếu chế biến ✓');
      setConfirming(false);
      setMaterialId(''); setRecipe(null); setQty(''); setNote('');
      loadBase(token);
    } catch (e) {
      if (expired(e)) return;
      if (e && e.response && e.response.data && e.response.data.code === 'PIN_REQUIRED') {
        clearPinToken('production');
        setPinErr(''); setPinPrompt(true);
        toast('Cần xác nhận PIN để chạy sản xuất.');
        return;
      }
      toastErr(errMsg(e, 'Tạo phiếu thất bại.'));
    } finally { setSaving(false); }
  };

  const todayHist = hist.filter((h) => String(h.created_at || '').slice(0, 10) === todayIso());
  const selMat = materials.find((m) => String(m.id) === String(materialId));

  // Gói phiên Hub (2026-11-05): không còn đăng nhập riêng — chưa có phiên
  // chung thì hướng NV về Cổng nhân viên đăng nhập 1 lần.
  if (!token) {
    return (
      <div className="cb-wrap">
        <style>{CSS}</style>
        <div className="cb-login">
          <div className="cb-hd" style={{ borderRadius: 12 }}>
            <button onClick={goHub} aria-label="Quay lại hub"
              style={{ background: 'rgba(255,255,255,.16)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 10, minHeight: 44, marginBottom: 8 }}>&#8249; Hub</button>
            <div className="cb-title">🍳 Chế biến</div>
            <div className="cb-sub">Trang này dùng chung phiên đăng nhập của Cổng nhân viên</div>
          </div>
          <div className="cb-card">
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>Bạn chưa đăng nhập, hoặc phiên đã hết hạn. Đăng nhập 1 lần tại Cổng nhân viên là dùng được mọi mục (kho, chế biến, thu chi…), không cần đăng nhập lại ở từng trang.</div>
            <button className="cb-send" onClick={goHub}>Đến Cổng nhân viên đăng nhập</button>
          </div>
        </div>
      </div>
    );
  }

  const avatarLetter = ((emp && emp.full_name) || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="cb-wrap">
      <style>{CSS}</style>

      <header className="cb-hd">
        <div className="cb-hd-user">
          <div className="cb-avatar">{avatarLetter}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cb-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            <div className="cb-sub">{staffBranchName(session) || (emp && emp.branch_name) || ''}</div>
          </div>
          <button className="cb-logout" onClick={goHub} aria-label="Quay lại hub">‹ Hub</button>
          <button className="cb-logout" onClick={logout} aria-label="Đăng xuất">Đăng xuất</button>
        </div>
        <div className="cb-title">🍳 Chế biến</div>
      </header>

      <section className="cb-card">
        <h3>Tạo phiếu chế biến mới</h3>
        {loading ? (
          <div className="cb-empty">Đang tải...</div>
        ) : (
          <React.Fragment>
            <label className="cb-label" style={{ marginTop: 0 }}>Bán thành phẩm</label>
            <select className="cb-field" value={materialId} onChange={(e) => onPickMaterial(e.target.value)}>
              <option value="">— Chọn món cần chế biến —</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.unit ? ' (' + m.unit + ')' : ''}</option>
              ))}
            </select>

            <label className="cb-label">Số lượng ({selMat && selMat.unit ? selMat.unit : 'đơn vị'})</label>
            <input
              className="cb-field"
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))}
              placeholder="VD: 10"
            />

            {materialId && (
              <React.Fragment>
                {recipeLoading ? (
                  <div className="cb-empty">Đang tải định mức...</div>
                ) : rows.length > 0 ? (
                  <React.Fragment>
                    <label className="cb-label">Nguyên liệu sẽ bị trừ kho</label>
                    <table className="cb-tbl">
                      <thead>
                        <tr>
                          <th>Nguyên liệu</th>
                          <th style={{ textAlign: 'right' }}>Cần trừ</th>
                          <th style={{ textAlign: 'right' }}>Tồn kho</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.raw_material ? r.raw_material.id : i} className={r.short ? 'cb-short' : ''}>
                            <td>
                              <div>{r.raw_material ? r.raw_material.name : ''}</div>
                              <div className={'cb-stock' + (r.short ? ' bad' : '')}>
                                Định mức: {fmtQty(r.quantity)}{r.raw_material && r.raw_material.unit ? ' ' + r.raw_material.unit : ''}/{batchOut > 1 ? `${fmtQty(batchOut)} ` : '1 '}{selMat && selMat.unit ? selMat.unit : ''}/mẻ
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }} className="cb-need">
                              {r.short ? '⚠ ' : ''}{fmtQty(r.need)}{r.raw_material && r.raw_material.unit ? ' ' + r.raw_material.unit : ''}
                            </td>
                            <td style={{ textAlign: 'right' }} className={'cb-stock' + (r.short ? ' bad' : '')}>
                              {fmtQty(r.stock)}{r.raw_material && r.raw_material.unit ? ' ' + r.raw_material.unit : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {anyShort && qtyNum > 0 && (
                      <div className="cb-msg" style={{ margin: '10px 0 0' }}>
                        ⚠ Không đủ tồn kho cho số lượng này. Giảm số lượng hoặc nhập kho thêm.
                      </div>
                    )}
                  </React.Fragment>
                ) : (
                  <div className="cb-empty">Món này chưa có định mức nguyên liệu.</div>
                )}
              </React.Fragment>
            )}

            <label className="cb-label">Ghi chú (không bắt buộc)</label>
            <input
              className="cb-field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: chế biến ca sáng..."
            />
            {!confirming ? (
              <button className="cb-confirm" onClick={() => setConfirming(true)} disabled={!canConfirm}>
                ✓ Xác nhận chế biến
              </button>
            ) : (
              <div style={{ marginTop: 14, border: '1.5px solid #F5A623', background: '#fffbeb', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontWeight: 800, fontSize: 14.5, color: '#92400e', marginBottom: 6 }}>⚠ Chế biến là trừ kho ngay — kiểm tra lần cuối</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                  Tạo <b>{fmtQty(qtyNum)} {recipe?.material?.unit || ''}</b> bán thành phẩm, trừ {rows.length} nguyên liệu theo định mức (FIFO). Thao tác này ghi phiếu ngay, muốn sửa phải qua quản lý.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => setConfirming(false)} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: '1px solid #d1d5db', background: '#fff', fontWeight: 700, fontSize: 14.5 }}>Kiểm tra lại</button>
                  <button onClick={onConfirmProduce} disabled={saving} style={{ flex: 1.4, minHeight: 48, borderRadius: 12, border: 'none', background: '#F5A623', color: '#24305E', fontWeight: 800, fontSize: 14.5, opacity: saving ? 0.5 : 1 }}>{saving ? 'Đang trừ kho…' : 'Trừ kho & chế biến'}</button>
                </div>
              </div>
            )}
          </React.Fragment>
        )}
      </section>

      <section className="cb-card">
        <h3>Lịch sử hôm nay</h3>
        {loading ? (
          <div className="cb-empty">Đang tải...</div>
        ) : todayHist.length === 0 ? (
          <div className="cb-empty">Hôm nay chưa có phiếu chế biến nào.</div>
        ) : (
          todayHist.map((h) => (
            <div className="cb-hrow" key={h.id}>
              <div>
                <div className="cb-hn">{h.material_name}</div>
                <div className="cb-hd2">{fmtHM(h.created_at)} · {h.employee_name || ''}</div>
              </div>
              <div className="cb-hq">{fmtQty(h.quantity)}{h.unit ? ' ' + h.unit : ''}</div>
            </div>
          ))
        )}
      </section>

      <div className="cb-note">
        📌 <b>Lưu ý:</b> Bấm "Xác nhận chế biến" là kho nguyên liệu <b>trừ ngay</b> theo định mức (FIFO). Kiểm tra kỹ số lượng trước khi xác nhận.
      </div>

      {pinPrompt && (
        <HubPinPrompt title="🔐 Xác nhận PIN để chạy sản xuất"
          message="Chế biến trừ kho ngay (không qua duyệt) nên cần nhập lại mã PIN của bạn."
          busy={pinBusy} err={pinErr} onSubmit={submitPin} onClose={() => setPinPrompt(false)} />
      )}
      <div className={'cb-toast' + (toastOn ? ' show' : '')}>{toastMsg}</div>
    </div>
  );
}
