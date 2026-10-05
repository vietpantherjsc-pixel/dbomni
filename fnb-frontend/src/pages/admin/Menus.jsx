import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

// Gói 7f (2026-10-05): Quản lý Thực đơn (hiển thị trên POS/App).
// - Kéo-thả đổi thứ tự thực đơn và món trong thực đơn
// - Thêm/bớt món, tạo/sửa/xóa thực đơn
// - Danh mục vẫn dùng để nhóm SP + báo cáo (trang riêng)
const BASE = 'http://localhost/api';
const fmt = (v) => `${Number(v || 0).toLocaleString('vi-VN')} đ`;

export default function Menus() {
  const [menus, setMenus] = useState([]);
  const [sel, setSel] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const dragIdx = useRef(null);

  const load = async () => {
    const r = await axios.get(`${BASE}/menus`);
    if (r.data?.success) {
      setMenus(r.data.data);
      if (r.data.data.length && !sel) selectMenu(r.data.data[0].id);
      else if (sel) selectMenu(sel);
    }
  };
  const selectMenu = async (id) => {
    setSel(id);
    const r = await axios.get(`${BASE}/menus/${id}`);
    if (r.data?.success) setProducts(r.data.data.products || []);
  };
  useEffect(() => { load().catch((e) => {
    if (e.response?.status === 401) return; // hết phiên: AuthContext tự chuyển về login
    alert(e.response?.data?.message || e.message);
  }); }, []);

  // --- Kéo-thả thực đơn ---
  const onMenuDrop = async (toIdx) => {
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === toIdx) return;
    const arr = [...menus];
    const [m] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, m);
    setMenus(arr);
    dragIdx.current = null;
    try { await axios.post(`${BASE}/menus/reorder`, { ordered_ids: arr.map((x) => x.id) }); }
    catch (e) { alert(e.response?.data?.message || e.message); load(); }
  };

  // --- Kéo-thả món ---
  const onProdDrop = async (toIdx) => {
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === toIdx) return;
    const arr = [...products];
    const [p] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, p);
    setProducts(arr);
    dragIdx.current = null;
    try { await axios.post(`${BASE}/menus/${sel}/products/reorder`, { ordered_ids: arr.map((x) => x.id) }); }
    catch (e) { alert(e.response?.data?.message || e.message); selectMenu(sel); }
  };

  const createMenu = async () => {
    if (!newName.trim()) { alert('Nhập tên thực đơn.'); return; }
    await axios.post(`${BASE}/menus`, { name: newName.trim() }).catch((e) => alert(e.response?.data?.message || e.message));
    setNewName(''); setShowAdd(false); load();
  };
  const saveRename = async (id) => {
    const v = renameVal.trim();
    setRenaming(null);
    if (!v) return;
    try {
      await axios.patch(`${BASE}/menus/${id}`, { name: v });
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };

  const delMenu = async (id) => {
    if (!confirm('Xóa thực đơn này? Món bên trong không bị xóa.')) return;
    await axios.delete(`${BASE}/menus/${id}`).catch((e) => alert(e.message));
    setSel(null); load();
  };
  const search = async (v) => {
    setQ(v);
    if (!v.trim() || !sel) { setFound([]); return; }
    const r = await axios.get(`${BASE}/menus/${sel}/search-products`, { params: { q: v } }).catch(() => null);
    if (r?.data?.success) setFound(r.data.data);
  };
  const addProduct = async (pid) => {
    await axios.post(`${BASE}/menus/${sel}/products`, { product_id: pid }).catch((e) => alert(e.response?.data?.message || e.message));
    setQ(''); setFound([]); selectMenu(sel);
  };
  const delProduct = async (pid) => {
    await axios.delete(`${BASE}/menus/${sel}/products/${pid}`).catch((e) => alert(e.message));
    selectMenu(sel);
  };

  const dragProps = (idx) => ({
    draggable: true,
    onDragStart: (e) => { dragIdx.current = idx; e.dataTransfer.effectAllowed = 'move'; },
    onDragOver: (e) => e.preventDefault(),
  });

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-[22px] font-bold text-[var(--m-ink)]">Thực đơn</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--m-ink-soft)' }}>
          Thực đơn hiển thị trên POS và App đặt hàng — kéo-thả để sắp xếp thứ tự.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Cột trái: danh sách thực đơn */}
          <div className="m-card p-3">
            <div className="flex justify-between items-center px-2 py-1 mb-2">
              <span className="m-kicker">Danh sách ({menus.length})</span>
              <button onClick={() => setShowAdd(!showAdd)} className="m-btn m-btn-primary m-btn-sm">+ Thêm</button>
            </div>
            {showAdd && (
              <div className="flex gap-2 px-2 mb-2">
                <input className="m-input" placeholder="Tên thực đơn…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createMenu()} />
                <button onClick={createMenu} className="m-btn m-btn-primary m-btn-sm">Lưu</button>
              </div>
            )}
            <div className="space-y-1">
              {menus.map((m, i) => (
                <div
                  key={m.id}
                  {...dragProps(i)}
                  onDrop={() => onMenuDrop(i)}
                  onClick={() => selectMenu(m.id)}
                  className={`m-nav-item cursor-move ${sel === m.id ? 'active' : ''}`}
                  style={sel === m.id ? {} : { color: 'var(--m-ink)' }}
                >
                  <span style={{ color: 'var(--m-ink-faint)', cursor: 'grab' }}>⠿</span>
                  {renaming === m.id ? (
                    <input autoFocus className="m-input !py-1 !px-2 flex-1 text-sm"
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => saveRename(m.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(m.id); if (e.key === 'Escape') setRenaming(null); }} />
                  ) : (
                    <span className="flex-1 truncate font-medium" title="Nhấp đúp để đổi tên"
                      onDoubleClick={(e) => { e.stopPropagation(); setRenaming(m.id); setRenameVal(m.name); }}>{m.name}</span>
                  )}
                  <span className="m-badge m-badge-gray m-num">{m.products_count}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); delMenu(m.id); }}
                    className="text-xs hover:underline" style={{ color: 'var(--m-danger)' }}
                  >Xóa</button>
                </div>
              ))}
            </div>
          </div>

          {/* Cột phải: món trong thực đơn */}
          <div className="md:col-span-2 m-card p-4">
            {!sel ? (
              <div className="text-center py-12 text-sm" style={{ color: 'var(--m-ink-faint)' }}>Chọn một thực đơn bên trái.</div>
            ) : (
              <>
                <div className="m-kicker mb-2">Món trong thực đơn ({products.length}) — kéo-thả để sắp xếp</div>
                <div className="flex gap-2 mb-3 relative">
                  <input className="m-input" placeholder="Tìm món để thêm…" value={q} onChange={(e) => search(e.target.value)} />
                  {found.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 m-card z-10 max-h-60 overflow-auto m-scroll">
                      {found.map((p) => (
                        <button key={p.id} onClick={() => addProduct(p.id)} className="w-full text-left px-3 py-2 hover:bg-[var(--m-bg-soft)] text-sm flex justify-between">
                          <span>{p.name}</span><span className="m-num" style={{ color: 'var(--m-ink-faint)' }}>{fmt(p.base_price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  {products.map((p, i) => (
                    <div
                      key={p.id}
                      {...dragProps(i)}
                      onDrop={() => onProdDrop(i)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-move hover:bg-[var(--m-bg-soft)]"
                      style={{ borderColor: 'var(--m-line)' }}
                    >
                      <span style={{ color: 'var(--m-ink-faint)', cursor: 'grab' }}>⠿</span>
                      <span className="m-num text-xs w-6" style={{ color: 'var(--m-ink-faint)' }}>{i + 1}</span>
                      {p.image_url && <img src={p.image_url} alt="" className="w-9 h-9 rounded-lg object-cover" />}
                      <span className="flex-1 text-sm font-medium truncate">{p.name}</span>
                      <span className="text-sm m-num" style={{ color: 'var(--m-ink-soft)' }}>{fmt(p.base_price)}</span>
                      <button onClick={() => delProduct(p.id)} className="text-xs hover:underline" style={{ color: 'var(--m-danger)' }}>Bớt</button>
                    </div>
                  ))}
                  {products.length === 0 && (
                    <div className="text-center py-10 text-sm" style={{ color: 'var(--m-ink-faint)' }}>Chưa có món nào. Tìm và thêm món ở ô trên.</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
