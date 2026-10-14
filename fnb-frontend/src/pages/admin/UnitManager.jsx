import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';


// Gói 52: quản lý đơn vị tính dùng chung toàn hệ thống
export default function UnitManager() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => axios.get(`${API}/units`).then((r) => setItems(r.data?.data || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!name.trim()) { alert('Nhập tên đơn vị'); return; }
    try {
      if (editing) await axios.put(`${API}/units/${editing}`, { name: name.trim() });
      else await axios.post(`${API}/units`, { name: name.trim() });
      setName(''); setEditing(null); load();
    } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
  };

  const remove = async (id) => {
    if (!confirm('Xóa đơn vị này?')) return;
    try {
      await axios.delete(`${API}/units/${id}`);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {items.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-[13px]">
            {editing === u.id ? (
              <input value={name} onChange={(e) => setName(e.target.value)} className="m-input !w-24 !py-1" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(null); setName(''); } }} />
            ) : (
              <b>{u.name}</b>
            )}
            {editing === u.id ? (
              <>
                <button onClick={save} className="text-green-600 text-[12px] font-bold">✓</button>
                <button onClick={() => { setEditing(null); setName(''); }} className="text-gray-500 text-[12px]">✕</button>
              </>
            ) : (
              <>
                <button onClick={() => { setEditing(u.id); setName(u.name); }} className="text-blue-600 text-[12px]">Sửa</button>
                <button onClick={() => remove(u.id)} className="text-red-600 text-[12px]">✕</button>
              </>
            )}
          </span>
        ))}
      </div>
      {editing === null && (
        <div className="mt-3 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên đơn vị mới (VD: Phần)"
            className="m-input flex-1" onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          <button onClick={save} className="m-btn m-btn-primary text-[13px]">+ Thêm</button>
        </div>
      )}
    </div>
  );
}
