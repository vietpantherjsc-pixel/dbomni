import React, { useEffect, useState } from 'react';
import axios from 'axios';
import SearchIcon from '../../components/SearchIcon'; // Gói 55 p11x
import { API } from '../../utils/api';


// Gói 55: quản lý tên thay thế món — map tên cũ (từ file import/app khác) về món hiện tại
// VD: "Mua 1 Tặng 1: Trà sữa ô long tặng hồng trà" (tên cũ T8) → món "Mua 1 Tặng 1: Trà sữa ô long tặng ô long lài"
export default function ProductAliasManager() {
  const [aliases, setAliases] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ product_id: '', alias_name: '' });
  const [search, setSearch] = useState('');

  const load = () => {
    axios.get(`${API}/product-aliases`).then((r) => setAliases(r.data?.data?.data || r.data?.data || [])).catch(() => {});
    axios.get(`${API}/products?per_page=200`).then((r) => setProducts(r.data?.data?.data || r.data?.data || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.product_id || !form.alias_name.trim()) { alert('Chọn món và nhập tên cũ'); return; }
    try {
      await axios.post(`${API}/product-aliases`, form);
      setForm({ product_id: '', alias_name: '' });
      load();
    } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
  };

  const remove = async (id) => {
    if (!confirm('Xóa tên thay thế này?')) return;
    await axios.delete(`${API}/product-aliases/${id}`).catch(() => {});
    load();
  };

  const filtered = aliases.filter((a) =>
    !search || a.alias_name.toLowerCase().includes(search.toLowerCase()) ||
    a.product?.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="text-[12px] text-gray-500 mb-3">
        Dùng khi import file Excel có tên món cũ khác với tên hiện tại. Hệ thống sẽ tự map tên cũ về đúng món.
      </div>
      <div className="mb-3 flex gap-2 items-center">
        <div className="relative flex-1">
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#999', display: 'flex' }}>
            <SearchIcon size={15} />
          </span>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên cũ / tên món..." className="m-input w-full" style={{ paddingLeft: 32 }} />
        </div>
      </div>
      {filtered.map((a) => (
        <div key={a.id} className="flex items-center gap-3 py-2 border-b border-dashed" style={{ borderColor: 'var(--m-line)' }}>
          <div className="flex-1">
            <div className="text-[13px]"><b className="text-amber-700">"{a.alias_name}"</b></div>
            <div className="text-[12px] text-gray-500">→ {a.product?.name || `#${a.product_id}`}</div>
          </div>
          <button onClick={() => remove(a.id)} className="text-[12px] text-red-600 hover:underline">Xóa</button>
        </div>
      ))}
      {filtered.length === 0 && <div className="text-[13px] text-gray-400 py-4 text-center">Chưa có tên thay thế nào.</div>}

      <div className="mt-4 p-3 rounded-xl bg-slate-50 flex flex-wrap gap-2 items-center">
        <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}
          className="m-input flex-1 min-w-[200px]">
          <option value="">— Chọn món hiện tại —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={form.alias_name} onChange={(e) => setForm({ ...form, alias_name: e.target.value })}
          placeholder='Tên cũ (VD: Trà sữa ô long tặng hồng trà)' className="m-input flex-1 min-w-[200px]" />
        <button onClick={save} className="m-btn m-btn-primary text-[13px]">+ Thêm</button>
      </div>
    </div>
  );
}
