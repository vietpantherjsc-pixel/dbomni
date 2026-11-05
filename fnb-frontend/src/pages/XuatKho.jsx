import React, { useEffect, useMemo, useState } from 'react';
import SearchInput from '../components/SearchInput';
import axios from 'axios';
import { API } from '../utils/api';
import { getStaffSession, clearStaffSession, staffSessionExpired } from '../utils/staffSession'; // Gói phiên Hub (2026-11-05)
import HubConfirm from '../components/HubConfirm'; // UX 2026-10-26 (🟡 Hub)
import { useSharedCategories } from '../utils/sharedCategories'; // Spec danh mục dùng chung

// Trang nhân viên tạo phiếu xuất kho bằng điện thoại (public, KHÔNG cần đăng nhập admin)
// Phiên CHUNG của Hub (gói phiên Hub 2026-11-05): staff_token/staff_emp/staff_branch_id — đăng nhập 1 lần tại /nhan-vien
// API (PENDING — cần backend bổ sung):
// - POST /employee/outbound-receipts {reason, note, items:[{material_id, quantity}]}
// Phiếu tạo ở trạng thái nháp, admin chốt sau (trừ kho FIFO khi chốt).

const NAVY = '#24305E';
const ORANGE = '#F5A623';

const REASONS_FB = [
  { code: 'damaged', name: 'Hủy hàng' },
  { code: 'internal_use', name: 'Dùng nội bộ' },
  { code: 'sale', name: 'Xuất bán' },
  { code: 'other', name: 'Khác' },
];

const CSS = `
.xk-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.xk-wrap button{font-family:inherit;}
.xk-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 12px 12px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.xk-hd-user{display:flex;align-items:center;gap:10px;}
.xk-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.xk-name{font-size:15px;font-weight:700;line-height:1.25;}
.xk-sub{font-size:12px;opacity:.75;margin-top:1px;}
.xk-title{font-size:20px;font-weight:800;margin-top:12px;}
.xk-logout{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:44px;white-space:nowrap;}
.xk-card{background:#fff;border-radius:12px;margin:12px 16px 0;padding:14px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.xk-card h3{font-size:15px;font-weight:700;color:${NAVY};margin-bottom:10px;}
.xk-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.xk-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:6px;box-sizing:border-box;}
.xk-field:focus{outline:none;border-color:${ORANGE};}
.xk-addbtn{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:12px;}
.xk-submit{background:${ORANGE};color:#fff;width:100%;min-height:54px;border:none;border-radius:12px;font-size:16px;font-weight:800;margin-top:14px;}
.xk-submit:disabled{opacity:.45;}
.xk-item{border:1px solid #e8e9ee;border-radius:10px;padding:10px 12px;margin-bottom:8px;}
.xk-iname{font-weight:700;font-size:14px;}
.xk-del{border:none;background:#fdeeee;color:#a12b2b;font-weight:800;font-size:13px;min-width:44px;min-height:44px;border-radius:10px;}
.xk-empty{text-align:center;color:#6b7280;font-size:13.5px;padding:18px 8px;line-height:1.6;}
.xk-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.xk-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%) translateY(10px);background:rgba(26,29,38,.92);color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;border-radius:999px;z-index:60;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;max-width:92vw;text-align:center;line-height:1.45;border-radius:16px;}
.xk-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.xk-login{padding:0 16px 24px;}
.xk-login-hd{background:${NAVY};color:#fff;margin:0 -16px 16px;padding:22px 20px 26px;border-radius:0 0 12px 12px;text-align:center;}
.xk-login-card{background:#fff;border-radius:12px;padding:18px 16px;box-shadow:0 1px 3px rgba(16,24,40,.08);}
.xk-pin{font-size:30px;font-weight:800;letter-spacing:12px;text-align:center;}
.xk-send{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:16px;}
.xk-success{text-align:center;padding:48px 24px;}
.xk-check-big{width:84px;height:84px;border-radius:50%;background:#dcfce7;color:#15803d;font-size:44px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;}
.xk-code{font-size:22px;font-weight:800;color:${NAVY};letter-spacing:1px;margin-top:8px;}
.xk-note{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #f5dfae;color:#8a5a00;}
`;

