import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';

// Spec danh mục dùng chung (Đại Vương chốt 2026-10-19): CRUD 13 tab danh mục nghiệp vụ.
// Tab payment_channels là ẢO — đọc từ Kênh bán hàng (chỉ xem, sửa ở trang Kênh bán hàng).
const VIRTUAL = 'payment_channels';

export default function SharedCategoryManager() {
  const [groups, setGroups] = useState({});
  const [tab, setTab] = useState('payment_types');
  const [items, setItems] = useState([]);
  const [channels, setChannels] = useState([]); // cho tab ảo
  const [form, setForm] = useState({ code: '', name: '' });
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState('');

  const loadGroups = async () => {
    try {
      const r = await axios.get(`${API}/shared-categories/groups`);
      if (r.data?.success) setGroups(r.data.data || {});
    } catch { /* bỏ qua */ }
  };

  const load = async (g) => {
    setMsg('');
    if (g === VIRTUAL) {
      try {
        const r = await axios.get(`${API}/shared-categories`, { params: { group: g } });
        setChannels(r.data?.data || []);
      } catch { setChannels([]); }
      return;
    }
    try {
      const r = await axios.get(`${API}/shared-categories/all`, { params: { group: g } });
      setItems(r.data?.data || []);
    } catch { setItems([]); }
  };

  useEffect(() => { loadGroups(); }, []);
  useEffect(() => { if (tab) load(tab); }, [tab]);

  const resetForm = () => { setEditing(null); setForm({ code: '', name: '' }); };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { setMsg('Nhập đủ mã và tên.'); return; }
    try {
      if (editing) {
        await axios.patch(`${API}/shared-categories/${editing}`, { code: form.code.trim(), name: form.name.trim() });
      } else {
        await axios.post(`${API}/shared-categories`, { group: tab, code: form.code.trim(), name: form.name.trim() });
      }
      resetForm(); load(tab); setMsg('Đã lưu.');
    } catch (e) { setMsg(e.response?.data?.message || 'Lưu thất bại.'); }
  };

  const toggle = async (it) => {
    try {
      await axios.patch(`${API}/shared-categories/${it.id}`, { is_active: !it.is_active });
      load(tab);
    } catch { setMsg('Cập nhật thất bại.'); }
  };

  const remove = async (it) => {
    if (!window.confirm(`Xóa "${it.name}" khỏi danh mục?`)) return;
    try {
      await axios.delete(`${API}/shared-categories/${it.id}`);
      load(tab);
    } catch { setMsg('Xóa thất bại.'); }
  };

  const restore = async () => {
    if (!window.confirm('Khôi phục các giá trị mặc định bị thiếu/tắt? (Không xóa giá trị bạn tự thêm)')) return;
    try {
      const r = await axios.post(`${API}/shared-categories/restore-defaults`, { group: tab });
      setMsg(`Đã khôi phục ${r.data?.restored ?? 0} giá trị.`);
      load(tab);
    } catch { setMsg('Khôi phục thất bại.'); }
  };

  const tabs = Object.entries(groups);
  const CAT_LABEL = { store: 'Tại cửa hàng', online: 'Online', partner: 'Đối tác' };

  return (
    <div>
      {/* Thanh tab con — cuộn ngang trên mobile */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        {tabs.map(([code, label]) => (
          <button key={code} type="button" onClick={() => { setTab(code); resetForm(); }}
            className="m-btn text-xs whitespace-nowrap shrink-0"
            style={tab === code ? { background: 'var(--m-primary)', color: '#fff', borderColor: 'var(--m-primary)' } : {}}>
            {label}
          </button>
        ))}
      </div>

      {tab === VIRTUAL ? (
        <div>
          <p className="text-sm mb-3" style={{ color: 'var(--m-ink-soft)' }}>
            Kênh áp dụng đọc động từ <b>Kênh bán hàng</b> (chỉ kênh đang bật). Sửa tại trang Kênh bán hàng.
          </p>
          {['store', 'online', 'partner'].map((c) => {
            const list = channels.filter((x) => (x.category || 'partner') === c);
            if (!list.length) return null;
            return (
              <div key={c} className="mb-2">
                <div className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--m-ink-soft)' }}>{CAT_LABEL[c]}</div>
                <div className="flex flex-wrap gap-2">
                  {list.map((x) => (
                    <span key={x.code} className="m-badge" style={{ background: 'var(--m-accent-soft)', color: 'var(--m-primary)' }}>
                      {x.name} <span style={{ color: 'var(--m-ink-faint)' }}>({x.code})</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {channels.length === 0 && <div className="text-sm" style={{ color: 'var(--m-ink-faint)' }}>Chưa tải được danh sách kênh.</div>}
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input className="m-input" style={{ width: 140 }} placeholder="Mã (VD: cash)"
              value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing} />
            <input className="m-input flex-1" style={{ minWidth: 160 }} placeholder="Tên hiển thị"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <button type="button" onClick={save} className="m-btn m-btn-primary text-xs">
              {editing ? 'Cập nhật' : '+ Thêm'}
            </button>
            {editing && <button type="button" onClick={resetForm} className="m-btn text-xs">Hủy</button>}
            <button type="button" onClick={restore} className="m-btn text-xs" title="Thêm lại các giá trị mặc định bị thiếu/tắt">
              ↺ Khôi phục mặc định
            </button>
          </div>
          {msg && <div className="text-xs mb-2" style={{ color: 'var(--m-ink-soft)' }}>{msg}</div>}
          <div className="overflow-x-auto">
            <table className="m-table w-full text-sm">
              <thead><tr><th>Mã</th><th>Tên hiển thị</th><th className="text-center">Trạng thái</th><th className="text-right">Thao tác</th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} style={it.is_active ? {} : { opacity: 0.5 }}>
                    <td><code className="text-xs">{it.code}</code></td>
                    <td>{it.name}</td>
                    <td className="text-center">
                      <button type="button" onClick={() => toggle(it)} className="m-badge"
                        style={it.is_active
                          ? { background: '#eef7ef', color: '#14602f', border: 'none', cursor: 'pointer' }
                          : { background: '#f1f2f6', color: '#6b7280', border: 'none', cursor: 'pointer' }}>
                        {it.is_active ? 'Đang dùng' : 'Đã tắt'}
                      </button>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button type="button" onClick={() => { setEditing(it.id); setForm({ code: it.code, name: it.name }); }}
                        className="m-btn text-xs mr-2">Sửa</button>
                      <button type="button" onClick={() => remove(it)} className="m-btn text-xs"
                        style={{ color: 'var(--m-danger)' }}>Xóa</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6" style={{ color: 'var(--m-ink-faint)' }}>
                    Chưa có giá trị nào. Bấm "↺ Khôi phục mặc định" để lấy lại danh sách chuẩn.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
