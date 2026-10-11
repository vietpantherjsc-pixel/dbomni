import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useBranch } from '../../contexts/BranchContext';
import { fmtDate, fmtTime, fmtDateTime } from '../../utils/format';
import DateInput from '../../components/DateInput';
import TimeInput from '../../components/TimeInput';

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
    const [categories, setCategories] = useState([]); // Gói 22: loại danh mục NL
    // Gói 14: nút "+ Nguyên liệu" ở header trang kích hoạt form thêm mới trong tab Tồn kho
    const [addMaterialSignal, setAddMaterialSignal] = useState(0);
    // Gói 18: chi nhánh dùng chung từ BranchContext ('0' = tất cả)
    const { branchId } = useBranch();
    const [branches, setBranches] = useState([]);
    // Tồn kho/nhập/chế biến cần 1 chi nhánh cụ thể: '0' -> lấy CN đầu tiên
    const effBranchId = branchId === '0' ? (branches[0]?.id || 1) : Number(branchId);

    const fetchAll = async (bid) => {
        try {
            const [mRes, sRes, bRes, cRes] = await Promise.all([
                axios.get(`${API}/materials`),
                axios.get(`${API}/inventory/branch/${bid}`),
                axios.get(`${API}/branches`),
                axios.get(`${API}/material-categories`),
            ]);
            if (mRes.data?.success) setMaterials(mRes.data.data);
            if (sRes.data?.success) setStock(sRes.data.data);
            if (bRes.data?.success) setBranches(bRes.data.data || []);
            if (cRes.data?.success) setCategories(cRes.data.data || []);
        } catch (err) { console.error('Lỗi tải kho:', err); }
    };

    useEffect(() => { fetchAll(effBranchId); }, [effBranchId]);

    const matById = (id) => materials.find((m) => m.id === Number(id));

    // Gói 22: tải lại loại NL + nguyên liệu (sau CRUD loại)
    const fetchCats = async () => {
        try {
            const [cRes, mRes] = await Promise.all([
                axios.get(`${API}/material-categories`),
                axios.get(`${API}/materials`),
            ]);
            if (cRes.data?.success) setCategories(cRes.data.data || []);
            if (mRes.data?.success) setMaterials(mRes.data.data);
        } catch (err) { console.error('Lỗi tải loại NL:', err); }
    };

    return (
        <AdminLayout>
            <div className="p-4 sm:p-5">
                {/* Tiêu đề + nút thêm (chuẩn trang Hóa đơn) */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold text-gray-800">Kho hàng</h1>
                        <p className="text-[13px] text-[#6b7280] mt-0.5">Quản lý tồn kho, nhập hàng, chế biến bán thành phẩm và kiểm kê.</p>
                    </div>
                    {tab === 'stock' && (
                        <button onClick={() => setAddMaterialSignal((s) => s + 1)}
                            className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7] whitespace-nowrap self-start sm:self-auto shrink-0">
                            + Nguyên liệu
                        </button>
                    )}
                </div>

                <div className="mt-3 bg-white rounded shadow-sm">
                    {/* Tabs */}
                    <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-100 px-4">
                        {[
                            ['stock', 'Tồn kho'],
                            ['cats', 'Loại NL'],
                            ['inbound', 'Nhập kho'],
                            ['transfer', 'Chuyển kho'],
                            ['production', 'Chế biến'],
                            ['stocktake', 'Kiểm kê'],
                        ].map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => setTab(key)}
                                className={`px-3 py-3 text-[13px] whitespace-nowrap shrink-0 border-b-2 -mb-px transition-colors ${
                                    tab === key ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="p-4">
                        {tab === 'stock' && <StockTab stock={stock} materials={materials} categories={categories} onChange={() => fetchAll(effBranchId)} addSignal={addMaterialSignal} />}
                        {tab === 'cats' && <CategoryTab categories={categories} onChange={fetchCats} />}
                        {tab === 'inbound' && <InboundTab materials={materials} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} branches={branches} />}
                        {tab === 'transfer' && <TransferTab materials={materials} branches={branches} branchId={effBranchId} onDone={() => fetchAll(effBranchId)} />}
                        {tab === 'production' && <ProductionTab materials={materials} matById={matById} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} />}
                        {tab === 'stocktake' && <StocktakeTab materials={materials} categories={categories} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} showAll={branchId === '0'} />}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}

// ================= TAB TỒN KHO =================
function StockTab({ stock, materials, categories, onChange, addSignal }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null); // null = thêm mới
    const [form, setForm] = useState({ name: '', unit: 'g', type: 'raw', material_category_id: '', minimum_stock: 0, purchase_unit: '', conversion_rate: '' });

    const resetForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm({ name: '', unit: 'g', type: 'raw', material_category_id: '', minimum_stock: 0, purchase_unit: '', conversion_rate: '' });
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
            material_category_id: m.material_category_id ?? '',
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
                material_category_id: form.material_category_id === '' ? null : Number(form.material_category_id),
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

    // Gói 46: xóa nguyên liệu/BTP khi tồn=0 (xóa mềm, giữ lịch sử); chặn khi còn trong BOM
    const delMaterial = async (s) => {
        if (!window.confirm(`Xóa "${s.name}"?\nLịch sử nhập/xuất trước đó vẫn được giữ lại.`)) return;
        try {
            const res = await axios.delete(`${API}/materials/${s.material_id}`);
            alert(res.data?.message || 'Đã xóa.');
            onChange();
        } catch (err) { alert(err.response?.data?.message || 'Xóa thất bại'); }
    };

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
                        <label className="text-xs text-gray-500">Loại nguyên liệu (nhóm kiểm kho)</label>
                        <select value={form.material_category_id} onChange={(e) => setForm({ ...form, material_category_id: e.target.value })}
                            className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]">
                            <option value="">— Chưa phân loại —</option>
                            {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                                    {(() => {
                                        const m = materials.find((x) => x.id === s.material_id);
                                        const cn = m?.category?.name;
                                        if (cn) return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-50 text-blue-700 border-blue-200">{cn}</span>;
                                        return <span className={`px-2 py-0.5 rounded-full text-[11px] border ${TYPE_COLORS[s.type] || TYPE_COLORS.raw}`}>{TYPE_LABELS[s.type] || s.type}</span>;
                                    })()}
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
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <button onClick={() => startEdit(s.material_id)}
                                        className="text-[#0d6efd] hover:underline text-[13px] mr-3">Sửa</button>
                                    <button onClick={() => delMaterial(s)}
                                        className="text-red-600 hover:underline text-[13px]">Xóa</button>
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

// ================= TAB NHẬP KHO (Gói 43: phiếu nhập theo hóa đơn) =================
const todayLocal = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const vnd = (n) => Number(n || 0).toLocaleString('vi-VN');

function InboundTab({ materials, onDone, branchId, branches }) {
    const [receipts, setReceipts] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [detail, setDetail] = useState(null); // receipt chi tiết
    const [editing, setEditing] = useState(false);

    const fetchReceipts = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API}/inbound-receipts`, { params: { branch_id: branchId, per_page: 50 } });
            setReceipts(res.data?.data?.data || res.data?.data || []);
        } catch { /* bỏ qua */ }
        setLoading(false);
    };
    useEffect(() => {
        fetchReceipts();
        axios.get(`${API}/partners`, { params: { type: 'supplier', is_active: 1 } })
            .then((r) => setSuppliers(r.data?.data || []))
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    const openDetail = async (id) => {
        try {
            const res = await axios.get(`${API}/inbound-receipts/${id}`);
            setDetail(res.data?.data);
            setEditing(false);
        } catch (e) { alert(e.response?.data?.message || 'Không tải được phiếu'); }
    };
    const cancelReceipt = async (id) => {
        if (!window.confirm('Hủy phiếu nhập này? Chỉ hủy được khi nguyên liệu chưa xuất dùng.')) return;
        try {
            await axios.post(`${API}/inbound-receipts/${id}/cancel`);
            setDetail(null);
            fetchReceipts();
            onDone();
        } catch (e) { alert(e.response?.data?.message || 'Không hủy được'); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] text-gray-500">Phiếu nhập hàng theo hóa đơn nhà cung cấp</div>
                <button onClick={() => setShowForm(true)}
                    className="px-5 py-2.5 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                    ＋ Tạo phiếu nhập
                </button>
            </div>
            {loading ? <div className="text-gray-400 text-[13px] py-8 text-center">Đang tải...</div> : (
                <div className="border border-gray-100 rounded overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[860px]">
                        <thead className="bg-gray-50">
                            <tr className="text-left text-gray-500 border-b border-gray-100">
                                <th className="px-4 py-3 font-medium">Mã phiếu</th>
                                <th className="px-2 py-3 font-medium">Ngày</th>
                                <th className="px-2 py-3 font-medium">Nhà cung cấp</th>
                                <th className="px-2 py-3 font-medium text-right">Tổng tiền</th>
                                <th className="px-2 py-3 font-medium">Thanh toán</th>
                                <th className="px-2 py-3 font-medium">Trạng thái</th>
                                <th className="px-3 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {receipts.map((r) => (
                                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                                    <td className="px-4 py-2.5 font-semibold text-[#0d6efd]">{r.code}</td>
                                    <td className="px-2 py-2.5">{fmtDate(r.receipt_date)}{r.invoice_no && <div className="text-[11px] text-gray-400">HĐ: {r.invoice_no}</div>}</td>
                                    <td className="px-2 py-2.5">{r.partner?.name || <span className="text-gray-400">Mua lẻ</span>}</td>
                                    <td className="px-2 py-2.5 text-right font-bold">{vnd(r.grand_total)}đ</td>
                                    <td className="px-2 py-2.5">
                                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${r.payment_type === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {r.payment_type === 'paid' ? 'Trả ngay' : 'Công nợ'}
                                        </span>
                                    </td>
                                    <td className="px-2 py-2.5">
                                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {r.status === 'confirmed' ? 'Đã nhập' : 'Đã hủy'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                        <button onClick={() => openDetail(r.id)} className="text-[#0d6efd] text-[12px] font-medium mr-3">Xem</button>
                                        {r.status === 'confirmed' && (
                                            <button onClick={() => cancelReceipt(r.id)} className="text-red-500 text-[12px]">Hủy</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {receipts.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Chưa có phiếu nhập nào.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            {showForm && (
                <ReceiptForm
                    materials={materials} suppliers={suppliers} branchId={branchId}
                    onClose={() => setShowForm(false)}
                    onDone={() => { setShowForm(false); fetchReceipts(); onDone(); }}
                />
            )}
            {detail && (
                <ReceiptDetail
                    receipt={detail} suppliers={suppliers} editing={editing} setEditing={setEditing}
                    onClose={() => setDetail(null)}
                    onDone={() => { setDetail(null); fetchReceipts(); onDone(); }}
                />
            )}
        </div>
    );
}

// Form tạo phiếu nhập
function ReceiptForm({ materials, suppliers, branchId, onClose, onDone }) {
    const [partnerId, setPartnerId] = useState('');
    const [invoiceNo, setInvoiceNo] = useState('');
    const [receiptDate, setReceiptDate] = useState(todayLocal());
    const [paymentType, setPaymentType] = useState('paid');
    const [taxIncluded, setTaxIncluded] = useState(true);
    const [taxRate, setTaxRate] = useState(10);
    const [discount, setDiscount] = useState('');
    const [shipping, setShipping] = useState('');
    const [note, setNote] = useState('');
    const [lines, setLines] = useState([]); // [{material_id, purchase_quantity, unit_cost, expired_at}]
    const [matSearch, setMatSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const addLine = (m) => {
        if (lines.some((l) => l.material_id === m.id)) return;
        setLines([...lines, { material_id: m.id, name: m.name, unit: m.unit, purchase_unit: m.purchase_unit || m.unit, conversion_rate: m.conversion_rate || 1, purchase_quantity: '', unit_cost: '', expired_at: '' }]);
        setMatSearch('');
    };
    const setLine = (mid, field, value) => {
        setLines(lines.map((l) => l.material_id === mid ? { ...l, [field]: value } : l));
    };
    const removeLine = (mid) => setLines(lines.filter((l) => l.material_id !== mid));

    const subtotal = lines.reduce((s, l) => s + Number(l.purchase_quantity || 0) * Number(l.unit_cost || 0), 0);
    const rate = Number(taxRate) || 0;
    const vat = taxIncluded ? (rate > 0 ? subtotal * rate / (100 + rate) : 0) : (rate > 0 ? subtotal * rate / 100 : 0);
    const grand = subtotal - Number(discount || 0) + Number(shipping || 0) + (taxIncluded ? 0 : vat);

    const matFiltered = matSearch.trim()
        ? materials.filter((m) => m.name.toLowerCase().includes(matSearch.trim().toLowerCase())).slice(0, 8)
        : [];

    const submit = async () => {
        const items = lines.filter((l) => Number(l.purchase_quantity) > 0);
        if (!items.length) return alert('Thêm ít nhất 1 nguyên liệu có số lượng');
        if (paymentType === 'debt' && !partnerId) return alert('Công nợ phải chọn nhà cung cấp');
        if (!window.confirm(`Tạo phiếu nhập ${items.length} dòng, tổng ${vnd(grand)}đ (${paymentType === 'paid' ? 'trả ngay' : 'công nợ'})?`)) return;
        setSubmitting(true);
        try {
            const res = await axios.post(`${API}/inbound-receipts`, {
                branch_id: branchId,
                partner_id: partnerId || null,
                invoice_no: invoiceNo || null,
                receipt_date: receiptDate,
                tax_included: taxIncluded,
                tax_rate: rate,
                discount_amount: Number(discount) || 0,
                shipping_fee: Number(shipping) || 0,
                payment_type: paymentType,
                note: note || null,
                items: items.map((l) => ({
                    material_id: l.material_id,
                    purchase_quantity: Number(l.purchase_quantity),
                    unit_cost: Number(l.unit_cost) || 0,
                    expired_at: l.expired_at || null,
                })),
            });
            if (res.data?.success) { alert(res.data.message); onDone(); }
        } catch (e) { alert(e.response?.data?.message || 'Tạo phiếu thất bại'); }
        setSubmitting(false);
    };

    const inp = 'border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:border-[#0d6efd]';
    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[640px] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 pb-3 shrink-0">
                    <h2 className="font-bold text-[16px]">Tạo phiếu nhập hàng</h2>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Nhà cung cấp</div>
                            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className={inp + ' w-full'}>
                                <option value="">— Mua lẻ —</option>
                                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Số hóa đơn</div>
                            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="VD: 0001234" className={inp + ' w-full'} />
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Ngày chứng từ</div>
                            <DateInput value={receiptDate} onChange={setReceiptDate} className={inp + ' w-full'} />
                        </label>
                        <div>
                            <div className="text-[12px] text-gray-500 mb-1">Thanh toán</div>
                            <div className="flex gap-2">
                                {[['paid', 'Trả ngay'], ['debt', 'Công nợ']].map(([v, l]) => (
                                    <button key={v} onClick={() => setPaymentType(v)}
                                        className={`flex-1 py-2 rounded text-[13px] font-medium border ${paymentType === v ? 'bg-[#0d6efd] text-white border-[#0d6efd]' : 'border-gray-300 text-gray-600'}`}>{l}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="text-[12px] text-gray-500 mb-1">Nguyên liệu</div>
                        <input value={matSearch} onChange={(e) => setMatSearch(e.target.value)} placeholder="Gõ tên để thêm dòng..." className={inp + ' w-full'} />
                        {matFiltered.length > 0 && (
                            <div className="border border-gray-200 rounded mt-1 max-h-[140px] overflow-y-auto">
                                {matFiltered.map((m) => (
                                    <button key={m.id} onClick={() => addLine(m)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50">
                                        {m.name} <span className="text-gray-400 text-[11px]">({m.purchase_unit || m.unit})</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {lines.map((l) => (
                        <div key={l.material_id} className="border border-gray-200 rounded p-3">
                            <div className="flex items-center justify-between mb-2">
                                <b className="text-[13px]">{l.name}</b>
                                <button onClick={() => removeLine(l.material_id)} className="text-red-400 text-lg leading-none">×</button>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <label className="block">
                                    <div className="text-[11px] text-gray-400">SL ({l.purchase_unit})</div>
                                    <input type="number" min="0" step="any" value={l.purchase_quantity} onChange={(e) => setLine(l.material_id, 'purchase_quantity', e.target.value)} className={inp + ' w-full text-right'} />
                                </label>
                                <label className="block">
                                    <div className="text-[11px] text-gray-400">Đơn giá (đ)</div>
                                    <input type="number" min="0" value={l.unit_cost} onChange={(e) => setLine(l.material_id, 'unit_cost', e.target.value)} className={inp + ' w-full text-right'} />
                                </label>
                                <label className="block">
                                    <div className="text-[11px] text-gray-400">Hạn dùng</div>
                                    <DateInput value={l.expired_at} onChange={(v) => setLine(l.material_id, 'expired_at', v)} className={inp + ' w-full'} />
                                </label>
                            </div>
                            {Number(l.purchase_quantity) > 0 && (
                                <div className="text-[12px] text-gray-500 mt-1 text-right">
                                    = <b>{vnd(Number(l.purchase_quantity) * Number(l.unit_cost || 0))}đ</b>
                                    {l.conversion_rate !== 1 && <span className="text-emerald-600"> → {(Number(l.purchase_quantity) * Number(l.conversion_rate)).toLocaleString('vi-VN')} {l.unit}</span>}
                                </div>
                            )}
                        </div>
                    ))}
                    <div className="grid grid-cols-2 gap-3">
                        <label className="flex items-center gap-2 text-[13px]">
                            <input type="checkbox" checked={taxIncluded} onChange={(e) => setTaxIncluded(e.target.checked)} className="w-4 h-4" />
                            Giá đã gồm VAT
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Thuế suất (%)</div>
                            <div className="flex gap-1">
                                {[0, 8, 10].map((r) => (
                                    <button key={r} onClick={() => setTaxRate(r)} className={`px-3 py-1.5 rounded text-[12px] border ${rate === r ? 'bg-[#0d6efd] text-white border-[#0d6efd]' : 'border-gray-300'}`}>{r}%</button>
                                ))}
                                <input type="number" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={inp + ' w-16 text-right'} />
                            </div>
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Chiết khấu (đ)</div>
                            <input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inp + ' w-full text-right'} />
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Phí vận chuyển (đ)</div>
                            <input type="number" min="0" value={shipping} onChange={(e) => setShipping(e.target.value)} className={inp + ' w-full text-right'} />
                        </label>
                    </div>
                    <label className="block">
                        <div className="text-[12px] text-gray-500 mb-1">Ghi chú</div>
                        <input value={note} onChange={(e) => setNote(e.target.value)} className={inp + ' w-full'} />
                    </label>
                    <div className="bg-gray-50 rounded p-3 text-[13px] space-y-1">
                        <div className="flex justify-between"><span>Tiền hàng</span><b>{vnd(subtotal)}đ</b></div>
                        {rate > 0 && <div className="flex justify-between text-gray-500"><span>Trong đó VAT {rate}%</span><span>{vnd(vat)}đ</span></div>}
                        {Number(discount) > 0 && <div className="flex justify-between text-gray-500"><span>Chiết khấu</span><span>−{vnd(discount)}đ</span></div>}
                        {Number(shipping) > 0 && <div className="flex justify-between text-gray-500"><span>Phí vận chuyển</span><span>+{vnd(shipping)}đ</span></div>}
                        <div className="flex justify-between text-[15px] pt-1 border-t"><span className="font-bold">Tổng thanh toán</span><b className="text-[#0d6efd]">{vnd(grand)}đ</b></div>
                    </div>
                </div>
                <div className="p-4 pt-3 border-t border-gray-100 shrink-0 bg-white">
                    <div className="flex gap-2">
                        <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                        <button onClick={submit} disabled={submitting} className="flex-1 h-11 rounded-xl bg-[#0d6efd] text-white text-[14px] font-semibold disabled:opacity-40">
                            {submitting ? 'Đang tạo...' : 'Tạo phiếu nhập'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Xem / sửa phiếu nhập
function ReceiptDetail({ receipt, suppliers, editing, setEditing, onClose, onDone }) {
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (editing && receipt) {
            setForm({
                partner_id: receipt.partner_id || '',
                invoice_no: receipt.invoice_no || '',
                receipt_date: (receipt.receipt_date || '').slice(0, 10),
                tax_included: !!receipt.tax_included,
                tax_rate: receipt.tax_rate || 0,
                discount_amount: receipt.discount_amount || '',
                shipping_fee: receipt.shipping_fee || '',
                note: receipt.note || '',
                items: receipt.items.map((it) => ({
                    id: it.id, name: it.material?.name, purchase_quantity: it.purchase_quantity,
                    unit_cost: it.unit_cost, expired_at: (it.expired_at || '').slice(0, 10),
                    touched: it.batch && Number(it.batch.current_quantity) !== Number(it.batch.initial_quantity),
                })),
            });
        }
    }, [editing, receipt]);
    const setF = (k, v) => setForm({ ...form, [k]: v });
    const setItem = (id, field, value) => setForm({ ...form, items: form.items.map((l) => l.id === id ? { ...l, [field]: value } : l) });

    const save = async () => {
        setSaving(true);
        try {
            const res = await axios.patch(`${API}/inbound-receipts/${receipt.id}`, {
                partner_id: form.partner_id || null,
                invoice_no: form.invoice_no || null,
                receipt_date: form.receipt_date,
                tax_included: form.tax_included,
                tax_rate: Number(form.tax_rate) || 0,
                discount_amount: Number(form.discount_amount) || 0,
                shipping_fee: Number(form.shipping_fee) || 0,
                note: form.note || null,
                items: form.items.map((l) => ({
                    id: l.id, purchase_quantity: Number(l.purchase_quantity), unit_cost: Number(l.unit_cost) || 0,
                    expired_at: l.expired_at || null,
                })),
            });
            if (res.data?.success) { alert(res.data.message); onDone(); }
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
        setSaving(false);
    };

    const inp = 'border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:border-[#0d6efd]';
    const r = receipt;
    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[640px] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 pb-3 shrink-0 flex items-center justify-between">
                    <h2 className="font-bold text-[16px]">Phiếu {r.code}</h2>
                    {r.status === 'confirmed' && !editing && (
                        <button onClick={() => setEditing(true)} className="text-[#0d6efd] text-[13px] font-medium">✎ Sửa</button>
                    )}
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-4">
                    {!editing ? (
                        <div className="space-y-2 text-[13px]">
                            <div className="grid grid-cols-2 gap-2">
                                <div><span className="text-gray-400">NCC: </span><b>{r.partner?.name || 'Mua lẻ'}</b></div>
                                <div><span className="text-gray-400">Ngày: </span><b>{fmtDate(r.receipt_date)}</b></div>
                                <div><span className="text-gray-400">Số HĐ: </span><b>{r.invoice_no || '—'}</b></div>
                                <div><span className="text-gray-400">Thanh toán: </span><b>{r.payment_type === 'paid' ? 'Trả ngay' : 'Công nợ'}</b></div>
                            </div>
                            {r.note && <div><span className="text-gray-400">Ghi chú: </span>{r.note}</div>}
                            <div className="border-t pt-2 mt-2">
                                {r.items.map((it) => (
                                    <div key={it.id} className="flex justify-between py-1.5 border-b border-gray-50">
                                        <div>
                                            <div className="font-medium">{it.material?.name}</div>
                                            <div className="text-[11px] text-gray-400">{Number(it.purchase_quantity)} {it.purchase_unit} × {vnd(it.unit_cost)}đ</div>
                                        </div>
                                        <b>{vnd(it.line_total)}đ</b>
                                    </div>
                                ))}
                            </div>
                            <div className="bg-gray-50 rounded p-3 space-y-1">
                                <div className="flex justify-between"><span>Tiền hàng</span><span>{vnd(r.subtotal)}đ</span></div>
                                {Number(r.vat_amount) > 0 && <div className="flex justify-between text-gray-500"><span>VAT</span><span>{vnd(r.vat_amount)}đ</span></div>}
                                {Number(r.discount_amount) > 0 && <div className="flex justify-between text-gray-500"><span>Chiết khấu</span><span>−{vnd(r.discount_amount)}đ</span></div>}
                                {Number(r.shipping_fee) > 0 && <div className="flex justify-between text-gray-500"><span>Phí VC</span><span>+{vnd(r.shipping_fee)}đ</span></div>}
                                <div className="flex justify-between text-[15px] pt-1 border-t"><b>Tổng</b><b className="text-[#0d6efd]">{vnd(r.grand_total)}đ</b></div>
                            </div>
                        </div>
                    ) : form && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block">
                                    <div className="text-[12px] text-gray-500 mb-1">Nhà cung cấp</div>
                                    <select value={form.partner_id} onChange={(e) => setF('partner_id', e.target.value)} className={inp + ' w-full'}>
                                        <option value="">— Mua lẻ —</option>
                                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </label>
                                <label className="block">
                                    <div className="text-[12px] text-gray-500 mb-1">Số hóa đơn</div>
                                    <input value={form.invoice_no} onChange={(e) => setF('invoice_no', e.target.value)} className={inp + ' w-full'} />
                                </label>
                                <label className="block">
                                    <div className="text-[12px] text-gray-500 mb-1">Ngày chứng từ</div>
                                    <DateInput value={form.receipt_date} onChange={(v) => setF('receipt_date', v)} className={inp + ' w-full'} />
                                </label>
                                <label className="block">
                                    <div className="text-[12px] text-gray-500 mb-1">Thuế suất (%)</div>
                                    <input type="number" min="0" max="100" value={form.tax_rate} onChange={(e) => setF('tax_rate', e.target.value)} className={inp + ' w-full'} />
                                </label>
                                <label className="block">
                                    <div className="text-[12px] text-gray-500 mb-1">Chiết khấu (đ)</div>
                                    <input type="number" min="0" value={form.discount_amount} onChange={(e) => setF('discount_amount', e.target.value)} className={inp + ' w-full text-right'} />
                                </label>
                                <label className="block">
                                    <div className="text-[12px] text-gray-500 mb-1">Phí vận chuyển (đ)</div>
                                    <input type="number" min="0" value={form.shipping_fee} onChange={(e) => setF('shipping_fee', e.target.value)} className={inp + ' w-full text-right'} />
                                </label>
                            </div>
                            <label className="flex items-center gap-2 text-[13px]">
                                <input type="checkbox" checked={form.tax_included} onChange={(e) => setF('tax_included', e.target.checked)} className="w-4 h-4" />
                                Giá đã gồm VAT
                            </label>
                            {form.items.map((l) => (
                                <div key={l.id} className="border border-gray-200 rounded p-3">
                                    <div className="font-medium text-[13px] mb-2">{l.name}
                                        {l.touched && <span className="ml-2 text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">đã xuất dùng — không sửa SL</span>}
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <label className="block">
                                            <div className="text-[11px] text-gray-400">Số lượng</div>
                                            <input type="number" min="0" step="any" value={l.purchase_quantity} disabled={l.touched}
                                                onChange={(e) => setItem(l.id, 'purchase_quantity', e.target.value)} className={inp + ' w-full text-right disabled:bg-gray-100'} />
                                        </label>
                                        <label className="block">
                                            <div className="text-[11px] text-gray-400">Đơn giá</div>
                                            <input type="number" min="0" value={l.unit_cost} onChange={(e) => setItem(l.id, 'unit_cost', e.target.value)} className={inp + ' w-full text-right'} />
                                        </label>
                                        <label className="block">
                                            <div className="text-[11px] text-gray-400">Hạn dùng</div>
                                            <DateInput value={l.expired_at} onChange={(v) => setItem(l.id, 'expired_at', v)} className={inp + ' w-full'} />
                                        </label>
                                    </div>
                                </div>
                            ))}
                            <label className="block">
                                <div className="text-[12px] text-gray-500 mb-1">Ghi chú</div>
                                <input value={form.note} onChange={(e) => setF('note', e.target.value)} className={inp + ' w-full'} />
                            </label>
                        </div>
                    )}
                </div>
                <div className="p-4 pt-3 border-t border-gray-100 shrink-0 bg-white">
                    <div className="flex gap-2">
                        <button onClick={() => editing ? setEditing(false) : onClose()} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">
                            {editing ? 'Quay lại' : 'Đóng'}
                        </button>
                        {editing && (
                            <button onClick={save} disabled={saving} className="flex-1 h-11 rounded-xl bg-[#0d6efd] text-white text-[14px] font-semibold disabled:opacity-40">
                                {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ================= TAB CHUYỂN KHO (Gói 43) =================
function TransferTab({ materials, branches, branchId, onDone }) {
    const [transfers, setTransfers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);

    const fetchTransfers = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API}/stock-transfers`, { params: { per_page: 50 } });
            setTransfers(res.data?.data?.data || res.data?.data || []);
        } catch { /* bỏ qua */ }
        setLoading(false);
    };
    useEffect(() => { fetchTransfers(); }, []);

    const doConfirm = async (id) => {
        if (!window.confirm('Chốt chuyển kho? Tồn kho 2 chi nhánh sẽ thay đổi ngay.')) return;
        try {
            const res = await axios.post(`${API}/stock-transfers/${id}/confirm`);
            alert(res.data?.message + (res.data?.data?.total_cost ? ` (Giá vốn: ${vnd(res.data.data.total_cost)}đ)` : ''));
            fetchTransfers();
            onDone();
        } catch (e) { alert(e.response?.data?.message || 'Chốt thất bại'); }
    };
    const doCancel = async (id) => {
        if (!window.confirm('Hủy phiếu chuyển kho này?')) return;
        try {
            await axios.post(`${API}/stock-transfers/${id}/cancel`);
            fetchTransfers();
        } catch (e) { alert(e.response?.data?.message || 'Hủy thất bại'); }
    };

    const stLabel = { draft: ['Nháp', 'bg-gray-100 text-gray-600'], confirmed: ['Đã chuyển', 'bg-green-100 text-green-700'], cancelled: ['Đã hủy', 'bg-red-50 text-red-400'] };

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] text-gray-500">Điều chuyển nguyên liệu giữa các chi nhánh (kèm giá vốn)</div>
                <button onClick={() => setShowForm(true)}
                    className="px-5 py-2.5 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                    ＋ Tạo phiếu chuyển
                </button>
            </div>
            {loading ? <div className="text-gray-400 text-[13px] py-8 text-center">Đang tải...</div> : (
                <div className="border border-gray-100 rounded overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[820px]">
                        <thead className="bg-gray-50">
                            <tr className="text-left text-gray-500 border-b border-gray-100">
                                <th className="px-4 py-3 font-medium">Mã phiếu</th>
                                <th className="px-2 py-3 font-medium">Từ kho</th>
                                <th className="px-2 py-3 font-medium">Đến kho</th>
                                <th className="px-2 py-3 font-medium">Mặt hàng</th>
                                <th className="px-2 py-3 font-medium text-right">Giá vốn</th>
                                <th className="px-2 py-3 font-medium">Trạng thái</th>
                                <th className="px-3 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {transfers.map((t) => (
                                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                                    <td className="px-4 py-2.5 font-semibold text-[#0d6efd]">{t.code}</td>
                                    <td className="px-2 py-2.5">{t.from_branch?.name}</td>
                                    <td className="px-2 py-2.5">{t.to_branch?.name}</td>
                                    <td className="px-2 py-2.5 text-[12px] text-gray-600">
                                        {(t.items || []).map((it) => `${it.material?.name} (${Number(it.quantity)})`).join(', ')}
                                    </td>
                                    <td className="px-2 py-2.5 text-right font-bold">{vnd(t.total_cost)}đ</td>
                                    <td className="px-2 py-2.5">
                                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${stLabel[t.status]?.[1] || ''}`}>{stLabel[t.status]?.[0] || t.status}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                        {t.status === 'draft' && (
                                            <>
                                                <button onClick={() => doConfirm(t.id)} className="text-green-600 text-[12px] font-medium mr-3">✓ Chốt</button>
                                                <button onClick={() => doCancel(t.id)} className="text-red-500 text-[12px]">Hủy</button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {transfers.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Chưa có phiếu chuyển kho nào.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            {showForm && (
                <TransferForm materials={materials} branches={branches} defaultFrom={branchId}
                    onClose={() => setShowForm(false)}
                    onDone={() => { setShowForm(false); fetchTransfers(); onDone(); }}
                />
            )}
        </div>
    );
}

function TransferForm({ materials, branches, defaultFrom, onClose, onDone }) {
    const [fromId, setFromId] = useState(String(defaultFrom || ''));
    const [toId, setToId] = useState('');
    const [note, setNote] = useState('');
    const [lines, setLines] = useState([]);
    const [matSearch, setMatSearch] = useState('');
    const [stocks, setStocks] = useState({}); // {materialId: {quantity, unit}}
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        setStocks({});
        setLines([]);
    }, [fromId]);

    const addLine = async (m) => {
        if (lines.some((l) => l.material_id === m.id)) return;
        setLines([...lines, { material_id: m.id, name: m.name, unit: m.unit, quantity: '' }]);
        setMatSearch('');
        try {
            const res = await axios.get(`${API}/stock-transfer-stock`, { params: { branch_id: fromId, material_id: m.id } });
            setStocks((prev) => ({ ...prev, [m.id]: res.data?.data }));
        } catch { /* bỏ qua */ }
    };
    const setLine = (mid, v) => setLines(lines.map((l) => l.material_id === mid ? { ...l, quantity: v } : l));
    const removeLine = (mid) => setLines(lines.filter((l) => l.material_id !== mid));

    const matFiltered = matSearch.trim()
        ? materials.filter((m) => m.name.toLowerCase().includes(matSearch.trim().toLowerCase())).slice(0, 8)
        : [];

    const submit = async () => {
        const items = lines.filter((l) => Number(l.quantity) > 0);
        if (!fromId || !toId) return alert('Chọn kho nguồn và kho đích');
        if (fromId === toId) return alert('Kho nguồn và kho đích phải khác nhau');
        if (!items.length) return alert('Thêm ít nhất 1 nguyên liệu có số lượng');
        const fromName = branches.find((b) => String(b.id) === String(fromId))?.name;
        const toName = branches.find((b) => String(b.id) === String(toId))?.name;
        if (!window.confirm(`Tạo phiếu chuyển ${items.length} dòng từ ${fromName} → ${toName}? (Chốt sau mới trừ/cộng kho)`)) return;
        setSubmitting(true);
        try {
            const res = await axios.post(`${API}/stock-transfers`, {
                from_branch_id: Number(fromId), to_branch_id: Number(toId), note: note || null,
                items: items.map((l) => ({ material_id: l.material_id, quantity: Number(l.quantity) })),
            });
            if (res.data?.success) { alert(res.data.message + ' Bấm "Chốt" để thực hiện chuyển kho.'); onDone(); }
        } catch (e) { alert(e.response?.data?.message || 'Tạo phiếu thất bại'); }
        setSubmitting(false);
    };

    const inp = 'border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:border-[#0d6efd]';
    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[560px] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 pb-3 shrink-0">
                    <h2 className="font-bold text-[16px]">Tạo phiếu chuyển kho</h2>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Kho nguồn</div>
                            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={inp + ' w-full'}>
                                <option value="">— Chọn —</option>
                                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Kho đích</div>
                            <select value={toId} onChange={(e) => setToId(e.target.value)} className={inp + ' w-full'}>
                                <option value="">— Chọn —</option>
                                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </label>
                    </div>
                    <div>
                        <div className="text-[12px] text-gray-500 mb-1">Nguyên liệu {!fromId && <span className="text-red-400">(chọn kho nguồn trước)</span>}</div>
                        <input value={matSearch} disabled={!fromId} onChange={(e) => setMatSearch(e.target.value)} placeholder="Gõ tên để thêm dòng..." className={inp + ' w-full disabled:bg-gray-100'} />
                        {matFiltered.length > 0 && (
                            <div className="border border-gray-200 rounded mt-1 max-h-[140px] overflow-y-auto">
                                {matFiltered.map((m) => (
                                    <button key={m.id} onClick={() => addLine(m)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50">
                                        {m.name} <span className="text-gray-400 text-[11px]">({m.unit})</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {lines.map((l) => (
                        <div key={l.material_id} className="border border-gray-200 rounded p-3">
                            <div className="flex items-center justify-between mb-2">
                                <b className="text-[13px]">{l.name}</b>
                                <button onClick={() => removeLine(l.material_id)} className="text-red-400 text-lg leading-none">×</button>
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(l.material_id, e.target.value)}
                                    placeholder="Số lượng" className={inp + ' flex-1 text-right'} />
                                <span className="text-[12px] text-gray-500">{l.unit}</span>
                            </div>
                            <div className="text-[11px] text-gray-400 mt-1">
                                Tồn khả dụng tại nguồn: {stocks[l.material_id] ? <b className="text-gray-600">{vnd(stocks[l.material_id].quantity)} {stocks[l.material_id].unit}</b> : '...'}
                            </div>
                        </div>
                    ))}
                    <label className="block">
                        <div className="text-[12px] text-gray-500 mb-1">Ghi chú</div>
                        <input value={note} onChange={(e) => setNote(e.target.value)} className={inp + ' w-full'} />
                    </label>
                </div>
                <div className="p-4 pt-3 border-t border-gray-100 shrink-0 bg-white">
                    <div className="flex gap-2">
                        <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                        <button onClick={submit} disabled={submitting} className="flex-1 h-11 rounded-xl bg-[#0d6efd] text-white text-[14px] font-semibold disabled:opacity-40">
                            {submitting ? 'Đang tạo...' : 'Tạo phiếu'}
                        </button>
                    </div>
                </div>
            </div>
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
                                <span className="text-gray-400 text-xs">{fmtDateTime(p.created_at)}</span>
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

// ================= TAB LOẠI NGUYÊN LIỆU (Gói 22) =================
// Quản lý loại danh mục nguyên liệu — nhóm kiểm kho động (thay 3 nhóm cứng).
function CategoryTab({ categories, onChange }) {
    const [name, setName] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');

    const sorted = (categories || []).slice().sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || (a.id - b.id));

    const saveNew = async () => {
        if (!name.trim()) return alert('Nhập tên loại nguyên liệu');
        try {
            const res = await axios.post(`${API}/material-categories`, { name: name.trim() });
            if (res.data?.success) { setName(''); onChange(); }
        } catch (err) { alert(err.response?.data?.message || 'Thêm thất bại'); }
    };

    const startEdit = (c) => { setEditingId(c.id); setEditName(c.name); };
    const cancelEdit = () => { setEditingId(null); setEditName(''); };

    const saveEdit = async (id) => {
        if (!editName.trim()) return alert('Nhập tên loại nguyên liệu');
        try {
            const res = await axios.patch(`${API}/material-categories/${id}`, { name: editName.trim() });
            if (res.data?.success) { cancelEdit(); onChange(); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const del = async (c) => {
        if (!window.confirm(`Xóa loại "${c.name}"?`)) return;
        try {
            const res = await axios.delete(`${API}/material-categories/${c.id}`);
            if (res.data?.success) onChange();
            else alert(res.data?.message || 'Xóa thất bại');
        } catch (err) { alert(err.response?.data?.message || 'Xóa thất bại'); }
    };

    // Đổi thứ tự bằng nút lên/xuống
    const move = async (idx, dir) => {
        const j = idx + dir;
        if (j < 0 || j >= sorted.length) return;
        const ids = sorted.map((c) => c.id);
        const tmp = ids[idx]; ids[idx] = ids[j]; ids[j] = tmp;
        try {
            const res = await axios.post(`${API}/material-categories/reorder`, { ids });
            if (res.data?.success) onChange();
        } catch (err) { alert('Sắp xếp thất bại'); }
    };

    return (
        <div>
            <p className="text-[13px] text-gray-500 mb-3">
                Loại nguyên liệu dùng để nhóm khi kiểm kho — số ảnh PNG xuất ra bằng số loại có dòng kiểm.
            </p>
            <div className="flex gap-2 mb-4 max-w-md">
                <input value={name} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveNew()}
                    placeholder="Tên loại mới (VD: Gia vị)"
                    className="flex-1 px-3 py-2.5 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-[#0d6efd]" />
                <button onClick={saveNew}
                    className="px-4 py-2.5 bg-[#0d6efd] text-white text-[14px] font-medium rounded-lg hover:bg-[#0b5ed7] whitespace-nowrap">
                    + Thêm loại
                </button>
            </div>
            <div className="border border-gray-100 rounded-lg overflow-x-auto">
                <table className="w-full text-[13px] min-w-[480px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                            <th className="px-4 py-3 font-medium" style={{ width: 90 }}>Thứ tự</th>
                            <th className="px-3 py-3 font-medium">Tên loại</th>
                            <th className="px-3 py-3 font-medium text-right">Số nguyên liệu</th>
                            <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((c, i) => (
                            <tr key={c.id} className="border-b border-gray-50">
                                <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                                <td className="px-3 py-3">
                                    {editingId === c.id ? (
                                        <input value={editName} onChange={(e) => setEditName(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(c.id); if (e.key === 'Escape') cancelEdit(); }}
                                            autoFocus
                                            className="px-2 py-1.5 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                                    ) : (
                                        <b>{c.name}</b>
                                    )}
                                </td>
                                <td className="px-3 py-3 text-right text-gray-500">{c.materials_count ?? 0}</td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                    {editingId === c.id ? (
                                        <>
                                            <button onClick={() => saveEdit(c.id)} className="text-xs font-bold text-green-700 mr-2">Lưu</button>
                                            <button onClick={cancelEdit} className="text-xs text-gray-500 mr-2">Hủy</button>
                                        </>
                                    ) : (
                                        <button onClick={() => startEdit(c)} className="text-xs font-semibold mr-2 text-[#0d6efd] hover:underline">Sửa</button>
                                    )}
                                    <button onClick={() => move(i, -1)} disabled={i === 0} title="Lên"
                                        className="text-xs font-bold mr-1 px-1.5 py-0.5 border rounded disabled:opacity-30">↑</button>
                                    <button onClick={() => move(i, 1)} disabled={i === sorted.length - 1} title="Xuống"
                                        className="text-xs font-bold mr-2 px-1.5 py-0.5 border rounded disabled:opacity-30">↓</button>
                                    <button onClick={() => del(c)} className="text-xs font-semibold text-red-600 hover:underline">Xóa</button>
                                </td>
                            </tr>
                        ))}
                        {sorted.length === 0 && (
                            <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">Chưa có loại nào.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ================= TAB KIỂM KÊ (Gói 19) =================
// Theo demo v4 đã chốt: kiểm theo 3 nhóm (nguyên liệu thô / bán thành phẩm / bao bì),
// nhập tồn thực tế → chênh lệch realtime, chốt phiếu → biên bản + 3 ảnh PNG theo nhóm,
// lịch sử kiểm kho lưu trong admin (bảng stocktakes + stocktake_items).
// Gói 22: nhóm kiểm kho ĐỘNG theo loại danh mục nguyên liệu (thay 3 nhóm cứng).
// catId = material_category_id; 0 = "Chưa phân loại".
const stCatIdOf = (material) => material?.material_category_id ?? 0;
const stSlug = (str) => String(str || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nhom';

// Gói 36: dùng fmtDate/fmtTime từ utils/format (đã thay mọi chỗ dùng stFmtDateVN).
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

// Vẽ biên bản PNG cho 1 nhóm loại nguyên liệu (port từ demo v4 đã chốt, Gói 22: nhóm động + tên CN)
const drawStocktakePNG = (sess, group) => {
    const g = group;
    const rows = sess.rows.filter((r) => r.catId === g.id);
    const W = 1000, pad = 44;
    const dtStr = fmtDate(sess.date) + ' — ' + fmtTime(sess.time);
    let m = 0, s = 0, sh = 0;
    rows.forEach((r) => { if (r.d === 0) m++; else if (r.d > 0) s++; else sh++; });

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const headerH = 196, infoH = 150, colH = 44, rowH = 46;
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

    // Thông tin nhóm (Gói 22: thêm tên chi nhánh)
    let y = headerH + 36;
    ctx.textAlign = 'left'; ctx.fillStyle = '#1f2430'; ctx.font = '400 20px Inter, Arial, sans-serif';
    ctx.fillText('Chi nhánh: ' + (sess.branchName || '—'), pad, y); y += 34;
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
    a.download = 'kiem-kho-' + stSlug(g.name) + '-' + sess.date + '-' + String(sess.time).replace(':', '') + '.png';
    a.href = cv.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
};

function StocktakeTab({ materials, categories, onDone, branchId, showAll }) {
    const [list, setList] = useState([]);
    const [detail, setDetail] = useState(null);
    const [counts, setCounts] = useState({});
    // Gói 22: nhóm kiểm kho động theo loại danh mục (0 = Chưa phân loại)
    const groups = useMemo(() => {
        const sorted = (categories || []).slice()
            .sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || (a.id - b.id));
        const list = sorted.map((c) => ({ id: c.id, name: c.name }));
        list.push({ id: 0, name: 'Chưa phân loại' });
        return list;
    }, [categories]);
    const [activeCat, setActiveCat] = useState(null);
    const curCat = groups.some((g) => g.id === activeCat) ? activeCat : (groups[0] ? groups[0].id : 0);
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
            const res = await axios.get(API + '/stocktakes', { params: { branch_id: branchId } });
            if (res.data?.success) setList(res.data.data || []);
        } catch (err) { console.error('Lỗi tải kiểm kê:', err); }
    };
    useEffect(() => { fetchList(); }, [branchId]);

    const handleCreate = async () => {
        try {
            const res = await axios.post(API + '/stocktakes', { branch_id: branchId, type: createType });
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
                setActiveCat(null);
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
                    branchName: d.branch?.name || '—', // Gói 22
                    groups: groups,
                    rows: (d.items || []).map((it) => {
                        const counted = it.counted_qty == null ? 0 : Number(it.counted_qty);
                        const system = Number(it.system_qty);
                        return {
                            catId: stCatIdOf(it.material),
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
                    branchName: stocktake.branch?.name || '—', // Gói 22
                    groups: groups,
                    rows: (rows || []).map((r) => ({
                        catId: r.category_id ?? 0, // Gói 22: snapshot loại NL lúc chốt
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
                            <b className="text-[#24305E]">{fmtDate(receipt.date)} — {fmtTime(receipt.time)}</b>
                        </div>
                        <div className="text-[13px] text-gray-600 mt-1">Chi nhánh: <b>{receipt.branchName}</b></div>
                        <div className="text-[13px] text-gray-600 mt-2">Người kiểm: <b>{receipt.checker}</b> · {total} dòng · <span className={diffN ? 'text-red-600 font-medium' : 'text-emerald-600'}>{diffN} dòng lệch</span></div>
                    </div>
                    {(receipt.groups || []).map((g) => {
                        const rows = receipt.rows.filter((r) => r.catId === g.id);
                        if (rows.length === 0) return null;
                        return (
                            <div key={g.id} className="mb-5">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-semibold text-[14px] text-[#24305E]">▸ {g.name} ({rows.length})</h4>
                                    <button onClick={() => drawStocktakePNG(receipt, g)}
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
        const groupItems = (catId) => items.filter((it) => stCatIdOf(it.material) === catId);
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
                        <DateInput value={checkDate} onChange={(v) => setCheckDate(v)}
                            className="mt-1 w-full px-3 py-2.5 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-[#0d6efd]" />
                    </label>
                    <label className="text-[13px] text-gray-600">Giờ kiểm
                        <TimeInput value={checkTime} onChange={(v) => setCheckTime(v)}
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
                    {groups.map((g) => {
                        const c = groupItems(g.id).length;
                        const dc = groupItems(g.id).filter((it) => counts[it.id] !== '' && counts[it.id] != null).length;
                        return (
                            <button key={g.id} onClick={() => setActiveCat(g.id)}
                                className={'flex-shrink-0 px-4 py-2.5 text-[13px] rounded-lg border transition-colors ' + (curCat === g.id
                                    ? 'bg-[#24305E] text-white border-[#24305E] font-medium'
                                    : 'bg-white text-gray-600 border-gray-200')}>
                                {g.name} <span className="opacity-70">({dc}/{c})</span>
                            </button>
                        );
                    })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {groupItems(curCat).map((it) => {
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
                    {groupItems(curCat).length === 0 && (
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
                                <td className="px-3 py-3">{s.checked_at ? fmtDate(s.checked_at) + ' — ' + fmtTime(s.checked_at) : <span className="text-gray-400">chưa chốt</span>}</td>
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
