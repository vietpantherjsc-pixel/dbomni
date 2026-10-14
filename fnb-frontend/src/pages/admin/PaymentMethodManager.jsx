import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';

const TYPES = [
  { v: 'transfer', label: 'Chuyển khoản' },
  { v: 'cash', label: 'Tiền mặt' },
  { v: 'debit_card', label: 'Thẻ ghi nợ' },
  { v: 'credit_card', label: 'Thẻ tín dụng' },
  { v: 'ewallet', label: 'Ví điện tử' },
  { v: 'other', label: 'Khác' },
];
const CHANNELS = [
  { v: 'pos', label: 'POS' },
  { v: 'zalo', label: 'Zalo' },
];

// Gói 52: quản lý phương thức thanh toán (tên + loại + bật/tắt theo kênh)
export default function PaymentMethodManager() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'transfer', channels: ['pos', 'zalo'], is_active: true });
  const [editing, setEditing] = useState(null);
  const [dragIdx, setDragIdx] = useState(null); // Gói 55: kéo thả sắp xếp

  const load = () => axios.get(`${API}/payment-methods`).then((r) => setItems(r.data?.data || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleChannel = (ch) => {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch) ? f.channels.filter((c) => c !== ch) : [...f.channels, ch],
    }));
  };

  const save = async () => {
    if (!form.name.trim()) { alert('Nhập tên phương thức'); return; }
    try {
      if (editing) await axios.put(`${API}/payment-methods/${editing}`, form);
      else await axios.post(`${API}/payment-methods`, form);
      setForm({ name: '', type: 'transfer', channels: ['pos', 'zalo'], is_active: true });
      setEditing(null);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
  };

  const edit = (m) => {
    setEditing(m.id);
    setForm({ name: m.name, type: m.type, channels: m.channels || ['pos', 'zalo'], is_active: !!m.is_active });
  };

  const remove = async (id) => {
    if (!confirm('Xóa phương thức này?')) return;
    await axios.delete(`${API}/payment-methods/${id}`).catch(() => {});
    load();
  };

  const toggleActive = async (m) => {
    await axios.put(`${API}/payment-methods/${m.id}`, { is_active: !m.is_active }).catch(() => {});
    load();
  };

  // Gói 55: xóa tất cả PTTT (để import lại từ file Excel)
  const removeAll = async () => {
    if (!confirm(`Xóa tất cả ${items.length} phương thức thanh toán?`)) return;
    for (const m of items) {
      await axios.delete(`${API}/payment-methods/${m.id}`).catch(() => {});
    }
    load();
  };

  // Gói 55: kéo thả sắp xếp thứ tự hiển thị
  const onDragStart = (idx) => setDragIdx(idx);
  const onDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const next = [...items];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setItems(next);
    setDragIdx(idx);
  };
  const onDragEnd = async () => {
    setDragIdx(null);
    // Lưu sort_order theo thứ tự mới
    for (let i = 0; i < items.length; i++) {
      await axios.put(`${API}/payment-methods/${items[i].id}`, { sort_order: i }).catch(() => {});
    }
  };

  return (
    <div>
      {items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={removeAll} className="text-[12px] text-red-600 hover:underline">🗑 Xóa tất cả ({items.length})</button>
        </div>
      )}
      {items.map((m, idx) => (
        <div
          key={m.id}
          draggable
          onDragStart={() => onDragStart(idx)}
          onDragOver={(e) => onDragOver(e, idx)}
          onDragEnd={onDragEnd}
          className="flex items-center gap-3 py-2.5 border-b border-dashed"
          style={{
            borderColor: 'var(--m-line)',
            cursor: 'grab',
            opacity: dragIdx === idx ? 0.5 : 1,
            background: dragIdx === idx ? '#f0f4ff' : 'transparent',
          }}
        >
          <span style={{ cursor: 'grab', color: '#999', fontSize: 16 }} title="Kéo để sắp xếp">⋮⋮</span>
          <div className="flex-1">
            <b className="text-[13px]">{m.name}</b>
            <span className="text-[11px] ml-2 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
              {TYPES.find((t) => t.v === m.type)?.label || m.type}
            </span>
            {!m.is_active && <span className="text-[11px] ml-2 text-red-500">(tắt)</span>}
          </div>
          <div className="flex gap-1">
            {CHANNELS.map((c) => {
              const on = !m.channels || m.channels.includes(c.v);
              return (
                <button key={c.v} type="button" title={`${c.label}: ${on ? 'bật' : 'tắt'}`}
                  onClick={async () => {
                    const ch = m.channels?.length ? [...m.channels] : ['pos', 'zalo'];
                    const nc = ch.includes(c.v) ? ch.filter((x) => x !== c.v) : [...ch, c.v];
                    await axios.put(`${API}/payment-methods/${m.id}`, { channels: nc }).catch(() => {});
                    load();
                  }}
                  className="text-[11px] px-2 py-1 rounded-full border"
                  style={on ? { background: 'var(--m-primary)', color: '#fff', borderColor: 'var(--m-primary)' } : { color: 'var(--m-ink-faint)' }}>
                  {c.label}
                </button>
              );
            })}
          </div>
          <button onClick={() => toggleActive(m)} className="text-[12px] text-blue-600 hover:underline">{m.is_active ? 'Tắt' : 'Bật'}</button>
          <button onClick={() => edit(m)} className="text-[12px] text-blue-600 hover:underline">Sửa</button>
          <button onClick={() => remove(m.id)} className="text-[12px] text-red-600 hover:underline">Xóa</button>
        </div>
      ))}

      <div className="mt-4 p-3 rounded-xl bg-slate-50 flex flex-wrap gap-2 items-center">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Tên phương thức (VD: Chuyển khoản Techcombank)" className="m-input flex-1 min-w-[200px]" />
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="m-input">
          {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <div className="flex gap-1">
          {CHANNELS.map((c) => (
            <button key={c.v} type="button" onClick={() => toggleChannel(c.v)}
              className="text-[12px] px-2.5 py-1.5 rounded-full border"
              style={form.channels.includes(c.v) ? { background: 'var(--m-primary)', color: '#fff', borderColor: 'var(--m-primary)' } : {}}>
              {c.label}
            </button>
          ))}
        </div>
        <button onClick={save} className="m-btn m-btn-primary text-[13px]">{editing ? 'Lưu' : '+ Thêm'}</button>
        {editing && <button onClick={() => { setEditing(null); setForm({ name: '', type: 'transfer', channels: ['pos', 'zalo'], is_active: true }); }} className="text-[13px] text-gray-500">Hủy</button>}
      </div>
    </div>
  );
}
