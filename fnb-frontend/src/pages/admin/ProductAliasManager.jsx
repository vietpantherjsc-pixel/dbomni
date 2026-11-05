import React, { useEffect, useState } from 'react';

// S5(3): 401 trong các luồng nạp → hiện câu chuẩn hết phiên qua alert, có
// khóa chống dội 30s để nhiều catch cùng chết phiên không xếp hàng alert.
let __expiredAt = 0;
const noteExpired = (e) => {
    if (e?.response?.status === 401 && Date.now() - __expiredAt > 30000) {
        __expiredAt = Date.now();
        alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
};
import axios from 'axios';
import SearchInput from '../../components/SearchInput';
import { API } from '../../utils/api';


// Gói 55: quản lý tên thay thế món — map tên cũ (từ file import/app khác) về món hiện tại
// VD: "Mua 1 Tặng 1: Trà sữa ô long tặng hồng trà" (tên cũ T8) → món "Mua 1 Tặng 1: Trà sữa ô long tặng ô long lài"
export default function ProductAliasManager() {
  const [aliases, setAliases] = useState([]);
  const [loadErr, setLoadErr] = useState(false); // UX 2026-10-26 (🟠T1): phân biệt tải lỗi với thật sự trống
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ product_id: '', alias_name: '' });
  const [search, setSearch] = useState('');

  const load = () => {
    axios.get(`${API}/product-aliases`).then((r) => { setAliases(r.data?.data?.data || r.data?.data || []); setLoadErr(false); }).catch((e) => { noteExpired(e); setLoadErr(true); });
    axios.get(`${API}/products?per_page=200`).then((r) => setProducts(r.data?.data?.data || r.data?.data || [])).catch((e) => noteExpired(e));
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
    await axios.delete(`${API}/product-aliases/${id}`).catch((e) => alert(e.response?.data?.message || 'Thao tác thất bại. Vui lòng thử lại.'));
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
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => setSearch(v)}
            placeholder="Tìm tên cũ / tên món..." className="m-input w-full" wrapperStyle={{ display: 'flex', width: '100%' }} />
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
      {filtered.length === 0 && <div className="text-[13px] text-gray-400 py-4 text-center">{loadErr ? (<span style={{ color: 'var(--m-danger)' }}>⚠ Không tải được danh sách.<button onClick={load} className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 8 }}>Thử lại</button></span>) : 'Chưa có tên thay thế nào.'}</div>}

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
