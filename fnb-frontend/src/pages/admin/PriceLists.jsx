import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

// Gói 8a (2026-10-05): Quản lý kênh bán hàng (giá theo kênh) — thêm/bớt, bật/tắt, kéo-thả sắp xếp.
const BASE = import.meta.env.VITE_API_BASE || '/api';

export default function PriceLists() {
  const [lists, setLists] = useState([]);
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
    const r = await axios.get(`${BASE}/price-lists`);
    setLists(Array.isArray(r.data) ? r.data : []);
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const create = async () => {
    if (!name.trim()) { alert('Nhập tên kênh.'); return; }
    try {
      await axios.post(`${BASE}/price-lists`, { name: name.trim(), category: newCat });
      setName('');
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };

  const toggleActive = async (pl) => {
    try {
      await axios.patch(`${BASE}/price-lists/${pl.id}`, { is_active: !pl.is_active });
      load();
    } catch (e) { alert(e.message); }
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
    } catch (e) { alert(e.response?.data?.message || e.message); }
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
    } catch (e) { alert(e.response?.data?.message || e.message); }
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
    catch (e) { alert(e.message); load(); }
  };

  return (
    <AdminLayout>
      <div className="p-6 max-w-[900px] mx-auto">
        <h1 className="text-[22px] font-bold text-[var(--m-ink)] mb-1">Kênh bán hàng</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--m-ink-soft)' }}>
          Thêm/bớt kênh, bật/tắt, kéo-thả sắp xếp. Mỗi món có thể đặt giá riêng cho từng kênh tại form Mặt hàng.
        </p>

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

        <div className="m-card overflow-hidden">
          <table className="m-table">
            <thead><tr><th style={{width:36}}></th><th>Tên kênh</th><th>Mã</th><th>Phân loại</th><th>Chiết khấu kênh</th><th className="text-center">Món đang bán</th><th className="text-center">Trạng thái</th><th className="text-right">Thao tác</th></tr></thead>
            <tbody>
              {lists.map((pl) => (
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
              {lists.length === 0 && <tr><td colSpan={8} className="p-8 text-center" style={{color:'var(--m-ink-faint)'}}>Chưa có kênh nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
