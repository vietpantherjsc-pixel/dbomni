import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

// Gói 8a (2026-10-05): Quản lý kênh bán hàng (giá theo kênh) — thêm/bớt, bật/tắt, kéo-thả sắp xếp.
const BASE = 'http://localhost/api';

export default function PriceLists() {
  const [lists, setLists] = useState([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const drag = useRef(null);

  const load = async () => {
    const r = await axios.get(`${BASE}/price-lists`);
    setLists(Array.isArray(r.data) ? r.data : []);
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const create = async () => {
    if (!name.trim()) { alert('Nhập tên kênh.'); return; }
    try {
      await axios.post(`${BASE}/price-lists`, { name: name.trim() });
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

  const saveName = async (pl) => {
    if (!editName.trim()) { setEditing(null); return; }
    try {
      await axios.patch(`${BASE}/price-lists/${pl.id}`, { name: editName.trim() });
      setEditing(null);
      load();
    } catch (e) { alert(e.message); }
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

        <div className="m-card p-4 mb-4 flex gap-2">
          <input className="m-input flex-1" placeholder="Tên kênh mới… VD: ShopeeFood, Sự kiện" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <button className="m-btn m-btn-primary" onClick={create}>+ Thêm kênh</button>
        </div>

        <div className="m-card overflow-hidden">
          <table className="m-table">
            <thead><tr><th style={{width:36}}></th><th>Tên kênh</th><th>Mã</th><th className="text-center">Món đang bán</th><th className="text-center">Trạng thái</th><th className="text-right">Thao tác</th></tr></thead>
            <tbody>
              {lists.map((pl) => (
                <tr key={pl.id}
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
                        onKeyDown={(e) => { if (e.key === 'Enter') { setEditName(e.target.value); saveName({ ...pl }); } if (e.key === 'Escape') setEditing(null); }} />
                    ) : pl.name}
                  </td>
                  <td><code className="text-xs" style={{color:'var(--m-ink-faint)'}}>{pl.code}</code></td>
                  <td className="text-center m-num">{pl.product_count ?? '—'}</td>
                  <td className="text-center">
                    <button onClick={() => toggleActive(pl)} className={`m-badge ${pl.is_active ? 'm-badge-green' : 'm-badge-gray'}`}>
                      {pl.is_active ? 'Đang dùng' : 'Đã tắt'}
                    </button>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {editing === pl.id ? (
                      <button className="text-xs font-bold text-green-700 mr-2" onClick={(e) => saveName(pl)}>Lưu</button>
                    ) : (
                      <button className="text-xs font-semibold mr-2 hover:underline" style={{color:'var(--m-primary)'}}
                        onClick={() => { setEditing(pl.id); setEditName(pl.name); }}>Sửa</button>
                    )}
                    <button className="text-xs font-semibold hover:underline" style={{color:'var(--m-danger)'}} onClick={() => del(pl)}>Xóa</button>
                  </td>
                </tr>
              ))}
              {lists.length === 0 && <tr><td colSpan={6} className="p-8 text-center" style={{color:'var(--m-ink-faint)'}}>Chưa có kênh nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
