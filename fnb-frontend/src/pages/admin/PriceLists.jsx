import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

// Gói 8a (2026-10-05): Quản lý kênh bán hàng (giá theo kênh) — thêm/bớt, bật/tắt, kéo-thả sắp xếp.
const BASE = import.meta.env.VITE_API_BASE || '/api';

// Gói PNL kênh sàn (2026-10-31): tab nhập phí marketing sàn theo (kênh × CN × tháng).
// Số do sàn tổng hợp gửi ngày đầu tháng sau, nhập tay 1 lần/tháng. API nằm trong
// nhóm quyền tài chính (finance.manage) như thu-chi.
const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + 'đ';

function AdjustTab() {
  const prevMonth = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
  const [month, setMonth] = useState(prevMonth());
  const [branchId, setBranchId] = useState(0);
  const [meta, setMeta] = useState({ channels: [], branches: [] });
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');

  const loadAdj = async (m = month, b = branchId) => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${BASE}/channel-adjustments?month=${m}&branch_id=${b}`);
      const d = r.data?.data || {};
      setMeta({ channels: d.channels || [], branches: d.branches || [] });
      setRows(d.rows || []);
      const dr = {};
      (d.rows || []).forEach((row) => {
        dr[`${row.channel_code}|${row.branch_id}`] = { fee: String(row.marketing_fee ?? ''), note: row.note || '' };
      });
      setDrafts(dr);
    } catch (e) {
      if (e.response?.status === 403) setErr('Bạn không có quyền tài chính (finance.manage) nên không xem/nhập được đối soát sàn.');
      else setErr(e.response?.data?.message || 'Không tải được dữ liệu đối soát.');
      setRows([]);
    }
    setLoading(false);
  };
  useEffect(() => { loadAdj().catch(() => {}); }, [month, branchId]); // eslint-disable-line

  const rowOf = (code, bid) => rows.find((r) => r.channel_code === code && r.branch_id === bid);
  const scopeBranches = branchId > 0 ? meta.branches.filter((b) => b.id === branchId) : meta.branches;
  const totalActive = rows.filter((r) => r.status === 'active').reduce((s, r) => s + Number(r.marketing_fee || 0), 0);

  const save = async (code, bid) => {
    const key = `${code}|${bid}`;
    const dr = drafts[key] || { fee: '', note: '' };
    const fee = Number(dr.fee);
    if (dr.fee === '' || Number.isNaN(fee) || fee < 0) { alert('Phí marketing phải là số ≥ 0.'); return; }
    setSavingKey(key);
    try {
      const existing = rowOf(code, bid);
      if (existing && existing.status === 'active') {
        await axios.put(`${BASE}/channel-adjustments/${existing.id}`, { marketing_fee: fee, note: dr.note || null });
      } else {
        // Chưa có dòng → tạo mới; dòng đang void → API tự mở lại + cập nhật số
        await axios.post(`${BASE}/channel-adjustments`, { channel_code: code, branch_id: bid, month, marketing_fee: fee, note: dr.note || null });
      }
      await loadAdj();
    } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại.'); }
    setSavingKey('');
  };

  const voidRow = async (row) => {
    const reason = window.prompt('Lý do hủy dòng đối soát này (bắt buộc):', '');
    if (!reason) return;
    try {
      await axios.post(`${BASE}/channel-adjustments/${row.id}/void`, { void_reason: reason });
      await loadAdj();
    } catch (e) { alert(e.response?.data?.message || 'Hủy thất bại.'); }
  };

  const reopenRow = async (row) => {
    try {
      await axios.post(`${BASE}/channel-adjustments/${row.id}/reopen`, {});
      await loadAdj();
    } catch (e) { alert(e.response?.data?.message || 'Mở lại thất bại.'); }
  };

  return (
    <div>
      <div className="m-card p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-[220px_220px_1fr] gap-3 items-end">
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--m-ink-soft)' }}>Tháng đối soát</label>
            <input type="month" className="m-input w-full" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--m-ink-soft)' }}>Chi nhánh</label>
            <select className="m-input w-full" value={branchId} onChange={(e) => setBranchId(Number(e.target.value))}>
              <option value={0}>Tất cả chi nhánh</option>
              {meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <p className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>
            Nhập đúng số sàn gửi (tổng quảng cáo + marketing của tháng) cho từng kênh × chi nhánh. Tháng chưa nhập thì để trống — báo cáo sẽ ghi chú "chưa nhập" thay vì tính 0.
          </p>
        </div>
      </div>
      {err && <div className="m-card p-4 mb-4 text-sm" style={{ color: 'var(--m-danger)' }}>⚠ {err}</div>}
      {loading ? <div className="p-8 text-center text-sm" style={{ color: 'var(--m-ink-faint)' }}>Đang tải…</div> : (
      <>
      {scopeBranches.map((br) => (
        <div key={br.id} className="m-card overflow-x-auto mb-4">
          <div className="px-4 pt-3 pb-1 font-bold text-sm">{br.name}</div>
          <table className="m-table">
            <thead><tr><th>Kênh sàn</th><th style={{ width: 190 }}>Phí marketing (VNĐ)</th><th>Ghi chú</th><th style={{ width: 210 }}>Người nhập / cập nhật</th><th className="text-right" style={{ width: 190 }}>Thao tác</th></tr></thead>
            <tbody>
              {meta.channels.filter((ch) => ch.is_active || rowOf(ch.code, br.id)).map((ch) => {
                const row = rowOf(ch.code, br.id);
                const key = `${ch.code}|${br.id}`;
                const dr = drafts[key] || { fee: '', note: '' };
                const isVoid = row?.status === 'void';
                return (
                  <tr key={key} style={isVoid ? { opacity: 0.55 } : undefined}>
                    <td>
                      <b>{ch.name}</b> <span style={{ color: 'var(--m-ink-faint)', fontSize: 11 }}>({ch.code})</span>
                      {isVoid && <div style={{ fontSize: 11.5, color: 'var(--m-danger)' }}>Đã hủy: {row.void_reason} — {row.voided_by_name || ''} {row.voided_at || ''}</div>}
                    </td>
                    <td>
                      <input type="number" min="0" className="m-input w-full" placeholder="Chưa nhập"
                        value={dr.fee} onChange={(e) => setDrafts({ ...drafts, [key]: { ...dr, fee: e.target.value } })} />
                      {row && !isVoid && <div style={{ fontSize: 11, color: 'var(--m-ink-faint)', marginTop: 2 }}>= {fmtVND(row.marketing_fee)}</div>}
                    </td>
                    <td>
                      <input className="m-input w-full" placeholder="VD: kỳ đối soát T9 của sàn"
                        value={dr.note} onChange={(e) => setDrafts({ ...drafts, [key]: { ...dr, note: e.target.value } })} />
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--m-ink-soft)' }}>
                      {row ? <>{row.updated_by_name || row.created_by_name || '—'}{row.updated_at ? <><br />{row.updated_at}</> : null}</> : <span style={{ color: 'var(--m-ink-faint)' }}>Chưa nhập</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button className="m-btn m-btn-primary m-btn-sm" disabled={savingKey === key} onClick={() => save(ch.code, br.id)}>
                        {savingKey === key ? 'Đang lưu…' : (isVoid ? 'Mở lại & lưu' : 'Lưu')}
                      </button>
                      {row && !isVoid && <button className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 6 }} onClick={() => voidRow(row)}>Hủy dòng</button>}
                      {isVoid && <button className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 6 }} onClick={() => reopenRow(row)}>Mở lại</button>}
                    </td>
                  </tr>
                );
              })}
              {meta.channels.length === 0 && <tr><td colSpan={5} className="p-6 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có kênh đối tác (sàn) nào.</td></tr>}
            </tbody>
          </table>
        </div>
      ))}
      <div className="text-right font-bold">Tổng phí marketing đã nhập (tháng {month}{branchId > 0 ? '' : ', tất cả CN'}): {fmtVND(totalActive)}</div>
      </>
      )}
    </div>
  );
}

export default function PriceLists() {
  const [pageTab, setPageTab] = useState('lists');
  const [lists, setLists] = useState([]);
  const [loadErr, setLoadErr] = useState(false); // UX 2026-10-26 (🟠T1)
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  // Spec kênh bán hàng (2026-10-19): phân loại kênh
  const CATS = [
    { code: 'store', label: 'Tại cửa hàng' },
    { code: 'online', label: 'Online' },
    { code: 'partner', label: 'Đối tác' },
  ];
  const catLabel = (c) => (CATS.find((x) => x.code === c) || {}).label || c || '—';
  const [newCat, setNewCat] = useState('store');
  const [editCat, setEditCat] = useState('store');
  // Gói 17: chiết khấu kênh
  const [editRate, setEditRate] = useState('');
  const [editTaxIncluded, setEditTaxIncluded] = useState(true);
  const [editTaxRate, setEditTaxRate] = useState('');
  const drag = useRef(null);

  const load = async () => {
    try {
      const r = await axios.get(`${BASE}/price-lists`);
      setLists(Array.isArray(r.data) ? r.data : []);
      setLoadErr(false);
    } catch { setLoadErr(true); } // UX 2026-10-26 (🟠T1): trước đây lỗi tải bị nuốt ở useEffect, bảng hiện "Chưa có kênh nào" giả
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const create = async () => {
    if (!name.trim()) { alert('Nhập tên kênh.'); return; }
    try {
      await axios.post(`${BASE}/price-lists`, { name: name.trim(), category: newCat });
      setName('');
      load();
    } catch (e) { alert(e.response?.data?.message || 'Thao tác thất bại. Vui lòng thử lại.'); }
  };

  const toggleActive = async (pl) => {
    try {
      await axios.patch(`${BASE}/price-lists/${pl.id}`, { is_active: !pl.is_active });
      load();
    } catch (e) { alert('Thao tác thất bại. Vui lòng thử lại.'); }
  };

  // Gói 17: lưu tên + chiết khấu kênh
  const saveAll = async (pl) => {
    if (!editName.trim()) { setEditing(null); return; }
    const payload = {
      name: editName.trim(),
      category: editCat,
      commission_rate: editRate === '' ? 0 : Math.max(0, Math.min(100, Number(editRate) || 0)),
      commission_tax_included: !!editTaxIncluded,
      commission_tax_rate: editTaxIncluded ? null : (editTaxRate === '' ? null : Math.max(0, Math.min(100, Number(editTaxRate) || 0))),
    };
    try {
      await axios.patch(`${BASE}/price-lists/${pl.id}`, payload);
      setEditing(null);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Thao tác thất bại. Vui lòng thử lại.'); }
  };

  // Gói 17: text hiển thị chiết khấu
  const ckText = (pl) => {
    const r = Number(pl.commission_rate || 0);
    if (r <= 0) return '—';
    const included = pl.commission_tax_included === true || pl.commission_tax_included === 1;
    const t = included
      ? 'đã gồm thuế'
      : (pl.commission_tax_rate ? `chưa gồm thuế (+${pl.commission_tax_rate}%)` : 'chưa gồm thuế');
    return `${r}% · ${t}`;
  };

  // Gói 17: mở form sửa (nạp sẵn chiết khấu hiện tại)
  const startEdit = (pl) => {
    setEditing(pl.id);
    setEditName(pl.name);
    setEditCat(pl.category || 'store');
    setEditRate(pl.commission_rate != null ? String(pl.commission_rate) : '');
    setEditTaxIncluded(!(pl.commission_tax_included === false || pl.commission_tax_included === 0));
    setEditTaxRate(pl.commission_tax_rate != null ? String(pl.commission_tax_rate) : '');
  };

  const del = async (pl) => {
    if (!confirm(`Xóa kênh "${pl.name}"?`)) return;
    try {
      await axios.delete(`${BASE}/price-lists/${pl.id}`);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Thao tác thất bại. Vui lòng thử lại.'); }
  };

  const drop = async (targetId) => {
    const from = drag.current;
    drag.current = null;
    if (from == null || from === targetId) return;
    const arr = [...lists];
    const fi = arr.findIndex((x) => x.id === from);
    const ti = arr.findIndex((x) => x.id === targetId);
    const [mv] = arr.splice(fi, 1);
    arr.splice(ti, 0, mv);
    setLists(arr);
    try { await axios.post(`${BASE}/price-lists/reorder`, { ids: arr.map((x) => x.id) }); }
    catch (e) { alert('Thao tác thất bại. Vui lòng thử lại.'); load(); }
  };

  // UX 2026-10-26 (🟠14): nút ↑/↓ dự phòng cảm ứng cho kéo-thả
  const movePl = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= lists.length) return;
    const arr = [...lists];
    const [mv] = arr.splice(idx, 1);
    arr.splice(j, 0, mv);
    setLists(arr);
    try { await axios.post(`${BASE}/price-lists/reorder`, { ids: arr.map((x) => x.id) }); }
    catch (e) { alert('Thao tác thất bại. Vui lòng thử lại.'); load(); }
  };

  return (
    <AdminLayout>
      <div className="p-6 max-w-[900px] mx-auto">
        <h1 className="text-[22px] font-bold text-[var(--m-ink)] mb-1">Kênh bán hàng</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--m-ink-soft)' }}>
          Thêm/bớt kênh, bật/tắt, kéo-thả hoặc bấm ↑/↓ để sắp xếp. Mỗi món có thể đặt giá riêng cho từng kênh tại form Mặt hàng.
        </p>

        {/* Gói PNL kênh sàn (2026-10-31): 2 tab — Bảng giá kênh | Đối soát sàn theo tháng */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {[['lists', 'Bảng giá kênh'], ['adjust', 'Đối soát sàn theo tháng']].map(([key, label]) => (
            <button key={key} onClick={() => setPageTab(key)}
              style={{ padding: '8px 16px', borderRadius: 999, fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
                border: '1px solid ' + (pageTab === key ? '#24305E' : '#ddd'),
                background: pageTab === key ? '#24305E' : '#fff', color: pageTab === key ? '#fff' : '#24305E' }}>
              {label}
            </button>
          ))}
        </div>

        {pageTab === 'adjust' && <AdjustTab />}
        {pageTab === 'lists' && (<>
        {/* Fix runtime zip tổng: dựng lại form thêm kênh đúng pattern (nhãn + ô nhập + nút) —
            bản cũ select không đặt width nên render thừa ô trống lệch hàng */}
        <div className="m-card p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px_auto] gap-3 items-end">
            <div>
              <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--m-ink-soft)' }}>Tên kênh mới</label>
              <input className="m-input w-full" placeholder="VD: ShopeeFood, Sự kiện" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--m-ink-soft)' }}>Phân loại kênh</label>
              <select className="m-input w-full" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                {CATS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <button className="m-btn m-btn-primary whitespace-nowrap" onClick={create}>+ Thêm kênh</button>
          </div>
        </div>

        <div className="m-card overflow-x-auto">
          <table className="m-table">
            <thead><tr><th style={{width:36}}></th><th>Tên kênh</th><th>Mã</th><th>Phân loại</th><th>Chiết khấu kênh</th><th className="text-center">Món đang bán</th><th className="text-center">Trạng thái</th><th className="text-right">Thao tác</th></tr></thead>
            <tbody>
              {lists.map((pl, idx) => (
                <React.Fragment key={pl.id}>
                <tr
                  draggable
                  onDragStart={(e) => { drag.current = pl.id; e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => drop(pl.id)}
                >
                  <td className="cursor-grab" style={{color:'var(--m-ink-faint)'}} title="Kéo để sắp xếp">⠿</td>
                  <td className="font-medium">
                    {editing === pl.id ? (
                      <input className="m-input" defaultValue={pl.name} autoFocus
                        onBlur={(e) => { setEditName(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { setEditName(e.target.value); saveAll({ ...pl }); } if (e.key === 'Escape') setEditing(null); }} />
                    ) : pl.name}
                  </td>
                  <td><code className="text-xs" style={{color:'var(--m-ink-faint)'}}>{pl.code}</code></td>
                  <td>
                    {editing === pl.id ? (
                      <select className="m-input" value={editCat} onChange={(e) => setEditCat(e.target.value)} style={{ fontSize: 12, padding: '4px 6px' }}>
                        {CATS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                    ) : (
                      <span className="m-badge m-badge-gray">{catLabel(pl.category)}</span>
                    )}
                  </td>
                  <td className="text-sm">{ckText(pl)}</td>
                  <td className="text-center m-num">{pl.product_count ?? '—'}</td>
                  <td className="text-center">
                    <button onClick={() => toggleActive(pl)} className={`m-badge ${pl.is_active ? 'm-badge-green' : 'm-badge-gray'}`}>
                      {pl.is_active ? 'Đang dùng' : 'Đã tắt'}
                    </button>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="text-xs font-semibold mr-2" style={{ minWidth: 36, minHeight: 36, opacity: idx === 0 ? 0.3 : 1 }} disabled={idx === 0} onClick={() => movePl(idx, -1)} title="Lên">↑</button>
                    <button className="text-xs font-semibold mr-2" style={{ minWidth: 36, minHeight: 36, opacity: idx === lists.length - 1 ? 0.3 : 1 }} disabled={idx === lists.length - 1} onClick={() => movePl(idx, 1)} title="Xuống">↓</button>
                    {editing === pl.id ? (
                      <button className="text-xs font-bold text-green-700 mr-2" onClick={() => saveAll(pl)}>Lưu</button>
                    ) : (
                      <button className="text-xs font-semibold mr-2 hover:underline" style={{color:'var(--m-primary)'}}
                        onClick={() => startEdit(pl)}>Sửa</button>
                    )}
                    <button className="text-xs font-semibold hover:underline" style={{color:'var(--m-danger)'}} onClick={() => del(pl)}>Xóa</button>
                  </td>
                </tr>
                {editing === pl.id && (
                  <tr key={pl.id + '-ck'}>
                    <td></td>
                    <td colSpan={7}>
                      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg" style={{ background: '#F6F8FD' }}>
                        <label className="text-xs font-semibold">Chiết khấu kênh (%)
                          <input type="number" min="0" max="100" step="0.1" className="m-input ml-2" style={{ width: 90 }}
                            value={editRate} onChange={(e) => setEditRate(e.target.value)} placeholder="VD: 25" />
                        </label>
                        <label className="text-xs font-semibold flex items-center gap-1">
                          <input type="checkbox" checked={editTaxIncluded} onChange={(e) => setEditTaxIncluded(e.target.checked)} />
                          Đã gồm thuế
                        </label>
                        {!editTaxIncluded && (
                          <label className="text-xs font-semibold">Thuế suất (%)
                            <input type="number" min="0" max="100" step="0.1" className="m-input ml-2" style={{ width: 80 }}
                              value={editTaxRate} onChange={(e) => setEditTaxRate(e.target.value)} placeholder="VD: 8" />
                          </label>
                        )}
                        <span className="text-xs" style={{ color: 'var(--m-ink-faint)' }}>
                          % nền tảng thu trên doanh thu kênh — tự động tính vào chi phí ở báo cáo PNL.
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
              {lists.length === 0 && <tr><td colSpan={8} className="p-8 text-center" style={{color:'var(--m-ink-faint)'}}>{loadErr ? (<span style={{ color: 'var(--m-danger)' }}>⚠ Không tải được danh sách kênh.<button onClick={load} className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 8 }}>Thử lại</button></span>) : 'Chưa có kênh nào.'}</td></tr>}
            </tbody>
          </table>
        </div>
        </>)}
      </div>
    </AdminLayout>
  );
}
