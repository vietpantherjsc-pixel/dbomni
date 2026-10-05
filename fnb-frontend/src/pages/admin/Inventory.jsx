import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

const API = 'http://localhost/api';
const BRANCH_ID = 1;

const TYPE_LABELS = { raw: 'Nguyên liệu thô', semi_finished: 'Bán thành phẩm', consumable: 'Tiêu hao' };
const TYPE_COLORS = {
    raw: 'bg-blue-50 text-blue-700 border-blue-200',
    semi_finished: 'bg-violet-50 text-violet-700 border-violet-200',
    consumable: 'bg-slate-100 text-slate-600 border-slate-200',
};
const STOCKTAKE_TYPES = { daily: 'Ngày', weekly: 'Tuần', monthly: 'Tháng', spontaneous: 'Đột xuất' };

// =====================================================================
// Gói 4 (2026-10-04): Trang Kho hàng — 4 tabs:
// Tồn kho (cảnh báo tồn thấp) / Nhập kho (quy đổi đơn vị) /
// Chế biến (định mức + phiếu SX bán thành phẩm) / Kiểm kê.
// =====================================================================
export default function Inventory() {
    const [tab, setTab] = useState('stock');
    const [materials, setMaterials] = useState([]);
    const [stock, setStock] = useState([]);

    const fetchAll = async () => {
        try {
            const [mRes, sRes] = await Promise.all([
                axios.get(`${API}/materials`),
                axios.get(`${API}/inventory/branch/${BRANCH_ID}`),
            ]);
            if (mRes.data?.success) setMaterials(mRes.data.data);
            if (sRes.data?.success) setStock(sRes.data.data);
        } catch (err) { console.error('Lỗi tải kho:', err); }
    };

    useEffect(() => { fetchAll(); }, []);

    const matById = (id) => materials.find((m) => m.id === Number(id));

    return (
        <AdminLayout>
            <div>
                <h1 className="text-lg font-bold text-[#1f2937] mb-1">Kho hàng</h1>
                <p className="text-[13px] text-[#6b7280] mb-4">Quản lý tồn kho, nhập hàng, chế biến bán thành phẩm và kiểm kê.</p>

                <div className="flex gap-1 border-b border-gray-200 mb-4">
                    {[
                        ['stock', 'Tồn kho'],
                        ['inbound', 'Nhập kho'],
                        ['production', 'Chế biến'],
                        ['stocktake', 'Kiểm kê'],
                    ].map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`px-4 py-2.5 text-[13px] border-b-2 -mb-px transition-colors ${
                                tab === key ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === 'stock' && <StockTab stock={stock} materials={materials} onChange={fetchAll} />}
                {tab === 'inbound' && <InboundTab materials={materials} onDone={fetchAll} />}
                {tab === 'production' && <ProductionTab materials={materials} matById={matById} onDone={fetchAll} />}
                {tab === 'stocktake' && <StocktakeTab materials={materials} onDone={fetchAll} />}
            </div>
        </AdminLayout>
    );
}

// ================= TAB TỒN KHO =================
function StockTab({ stock, materials, onChange }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null); // null = thêm mới
    const [form, setForm] = useState({ name: '', unit: 'g', type: 'raw', minimum_stock: 0, purchase_unit: '', conversion_rate: '' });

    const resetForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm({ name: '', unit: 'g', type: 'raw', minimum_stock: 0, purchase_unit: '', conversion_rate: '' });
    };

    // Gói 4 (2026-10-05): sửa nguyên liệu — nạp dữ liệu cũ vào form
    const startEdit = (materialId) => {
        const m = materials.find((x) => x.id === materialId);
        if (!m) return;
        setEditingId(m.id);
        setForm({
            name: m.name,
            unit: m.unit,
            type: m.type,
            minimum_stock: m.minimum_stock ?? 0,
            purchase_unit: m.purchase_unit || '',
            conversion_rate: m.conversion_rate || '',
        });
        setShowForm(true);
    };

    const editingStock = editingId ? stock.find((s) => s.material_id === editingId) : null;
    const hasBatches = editingStock && editingStock.batches_count > 0;

    const handleSave = async () => {
        if (!form.name.trim() || !form.unit.trim()) return alert('Nhập tên và đơn vị cơ sở');
        if (form.purchase_unit.trim() && !(Number(form.conversion_rate) > 0)) {
            return alert('Nhập tỉ lệ quy đổi (VD: 1 chai = 750ml)');
        }
        try {
            const payload = {
                name: form.name.trim(),
                unit: form.unit.trim(),
                type: form.type,
                minimum_stock: Number(form.minimum_stock) || 0,
                purchase_unit: form.purchase_unit.trim() || null,
                conversion_rate: form.purchase_unit.trim() ? (Number(form.conversion_rate) || 1) : 1,
            };
            let res;
            if (editingId) {
                // Không cho đổi đơn vị cơ sở khi đã có lô nhập (tránh lệch số liệu tồn)
                delete payload.unit;
                res = await axios.patch(`${API}/materials/${editingId}`, payload);
            } else {
                res = await axios.post(`${API}/materials`, payload);
            }
            if (res.data?.success) {
                resetForm();
                onChange();
            }
        } catch (err) { alert(err.response?.data?.message || 'Lưu nguyên liệu thất bại'); }
    };

    const lowCount = stock.filter((s) => s.is_low_stock).length;

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] text-gray-600">
                    {lowCount > 0
                        ? <span className="text-red-600 font-medium">⚠ {lowCount} nguyên liệu sắp hết</span>
                        : <span className="text-emerald-600">✓ Tồn kho ổn định</span>}
                </div>
                <button onClick={() => { resetForm(); setShowForm(true); }} className="px-3 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                    + Nguyên liệu
                </button>
            </div>

            {showForm && (
                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-[14px] mb-3">{editingId ? 'Sửa nguyên liệu' : 'Thêm nguyên liệu mới'}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                        <label className="text-xs text-gray-500">Tên nguyên liệu *</label>
                        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="VD: Syrup đường" className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">Đơn vị cơ sở *</label>
                        <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                            placeholder="g / ml / cái" disabled={hasBatches}
                            title={hasBatches ? 'Đã có lô nhập — không thể đổi đơn vị cơ sở' : ''}
                            className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd] disabled:bg-gray-100" />
                        {hasBatches && <div className="text-[11px] text-amber-600 mt-1">Đã có lô nhập — không đổi được đơn vị cơ sở</div>}
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">Loại</label>
                        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                            className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]">
                            <option value="raw">Nguyên liệu thô</option>
                            <option value="semi_finished">Bán thành phẩm</option>
                            <option value="consumable">Tiêu hao (ly, ống hút...)</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">Tồn tối thiểu (báo hết)</label>
                        <input type="number" min="0" value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })}
                            className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">Đơn vị nhập (VD: chai, kg)</label>
                        <input value={form.purchase_unit} onChange={(e) => setForm({ ...form, purchase_unit: e.target.value })}
                            placeholder="Để trống = nhập theo đơn vị cơ sở"
                            className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">Quy đổi: 1 {form.purchase_unit || 'đơn vị nhập'} = ? {form.unit}</label>
                        <input type="number" min="0" step="any" value={form.conversion_rate} onChange={(e) => setForm({ ...form, conversion_rate: e.target.value })}
                            placeholder="VD: 750" disabled={!form.purchase_unit.trim()}
                            className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd] disabled:bg-gray-50" />
                    </div>
                    <div className="col-span-2 md:col-span-3 flex gap-2">
                        <button onClick={handleSave} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                            {editingId ? 'Cập nhật' : 'Lưu'}
                        </button>
                        <button onClick={resetForm} className="px-4 py-2 text-[13px] text-gray-500">Hủy</button>
                    </div>
                    </div>
                </div>
            )}

            <div className="bg-white rounded shadow-sm overflow-x-auto">
                <table className="w-full text-[13px] min-w-[700px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="px-4 py-3 font-medium">Nguyên liệu</th>
                            <th className="px-3 py-3 font-medium">Loại</th>
                            <th className="px-3 py-3 font-medium text-right">Tồn hiện tại</th>
                            <th className="px-3 py-3 font-medium text-right">Tồn tối thiểu</th>
                            <th className="px-3 py-3 font-medium">Quy đổi nhập</th>
                            <th className="px-3 py-3 font-medium">Trạng thái</th>
                            <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stock.map((s) => (
                            <tr key={s.material_id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                <td className="px-4 py-3 font-medium">{s.name}</td>
                                <td className="px-3 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] border ${TYPE_COLORS[s.type] || TYPE_COLORS.raw}`}>
                                        {TYPE_LABELS[s.type] || s.type}
                                    </span>
                                </td>
                                <td className="px-3 py-3 text-right font-bold">{Number(s.current_stock).toLocaleString('vi-VN')} {s.unit}</td>
                                <td className="px-3 py-3 text-right text-gray-500">{Number(s.minimum_stock).toLocaleString('vi-VN')} {s.unit}</td>
                                <td className="px-3 py-3 text-gray-500 text-xs">
                                    {(materials.find((m) => m.id === s.material_id)?.purchase_unit)
                                        ? `1 ${materials.find((m) => m.id === s.material_id).purchase_unit} = ${Number(materials.find((m) => m.id === s.material_id).conversion_rate).toLocaleString('vi-VN')} ${s.unit}`
                                        : '—'}
                                </td>
                                <td className="px-3 py-3">
                                    {s.is_low_stock
                                        ? <span className="text-red-600 font-medium text-xs">⚠ Sắp hết</span>
                                        : <span className="text-emerald-600 text-xs">Ổn định</span>}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <button onClick={() => startEdit(s.material_id)}
                                        className="text-[#0d6efd] hover:underline text-[13px]">Sửa</button>
                                </td>
                            </tr>
                        ))}
                        {stock.length === 0 && (
                            <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Chưa có nguyên liệu nào.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ================= TAB NHẬP KHO (danh sách nhiều dòng) =================
// Gói 4 (2026-10-04): nhập đơn hàng nhiều món — mỗi nguyên liệu 1 dòng,
// điền số lượng vào các dòng cần nhập rồi bấm 1 nút, gọi API bulk 1 lần.
function InboundTab({ materials, onDone }) {
    const [rows, setRows] = useState({}); // {materialId: {purchase_quantity, unit_cost, expired_at, batch_code}}
    const [search, setSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const setRow = (id, field, value) => {
        setRows((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
    };

    const filtered = materials.filter((m) =>
        m.name.toLowerCase().includes(search.trim().toLowerCase())
    );

    const activeMats = filtered.filter((m) => Number(rows[m.id]?.purchase_quantity) > 0);
    const totalCost = activeMats.reduce(
        (s, m) => s + Number(rows[m.id]?.purchase_quantity || 0) * Number(rows[m.id]?.unit_cost || 0), 0
    );

    const clearRow = (id) => {
        setRows((prev) => { const next = { ...prev }; delete next[id]; return next; });
    };

    const handleSubmit = async () => {
        if (activeMats.length === 0) return alert('Nhập số lượng cho ít nhất 1 nguyên liệu');
        if (!window.confirm(`Nhập kho ${activeMats.length} mặt hàng, tổng tiền hàng ${totalCost.toLocaleString('vi-VN')}đ?`)) return;
        setSubmitting(true);
        try {
            const items = activeMats.map((m) => ({
                material_id: m.id,
                purchase_quantity: Number(rows[m.id].purchase_quantity),
                unit_cost: Number(rows[m.id].unit_cost) || 0,
                expired_at: rows[m.id].expired_at || null,
                batch_code: rows[m.id].batch_code || null,
            }));
            const res = await axios.post(`${API}/inbound/bulk`, { branch_id: BRANCH_ID, items });
            if (res.data?.success) {
                alert(res.data.message);
                setRows({});
                onDone();
            }
        } catch (err) { alert(err.response?.data?.message || 'Nhập kho thất bại'); }
        finally { setSubmitting(false); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <input
                    value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm nguyên liệu..."
                    className="w-64 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]"
                />
                <div className="text-[13px] text-gray-600">
                    {activeMats.length > 0 && (
                        <span className="mr-4">
                            <b className="text-[#0d6efd]">{activeMats.length}</b> dòng có số lượng —
                            tổng <b className="text-[#0d6efd]">{totalCost.toLocaleString('vi-VN')}đ</b>
                        </span>
                    )}
                    <button
                        onClick={handleSubmit} disabled={submitting || activeMats.length === 0}
                        className="px-5 py-2.5 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7] disabled:opacity-40"
                    >
                        {submitting ? 'Đang nhập...' : `Nhập kho${activeMats.length ? ` (${activeMats.length})` : ''}`}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded shadow-sm overflow-x-auto">
                <table className="w-full text-[13px] min-w-[900px]">
                    <thead className="sticky top-0 bg-gray-50">
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="px-4 py-3 font-medium w-[20%]">Nguyên liệu</th>
                            <th className="px-2 py-3 font-medium text-right w-[10%]">Số lượng nhập</th>
                            <th className="px-2 py-3 font-medium text-right w-[11%]">Giá vốn (đ)</th>
                            <th className="px-2 py-3 font-medium text-right w-[12%]">Thành tiền (đ)</th>
                            <th className="px-2 py-3 font-medium text-right w-[12%]">Quy đổi tồn kho</th>
                            <th className="px-2 py-3 font-medium w-[12%]">Hạn dùng</th>
                            <th className="px-2 py-3 font-medium w-[14%]">Mã lô</th>
                            <th className="px-3 py-3 w-[5%]"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((m) => {
                            const r = rows[m.id] || {};
                            const qty = Number(r.purchase_quantity) || 0;
                            const hasQty = qty > 0;
                            const baseQty = qty * Number(m.conversion_rate || 1);
                            return (
                                <tr key={m.id} className={`border-b border-gray-50 ${hasQty ? 'bg-blue-50/50' : 'hover:bg-gray-50/60'}`}>
                                    <td className="px-4 py-2">
                                        <div className="font-medium">{m.name}</div>
                                        <div className="text-[11px] text-gray-400">
                                            Nhập theo {m.purchase_unit || m.unit}
                                            {m.purchase_unit && ` (1 ${m.purchase_unit} = ${Number(m.conversion_rate).toLocaleString('vi-VN')} ${m.unit})`}
                                        </div>
                                    </td>
                                    <td className="px-2 py-2">
                                        <input
                                            type="number" min="0" step="any"
                                            value={r.purchase_quantity ?? ''}
                                            onChange={(e) => setRow(m.id, 'purchase_quantity', e.target.value)}
                                            placeholder="0"
                                            className={`w-full px-2 py-1.5 text-[13px] border rounded text-right focus:outline-none focus:border-[#0d6efd] ${hasQty ? 'border-[#0d6efd] font-bold' : 'border-gray-300'}`}
                                        />
                                    </td>
                                    <td className="px-2 py-2">
                                        <input
                                            type="number" min="0"
                                            value={r.unit_cost ?? ''}
                                            onChange={(e) => setRow(m.id, 'unit_cost', e.target.value)}
                                            placeholder="0"
                                            title="Đơn giá trên 1 đơn vị nhập"
                                            className="w-full px-2 py-1.5 text-[13px] border border-gray-300 rounded text-right focus:outline-none focus:border-[#0d6efd]"
                                        />
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                        {hasQty && Number(r.unit_cost) > 0
                                            ? <span className="font-bold text-[13px]">{(qty * Number(r.unit_cost)).toLocaleString('vi-VN')}</span>
                                            : <span className="text-gray-300 text-xs">—</span>}
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                        {hasQty
                                            ? <span className="text-emerald-600 font-medium text-xs">= {baseQty.toLocaleString('vi-VN')} {m.unit}</span>
                                            : <span className="text-gray-300 text-xs">—</span>}
                                    </td>
                                    <td className="px-2 py-2">
                                        <input
                                            type="date"
                                            value={r.expired_at ?? ''}
                                            onChange={(e) => setRow(m.id, 'expired_at', e.target.value)}
                                            className="w-full px-2 py-1.5 text-[12px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]"
                                        />
                                    </td>
                                    <td className="px-2 py-2">
                                        <input
                                            value={r.batch_code ?? ''}
                                            onChange={(e) => setRow(m.id, 'batch_code', e.target.value)}
                                            placeholder="Tự sinh"
                                            className="w-full px-2 py-1.5 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]"
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {hasQty && (
                                            <button onClick={() => clearRow(m.id)} title="Xóa dòng"
                                                className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {filtered.length === 0 && (
                            <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Không tìm thấy nguyên liệu.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
                Chỉ các dòng có số lượng &gt; 0 mới được nhập. Tất cả dòng được tạo trong 1 lần bấm nút.
            </p>
        </div>
    );
}

// ================= TAB CHẾ BIẾN =================
function ProductionTab({ materials, matById, onDone }) {
    const [recipes, setRecipes] = useState([]);
    const [history, setHistory] = useState([]);
    const [semiId, setSemiId] = useState('');
    const [newLine, setNewLine] = useState({ raw_material_id: '', quantity: '' });
    const [produce, setProduce] = useState({ material_id: '', quantity: '', note: '' });

    const semis = materials.filter((m) => m.type === 'semi_finished');
    const raws = materials.filter((m) => m.type !== 'semi_finished');

    const fetchData = async () => {
        try {
            const [rRes, hRes] = await Promise.all([
                axios.get(`${API}/production-recipes`),
                axios.get(`${API}/productions`, { params: { branch_id: BRANCH_ID } }),
            ]);
            if (rRes.data?.success) setRecipes(rRes.data.data);
            if (hRes.data?.success) setHistory(hRes.data.data);
        } catch (err) { console.error('Lỗi tải chế biến:', err); }
    };
    useEffect(() => { fetchData(); }, []);

    const filteredRecipes = semiId ? recipes.filter((r) => r.material_id === Number(semiId)) : recipes;

    const handleAddRecipe = async () => {
        if (!semiId || !newLine.raw_material_id || !newLine.quantity) return alert('Chọn đủ bán thành phẩm, nguyên liệu và số lượng');
        try {
            const res = await axios.post(`${API}/production-recipes`, {
                material_id: Number(semiId),
                raw_material_id: Number(newLine.raw_material_id),
                quantity: Number(newLine.quantity),
            });
            if (res.data?.success) {
                setNewLine({ raw_material_id: '', quantity: '' });
                fetchData();
            }
        } catch (err) { alert(err.response?.data?.message || 'Lưu định mức thất bại'); }
    };

    const handleDeleteRecipe = async (id) => {
        if (!window.confirm('Xóa định mức này?')) return;
        await axios.delete(`${API}/production-recipes/${id}`);
        fetchData();
    };

    const handleProduce = async () => {
        if (!produce.material_id || !produce.quantity) return alert('Chọn bán thành phẩm và số lượng cần chế biến');
        if (!window.confirm(`Chế biến ${produce.quantity} ${matById(produce.material_id)?.unit} ${matById(produce.material_id)?.name}? Nguyên liệu thô sẽ bị trừ kho.`)) return;
        try {
            const res = await axios.post(`${API}/productions`, {
                branch_id: BRANCH_ID,
                material_id: Number(produce.material_id),
                quantity: Number(produce.quantity),
                note: produce.note || null,
            });
            if (res.data?.success) {
                alert(res.data.message);
                setProduce({ material_id: '', quantity: '', note: '' });
                fetchData(); onDone();
            }
        } catch (err) { alert(err.response?.data?.message || 'Chế biến thất bại'); }
    };

    return (
        <div className="grid md:grid-cols-2 gap-4">
            {/* Định mức */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-[14px] mb-3">Định mức chế biến</h3>
                <label className="text-xs text-gray-500">Bán thành phẩm</label>
                <select value={semiId} onChange={(e) => setSemiId(e.target.value)}
                    className="w-full mt-1 mb-3 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]">
                    <option value="">-- Tất cả --</option>
                    {semis.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                </select>

                {filteredRecipes.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-[13px] border-b border-gray-50 py-2">
                        <span>
                            <b>{r.material?.name}</b>
                            <span className="text-gray-400"> ← </span>
                            {Number(r.quantity).toLocaleString('vi-VN')} {r.rawMaterial?.unit} {r.rawMaterial?.name}
                        </span>
                        <button onClick={() => handleDeleteRecipe(r.id)} className="text-gray-300 hover:text-red-500">×</button>
                    </div>
                ))}
                {filteredRecipes.length === 0 && <p className="text-xs text-gray-400 py-2">Chưa có định mức.</p>}

                {semiId && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="text-xs text-gray-500 mb-2">Thêm nguyên liệu cho 1 {matById(semiId)?.unit} {matById(semiId)?.name}:</div>
                        <div className="flex gap-2">
                            <select value={newLine.raw_material_id} onChange={(e) => setNewLine({ ...newLine, raw_material_id: e.target.value })}
                                className="flex-1 px-2 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]">
                                <option value="">-- Nguyên liệu thô --</option>
                                {raws.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                            </select>
                            <input type="number" min="0" step="any" placeholder="SL" value={newLine.quantity}
                                onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
                                className="w-20 px-2 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                            <button onClick={handleAddRecipe} className="px-3 py-2 bg-[#0d6efd] text-white text-[13px] rounded hover:bg-[#0b5ed7]">+</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Phiếu chế biến */}
            <div>
                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-[14px] mb-3">Tạo phiếu chế biến</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                            <label className="text-xs text-gray-500">Bán thành phẩm *</label>
                            <select value={produce.material_id} onChange={(e) => setProduce({ ...produce, material_id: e.target.value })}
                                className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]">
                                <option value="">-- Chọn --</option>
                                {semis.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500">Số lượng * ({matById(produce.material_id)?.unit || '...'})</label>
                            <input type="number" min="0" step="any" value={produce.quantity}
                                onChange={(e) => setProduce({ ...produce, quantity: e.target.value })}
                                className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500">Ghi chú</label>
                            <input value={produce.note} onChange={(e) => setProduce({ ...produce, note: e.target.value })}
                                className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                        </div>
                    </div>
                    <button onClick={handleProduce} className="mt-3 px-5 py-2.5 bg-violet-600 text-white text-[13px] font-medium rounded hover:bg-violet-700">
                        Chế biến
                    </button>
                    <p className="text-[11px] text-gray-400 mt-2">Trừ nguyên liệu thô theo định mức (FIFO) và nhập lô mới cho bán thành phẩm.</p>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h3 className="font-semibold text-[14px] mb-2">Lịch sử chế biến</h3>
                    {history.map((p) => (
                        <div key={p.id} className="text-[13px] border-b border-gray-50 py-2">
                            <div className="flex justify-between">
                                <span className="font-medium">{p.material?.name} — {Number(p.quantity).toLocaleString('vi-VN')} {p.material?.unit}</span>
                                <span className="text-gray-400 text-xs">{new Date(p.created_at).toLocaleString('vi-VN')}</span>
                            </div>
                            <div className="text-xs text-gray-500">
                                Dùng: {(p.items || []).map((i) => `${Number(i.quantity).toLocaleString('vi-VN')} ${i.material?.unit} ${i.material?.name}`).join(', ')}
                            </div>
                        </div>
                    ))}
                    {history.length === 0 && <p className="text-xs text-gray-400">Chưa có phiếu nào.</p>}
                </div>
            </div>
        </div>
    );
}

// ================= TAB KIỂM KÊ =================
function StocktakeTab({ materials, onDone }) {
    const [list, setList] = useState([]);
    const [detail, setDetail] = useState(null);
    const [counts, setCounts] = useState({});
    const [showCreate, setShowCreate] = useState(false);
    const [createType, setCreateType] = useState('spontaneous');

    const fetchList = async () => {
        try {
            const res = await axios.get(`${API}/stocktakes`, { params: { branch_id: BRANCH_ID } });
            if (res.data?.success) setList(res.data.data);
        } catch (err) { console.error('Lỗi tải kiểm kê:', err); }
    };
    useEffect(() => { fetchList(); }, []);

    const handleCreate = async () => {
        try {
            const res = await axios.post(`${API}/stocktakes`, { branch_id: BRANCH_ID, type: createType });
            if (res.data?.success) {
                setShowCreate(false);
                openDetail(res.data.data.id);
                fetchList();
            }
        } catch (err) { alert(err.response?.data?.message || 'Tạo phiếu thất bại'); }
    };

    const openDetail = async (id) => {
        try {
            const res = await axios.get(`${API}/stocktakes/${id}`);
            if (res.data?.success) {
                setDetail(res.data.data);
                const init = {};
                (res.data.data.items || []).forEach((it) => { init[it.id] = it.counted_qty ?? ''; });
                setCounts(init);
            }
        } catch (err) { alert('Tải phiếu thất bại'); }
    };

    const handleSaveCounts = async () => {
        const items = Object.entries(counts)
            .filter(([, v]) => v !== '' && v !== null)
            .map(([stocktake_item_id, counted_qty]) => ({ stocktake_item_id: Number(stocktake_item_id), counted_qty: Number(counted_qty) }));
        if (items.length === 0) return alert('Nhập ít nhất 1 số liệu');
        try {
            const res = await axios.patch(`${API}/stocktakes/${detail.id}/counts`, { items });
            if (res.data?.success) { alert(res.data.message); openDetail(detail.id); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const handleConfirm = async () => {
        if (!window.confirm('Chốt kiểm kê? Kho sẽ được điều chỉnh theo chênh lệch. Không thể sửa sau khi chốt.')) return;
        try {
            const res = await axios.post(`${API}/stocktakes/${detail.id}/confirm`);
            if (res.data?.success) {
                const adj = res.data.data || [];
                alert(`${res.data.message}\n` + (adj.length
                    ? adj.map((a) => `${a.material}: hệ thống ${a.system} → thực đếm ${a.counted} (${a.diff > 0 ? '+' : ''}${a.diff} ${a.unit})`).join('\n')
                    : 'Không có chênh lệch.'));
                setDetail(null); fetchList(); onDone();
            }
        } catch (err) { alert(err.response?.data?.message || 'Chốt thất bại'); }
    };

    if (detail) {
        const diffCount = (detail.items || []).filter((it) => counts[it.id] !== '' && counts[it.id] != null && Math.abs(Number(counts[it.id]) - Number(it.system_qty)) >= 0.005).length;
        return (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-[14px]">
                        Phiếu kiểm kê #{detail.id} — {STOCKTAKE_TYPES[detail.type]}
                        <span className={`ml-2 px-2 py-0.5 rounded-full text-[11px] ${detail.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                            {detail.status === 'confirmed' ? 'Đã chốt' : 'Đang kiểm'}
                        </span>
                    </h3>
                    <button onClick={() => setDetail(null)} className="text-[13px] text-gray-500 hover:underline">← Danh sách</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[600px]">
                        <thead>
                            <tr className="text-left text-gray-500 border-b border-gray-100">
                                <th className="py-2 font-medium">Nguyên liệu</th>
                                <th className="py-2 font-medium text-right">Tồn hệ thống</th>
                                <th className="py-2 font-medium text-right">Thực đếm *</th>
                                <th className="py-2 font-medium text-right">Chênh lệch</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(detail.items || []).map((it) => {
                                const counted = counts[it.id];
                                const diff = (counted !== '' && counted != null) ? Number(counted) - Number(it.system_qty) : null;
                                return (
                                    <tr key={it.id} className="border-b border-gray-50">
                                        <td className="py-2">{it.material?.name} <span className="text-gray-400 text-xs">({it.material?.unit})</span></td>
                                        <td className="py-2 text-right">{Number(it.system_qty).toLocaleString('vi-VN')}</td>
                                        <td className="py-2 text-right">
                                            <input
                                                type="number" min="0" step="any"
                                                value={counted ?? ''}
                                                disabled={detail.status === 'confirmed'}
                                                onChange={(e) => setCounts({ ...counts, [it.id]: e.target.value })}
                                                className="w-28 px-2 py-1.5 text-[13px] border border-gray-300 rounded text-right focus:outline-none focus:border-[#0d6efd] disabled:bg-gray-50"
                                            />
                                        </td>
                                        <td className={`py-2 text-right font-medium ${diff == null ? 'text-gray-300' : diff === 0 ? 'text-gray-400' : diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {diff == null ? '—' : `${diff > 0 ? '+' : ''}${diff.toLocaleString('vi-VN')}`}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {detail.status !== 'confirmed' && (
                    <div className="flex items-center gap-3 mt-4">
                        <button onClick={handleSaveCounts} className="px-4 py-2 border border-gray-300 text-[13px] rounded text-gray-600 hover:bg-gray-50">
                            Lưu số liệu
                        </button>
                        <button onClick={handleConfirm} className="px-5 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                            Chốt kiểm kê{diffCount > 0 ? ` (${diffCount} chênh lệch)` : ''}
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="flex gap-2 items-center">
                    {!showCreate ? (
                        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                            + Tạo phiếu kiểm kê
                        </button>
                    ) : (
                        <>
                            <select value={createType} onChange={(e) => setCreateType(e.target.value)}
                                className="px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]">
                                {Object.entries(STOCKTAKE_TYPES).map(([k, v]) => <option key={k} value={k}>Kiểm kê {v.toLowerCase()}</option>)}
                            </select>
                            <button onClick={handleCreate} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">Tạo</button>
                            <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-[13px] text-gray-500">Hủy</button>
                        </>
                    )}
                </div>
            </div>
            <div className="bg-white rounded shadow-sm overflow-x-auto">
                <table className="w-full text-[13px] min-w-[600px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="px-4 py-3 font-medium">#</th>
                            <th className="px-3 py-3 font-medium">Loại</th>
                            <th className="px-3 py-3 font-medium">Ngày tạo</th>
                            <th className="px-3 py-3 font-medium">Người kiểm</th>
                            <th className="px-3 py-3 font-medium">Trạng thái</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.map((s) => (
                            <tr key={s.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                <td className="px-4 py-3 font-medium">#{s.id}</td>
                                <td className="px-3 py-3">Kiểm kê {STOCKTAKE_TYPES[s.type]?.toLowerCase()}</td>
                                <td className="px-3 py-3 text-gray-500">{new Date(s.created_at).toLocaleString('vi-VN')}</td>
                                <td className="px-3 py-3">{s.user?.name || '—'}</td>
                                <td className="px-3 py-3">
                                    {s.status === 'confirmed'
                                        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">Đã chốt</span>
                                        : <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">Đang kiểm</span>}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <button onClick={() => openDetail(s.id)} className="text-[#0d6efd] hover:underline text-[13px]">
                                        {s.status === 'confirmed' ? 'Xem' : 'Tiếp tục kiểm'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {list.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Chưa có phiếu kiểm kê nào.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
