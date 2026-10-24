import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';
import { useSharedCategories } from '../../utils/sharedCategories';

// Spec danh mục dùng chung: TYPES đọc từ danh mục payment_types,
// CHANNELS đọc động từ Kênh bán hàng (tab payment_channels ẢO).
const TYPES_FB = [
  { code: 'transfer', name: 'Chuyển khoản' },
  { code: 'cash', name: 'Tiền mặt' },
  { code: 'debit_card', name: 'Thẻ ghi nợ' },
  { code: 'credit_card', name: 'Thẻ tín dụng' },
  { code: 'ewallet', name: 'Ví điện tử' },
  { code: 'other', name: 'Khác' },
];
// Chuẩn hóa mã kênh cũ (pos/zalo) về mã Kênh bán hàng hiện tại
const normCh = (c) => ({ pos: 'nha_hang', zalo: 'online' }[String(c).toLowerCase()] || c);
const normChArr = (arr) => [...new Set((arr || []).map(normCh))];

// Gói 52: quản lý phương thức thanh toán (tên + loại + bật/tắt theo kênh)
// Spec cài đặt danh sách (2026-10-21): chuyển thành BẢNG có cột (L1) + form trong MODAL,
// bỏ nút "Xóa tất cả". Kéo-thả sắp xếp giữ nguyên cơ chế cũ.
export default function PaymentMethodManager() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'transfer', channels: [], is_active: true });
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState(null); // Gói 55: kéo thả sắp xếp
  const TYPES = useSharedCategories('payment_types', TYPES_FB);
  const CHANNELS = useSharedCategories('payment_channels', []);

  const load = () => axios.get(`${API}/payment-methods`).then((r) => setItems(r.data?.data || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const emptyForm = () => ({ name: '', type: 'transfer', channels: [], is_active: true });
  // [] = mọi kênh (quy ước chung)
  const chOn = (channels, code) => {
    const arr = normChArr(channels);
    return arr.length === 0 || arr.includes(code);
  };
  const toggleChannel = (code) => {
    setForm((f) => {
      const all = CHANNELS.map((c) => c.code);
      let cur = normChArr(f.channels);
      if (cur.length === 0) cur = [...all];
      cur = cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code];
      return { ...f, channels: cur.length >= all.length ? [] : cur };
    });
  };
  const toggleRowChannel = async (m, code) => {
    const all = CHANNELS.map((x) => x.code);
    let cur = normChArr(m.channels);
    if (cur.length === 0) cur = [...all];
    cur = cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code];
    const nc = cur.length >= all.length ? [] : cur;
    await axios.put(`${API}/payment-methods/${m.id}`, { channels: nc }).catch(() => {});
    load();
  };

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setModalOpen(true); };
  const openEdit = (m) => {
    setEditing(m.id);
    setForm({ name: m.name, type: m.type, channels: normChArr(m.channels), is_active: !!m.is_active });
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setEditing(null); setForm(emptyForm()); };

  const save = async () => {
    if (!form.name.trim()) { alert('Nhập tên phương thức'); return; }
    try {
      if (editing) await axios.put(`${API}/payment-methods/${editing}`, form);
      else await axios.post(`${API}/payment-methods`, form);
      closeModal();
      load();
    } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
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
      <div className="flex justify-end mb-3">
        <button onClick={openAdd} className="m-btn m-btn-primary text-[13px]">+ Thêm phương thức</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[680px]">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="py-2 pr-2 font-medium w-10">Thứ tự</th>
              <th className="py-2 pr-3 font-medium">Tên</th>
              <th className="py-2 pr-3 font-medium">Loại</th>
              <th className="py-2 pr-3 font-medium">Kênh áp dụng</th>
              <th className="py-2 pr-3 font-medium">Trạng thái</th>
              <th className="py-2 font-medium text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">Chưa có phương thức nào.</td></tr>
            )}
            {items.map((m, idx) => (
              <tr key={m.id}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                className="border-b border-gray-50"
                style={{ opacity: dragIdx === idx ? 0.5 : 1, background: dragIdx === idx ? '#f0f4ff' : 'transparent' }}>
                <td className="py-2.5 pr-2">
                  <span style={{ cursor: 'grab', color: '#999', fontSize: 16 }} title="Kéo để sắp xếp">⋮⋮</span>
                </td>
                <td className="py-2.5 pr-3 font-medium">{m.name}</td>
                <td className="py-2.5 pr-3">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                    {TYPES.find((t) => t.code === m.type)?.name || m.type}
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  <div className="flex gap-1 flex-wrap">
                    {CHANNELS.map((c) => {
                      const on = chOn(m.channels, c.code);
                      return (
                        <button key={c.code} type="button" title={`${c.name}: ${on ? 'bật' : 'tắt'}`}
                          onClick={() => toggleRowChannel(m, c.code)}
                          className="text-[11px] px-2 py-1 rounded-full border"
                          style={on ? { background: 'var(--m-primary)', color: '#fff', borderColor: 'var(--m-primary)' } : { color: 'var(--m-ink-faint)' }}>
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="py-2.5 pr-3">
                  <button type="button" onClick={() => toggleActive(m)} title={m.is_active ? 'Đang bật — bấm để tắt' : 'Đang tắt — bấm để bật'}
                    className="relative inline-flex w-10 h-5.5 rounded-full transition-colors align-middle"
                    style={{ background: m.is_active ? '#22c55e' : '#d1d5db', height: 22 }}>
                    <span className="absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all"
                      style={{ left: m.is_active ? 20 : 2 }} />
                  </button>
                  <span className="ml-2 text-[12px] text-gray-500">{m.is_active ? 'Bật' : 'Tắt'}</span>
                </td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(m)} className="text-blue-600 text-[12px] mr-3">Sửa</button>
                  <button onClick={() => remove(m.id)} className="text-red-600 text-[12px]">Xóa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[12px] text-gray-400 mt-2">Kéo tay cầm ⋮⋮ để đổi thứ tự hiển thị ở POS / Mini App.</div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[15px]">{editing ? 'Sửa phương thức thanh toán' : 'Thêm phương thức thanh toán'}</h3>
              <button onClick={closeModal} className="w-8 h-8 rounded-full bg-gray-100 text-gray-500">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-medium text-gray-500">Tên phương thức *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="VD: Chuyển khoản Techcombank" className="m-input w-full mt-1" autoFocus />
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-500">Loại</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="m-input w-full mt-1">
                  {TYPES.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-500">Kênh áp dụng</label>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {CHANNELS.map((c) => (
                    <button key={c.code} type="button" onClick={() => toggleChannel(c.code)}
                      className="text-[12px] px-3 py-1.5 rounded-full border"
                      style={chOn(form.channels, c.code) ? { background: 'var(--m-primary)', color: '#fff', borderColor: 'var(--m-primary)' } : {}}>
                      {c.name}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-gray-400 mt-1">Bật tất cả = áp dụng mọi kênh.</div>
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
                Đang bật (hiển thị khi thanh toán)
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={closeModal} className="px-4 py-2 rounded-lg border border-gray-200 text-[13px]">Hủy</button>
              <button onClick={save} className="m-btn m-btn-primary text-[13px]">{editing ? 'Lưu thay đổi' : 'Thêm mới'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
