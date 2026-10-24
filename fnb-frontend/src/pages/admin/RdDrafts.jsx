import React, { useState, useEffect, useCallback } from 'react';
import { rdGet, rdPost, rdPut, rdDelete } from './rdApi';

// SPEC R&D — Tab 1: Món nháp (bảng riêng rd_products, không lọt ra hệ thống bán hàng).
// Giá vốn tính ĐÚNG logic calcCost của món thật; giá vốn chạy trực tiếp trong form.
const fmt = (n) => `${Math.round(Number(n || 0)).toLocaleString('vi-VN')}đ`;
const STATUS = { draft: 'Nháp', approved: 'Đã duyệt', discarded: 'Đã loại' };

const emptyForm = (meta) => ({
  name: '', category_id: '', unit: '', description: '', image_url: '', expected_price: '',
  option_group_ids: [],
  prices: (meta?.price_lists || []).map((pl) => ({ price_list_id: pl.id, price: '' })),
  recipes: [], option_recipes: [],
});

export default function RdDrafts({ meta }) {
  const [list, setList] = useState([]);
  const [statusF, setStatusF] = useState('draft');
  const [catF, setCatF] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'edit', id}
  const [form, setForm] = useState(emptyForm(meta));
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rdGet(`/rd/products`, {
        params: { status: statusF, category_id: catF || undefined, search: search || undefined },
      });
      setList(res.data?.data || []);
    } catch (e) { alert(e.response?.data?.message || 'Không tải được danh sách món nháp.'); }
    finally { setLoading(false); }
  }, [statusF, catF, search]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const matCost = (mid) => Number(meta.materials.find((m) => m.id === Number(mid))?.cost_per_base || 0);
  const liveCost = (form?.recipes || []).reduce((s, r) => s + (Number(r.quantity) || 0) * matCost(r.material_id), 0);

  const openCreate = () => { setForm(emptyForm(meta)); setModal({ mode: 'create' }); };

  const openEdit = async (id) => {
    try {
      const res = await rdGet(`/rd/products/${id}`);
      const d = res.data?.data;
      setForm({
        name: d.name || '', category_id: d.category_id || '', unit: d.unit || '',
        description: d.description || '', image_url: d.image_url || '',
        expected_price: d.expected_price ?? '',
        option_group_ids: d.option_group_ids || [],
        prices: (meta.price_lists || []).map((pl) => {
          const found = (d.prices || []).find((p) => p.price_list_id === pl.id);
          return { price_list_id: pl.id, price: found ? found.price : '' };
        }),
        recipes: (d.recipes || []).map((r) => ({ material_id: r.material_id, quantity: r.quantity, kind: r.kind })),
        option_recipes: (d.option_recipes || []).map((r) => ({ product_option_id: r.product_option_id, material_id: r.material_id, quantity: r.quantity, kind: r.kind })),
      });
      setModal({ mode: 'edit', id });
    } catch (e) { alert(e.response?.data?.message || 'Không tải được món nháp.'); }
  };

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      category_id: form.category_id ? Number(form.category_id) : null,
      unit: form.unit || null,
      description: form.description || null,
      image_url: form.image_url || null,
      expected_price: Number(form.expected_price) || 0,
      option_group_ids: form.option_group_ids,
      prices: form.prices.filter((p) => p.price !== '' && Number(p.price) > 0)
        .map((p) => ({ price_list_id: p.price_list_id, price: Number(p.price) })),
      recipes: form.recipes.filter((r) => r.material_id && Number(r.quantity) > 0),
      option_recipes: form.option_recipes.filter((r) => r.product_option_id && r.material_id && Number(r.quantity) > 0),
    };
    setSaving(true);
    try {
      if (modal.mode === 'create') await rdPost(`/rd/products`, payload);
      else await rdPut(`/rd/products/${modal.id}`, payload);
      setModal(null);
      fetchList();
    } catch (e) {
      const msg = e.response?.data?.message
        || (e.response?.data?.errors ? Object.values(e.response.data.errors).flat().join('\n') : null)
        || 'Không lưu được món nháp.';
      alert(msg);
    } finally { setSaving(false); }
  };

  const act = async (id, action, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try {
      const res = await rdPost(`/rd/products/${id}/${action}`);
      if (res.data?.message) alert(res.data.message);
      fetchList();
    } catch (e) { alert(e.response?.data?.message || 'Thao tác thất bại.'); }
  };

  const handleDelete = async (p) => {
    if (!confirm(`Xóa hẳn món nháp "${p.name}"?`)) return;
    try { await rdDelete(`/rd/products/${p.id}`); fetchList(); }
    catch (e) { alert(e.response?.data?.message || 'Không xóa được.'); }
  };

  const quickPrice = async (p, value) => {
    const v = Number(value);
    if (Number.isNaN(v) || v === Number(p.expected_price)) return;
    try {
      await rdPut(`/rd/products/${p.id}/quick-price`, { expected_price: v });
      fetchList();
    } catch (e) { alert(e.response?.data?.message || 'Không sửa được giá.'); }
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const allOptions = (meta.option_groups || []).flatMap((g) => (g.options || []).map((o) => ({ ...o, group_name: g.name })));

  const recipeRows = (rows, onChange, withOption) => (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-center">
          {withOption && (
            <select value={r.product_option_id || ''} className="m-input" style={{ width: 180 }}
              onChange={(e) => { const n = [...rows]; n[i] = { ...n[i], product_option_id: Number(e.target.value) || '' }; onChange(n); }}>
              <option value="">— Chọn tùy chọn —</option>
              {allOptions.map((o) => <option key={o.id} value={o.id}>{o.group_name}: {o.name}</option>)}
            </select>
          )}
          <select value={r.material_id || ''} className="m-input" style={{ width: 220 }}
            onChange={(e) => { const n = [...rows]; n[i] = { ...n[i], material_id: Number(e.target.value) || '' }; onChange(n); }}>
            <option value="">— Chọn nguyên liệu —</option>
            {meta.materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit || 'đv'})</option>)}
          </select>
          <input type="number" min={0} step="0.01" value={r.quantity} placeholder="Định lượng"
            className="m-input" style={{ width: 110 }}
            onChange={(e) => { const n = [...rows]; n[i] = { ...n[i], quantity: e.target.value }; onChange(n); }} />
          <select value={r.kind || 'ingredient'} className="m-input" style={{ width: 120 }}
            onChange={(e) => { const n = [...rows]; n[i] = { ...n[i], kind: e.target.value }; onChange(n); }}>
            <option value="ingredient">Nguyên liệu</option>
            <option value="packaging">Bao bì</option>
          </select>
          <span className="text-xs" style={{ color: 'var(--m-ink-soft)', minWidth: 90 }}>
            {r.material_id ? fmt((Number(r.quantity) || 0) * matCost(r.material_id)) : ''}
          </span>
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="text-xs font-semibold" style={{ color: 'var(--m-danger)' }}>✕</button>
        </div>
      ))}
      <button type="button" className="m-btn m-btn-sm m-btn-ghost"
        onClick={() => onChange([...rows, withOption
          ? { product_option_id: '', material_id: '', quantity: '', kind: 'ingredient' }
          : { material_id: '', quantity: '', kind: 'ingredient' }])}>
        + Thêm dòng
      </button>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm theo tên món..."
          className="m-input" style={{ width: 210 }} />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="m-input" style={{ width: 140 }}>
          <option value="draft">Nháp</option>
          <option value="approved">Đã duyệt</option>
          <option value="discarded">Đã loại</option>
          <option value="all">Tất cả</option>
        </select>
        <select value={catF} onChange={(e) => setCatF(e.target.value)} className="m-input" style={{ width: 170 }}>
          <option value="">Mọi danh mục</option>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={openCreate} className="m-btn m-btn-primary m-btn-sm" style={{ marginLeft: 'auto' }}>+ Món nháp</button>
      </div>

      <div className="m-card overflow-x-auto">
        <table className="m-table min-w-[1050px]">
          <thead>
            <tr>
              <th>Tên món</th><th>Danh mục</th><th>Định mức</th><th>Giá vốn</th>
              <th>Giá bán dự kiến</th><th>Food cost %</th><th>Lãi gộp/ly</th><th>Tỷ suất LN</th>
              <th>Trạng thái</th><th className="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">
                  <span className="flex items-center gap-2">
                    {p.image_url && <img src={p.image_url} alt="" style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 6 }} />}
                    {p.name}
                  </span>
                </td>
                <td>{p.category_name || '—'}</td>
                <td className="m-num">{p.materials_count} NL</td>
                <td className="m-num font-semibold">{fmt(p.cost_price)}</td>
                <td>
                  {p.status === 'approved' ? (
                    <span className="m-num font-semibold">{fmt(p.expected_price)}</span>
                  ) : (
                    <input type="number" min={0} defaultValue={p.expected_price || ''} key={`${p.id}-${p.expected_price}`}
                      className="m-input m-num" style={{ width: 110, padding: '4px 8px' }}
                      onBlur={(e) => quickPrice(p, e.target.value)} />
                  )}
                </td>
                <td className="m-num font-semibold"
                  style={{ color: p.alert_level === 'red' ? '#dc2626' : p.alert_level === 'orange' ? '#d97706' : undefined }}>
                  {p.food_cost_pct != null ? `${p.food_cost_pct}%` : '—'}
                </td>
                <td className="m-num">{p.gross_profit != null ? fmt(p.gross_profit) : '—'}</td>
                <td className="m-num">{p.margin_pct != null ? `${p.margin_pct}%` : '—'}</td>
                <td><span className={`m-badge ${p.status === 'approved' ? 'm-badge-green' : p.status === 'discarded' ? 'm-badge-red' : 'm-badge-gray'}`}>{STATUS[p.status]}</span></td>
                <td className="text-right whitespace-nowrap">
                  {p.status === 'approved' ? (
                    <a href={`/admin/products`} className="text-xs font-semibold hover:underline" style={{ color: 'var(--m-primary)' }}>
                      Xem món thật #{p.approved_product_id}
                    </a>
                  ) : (
                    <>
                      <button onClick={() => openEdit(p.id)} className="text-xs font-semibold hover:underline mr-3" style={{ color: 'var(--m-primary)' }}>Sửa</button>
                      <button onClick={() => act(p.id, 'clone')} className="text-xs font-semibold hover:underline mr-3" style={{ color: 'var(--m-primary)' }}>Nhân bản</button>
                      {p.status === 'draft' && (
                        <button onClick={() => act(p.id, 'approve', `Duyệt "${p.name}" thành món thật? Món sẽ xuất hiện ở Danh sách mặt hàng (chưa xếp thực đơn nên chưa bán được).`)}
                          className="text-xs font-semibold hover:underline mr-3" style={{ color: '#059669' }}>Duyệt</button>
                      )}
                      {p.status === 'draft' && (
                        <button onClick={() => act(p.id, 'discard')} className="text-xs font-semibold hover:underline mr-3" style={{ color: '#d97706' }}>Loại</button>
                      )}
                      {p.status === 'discarded' && (
                        <button onClick={() => act(p.id, 'restore')} className="text-xs font-semibold hover:underline mr-3" style={{ color: 'var(--m-primary)' }}>Khôi phục</button>
                      )}
                      <button onClick={() => handleDelete(p)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--m-danger)' }}>Xóa</button>
                    </>
                  )}
                  {p.status === 'approved' && (
                    <button onClick={() => act(p.id, 'clone')} className="text-xs font-semibold hover:underline ml-3" style={{ color: 'var(--m-primary)' }}>Nhân bản</button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && !loading && <tr><td colSpan={10} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có món nháp nào ở bộ lọc này.</td></tr>}
            {loading && <tr><td colSpan={10} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Đang tải...</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--m-ink-faint)' }}>
        Giá vốn chỉ tính định mức cơ bản (không gồm định mức theo tùy chọn) — giống hệt cách tính của món thật.
        Food cost % tô cam khi vượt ngưỡng {meta.food_cost_alert_pct}% trong Thiết lập, tô đỏ khi vượt +10 điểm %.
      </p>

      {modal && (
        <div className="m-modal-backdrop" onClick={() => setModal(null)}>
          <div className="m-modal m-modal--flex" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="m-modal-head">{modal.mode === 'create' ? 'Tạo món nháp' : 'Sửa món nháp'}</div>
            <div className="m-modal-body">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="m-label">Tên món *</label>
                  <input value={form.name} onChange={(e) => set('name', e.target.value)} className="m-input w-full" />
                </div>
                <div>
                  <label className="m-label">Danh mục</label>
                  <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)} className="m-input w-full">
                    <option value="">— Chưa chọn —</option>
                    {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="m-label">Đơn vị tính</label>
                  <input value={form.unit} onChange={(e) => set('unit', e.target.value)} className="m-input w-full" placeholder="ly / phần..." />
                </div>
                <div>
                  <label className="m-label">Giá bán dự kiến (đ) *</label>
                  <input type="number" min={0} value={form.expected_price} onChange={(e) => set('expected_price', e.target.value)} className="m-input w-full" />
                </div>
                <div>
                  <label className="m-label">Ảnh (URL)</label>
                  <input value={form.image_url} onChange={(e) => set('image_url', e.target.value)} className="m-input w-full" />
                </div>
                <div className="md:col-span-2">
                  <label className="m-label">Mô tả</label>
                  <textarea value={form.description} onChange={(e) => set('description', e.target.value)} className="m-input w-full" rows={2} />
                </div>
              </div>

              <div>
                <div className="text-sm font-bold mb-2">Giá theo kênh (trống = dùng giá dự kiến)</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {form.prices.map((pr, i) => (
                    <div key={pr.price_list_id}>
                      <label className="m-label">{meta.price_lists.find((x) => x.id === pr.price_list_id)?.name || `Kênh ${pr.price_list_id}`}</label>
                      <input type="number" min={0} value={pr.price} className="m-input w-full"
                        onChange={(e) => { const n = [...form.prices]; n[i] = { ...n[i], price: e.target.value }; set('prices', n); }} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-bold mb-2">
                  Định mức cơ bản — Giá vốn hiện tại: <span style={{ color: 'var(--m-primary)' }}>{fmt(liveCost)}</span>
                  {Number(form.expected_price) > 0 && (
                    <span className="font-normal text-xs" style={{ color: 'var(--m-ink-soft)' }}>
                      {' '}· Food cost {Math.round(liveCost / Number(form.expected_price) * 1000) / 10}%
                    </span>
                  )}
                </div>
                {recipeRows(form.recipes, (n) => set('recipes', n), false)}
              </div>

              <div>
                <div className="text-sm font-bold mb-1">Nhóm tùy chọn</div>
                <div className="flex flex-wrap gap-3">
                  {(meta.option_groups || []).map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 accent-[#24305E]"
                        checked={form.option_group_ids.includes(g.id)}
                        onChange={(e) => set('option_group_ids', e.target.checked
                          ? [...form.option_group_ids, g.id]
                          : form.option_group_ids.filter((x) => x !== g.id))} />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-bold mb-2">Định mức theo tùy chọn (không tính vào giá vốn cơ bản)</div>
                {recipeRows(form.option_recipes, (n) => set('option_recipes', n), true)}
              </div>
            </div>
            </div>
            <div className="m-modal-foot">
              <button onClick={() => setModal(null)} className="m-btn m-btn-ghost">Hủy</button>
              <button onClick={save} disabled={saving} className="m-btn m-btn-primary">{saving ? 'Đang lưu...' : 'Lưu nháp'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
