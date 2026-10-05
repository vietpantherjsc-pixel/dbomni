import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

// Gói 8a (2026-10-05): Nhóm tùy chọn — kéo-thả sắp xếp nhóm & tùy chọn,
// gán nhóm cho mặt hàng, định mức nguyên liệu tăng thêm cho từng tùy chọn.
const BASE = 'http://localhost/api';

export default function OptionGroups() {
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState({});
  const [editing, setEditing] = useState(null);
  const [newOpt, setNewOpt] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'single', is_required: false, quantity_mode: 'fixed' });
  const [assignGroup, setAssignGroup] = useState(null); // group đang gán món
  const [recipeOpt, setRecipeOpt] = useState(null); // option đang sửa định mức
  const [editingGroup, setEditingGroup] = useState(null); // Gói 8d: sửa nhóm (đổi loại định lượng)
  const [priceDrafts, setPriceDrafts] = useState({}); // Gói 8f: giá đang sửa {optionId: value}
  const dragG = useRef(null);
  const dragO = useRef(null);

  const load = async () => {
    const r = await axios.get(`${BASE}/option-groups`);
    if (r.data?.success) setGroups(r.data.data);
  };
  useEffect(() => { load().catch((e) => {
    if (e.response?.status === 401) return;
    alert(e.response?.data?.message || e.message);
  }); }, []);

  const toggle = (id) => setOpen((p) => ({ ...p, [id]: !p[id] }));

  // ---- kéo-thả nhóm ----
  const dropGroup = async (targetId) => {
    const from = dragG.current, to = targetId;
    dragG.current = null;
    if (from == null || from === to) return;
    const arr = [...groups];
    const fi = arr.findIndex((g) => g.id === from);
    const ti = arr.findIndex((g) => g.id === to);
    const [mv] = arr.splice(fi, 1);
    arr.splice(ti, 0, mv);
    setGroups(arr);
    try { await axios.post(`${BASE}/option-groups/reorder`, { ids: arr.map((g) => g.id) }); }
    catch (e) { alert(e.response?.data?.message || e.message); load(); }
  };

  // ---- kéo-thả tùy chọn trong nhóm ----
  const dropOption = async (gid, targetId) => {
    const from = dragO.current;
    dragO.current = null;
    if (from == null || from === targetId) return;
    const arr = [...groups];
    const gi = arr.findIndex((g) => g.id === gid);
    const opts = [...(arr[gi].options || [])];
    const fi = opts.findIndex((o) => o.id === from);
    const ti = opts.findIndex((o) => o.id === targetId);
    const [mv] = opts.splice(fi, 1);
    opts.splice(ti, 0, mv);
    arr[gi] = { ...arr[gi], options: opts };
    setGroups(arr);
    try { await axios.post(`${BASE}/option-groups/${gid}/options/reorder`, { ids: opts.map((o) => o.id) }); }
    catch (e) { alert(e.response?.data?.message || e.message); load(); }
  };

  const savePrice = async (opt, price) => {
    try {
      await axios.patch(`${BASE}/options/${opt.id}`, { additional_price: Number(price) || 0 });
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); load(); }
  };

  // Gói 8f: hiển thị số gọn ("10000.00" -> "10000"), nút Lưu hiện khi có thay đổi
  const cleanNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : '0';
  };
  const confirmPrice = async (opt) => {
    const v = priceDrafts[opt.id] ?? cleanNum(opt.additional_price);
    setPriceDrafts((p) => { const n = { ...p }; delete n[opt.id]; return n; });
    if (Number(v) !== Number(opt.additional_price)) await savePrice(opt, v);
  };

  const addOption = async (gid) => {
    const v = newOpt[gid];
    if (!v?.name?.trim()) { alert('Nhập tên tùy chọn.'); return; }
    try {
      await axios.post(`${BASE}/option-groups/${gid}/options`, { name: v.name.trim(), additional_price: Number(v.price) || 0 });
      setNewOpt((p) => ({ ...p, [gid]: {} }));
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };

  const delOption = async (id) => {
    if (!confirm('Xóa tùy chọn này?')) return;
    await axios.delete(`${BASE}/options/${id}`).catch((e) => alert(e.message));
    load();
  };

  const createGroup = async () => {
    if (!form.name.trim()) { alert('Nhập tên nhóm.'); return; }
    try {
      await axios.post(`${BASE}/option-groups`, { ...form, name: form.name.trim() });
      setForm({ name: '', type: 'single', is_required: false, quantity_mode: 'fixed' });
      setShowAdd(false);
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };

  const delGroup = async (id) => {
    if (!confirm('Xóa nhóm này? Tùy chọn sẽ được giữ lại.')) return;
    await axios.delete(`${BASE}/option-groups/${id}`).catch((e) => alert(e.message));
    load();
  };

  const input = 'm-input';

  return (
    <AdminLayout>
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-1">
        <h1 className="text-[22px] font-bold text-[var(--m-ink)]">Nhóm tùy chọn</h1>
        <button onClick={() => setShowAdd(!showAdd)} className="m-btn m-btn-primary">
          {showAdd ? 'Đóng' : '+ Thêm nhóm'}
        </button>
      </div>
      <p className="text-sm mb-6" style={{color:"var(--m-ink-soft)"}}>Kéo-thả để sắp xếp nhóm & tùy chọn · Gán nhóm cho mặt hàng · Định mức nguyên liệu tăng thêm cho từng tùy chọn.</p>

      {showAdd && (
        <div className="m-card p-5 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><label className="text-xs font-semibold">Tên nhóm *</label><input className={input + ' w-full'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Topping mới" /></div>
            <div><label className="text-xs font-semibold">Kiểu chọn</label>
              <select className={input + ' w-full'} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="single">Chọn 1</option><option value="multiple">Chọn nhiều</option>
              </select></div>
            {/* Gói 8c: loại định lượng */}
            <div><label className="text-xs font-semibold">Loại định lượng</label>
              <select className={input + ' w-full'} value={form.quantity_mode} onChange={(e) => setForm({ ...form, quantity_mode: e.target.value })}>
                <option value="fixed">Cố định (set ở đây)</option><option value="per_product">Theo món (set trong món)</option>
              </select></div>
            <div className="flex items-end gap-2"><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={form.is_required} onChange={(e) => setForm({ ...form, is_required: e.target.checked })} /> Bắt buộc chọn</label></div>
          </div>
          <p className="text-xs mt-2" style={{color:'var(--m-ink-faint)'}}>
            <b>Cố định:</b> định lượng 1 lần, áp dụng mọi món (VD: Topping). <b>Theo món:</b> mỗi món set riêng trong form Mặt hàng (VD: Size — cà phê +40ml, trà +70ml).
          </p>
          <button onClick={createGroup} className="m-btn m-btn-primary mt-3">Tạo nhóm</button>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.id} className="m-card mb-3"
          draggable
          onDragStart={(e) => { dragG.current = g.id; e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dropGroup(g.id)}
        >
          <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => toggle(g.id)}>
            <span className="cursor-grab text-[var(--m-ink-faint)]" title="Kéo để sắp xếp" onClick={(e) => e.stopPropagation()}>⠿</span>
            <span className="text-gray-400">{open[g.id] ? '▾' : '▸'}</span>
            <div className="flex-1">
              <div className="font-bold flex items-center gap-2">
                {g.name}
                {/* Gói 8c: badge loại định lượng */}
                <span className="m-badge" style={g.quantity_mode === 'per_product'
                  ? { background: '#FEF3C7', color: '#92400E' }
                  : { background: 'var(--m-accent-soft)', color: 'var(--m-primary)' }}>
                  {g.quantity_mode === 'per_product' ? 'Theo món' : 'Cố định'}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {g.type === 'single' ? 'Chọn 1' : 'Chọn nhiều'} · {g.is_required ? 'Bắt buộc' : 'Không bắt buộc'} · {g.options?.length || 0} tùy chọn · {g.products_count || 0} món dùng
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setAssignGroup(g); }} className="m-btn m-btn-sm m-btn-ghost">Gán mặt hàng</button>
            <button onClick={(e) => { e.stopPropagation(); setEditingGroup(g); }} className="text-xs font-semibold hover:underline" style={{color:'var(--m-primary)'}}>Sửa</button>
            <button onClick={(e) => { e.stopPropagation(); delGroup(g.id); }} className="text-xs text-red-600 hover:underline">Xóa</button>
          </div>
          {open[g.id] && (
            <div className="border-t px-4 py-3">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500"><th className="py-2 w-8"></th><th className="py-2">Tùy chọn</th><th className="w-52">Giá thêm (đ)</th><th className="w-48"></th></tr></thead>
                <tbody>
                  {(g.options || []).map((o) => (
                    <tr key={o.id} className="border-t border-gray-100"
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); dragO.current = o.id; e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      onDrop={(e) => { e.stopPropagation(); dropOption(g.id, o.id); }}
                    >
                      <td className="py-2 cursor-grab text-[var(--m-ink-faint)]" title="Kéo để sắp xếp">⠿</td>
                      <td className="py-2">{editing === o.id ? (
                        <input className={input} defaultValue={o.name} id={`nm-${o.id}`} />
                      ) : o.name}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <input type="number" min="0" step="500" className={input + ' w-28'}
                            value={priceDrafts[o.id] ?? cleanNum(o.additional_price)}
                            onChange={(e) => setPriceDrafts((p) => ({ ...p, [o.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') confirmPrice(o); }} />
                          {(priceDrafts[o.id] ?? cleanNum(o.additional_price)) !== cleanNum(o.additional_price) && (
                            <button className="m-btn m-btn-sm m-btn-primary" onClick={() => confirmPrice(o)}>Lưu</button>
                          )}
                        </div>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {/* Gói 8c: nhóm theo món -> cấu hình trong form món */}
                        {g.quantity_mode === 'per_product' ? (
                          <span className="text-xs" style={{color:'var(--m-ink-faint)'}} title="Mở form Mặt hàng để set định mức cho từng món">Set trong món</span>
                        ) : (
                          <button className="text-xs font-semibold mr-2 hover:underline" style={{color:'var(--m-primary)'}} onClick={() => setRecipeOpt(o)}>Định mức</button>
                        )}
                        {editing === o.id ? (
                          <button className="text-xs text-green-700 font-bold mr-2" onClick={async () => {
                            const nm = document.getElementById(`nm-${o.id}`).value;
                            await axios.patch(`${BASE}/options/${o.id}`, { name: nm }).catch((e) => alert(e.message));
                            setEditing(null); load();
                          }}>Lưu</button>
                        ) : (
                          <button className="text-xs text-blue-600 mr-2" onClick={() => setEditing(o.id)}>Sửa</button>
                        )}
                        <button className="text-xs text-red-600" onClick={() => delOption(o.id)}>Xóa</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2 mt-3">
                <input className={input + ' flex-1'} placeholder="Tên tùy chọn mới…" value={newOpt[g.id]?.name || ''} onChange={(e) => setNewOpt((p) => ({ ...p, [g.id]: { ...p[g.id], name: e.target.value } }))} />
                <input type="number" min="0" step="500" className={input + ' w-32'} placeholder="Giá thêm" value={newOpt[g.id]?.price || ''} onChange={(e) => setNewOpt((p) => ({ ...p, [g.id]: { ...p[g.id], price: e.target.value } }))} />
                <button onClick={() => addOption(g.id)} className="m-btn m-btn-primary m-btn-sm">+ Thêm</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {groups.length === 0 && <div className="text-center text-gray-400 py-10">Chưa có nhóm nào. Chạy <code>php artisan import:option-groups</code> để nạp.</div>}

      {assignGroup && <AssignModal group={assignGroup} onClose={() => { setAssignGroup(null); load(); }} />}
      {recipeOpt && <RecipeModal option={recipeOpt} onClose={() => setRecipeOpt(null)} />}
      {editingGroup && <EditGroupModal group={editingGroup} onClose={() => { setEditingGroup(null); load(); }} />}
    </div>
    </AdminLayout>
  );
}

// ---- Modal sửa nhóm (Gói 8d): đổi tên, kiểu chọn, LOẠI ĐỊNH LƯỢNG ----
function EditGroupModal({ group, onClose }) {
  const [name, setName] = useState(group.name);
  const [type, setType] = useState(group.type);
  const [quantityMode, setQuantityMode] = useState(group.quantity_mode || 'fixed');
  const [isRequired, setIsRequired] = useState(!!group.is_required);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { alert('Nhập tên nhóm.'); return; }
    if (quantityMode !== (group.quantity_mode || 'fixed')) {
      const msg = quantityMode === 'per_product'
        ? 'Chuyển sang "Theo món": định mức cũ (nếu có) sẽ không áp dụng nữa — phải set lại trong form từng món. Tiếp tục?'
        : 'Chuyển sang "Cố định": định mức theo món cũ sẽ không áp dụng nữa. Tiếp tục?';
      if (!confirm(msg)) return;
    }
    setSaving(true);
    try {
      await axios.patch(`${BASE}/option-groups/${group.id}`, {
        name: name.trim(), type, quantity_mode: quantityMode, is_required: isRequired,
      });
      onClose();
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="m-modal-backdrop" onClick={onClose}>
      <div className="m-modal !max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="m-modal-head">Sửa nhóm tùy chọn</div>
        <div className="m-modal-body space-y-4">
          <div>
            <label className="m-label">Tên nhóm *</label>
            <input className="m-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="m-label">Kiểu chọn</label>
            <select className="m-input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="single">Chọn 1</option>
              <option value="multiple">Chọn nhiều</option>
            </select>
          </div>
          <div>
            <label className="m-label">Loại định lượng *</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'fixed', t: 'Cố định', d: 'Set 1 lần ở đây, áp dụng mọi món (VD: Topping)' },
                { v: 'per_product', t: 'Theo món', d: 'Mỗi món set riêng trong form Mặt hàng (VD: Size)' },
              ].map((o) => (
                <button key={o.v} type="button" onClick={() => setQuantityMode(o.v)}
                  className="p-3 rounded-lg border text-left"
                  style={quantityMode === o.v
                    ? { borderColor: 'var(--m-primary)', background: 'var(--m-accent-soft)' }
                    : { borderColor: 'var(--m-line)', background: 'var(--m-surface)' }}>
                  <span className="block text-sm font-bold" style={{ color: 'var(--m-ink)' }}>{o.t}</span>
                  <span className="block text-xs mt-1" style={{ color: 'var(--m-ink-faint)' }}>{o.d}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--m-ink)' }}>
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="w-4 h-4 accent-[#24305E]" />
            Bắt buộc chọn
          </label>
        </div>
        <div className="m-modal-foot">
          <button className="m-btn m-btn-ghost" onClick={onClose}>Hủy</button>
          <button className="m-btn m-btn-primary" disabled={saving} onClick={save}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Modal gán nhóm cho mặt hàng ----
function AssignModal({ group, onClose }) {
  const [products, setProducts] = useState([]);
  const [checked, setChecked] = useState([]);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, a] = await Promise.all([
        axios.get(`${BASE}/products`),
        axios.get(`${BASE}/option-groups/${group.id}/products`),
      ]);
      setProducts(Array.isArray(p.data) ? p.data : (p.data.data || []));
      setChecked(a.data?.data || []);
    })().catch((e) => alert(e.message));
  }, [group.id]);

  const toggleCk = (id) => setChecked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await axios.post(`${BASE}/option-groups/${group.id}/products`, { product_ids: checked });
      alert(r.data?.message || 'Đã lưu.');
      onClose();
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setSaving(false); }
  };

  const list = products.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="m-modal-backdrop" onClick={onClose}>
      <div className="m-modal !max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="m-modal-head">Gán nhóm "{group.name}" cho mặt hàng</div>
        <div className="m-modal-body">
          <input className="m-input w-full mb-3" placeholder="Tìm món…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-[50vh] overflow-y-auto m-scroll border rounded-lg" style={{borderColor:'var(--m-line)'}}>
            {list.map((p) => (
              <label key={p.id} className="flex items-center gap-3 px-3 py-2 border-b text-sm cursor-pointer hover:bg-[var(--m-bg-soft)]" style={{borderColor:'var(--m-line)'}}>
                <input type="checkbox" checked={checked.includes(p.id)} onChange={() => toggleCk(p.id)} className="w-4 h-4 accent-[#24305E]" />
                <span className="flex-1">{p.name}</span>
                <span className="text-xs" style={{color:'var(--m-ink-faint)'}}>{p.category?.name || ''}</span>
              </label>
            ))}
            {list.length === 0 && <div className="p-6 text-center text-sm" style={{color:'var(--m-ink-faint)'}}>Không tìm thấy món.</div>}
          </div>
          <div className="text-xs mt-2" style={{color:'var(--m-ink-soft)'}}>Đã chọn {checked.length} món</div>
        </div>
        <div className="m-modal-foot">
          <button className="m-btn m-btn-ghost" onClick={onClose}>Đóng</button>
          <button className="m-btn m-btn-primary" disabled={saving} onClick={save}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Modal định mức cho 1 tùy chọn (nhóm CỐ ĐỊNH) ----
// Gói 8c: 2 mục — Nguyên liệu (tự do, VD: trân châu 30g) và Bao bì (VD: hũ nhỏ).
function RecipeModal({ option, onClose }) {
  const [materials, setMaterials] = useState([]);
  const [ingredients, setIngredients] = useState([{ material_id: '', quantity: '' }]);
  const [packaging, setPackaging] = useState([{ material_id: '', quantity: '' }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await axios.get(`${BASE}/options/${option.id}/recipes`);
      const d = r.data?.data;
      setMaterials(d?.materials || []);
      const recs = d?.recipes || [];
      const ing = recs.filter((x) => (x.kind || 'ingredient') === 'ingredient');
      const pack = recs.filter((x) => x.kind === 'packaging');
      setIngredients(ing.length ? ing.map((x) => ({ material_id: String(x.material_id), quantity: x.quantity })) : [{ material_id: '', quantity: '' }]);
      setPackaging(pack.length ? pack.map((x) => ({ material_id: String(x.material_id), quantity: x.quantity })) : [{ material_id: '', quantity: '' }]);
    })().catch((e) => alert(e.message));
  }, [option.id]);

  const packMats = materials.filter((m) => (m.type || '').toLowerCase().includes('pack') || (m.type || '').includes('bao') || (m.name || '').toLowerCase().includes('ly') || (m.name || '').toLowerCase().includes('hũ') || (m.name || '').toLowerCase().includes('hộp'));

  const LineEditor = ({ lines, setLines, materialList, placeholder }) => (
    <>
      {lines.map((l, i) => (
        <div key={i} className="grid gap-2 mb-2 items-center" style={{ gridTemplateColumns: '1fr 130px 40px' }}>
          <select className="m-input" value={l.material_id} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, material_id: e.target.value } : x))}>
            <option value="">{placeholder}</option>
            {materialList.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
          </select>
          <input type="number" min="0" step="0.5" className="m-input" placeholder="SL" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
          <button className="m-btn m-btn-ghost m-btn-sm !px-0" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="m-btn m-btn-ghost m-btn-sm mt-1" onClick={() => setLines([...lines, { material_id: '', quantity: '' }])}>+ Thêm dòng</button>
    </>
  );

  const save = async () => {
    const toPayload = (lines, kind) => lines
      .filter((l) => l.material_id && Number(l.quantity) > 0)
      .map((l) => ({ material_id: Number(l.material_id), quantity: Number(l.quantity), kind }));
    setSaving(true);
    try {
      await axios.put(`${BASE}/options/${option.id}/recipes`, {
        recipes: [...toPayload(ingredients, 'ingredient'), ...toPayload(packaging, 'packaging')],
      });
      alert('Đã lưu định mức.');
      onClose();
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="m-modal-backdrop" onClick={onClose}>
      <div className="m-modal !max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="m-modal-head">Định mức — "{option.name}" <span className="m-badge ml-2" style={{ background: 'var(--m-accent-soft)', color: 'var(--m-primary)' }}>Cố định</span></div>
        <div className="m-modal-body">
          <p className="text-xs mb-3" style={{color:'var(--m-ink-soft)'}}>
            Áp dụng cho <b>mọi món</b> dùng tùy chọn này. Khi khách chọn, kho trừ thêm các dòng dưới đây.
          </p>
          <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{color:'var(--m-ink)'}}>1. Nguyên liệu tăng thêm</div>
          <p className="text-xs mb-2" style={{color:'var(--m-ink-faint)'}}>VD: Trân châu đen +30g trân châu (chọn tự do).</p>
          <LineEditor lines={ingredients} setLines={setIngredients} materialList={materials} placeholder="— Chọn nguyên liệu —" />

          <div className="text-xs font-bold uppercase tracking-wide mt-5 mb-2" style={{color:'var(--m-ink)'}}>2. Bao bì</div>
          <p className="text-xs mb-2" style={{color:'var(--m-ink-faint)'}}>VD: Topping trân châu +1 hũ nhựa nhỏ.</p>
          <LineEditor lines={packaging} setLines={setPackaging} materialList={packMats.length ? packMats : materials} placeholder="— Chọn bao bì —" />
        </div>
        <div className="m-modal-foot">
          <button className="m-btn m-btn-ghost" onClick={onClose}>Đóng</button>
          <button className="m-btn m-btn-primary" disabled={saving} onClick={save}>{saving ? 'Đang lưu…' : 'Lưu định mức'}</button>
        </div>
      </div>
    </div>
  );
}
