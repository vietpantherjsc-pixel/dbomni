import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useBranch } from '../../contexts/BranchContext';

const API = 'http://localhost/api';

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
    // Gói 14: nút "+ Nguyên liệu" ở header trang kích hoạt form thêm mới trong tab Tồn kho
    const [addMaterialSignal, setAddMaterialSignal] = useState(0);
    // Gói 18: chi nhánh dùng chung từ BranchContext ('0' = tất cả)
    const { branchId } = useBranch();
    const [branches, setBranches] = useState([]);
    // Tồn kho/nhập/chế biến cần 1 chi nhánh cụ thể: '0' -> lấy CN đầu tiên
    const effBranchId = branchId === '0' ? (branches[0]?.id || 1) : Number(branchId);

    const fetchAll = async (bid) => {
        try {
            const [mRes, sRes, bRes] = await Promise.all([
                axios.get(`${API}/materials`),
                axios.get(`${API}/inventory/branch/${bid}`),
                axios.get(`${API}/branches`),
            ]);
            if (mRes.data?.success) setMaterials(mRes.data.data);
            if (sRes.data?.success) setStock(sRes.data.data);
            if (bRes.data?.success) setBranches(bRes.data.data || []);
        } catch (err) { console.error('Lỗi tải kho:', err); }
    };

    useEffect(() => { fetchAll(effBranchId); }, [effBranchId]);

    const matById = (id) => materials.find((m) => m.id === Number(id));

    return (
        <AdminLayout>
            <div className="p-5">
                {/* Tiêu đề + nút thêm (chuẩn trang Hóa đơn) */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-semibold text-gray-800">Kho hàng</h1>
                        <p className="text-[13px] text-[#6b7280] mt-0.5">Quản lý tồn kho, nhập hàng, chế biến bán thành phẩm và kiểm kê.</p>
                    </div>
                    {tab === 'stock' && (
                        <button onClick={() => setAddMaterialSignal((s) => s + 1)}
                            className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7] whitespace-nowrap ml-4">
                            + Nguyên liệu
                        </button>
                    )}
                </div>

                <div className="mt-3 bg-white rounded shadow-sm">
                    {/* Tabs */}
                    <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-4">
                        {[
                            ['stock', 'Tồn kho'],
                            ['inbound', 'Nhập kho'],
                            ['production', 'Chế biến'],
                            ['stocktake', 'Kiểm kê'],
                        ].map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => setTab(key)}
                                className={`px-3 py-3 text-[13px] whitespace-nowrap border-b-2 -mb-px transition-colors ${
                                    tab === key ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="p-4">
                        {tab === 'stock' && <StockTab stock={stock} materials={materials} onChange={() => fetchAll(effBranchId)} addSignal={addMaterialSignal} />}
                        {tab === 'inbound' && <InboundTab materials={materials} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} />}
                        {tab === 'production' && <ProductionTab materials={materials} matById={matById} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} />}
                        {tab === 'stocktake' && <StocktakeTab materials={materials} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} showAll={branchId === '0'} />}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}

// ================= TAB TỒN KHO =================
function StockTab({ stock, materials, onChange, addSignal }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null); // null = thêm mới
    const [form, setForm] = useState({ name: '', unit: 'g', type: 'raw', minimum_stock: 0, purchase_unit: '', conversion_rate: '' });

    const resetForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm({ name: '', unit: 'g', type: 'raw', minimum_stock: 0, purchase_unit: '', conversion_rate: '' });
    };

    // Gói 14: nút "+ Nguyên liệu" ở header trang kích hoạt mở form thêm mới
    useEffect(() => {
        if (addSignal > 0) { resetForm(); setShowForm(true); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addSignal]);

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
            {/* Gói 14: cảnh báo tồn thấp gọn 1 dòng trong card, chỉ hiện khi có */}
            {lowCount > 0 && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-[13px] text-red-700">
                    ⚠ <b>{lowCount}</b> nguyên liệu sắp hết (dưới tồn tối thiểu)
                </div>
            )}

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

            <div className="border border-gray-100 rounded overflow-x-auto">
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
function InboundTab({ materials, onDone, branchId }) {
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
            const res = await axios.post(`${API}/inbound/bulk`, { branch_id: branchId, items });
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

            <div className="border border-gray-100 rounded overflow-x-auto">
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
function ProductionTab({ materials, matById, onDone, branchId }) {
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
                axios.get(`${API}/productions`, { params: { branch_id: branchId } }),
            ]);
            if (rRes.data?.success) setRecipes(rRes.data.data);
            if (hRes.data?.success) setHistory(hRes.data.data);
        } catch (err) { console.error('Lỗi tải chế biến:', err); }
    };
    useEffect(() => { fetchData(); }, [branchId]);

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
                branch_id: branchId,
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

// ================= TAB KIỂM KÊ (Gói 19) =================
// Theo demo v4 đã chốt: kiểm theo 3 nhóm (nguyên liệu thô / bán thành phẩm / bao bì),
// nhập tồn thực tế → chênh lệch realtime, chốt phiếu → biên bản + 3 ảnh PNG theo nhóm,
// lịch sử kiểm kho lưu trong admin (bảng stocktakes + stocktake_items).
const ST_GROUPS = [
    { id: 'raw', name: 'Nguyên liệu thô', slug: 'nguyen-lieu-tho' },
    { id: 'semi', name: 'Bán thành phẩm', slug: 'ban-thanh-pham' },
    { id: 'pack', name: 'Bao bì', slug: 'bao-bi' },
];
const stGiOfType = (t) => (t === 'semi_finished' ? 1 : t === 'consumable' ? 2 : 0);

const stFmtDateVN = (iso) => {
    if (!iso) return '—';
    const d = String(iso).length > 10 ? String(iso).slice(0, 10) : String(iso);
    const parts = d.split('-');
    if (parts.length !== 3) return d;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
};
const stFmtQty = (n) => {
    const v = Math.round(Number(n) * 100) / 100;
    return v.toLocaleString('vi-VN');
};
const stWrapText = (ctx, text, maxW) => {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    words.forEach((w) => {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
        else line = t;
    });
    if (line) lines.push(line);
    return lines;
};

// Vẽ biên bản PNG cho 1 nhóm (port từ demo v4 đã chốt)
const drawStocktakePNG = (sess, gi) => {
    const g = ST_GROUPS[gi];
    const rows = sess.rows.filter((r) => r.gi === gi);
    const W = 1000, pad = 44;
    const dtStr = stFmtDateVN(sess.date) + ' — ' + sess.time;
    let m = 0, s = 0, sh = 0;
    rows.forEach((r) => { if (r.d === 0) m++; else if (r.d > 0) s++; else sh++; });

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const headerH = 196, infoH = 110, colH = 44, rowH = 46;
    const tableW = W - pad * 2;
    const cols = [46, 420, 120, 120, 206];
    const H = headerH + infoH + colH + rows.length * rowH + 210;
    cv.width = W; cv.height = H;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    // Header navy + tên nhóm
    ctx.fillStyle = '#24305E'; ctx.fillRect(0, 0, W, headerH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff'; ctx.font = '600 22px Inter, Arial, sans-serif';
    ctx.fillText('DAYBREAK TEA & COFFEE', W / 2, 40);
    ctx.fillStyle = '#F5A623'; ctx.font = '700 30px Inter, Arial, sans-serif';
    ctx.fillText('KIỂM KHO — ' + g.name.toUpperCase(), W / 2, 88);
    ctx.strokeStyle = '#F5A623'; ctx.lineWidth = 2;
    ctx.strokeRect(W / 2 - 260, 108, 520, 64);
    ctx.fillStyle = '#F5A623'; ctx.font = '400 15px Inter, Arial, sans-serif';
    ctx.fillText('NGÀY — GIỜ KIỂM', W / 2, 132);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 26px Inter, Arial, sans-serif';
    ctx.fillText(dtStr, W / 2, 160);

    // Thông tin nhóm
    let y = headerH + 36;
    ctx.textAlign = 'left'; ctx.fillStyle = '#1f2430'; ctx.font = '400 20px Inter, Arial, sans-serif';
    ctx.fillText('Người kiểm: ' + sess.checker, pad, y); y += 34;
    ctx.fillText('Số dòng: ' + rows.length + '   ·   Khớp: ' + m + '   ·   Thừa: ' + s + '   ·   Thiếu: ' + sh, pad, y);
    y += 24;

    // Header bảng
    ctx.fillStyle = '#24305E'; ctx.fillRect(pad, y, tableW, colH);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 17px Inter, Arial, sans-serif';
    const heads = ['STT', 'Mặt hàng', 'Tồn LT', 'Tồn TT', 'Chênh lệch'];
    let cx = pad;
    heads.forEach((h, i) => { ctx.fillText(h, cx + 10, y + 29); cx += cols[i]; });
    y += colH;

    rows.forEach((r, idx) => {
        const stt = idx + 1;
        if (stt % 2 === 0) { ctx.fillStyle = '#fafbfc'; ctx.fillRect(pad, y, tableW, rowH); }
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad, y + rowH); ctx.lineTo(pad + tableW, y + rowH); ctx.stroke();
        ctx.fillStyle = '#1f2430'; ctx.font = '400 17px Inter, Arial, sans-serif';
        let bx = pad;
        ctx.fillText(String(stt), bx + 10, y + 30); bx += cols[0];
        const lines = stWrapText(ctx, r.name + ' (' + r.unit + ')', cols[1] - 16);
        ctx.font = '700 16px Inter, Arial, sans-serif';
        lines.slice(0, 2).forEach((ln, li) => ctx.fillText(ln, bx + 10, y + 22 + li * 20));
        ctx.font = '400 17px Inter, Arial, sans-serif';
        bx += cols[1];
        ctx.fillText(stFmtQty(r.system), bx + 10, y + 30); bx += cols[2];
        ctx.fillText(stFmtQty(r.counted), bx + 10, y + 30); bx += cols[3];
        ctx.fillStyle = r.d === 0 ? '#6b7280' : (r.d > 0 ? '#16a34a' : '#dc2626');
        ctx.font = '700 17px Inter, Arial, sans-serif';
        ctx.fillText(r.d === 0 ? '0' : (r.d > 0 ? '+' : '') + stFmtQty(r.d) + ' ' + r.unit, bx + 10, y + 30);
        ctx.font = '400 17px Inter, Arial, sans-serif';
        y += rowH;
    });

    // Chữ ký
    y += 30;
    ctx.fillStyle = '#1f2430'; ctx.font = '400 18px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Người kiểm', W * 0.25, y);
    ctx.fillText('Quản lý', W * 0.75, y);
    ctx.strokeStyle = '#6b7280'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W * 0.25 - 140, y + 10); ctx.lineTo(W * 0.25 + 140, y + 70); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.75 - 140, y + 10); ctx.lineTo(W * 0.75 + 140, y + 70); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '400 15px Inter, Arial, sans-serif'; ctx.fillStyle = '#6b7280';
    ctx.fillText('(Ký, ghi rõ họ tên)', W * 0.25, y + 96);
    ctx.fillText('(Ký, ghi rõ họ tên)', W * 0.75, y + 96);
    y += 120;
    ctx.font = '400 14px Inter, Arial, sans-serif';
    ctx.fillText('Ảnh biên bản nhóm "' + g.name + '" — dùng để lưu hồ sơ / in.', W / 2, y);

    const a = document.createElement('a');
    a.download = 'kiem-kho-' + g.slug + '-' + sess.date + '-' + String(sess.time).replace(':', '') + '.png';
    a.href = cv.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
};

function StocktakeTab({ materials, onDone }) {
    const [list, setList] = useState([]);
    const [detail, setDetail] = useState(null);
    const [counts, setCounts] = useState({});
    const [activeGroup, setActiveGroup] = useState(0);
    const [checkDate, setCheckDate] = useState('');
    const [checkTime, setCheckTime] = useState('');
    const [checkerName, setCheckerName] = useState('');
    const [receipt, setReceipt] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [createType, setCreateType] = useState('spontaneous');

    const nowParts = () => {
        const n = new Date();
        const p = (x) => String(x).padStart(2, '0');
        return {
            d: n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()),
            t: p(n.getHours()) + ':' + p(n.getMinutes()),
        };
    };

    const fetchList = async () => {
        try {
            const res = await axios.get(API + '/stocktakes', { params: { branch_id: BRANCH_ID } });
            if (res.data?.success) setList(res.data.data || []);
        } catch (err) { console.error('Lỗi tải kiểm kê:', err); }
    };
    useEffect(() => { fetchList(); }, []);

    const handleCreate = async () => {
        try {
            const res = await axios.post(API + '/stocktakes', { branch_id: BRANCH_ID, type: createType });
            if (res.data?.success) {
                setShowCreate(false);
                openDetail(res.data.data.id);
                fetchList();
            }
        } catch (err) { alert(err.response?.data?.message || 'Tạo phiếu thất bại'); }
    };

    const openDetail = async (id) => {
        try {
            const res = await axios.get(API + '/stocktakes/' + id);
            if (res.data?.success) {
                const d = res.data.data;
                setDetail(d);
                setReceipt(null);
                const init = {};
                (d.items || []).forEach((it) => { init[it.id] = it.counted_qty ?? ''; });
                setCounts(init);
                // Ngày-giờ kiểm: lấy từ phiếu đã chốt, phiếu nháp thì mặc định hiện tại
                if (d.checked_at) {
                    const dt = new Date(d.checked_at);
                    const p = (x) => String(x).padStart(2, '0');
                    setCheckDate(dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()));
                    setCheckTime(p(dt.getHours()) + ':' + p(dt.getMinutes()));
                } else {
                    const np = nowParts();
                    setCheckDate(np.d); setCheckTime(np.t);
                }
                setCheckerName(d.user?.name || '');
                setActiveGroup(0);
            }
        } catch (err) { alert('Tải phiếu thất bại'); }
    };

    const openReceipt = async (id) => {
        try {
            const res = await axios.get(API + '/stocktakes/' + id);
            if (res.data?.success) {
                const d = res.data.data;
                const dt = d.checked_at ? new Date(d.checked_at) : new Date(d.created_at);
                const p = (x) => String(x).padStart(2, '0');
                const sess = {
                    id: d.id,
                    date: dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()),
                    time: p(dt.getHours()) + ':' + p(dt.getMinutes()),
                    checker: d.user?.name || '—',
                    rows: (d.items || []).map((it) => {
                        const counted = it.counted_qty == null ? 0 : Number(it.counted_qty);
                        const system = Number(it.system_qty);
                        return {
                            gi: stGiOfType(it.material?.type),
                            name: it.material?.name || '—',
                            unit: it.material?.unit || '',
                            system, counted,
                            d: Math.round((counted - system) * 100) / 100,
                        };
                    }),
                };
                setDetail(null);
                setReceipt(sess);
            }
        } catch (err) { alert('Tải biên bản thất bại'); }
    };

    const handleSaveCounts = async () => {
        const items = Object.entries(counts)
            .filter(([, v]) => v !== '' && v !== null)
            .map(([stocktake_item_id, counted_qty]) => ({ stocktake_item_id: Number(stocktake_item_id), counted_qty: Number(counted_qty) }));
        if (items.length === 0) return alert('Nhập ít nhất 1 số liệu');
        try {
            const res = await axios.patch(API + '/stocktakes/' + detail.id + '/counts', { items });
            if (res.data?.success) { alert(res.data.message); openDetail(detail.id); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const handleConfirm = async () => {
        if (!window.confirm('Hoàn thành kiểm kho? Chênh lệch sẽ được lưu vào lịch sử (không tự động điều chỉnh tồn kho). Không thể sửa sau khi chốt.')) return;
        try {
            const res = await axios.post(API + '/stocktakes/' + detail.id + '/confirm', {
                checked_at: checkDate && checkTime ? checkDate + ' ' + checkTime + ':00' : undefined,
            });
            if (res.data?.success) {
                const { stocktake, rows } = res.data.data;
                const sess = {
                    id: stocktake.id,
                    date: checkDate, time: checkTime,
                    checker: checkerName || stocktake.user?.name || '—',
                    rows: (rows || []).map((r) => ({
                        gi: stGiOfType(r.type),
                        name: r.name, unit: r.unit,
                        system: r.system_qty, counted: r.counted_qty,
                        d: Math.round(Number(r.diff) * 100) / 100,
                    })),
                };
                setDetail(null);
                setReceipt(sess);
                fetchList();
                onDone();
            }
        } catch (err) { alert(err.response?.data?.message || 'Chốt thất bại'); }
    };

    // ---------- MÀN BIÊN BẢN ----------
    if (receipt) {
        const total = receipt.rows.length;
        const diffN = receipt.rows.filter((r) => r.d !== 0).length;
        return (
            <div>
                <button onClick={() => { setReceipt(null); fetchList(); }} className="text-[13px] text-gray-500 hover:underline mb-3">← Về danh sách kiểm kho</button>
                <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6 max-w-3xl">
                    <div className="text-center mb-4">
                        <div className="text-[12px] tracking-widest text-gray-400">DAYBREAK TEA & COFFEE</div>
                        <h3 className="text-lg font-bold text-[#24305E]">BIÊN BẢN KIỂM KHO #{receipt.id}</h3>
                        <div className="inline-block mt-2 px-4 py-1.5 border-2 border-dashed border-[#F5A623] rounded-lg">
                            <span className="text-[12px] text-gray-500">Ngày — giờ kiểm: </span>
                            <b className="text-[#24305E]">{stFmtDateVN(receipt.date)} — {receipt.time}</b>
                        </div>
                        <div className="text-[13px] text-gray-600 mt-2">Người kiểm: <b>{receipt.checker}</b> · {total} dòng · <span className={diffN ? 'text-red-600 font-medium' : 'text-emerald-600'}>{diffN} dòng lệch</span></div>
                    </div>
                    {ST_GROUPS.map((g, gi) => {
                        const rows = receipt.rows.filter((r) => r.gi === gi);
                        if (rows.length === 0) return null;
                        return (
                            <div key={g.id} className="mb-5">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-semibold text-[14px] text-[#24305E]">▸ {g.name} ({rows.length})</h4>
                                    <button onClick={() => drawStocktakePNG(receipt, gi)}
                                        className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#24305E] rounded hover:bg-[#1a2347]">
                                        ⬇ Tải ảnh: {g.name}
                                    </button>
                                </div>
                                <div className="overflow-x-auto border border-gray-100 rounded">
                                    <table className="w-full text-[13px] min-w-[520px]">
                                        <thead>
                                            <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                                                <th className="px-3 py-2 font-medium">Mặt hàng</th>
                                                <th className="px-3 py-2 font-medium text-right">Tồn LT</th>
                                                <th className="px-3 py-2 font-medium text-right">Tồn TT</th>
                                                <th className="px-3 py-2 font-medium text-right">Chênh lệch</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((r, i) => (
                                                <tr key={i} className="border-b border-gray-50">
                                                    <td className="px-3 py-2"><b>{r.name}</b> <span className="text-gray-400 text-xs">({r.unit})</span></td>
                                                    <td className="px-3 py-2 text-right">{stFmtQty(r.system)}</td>
                                                    <td className="px-3 py-2 text-right">{stFmtQty(r.counted)}</td>
                                                    <td className={'px-3 py-2 text-right font-medium ' + (r.d === 0 ? 'text-gray-400' : r.d > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                                        {r.d === 0 ? '0' : (r.d > 0 ? '+' : '') + stFmtQty(r.d)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })}
                    <div className="grid grid-cols-2 gap-4 mt-6 text-center text-[13px] text-gray-500">
                        <div><div className="font-medium text-gray-700">Người kiểm</div><div className="mt-10 border-t border-dashed border-gray-300 pt-1">(Ký, ghi rõ họ tên)</div></div>
                        <div><div className="font-medium text-gray-700">Quản lý</div><div className="mt-10 border-t border-dashed border-gray-300 pt-1">(Ký, ghi rõ họ tên)</div></div>
                    </div>
                </div>
            </div>
        );
    }

    // ---------- MÀN NHẬP KIỂM (phiếu nháp đang mở) ----------
    if (detail) {
        const items = detail.items || [];
        const total = items.length;
        const doneCount = items.filter((it) => counts[it.id] !== '' && counts[it.id] != null).length;
        const groupItems = (gi) => items.filter((it) => stGiOfType(it.material?.type) === gi);
        const diffOf = (it) => {
            const v = counts[it.id];
            if (v === '' || v == null || isNaN(v)) return null;
            return Math.round((Number(v) - Number(it.system_qty)) * 100) / 100;
        };
        return (
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-[14px]">
                        Phiếu kiểm kê #{detail.id} — Kiểm kê {STOCKTAKE_TYPES[detail.type]?.toLowerCase()}
                        <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">Đang kiểm</span>
                    </h3>
                    <button onClick={() => setDetail(null)} className="text-[13px] text-gray-500 hover:underline">← Danh sách</button>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="text-[13px] text-gray-600">Ngày kiểm
                        <input type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)}
                            className="mt-1 w-full px-3 py-2.5 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-[#0d6efd]" />
                    </label>
                    <label className="text-[13px] text-gray-600">Giờ kiểm
                        <input type="time" value={checkTime} onChange={(e) => setCheckTime(e.target.value)}
                            className="mt-1 w-full px-3 py-2.5 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-[#0d6efd]" />
                    </label>
                    <label className="text-[13px] text-gray-600">Người kiểm
                        <input type="text" value={checkerName} onChange={(e) => setCheckerName(e.target.value)} placeholder="Tên nhân viên kiểm"
                            className="mt-1 w-full px-3 py-2.5 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-[#0d6efd]" />
                    </label>
                </div>

                <div className="flex items-center justify-between mb-2 text-[13px]">
                    <span className="text-gray-600">Tiến độ: <b className="text-[#24305E]">{doneCount}/{total}</b></span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full mb-3 overflow-hidden">
                    <div className="h-full bg-[#F5A623] rounded-full transition-all" style={{ width: (total ? doneCount / total * 100 : 0) + '%' }} />
                </div>

                <div className="flex gap-2 mb-3 overflow-x-auto">
                    {ST_GROUPS.map((g, gi) => {
                        const c = groupItems(gi).length;
                        const dc = groupItems(gi).filter((it) => counts[it.id] !== '' && counts[it.id] != null).length;
                        return (
                            <button key={g.id} onClick={() => setActiveGroup(gi)}
                                className={'flex-shrink-0 px-4 py-2.5 text-[13px] rounded-lg border transition-colors ' + (activeGroup === gi
                                    ? 'bg-[#24305E] text-white border-[#24305E] font-medium'
                                    : 'bg-white text-gray-600 border-gray-200')}>
                                {g.name} <span className="opacity-70">({dc}/{c})</span>
                            </button>
                        );
                    })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {groupItems(activeGroup).map((it) => {
                        const d = diffOf(it);
                        return (
                            <div key={it.id} className="bg-white border border-gray-200 rounded-lg p-3">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div>
                                        <div className="font-medium text-[14px]">{it.material?.name}</div>
                                        <div className="text-[12px] text-gray-400">Đơn vị: {it.material?.unit}</div>
                                    </div>
                                    {d == null
                                        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500">Chưa kiểm</span>
                                        : d === 0
                                            ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500">Khớp</span>
                                            : d > 0
                                                ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">Thừa {stFmtQty(d)}</span>
                                                : <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-50 text-red-600 border border-red-200">Thiếu {stFmtQty(Math.abs(d))}</span>}
                                </div>
                                <div className="grid grid-cols-3 gap-2 items-end">
                                    <div className="text-[13px] text-gray-600">Tồn LT<b className="block text-gray-900 text-[14px]">{stFmtQty(it.system_qty)}</b></div>
                                    <div className={'text-[13px] ' + (d == null ? 'text-gray-400' : d === 0 ? 'text-gray-500' : d > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                        Chênh lệch<b className="block text-[14px]">{d == null ? '—' : (d > 0 ? '+' : '') + stFmtQty(d)}</b>
                                    </div>
                                    <label className="text-[12px] text-gray-500 col-span-1">Tồn thực tế
                                        <input type="number" min="0" step="any" inputMode="decimal"
                                            value={counts[it.id] ?? ''}
                                            onChange={(e) => setCounts({ ...counts, [it.id]: e.target.value })}
                                            placeholder="Nhập SL"
                                            className="mt-1 w-full px-3 py-3 text-[16px] border border-gray-300 rounded-lg text-right focus:outline-none focus:border-[#0d6efd]" />
                                    </label>
                                </div>
                            </div>
                        );
                    })}
                    {groupItems(activeGroup).length === 0 && (
                        <div className="text-[13px] text-gray-400 py-8 text-center md:col-span-2">Nhóm này chưa có nguyên liệu.</div>
                    )}
                </div>

                <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-100 mt-4 -mx-1 px-1 py-3 flex items-center gap-3">
                    <button onClick={handleSaveCounts} className="px-4 py-3 border border-gray-300 text-[14px] rounded-lg text-gray-600 hover:bg-gray-50">
                        Lưu số liệu
                    </button>
                    <button onClick={handleConfirm} disabled={doneCount !== total}
                        className="flex-1 px-5 py-3 bg-[#0d6efd] text-white text-[14px] font-medium rounded-lg hover:bg-[#0b5ed7] disabled:bg-gray-300 disabled:cursor-not-allowed">
                        Hoàn thành kiểm kho{doneCount !== total ? ' (' + doneCount + '/' + total + ')' : ''}
                    </button>
                </div>
                <div className="text-[12px] text-gray-400 mt-1">Nhập đủ tồn thực tế tất cả nguyên liệu để hoàn thành. Chênh lệch chỉ lưu lịch sử, không tự trừ/cộng kho.</div>
            </div>
        );
    }

    // ---------- MÀN DANH SÁCH + LỊCH SỬ ----------
    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="flex gap-2 items-center">
                    {!showCreate ? (
                        <button onClick={() => setShowCreate(true)} className="px-4 py-2.5 bg-[#0d6efd] text-white text-[14px] font-medium rounded-lg hover:bg-[#0b5ed7]">
                            + Tạo phiếu kiểm kê
                        </button>
                    ) : (
                        <>
                            <select value={createType} onChange={(e) => setCreateType(e.target.value)}
                                className="px-3 py-2.5 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-[#0d6efd]">
                                {Object.entries(STOCKTAKE_TYPES).map(([k, v]) => <option key={k} value={k}>Kiểm kê {v.toLowerCase()}</option>)}
                            </select>
                            <button onClick={handleCreate} className="px-4 py-2.5 bg-[#0d6efd] text-white text-[14px] font-medium rounded-lg hover:bg-[#0b5ed7]">Tạo</button>
                            <button onClick={() => setShowCreate(false)} className="px-3 py-2.5 text-[14px] text-gray-500">Hủy</button>
                        </>
                    )}
                </div>
            </div>
            <h3 className="font-semibold text-[14px] mb-2">Lịch sử kiểm kho</h3>
            <div className="border border-gray-100 rounded-lg overflow-x-auto">
                <table className="w-full text-[13px] min-w-[640px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                            <th className="px-4 py-3 font-medium">Phiếu</th>
                            <th className="px-3 py-3 font-medium">Ngày — giờ kiểm</th>
                            <th className="px-3 py-3 font-medium">Người kiểm</th>
                            <th className="px-3 py-3 font-medium text-right">Dòng kiểm</th>
                            <th className="px-3 py-3 font-medium">Chênh lệch</th>
                            <th className="px-3 py-3 font-medium">Trạng thái</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.map((s) => (
                            <tr key={s.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                <td className="px-4 py-3 font-medium">#{s.id}</td>
                                <td className="px-3 py-3">{s.checked_at ? stFmtDateVN(s.checked_at) + ' — ' + new Date(s.checked_at).toTimeString().slice(0, 5) : <span className="text-gray-400">chưa chốt</span>}</td>
                                <td className="px-3 py-3">{s.user?.name || '—'}</td>
                                <td className="px-3 py-3 text-right">{s.total_items ?? '—'}</td>
                                <td className="px-3 py-3">
                                    {(s.diff_items ?? 0) === 0
                                        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">Khớp hết</span>
                                        : <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-50 text-red-600 border border-red-200">{s.diff_items} dòng lệch</span>}
                                </td>
                                <td className="px-3 py-3">
                                    {s.status === 'confirmed'
                                        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">Đã chốt</span>
                                        : <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">Đang kiểm</span>}
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                    {s.status === 'confirmed'
                                        ? <button onClick={() => openReceipt(s.id)} className="text-[#0d6efd] hover:underline text-[13px]">Xem</button>
                                        : <button onClick={() => openDetail(s.id)} className="text-[#0d6efd] hover:underline text-[13px]">Tiếp tục kiểm</button>}
                                </td>
                            </tr>
                        ))}
                        {list.length === 0 && (
                            <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Chưa có phiếu kiểm kê nào.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