function auth(token) { // Gói phiên Hub 2026-11-05: bỏ tham số cổng ?t=
  return { headers: { Authorization: 'Bearer ' + token } };
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}
function qtyNum(s) {
  const n = parseFloat(String(s == null ? '' : s).trim().replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

export default function XuatKho({ embed } = {}) {
  const goHub = () => { window.location.href = '/nhan-vien'; }; // Gói phiên Hub 2026-11-05: điều hướng không gắn ?t=
  // Gói phiên Hub (2026-11-05): phiên chung của Hub — embed hoặc khóa staff_* khi mở trực tiếp; hết đọc khóa đảo riêng.
  const sess = getStaffSession();
  // Spec danh mục dùng chung: lý do xuất kho đọc từ API, fallback cứng
  const REASONS = useSharedCategories('outbound_reasons', REASONS_FB);
  const [token, setToken] = useState(() => (embed && embed.token) || (sess && sess.token) || '');
  const [emp, setEmp] = useState(() => {
    if (embed && embed.emp) return embed.emp;
    return sess && sess.emp ? sess.emp : null;
  });
  const [err, setErr] = useState('');
  // Gói 60: đồng bộ emp khi hub đổi chi nhánh
  useEffect(() => {
    if (embed && embed.emp) setEmp(embed.emp);
  }, [embed && embed.emp, embed && embed.branchId]);
  const curBranchName = (() => {
    const bid = (embed && embed.branchId) || (sess && sess.branchId) || 0;
    const list = (emp && emp.branches) || [];
    if (bid) {
      const b = list.find((x) => (x.id || x) === bid);
      if (b && b.name) return b.name;
    }
    return (emp && emp.branch_name) || '';
  })();

  const [materials, setMaterials] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  const [reason, setReason] = useState('internal_use');
  const [note, setNote] = useState('');
  const [items, setItems] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickSearch, setPickSearch] = useState('');

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);

  const toastTimer = React.useRef(null); // UX 2026-10-26 (🟡L29): toast lỗi hiện lâu hơn toast thường
  const toast = (m, isErr) => {
    setToastMsg(m);
    setToastOn(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastOn(false), isErr ? 5000 : 2400);
  };
  const toastErr = (m) => toast(m, true);

  const logout = () => { // Gói phiên Hub 2026-11-05: đăng xuất = hủy phiên chung rồi về Hub
    clearStaffSession();
    setToken(''); setEmp(null);
    window.location.href = '/nhan-vien';
  };

  const expired = (e) => { // Gói phiên Hub 2026-11-05: hết phiên xử lý tập trung tại Hub, không tự xóa khóa ở trang con
    if (e && e.response && e.response.status === 401) {
      if (embed && embed.onExpired) { embed.onExpired(); }
      else staffSessionExpired();
      return true;
    }
    return false;
  };


  const loadAll = async (tk) => {
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        axios.get(API + '/employee/materials', auth(tk)),
        axios.get(API + '/employee/stocktake-meta', auth(tk)).catch(() => ({ data: { data: {} } })),
      ]);
      setMaterials((m.data && m.data.data) || []);
      setCategories(((c.data && c.data.data) || {}).categories || []);
    } catch (e) {
      if (expired(e)) return;
      toastErr(errMsg(e, 'Không tải được dữ liệu.'));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (token) loadAll(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const addMultipleMaterials = (pickedIds) => {
    const existing = new Set(items.map((it) => it.materialId));
    const added = [];
    pickedIds.forEach((id) => {
      if (existing.has(id)) return;
      const m = materials.find((x) => x.id === id);
      if (!m) return;
      added.push({
        key: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        materialId: m.id,
        name: m.name,
        unit: m.unit || '',
        qty: '',
      });
    });
    if (added.length) {
      setItems((prev) => [...prev, ...added]);
      toast('Đã thêm ' + added.length + ' nguyên liệu.');
    }
    setShowPicker(false);
    setPickSearch('');
  };

  const setItemField = (key, field, value) => {
    setItems((prev) => prev.map((it) => it.key === key ? { ...it, [field]: value } : it));
  };

  const removeItem = (key) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
  };

  const submit = async () => {
    const validItems = items.filter((it) => qtyNum(it.qty) > 0);
    if (validItems.length === 0) { toast('Vui lòng nhập số lượng cho ít nhất 1 mặt hàng.'); return; }
    const reasonLabel = (REASONS.find((r) => r.code === reason) || {}).name || reason;
    setAskCreate({ message: 'Tạo phiếu xuất ' + validItems.length + ' mặt hàng?\nLý do: ' + reasonLabel, validItems, reasonLabel });
  };

  const [askCreate, setAskCreate] = useState(null);
  const doCreate = async () => {
    const validItems = (askCreate || {}).validItems || [];
    const reasonLabel = (askCreate || {}).reasonLabel || '';
    setAskCreate(null);
    if (!validItems.length) return;
    setSaving(true);
    try {
      // PENDING: cần backend POST /employee/outbound-receipts
      const r = await axios.post(API + '/employee/outbound-receipts', {
        branch_id: (embed && embed.branchId) || (sess && sess.branchId) || null, // Gói 60: CN đang thao tác
        reason,
        note: note.trim() || null,
        items: validItems.map((it) => ({
          material_id: it.materialId,
          quantity: qtyNum(it.qty),
        })),
      }, auth(token));
      const d = (r.data && r.data.data) || {};
      setSuccess({ code: d.code || '', reason: reasonLabel });
      setItems([]); setNote('');
    } catch (e) {
      toastErr(errMsg(e, 'Tạo phiếu thất bại.'));
    } finally { setSaving(false); }
  };

  const avatarLetter = ((emp && emp.full_name) || 'N').trim().charAt(0).toUpperCase();

  // Gói phiên Hub (2026-11-05): không còn đăng nhập riêng từng trang —
  // chưa có phiên chung thì hướng NV về Cổng nhân viên đăng nhập 1 lần.
  if (!token) {
    return (
      <div className="xk-wrap">
        <style>{CSS}</style>
        <div className="xk-login">
          <div className="xk-hd" style={{ borderRadius: 12 }}>
            <div className="xk-title">📤 Xuất kho</div>
            <div className="xk-sub">Trang này dùng chung phiên đăng nhập của Cổng nhân viên</div>
          </div>
          <div className="xk-card">
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>Bạn chưa đăng nhập, hoặc phiên đã hết hạn. Đăng nhập 1 lần tại Cổng nhân viên là dùng được mọi mục (kho, chế biến, thu chi…), không cần đăng nhập lại ở từng trang.</div>
            <button className="xk-send" onClick={goHub}>Đến Cổng nhân viên đăng nhập</button>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="xk-wrap">
        <style>{CSS}</style>
        <header className="xk-hd">
          <div className="xk-hd-user">
            <div className="xk-avatar">{avatarLetter}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="xk-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
              <div className="xk-sub">{curBranchName}</div>
            </div>
            {!(embed && embed.onBack) && <button className="xk-logout" onClick={goHub} aria-label="Quay lại hub">‹ Hub</button>}
          <button className="xk-logout" onClick={embed && embed.onBack ? embed.onBack : logout}>{embed && embed.onBack ? '‹ Quay lại' : 'Đăng xuất'}</button>
          </div>
          <div className="xk-title">📤 Xuất kho</div>
        </header>
        <div className="xk-card xk-success">
          <div className="xk-check-big">✓</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Tạo phiếu thành công!</div>
          <div className="xk-code">{success.code}</div>
          <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 8 }}>Lý do: {success.reason}</div>
          {/* S11: dòng trạng thái phiếu như màn hình thu/chi */}
          <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 8, lineHeight: 1.6 }}>Phiếu ở trạng thái <b>Chờ duyệt</b> — quản lý xác nhận trong admin mới có hiệu lực.</div>
          <button className="xk-submit" onClick={() => setSuccess(null)}>＋ Tạo phiếu mới</button>
        </div>
      </div>
    );
  }

  return (
    <div className="xk-wrap">
      <style>{CSS}</style>
      <header className="xk-hd">
        <div className="xk-hd-user">
          <div className="xk-avatar">{avatarLetter}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="xk-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            <div className="xk-sub">{curBranchName}</div>
          </div>
          {!(embed && embed.onBack) && <button className="xk-logout" onClick={goHub} aria-label="Quay lại hub">‹ Hub</button>}
          <button className="xk-logout" onClick={embed && embed.onBack ? embed.onBack : logout}>{embed && embed.onBack ? '‹ Quay lại' : 'Đăng xuất'}</button>
        </div>
        <div className="xk-title">📤 Xuất kho</div>
      </header>

      {loading ? (
        <div className="xk-card"><div className="xk-empty">Đang tải dữ liệu...</div></div>
      ) : (
        <>
          <div className="xk-note">
            Phiếu xuất tạo ở trạng thái <b>nháp</b>, quản lý chốt sau (trừ kho FIFO khi chốt).
          </div>

          <section className="xk-card">
            <h3>Thông tin phiếu</h3>
            <label className="xk-label" style={{ marginTop: 0 }}>Lý do xuất</label>
            <select className="xk-field" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
            {reason === 'sale' && (
              <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e', fontSize: 13, lineHeight: 1.5 }}>
                ⚠️ <b>Lưu ý:</b> Đơn bán qua POS đã tự trừ kho khi thanh toán. Phiếu "Xuất bán" chỉ dùng cho hàng bán ngoài hệ thống — nếu không sẽ <b>trừ kho 2 lần</b>. Hãy ghi rõ trong Ghi chú (VD: mã đơn, bán tại sự kiện...).
              </div>
            )}
            <label className="xk-label">Ghi chú</label>
            <input className="xk-field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú thêm..." />
          </section>

          <section className="xk-card">
            <h3>Thêm mặt hàng</h3>
            <button className="xk-addbtn" onClick={() => setShowPicker(true)}>
              ＋ Chọn nguyên liệu ({items.length} đã chọn)
            </button>
          </section>

          <section className="xk-card">
            <h3>Hàng trong phiếu ({items.length})</h3>
            {items.length === 0 ? (
              <div className="xk-empty">Chưa có mặt hàng nào.<br />Bấm "Chọn nguyên liệu" ở trên để thêm.</div>
            ) : (
              items.map((it) => (
                <div className="xk-item" key={it.key}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="xk-iname">{it.name}</div>
                    </div>
                    <button className="xk-del" onClick={() => removeItem(it.key)}>✕</button>
                  </div>
                  <label className="xk-label" style={{ marginTop: 0 }}>Số lượng xuất ({it.unit})</label>
                  <input
                    className="xk-field"
                    inputMode="decimal"
                    value={it.qty}
                    onChange={(e) => setItemField(it.key, 'qty', e.target.value.replace(/[^\d.,]/g, ''))}
                    placeholder="0"
                  />
                </div>
              ))
            )}
          </section>

          <section className="xk-card">
            <button className="xk-submit" onClick={submit} disabled={saving || items.length === 0}>
              {saving ? 'Đang tạo phiếu...' : '✓ Tạo phiếu xuất'}
            </button>
          </section>
        </>
      )}

      {showPicker && (
        <MaterialMultiPicker
          materials={materials}
          categories={categories}
          excludeIds={items.map((it) => it.materialId)}
          search={pickSearch}
          setSearch={setPickSearch}
          onClose={() => { setShowPicker(false); setPickSearch(''); }}
          onConfirm={addMultipleMaterials}
        />
      )}

      <HubConfirm open={!!askCreate} title="Tạo phiếu xuất kho" message={askCreate ? askCreate.message : ''} confirmLabel="Tạo phiếu" onCancel={() => setAskCreate(null)} onConfirm={doCreate} />
        <div className={'xk-toast' + (toastOn ? ' show' : '')}>{toastMsg}</div>
    </div>
  );
}

function MaterialMultiPicker({ materials, categories, excludeIds, search, setSearch, onClose, onConfirm }) {
  const [picked, setPicked] = useState(new Set());

  const groups = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const available = (materials || []).filter((m) =>
      !excludeIds.includes(m.id) &&
      m.is_active !== false &&
      (!q || String(m.name || '').toLowerCase().includes(q))
    );
    const sorted = (categories || []).slice()
      .sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || (a.id - b.id));
    const result = [];
    const byCat = {};
    const uncat = [];
    available.forEach((m) => {
      const cid = m.material_category_id;
      if (!cid) { uncat.push(m); return; }
      if (!byCat[cid]) byCat[cid] = [];
      byCat[cid].push(m);
    });
    sorted.forEach((c) => {
      if (byCat[c.id]?.length) result.push({ name: c.name, items: byCat[c.id] });
    });
    if (uncat.length) result.push({ name: 'Chưa phân loại', items: uncat });
    return result;
  }, [materials, excludeIds, categories, search]);

  const toggle = (id) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#24305E', marginBottom: 12 }}>Chọn nguyên liệu</h3>
        <SearchInput
          style={{ width: '100%', minHeight: 48, border: '1.5px solid #F5A623', borderRadius: 12, padding: '10px 12px', fontSize: 15, boxSizing: 'border-box' }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) => setSearch(v)}
          placeholder="Tìm nguyên liệu..."
          autoFocus
          wrapperStyle={{ display: 'flex', width: '100%', marginBottom: 12 }}
        />
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {groups.length === 0 && <div style={{ textAlign: 'center', color: '#6b7280', padding: 18 }}>Không có nguyên liệu nào.</div>}
          {groups.map((g) => (
            <div key={g.name} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#666', textTransform: 'uppercase', marginBottom: 6 }}>
                {g.name} ({g.items.length})
              </div>
              {g.items.map((m) => (
                <button key={m.id} onClick={() => toggle(m.id)}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '11px 12px', marginBottom: 6, borderRadius: 10, border: '1px solid',
                    borderColor: picked.has(m.id) ? '#24305E' : '#eee',
                    background: picked.has(m.id) ? '#eef2ff' : '#fff',
                    fontSize: 14, textAlign: 'left', fontFamily: 'inherit',
                  }}>
                  <span>{m.name} <span style={{ color: '#999', fontSize: 12 }}>({m.unit})</span></span>
                  {picked.has(m.id) && <span style={{ color: '#24305E', fontWeight: 800 }}>✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: '1px solid #ddd', background: '#fff', fontSize: 15, fontWeight: 700 }}>Hủy</button>
          <button onClick={() => onConfirm([...picked])} disabled={picked.size === 0}
            style={{ flex: 1, minHeight: 48, borderRadius: 12, border: 'none', background: '#24305E', color: '#fff', fontSize: 15, fontWeight: 700, opacity: picked.size === 0 ? 0.45 : 1 }}>
            Thêm ({picked.size})
          </button>
        </div>
      </div>
    </div>
  );
}
