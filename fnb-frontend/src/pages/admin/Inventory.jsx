import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import AdminLayout from '../../components/layout/AdminLayout';
import { useBranch } from '../../contexts/BranchContext';
import { fmtDate, fmtTime, fmtDateTime } from '../../utils/format';
import { API } from '../../utils/api';
import DateInput from '../../components/DateInput';
import TimeInput from '../../components/TimeInput';
import SearchIcon from '../../components/SearchIcon'; // Gói 55 p11x

const STOCKTAKE_TYPES = { daily: 'Ngày', weekly: 'Tuần', monthly: 'Tháng', spontaneous: 'Đột xuất' };

// Gói 55 p11ab: đảo tỷ lệ lưu kho (1 mua = 1/X cơ sở) sang chiều tự nhiên (1 cơ sở = X mua) để hiển thị
// Trả về null nếu rate không hợp lệ
const invRate = (rate) => {
    const n = Number(rate);
    if (!n || n <= 0) return null;
    return Number((1 / n).toFixed(4)).toLocaleString('vi-VN');
};

// =====================================================================
// Gói 4 (2026-10-04): Trang Kho hàng — 4 tabs:
// Tồn kho (cảnh báo tồn thấp) / Nhập kho (quy đổi đơn vị) /
// Chế biến (định mức + phiếu SX bán thành phẩm) / Kiểm kê.
// =====================================================================
export default function Inventory() {
    // Gói 55 p11: đọc section từ URL (/admin/inventory/:section)
    const { section } = useParams();
    // Map URL section → tab key
    const sectionToTab = { inbound: 'inbound', outbound: 'outbound', transfer: 'transfer', stocktake: 'stocktake' };
    const [tab, setTab] = useState(sectionToTab[section] || 'stock');
    // Gói 55 p11e: đồng bộ tab khi chuyển submenu (React Router tái dùng component)
    useEffect(() => {
        setTab(sectionToTab[section] || 'stock');
    }, [section]);
    // Tab con trong "Danh sách tồn kho": nguyên liệu | loại NL | định mức BTP | chế biến
    const [stockSubTab, setStockSubTab] = useState('materials');
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

    // Gói 55 p11: tiêu đề theo submenu
    const sectionTitles = {
        stock: ['Danh sách tồn kho', 'Quản lý nguyên liệu, loại nguyên liệu và định mức bán thành phẩm.'],
        inbound: ['Nhập kho', 'Tạo và quản lý phiếu nhập kho.'],
        outbound: ['Xuất kho', 'Tạo và quản lý phiếu xuất kho.'],
        transfer: ['Chuyển kho', 'Chuyển nguyên liệu giữa các chi nhánh.'],
        stocktake: ['Kiểm kê kho', 'Kiểm kê và cân bằng tồn kho.'],
    };
    const [secTitle, secDesc] = sectionTitles[tab] || sectionTitles.stock;

    return (
        <AdminLayout>
            <div className="p-4 sm:p-5">
                {/* Tiêu đề + nút thêm (chuẩn trang Hóa đơn) */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold text-gray-800">{secTitle}</h1>
                        <p className="text-[13px] text-[#6b7280] mt-0.5">{secDesc}</p>
                    </div>
                    {tab === 'stock' && stockSubTab === 'materials' && (
                        <button onClick={() => setAddMaterialSignal((s) => s + 1)}
                            className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7] whitespace-nowrap self-start sm:self-auto shrink-0">
                            + Nguyên liệu
                        </button>
                    )}
                </div>

                <div className="mt-3 bg-white rounded shadow-sm">
                    {/* Gói 55 p11: Danh sách tồn kho có 4 tab con; các submenu khác render trực tiếp */}
                    {tab === 'stock' && (
                    <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-100 px-4">
                        {[
                            ['materials', 'Nguyên liệu'],
                            ['cats', 'Loại nguyên liệu'],
                            ['bom', 'Định mức bán thành phẩm'],
                            ['production', 'Chế biến'],
                        ].map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => setStockSubTab(key)}
                                className={`px-3 py-3 text-[13px] whitespace-nowrap shrink-0 border-b-2 -mb-px transition-colors ${
                                    stockSubTab === key ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    )}

                    <div className="p-4">
                        {tab === 'stock' && stockSubTab === 'materials' && <StockTab stock={stock} materials={materials} categories={categories} branchId={effBranchId} onChange={() => fetchAll(effBranchId)} addSignal={addMaterialSignal} />}
                        {tab === 'stock' && stockSubTab === 'cats' && <CategoryTab categories={categories} onChange={fetchCats} />}
                        {tab === 'stock' && stockSubTab === 'bom' && <BomTab materials={materials} onDone={() => fetchAll(effBranchId)} />}
                        {tab === 'stock' && stockSubTab === 'production' && <ProductionTab materials={materials} matById={matById} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} />}
                        {tab === 'inbound' && <InboundTab materials={materials} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} branches={branches} />}
                        {/* Gói 55: ẩn Xuất kho — chưa có API phiếu xuất riêng */}
                        {tab === 'outbound' && <OutboundTab materials={materials} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} branches={branches} />}
                        {tab === 'transfer' && <TransferTab materials={materials} branches={branches} branchId={effBranchId} onDone={() => fetchAll(effBranchId)} />}
                        {tab === 'stocktake' && <StocktakeTab materials={materials} categories={categories} onDone={() => fetchAll(effBranchId)} branchId={effBranchId} showAll={branchId === '0'} />}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}

// ================= TAB TỒN KHO =================
function StockTab({ stock, materials, categories, onChange, addSignal, branchId }) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null); // null = thêm mới
    const [form, setForm] = useState({ name: '', unit: 'g', material_category_id: '', minimum_stock: 0, waste_threshold_pct: 5 });
    // Gói 55 p11m: nhiều đơn vị quy đổi [{unit_name, conversion_rate}]
    const [units, setUnits] = useState([]);
    const [newUnit, setNewUnit] = useState({ unit_name: '', conversion_rate: '' });
    // Gói 55 p11aa: danh sách đơn vị từ Thiết lập hệ thống
    const [sysUnits, setSysUnits] = useState([]);
    useEffect(() => {
        axios.get(API + '/units').then((r) => {
            const list = r.data?.data || r.data || [];
            setSysUnits(Array.isArray(list) ? list : []);
        }).catch(() => {});
    }, []);
    // Gói 55 p11m: mặt hàng liên kết
    const [linkedProducts, setLinkedProducts] = useState([]);
    // Gói 55 p11: lọc + tìm kiếm kiểu Sapo
    const [filterStatus, setFilterStatus] = useState('');
    const [filterCategory, setFilterCategory] = useState(''); // Gói 55 p11w: lọc theo loại NL
    const [searchText, setSearchText] = useState('');
    // Gói 55 p11l: chọn + thao tác hàng loạt
    const [selected, setSelected] = useState(new Set());
    const [bulkAction, setBulkAction] = useState('');
    const [bulkValue, setBulkValue] = useState('');
    // Gói 55 p11z: chỉnh sửa nhanh kiểu bảng tính (như Products)
    const [bulkEdit, setBulkEdit] = useState(false);
    const [bulkFields, setBulkFields] = useState(['unit', 'material_category_id', 'minimum_stock', 'is_active']);
    const [bulkRows, setBulkRows] = useState({});
    const [bulkSaving, setBulkSaving] = useState(false);
    const [addFieldOpen, setAddFieldOpen] = useState(false);

    const toggleSelect = (id) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelected(next);
    };
    const toggleSelectAll = () => {
        if (selected.size === filteredStock.length) setSelected(new Set());
        else setSelected(new Set(filteredStock.map((s) => s.material_id)));
    };
    const doBulk = async () => {
        if (!bulkAction || selected.size === 0) return;
        if (bulkAction === 'delete' && !window.confirm(`Xóa ${selected.size} nguyên liệu đã chọn? Chỉ xóa được khi tồn kho về 0 và không dùng trong định mức.`)) return;
        if (bulkAction === 'edit') { setBulkEdit(true); setBulkRows({}); return; } // Gói 55 p11z
        const payload = { ids: [...selected], action: bulkAction };
        if (bulkAction === 'category') payload.material_category_id = bulkValue || null;
        if (bulkAction === 'min_stock') payload.minimum_stock = Number(bulkValue) || 0;
        if (bulkAction === 'status') payload.is_active = bulkValue === 'active';
        try {
            const res = await axios.post(API + '/materials/bulk', payload);
            alert(res.data.message);
            setSelected(new Set()); setBulkAction(''); setBulkValue('');
            onChange();
        } catch (err) { alert(err.response?.data?.message || 'Thao tác thất bại'); }
    };

    // Gói 55 p11z: định nghĩa field cho màn chỉnh sửa nhanh
    const allBulkFields = () => ([
        { key: 'unit', label: 'Đơn vị cơ sở', type: 'unit_select' }, // Gói 55 p11aa: select từ Settings
        { key: 'material_category_id', label: 'Loại nguyên liệu', type: 'category' },
        { key: 'minimum_stock', label: 'Tồn tối thiểu', type: 'number' },
        { key: 'is_active', label: 'Đang hoạt động', type: 'checkbox' },
        { key: 'units_text', label: 'ĐV quy đổi', type: 'units_pair' }, // Gói 55 p11aa: hiện tỷ lệ
    ]);
    const bulkFieldDef = (key) => allBulkFields().find((f) => f.key === key);
    const setBulkCell = (id, field, value) => {
        setBulkRows((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
    };
    const bulkCellEditor = (id, f) => {
        const def = bulkFieldDef(f.key);
        const v = bulkRows[id]?.[f.key];
        if (!def) return null;
        if (def.type === 'checkbox') {
            return <input type="checkbox" checked={!!v} onChange={(e) => setBulkCell(id, f.key, e.target.checked)} className="w-4 h-4 accent-[#24305E]" />;
        }
        if (def.type === 'category') {
            return (
                <select value={v ?? ''} onChange={(e) => setBulkCell(id, f.key, e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-[13px] min-w-[140px] bg-white">
                    <option value="">— Chưa phân loại —</option>
                    {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            );
        }
        // Gói 55 p11aa: đơn vị cơ sở chọn từ Settings
        if (def.type === 'unit_select') {
            return (
                <select value={v ?? ''} onChange={(e) => setBulkCell(id, f.key, e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-[13px] min-w-[110px] bg-white">
                    <option value="">—</option>
                    {sysUnits.map((u) => (
                        <option key={u.id || u.name} value={u.name || u}>{u.name || u}</option>
                    ))}
                </select>
            );
        }
        // Gói 55 p11ab: ĐV quy đổi chiều tự nhiên — 1 [đơn vị cơ sở] = [số] [tên ĐV mua]
        if (def.type === 'units_pair') {
            const m = materials.find((x) => x.id === id);
            const baseUnit = m?.unit || '';
            const pair = (typeof v === 'object' && v !== null) ? v : { name: '', rate: '' };
            return (
                <div className="flex items-center gap-1 whitespace-nowrap">
                    <span className="text-gray-500 text-[13px]">1 {baseUnit} =</span>
                    <input type="number" min="0" step="any" value={pair.rate}
                        onChange={(e) => setBulkCell(id, f.key, { ...pair, rate: e.target.value })}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-[13px] w-[80px]" placeholder="Số" />
                    {/* Gói 55 p11aa: tên ĐV mua chọn từ Settings */}
                    <select value={pair.name}
                        onChange={(e) => setBulkCell(id, f.key, { ...pair, name: e.target.value })}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-[13px] w-[100px] bg-white">
                        <option value="">— Chọn —</option>
                        {sysUnits.map((u) => (
                            <option key={u.id || u.name} value={u.name || u}>{u.name || u}</option>
                        ))}
                    </select>
                </div>
            );
        }
        return (
            <input type={def.type === 'number' ? 'number' : 'text'} min="0"
                value={v ?? ''} onChange={(e) => setBulkCell(id, f.key, e.target.value)}
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-[13px] min-w-[110px]" placeholder="—" />
        );
    };
    const saveBulkEdit = async () => {
        const rows = [...selected].map((id) => {
            const values = {};
            bulkFields.forEach((f) => {
                const v = bulkRows[id]?.[f];
                const def = bulkFieldDef(f);
                // Gói 55 p11aa+p11ab: units_pair ghép thành "tên=số" (1 cơ sở = số ĐV mua), backend đảo khi lưu
                if (def?.type === 'units_pair') {
                    const name = (v?.name || '').trim();
                    const rate = (v?.rate || '').toString().trim();
                    if (name && rate && !isNaN(Number(rate)) && Number(rate) > 0) {
                        values[f] = `${name}=${Number(rate)}`;
                    }
                    return;
                }
                if (v === '' || v === undefined || v === null) return; // trống = giữ nguyên
                if (def?.type === 'number') values[f] = Number(v);
                else if (def?.type === 'checkbox') values[f] = !!v;
                else if (f === 'material_category_id') values[f] = v === '' ? null : Number(v);
                else values[f] = v;
            });
            return { id, values };
        }).filter((r) => Object.keys(r.values).length > 0);
        if (!rows.length) return alert('Chưa sửa ô nào.');
        setBulkSaving(true);
        try {
            const res = await axios.post(API + '/materials/bulk-update', { rows });
            alert(res.data?.message || `Đã lưu ${rows.length} nguyên liệu.`);
            setBulkEdit(false); setSelected(new Set()); setBulkRows({});
            onChange();
        } catch (e) { alert(e.response?.data?.message || 'Lưu hàng loạt thất bại'); }
        finally { setBulkSaving(false); }
    };

    // Gói 55 p11w: bật/tắt trạng thái hoạt động nhanh
    const toggleActive = async (s) => {
        const next = !(s.is_active ?? true);
        try {
            await axios.post(API + '/materials/bulk', {
                ids: [s.material_id], action: 'status', is_active: next,
            });
            onChange();
        } catch (err) { alert(err.response?.data?.message || 'Thao tác thất bại'); }
    };

    // Lọc danh sách theo trạng thái + từ khóa
    const filteredStock = useMemo(() => {
        return (stock || []).filter((s) => {
            if (filterStatus === 'out' && Number(s.current_stock) > 0) return false;
            if (filterStatus === 'low' && !s.is_low_stock) return false;
            if (filterStatus === 'ok' && (s.is_low_stock || Number(s.current_stock) <= 0)) return false;
            // Gói 55 p11w: lọc theo loại nguyên liệu
            if (filterCategory) {
                const m = materials.find((x) => x.id === s.material_id);
                if (String(m?.material_category_id ?? '') !== String(filterCategory)) return false;
            }
            if (searchText.trim() && !s.name.toLowerCase().includes(searchText.trim().toLowerCase())) return false;
            return true;
        });
    }, [stock, filterStatus, filterCategory, searchText, materials]);

    // Xuất Excel (CSV)
    const exportExcel = () => {
        const rows = [['Tên nguyên liệu', 'Loại', 'Đơn vị', 'SL tối thiểu', 'SL tồn', 'Trạng thái']];
        filteredStock.forEach((s) => {
            rows.push([s.name, s.type, s.unit, s.minimum_stock, s.current_stock, s.is_low_stock ? 'Sắp hết' : 'Ổn định']);
        });
        const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `nguyen-lieu-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    };

    // Nhập Excel (CSV)
    // Gói 55 p11p: import Excel với mapping cột (tự động + thủ công)
    const [showImport, setShowImport] = useState(false);
    const [importHeaders, setImportHeaders] = useState([]);
    const [importRows, setImportRows] = useState([]);
    const [importMap, setImportMap] = useState({}); // {field: colIndex}
    const [importing, setImporting] = useState(false);

    const IMPORT_FIELDS = [
        { key: 'name', label: 'Tên nguyên liệu *', required: true },
        { key: 'unit', label: 'Đơn vị cơ sở', required: false },
        { key: 'material_category_id', label: 'Loại nguyên liệu', required: false },
        { key: 'minimum_stock', label: 'Tồn tối thiểu', required: false },
    ];

    // Tự động map dựa trên tên cột
    const autoMapColumns = (headers) => {
        const map = {};
        // Gói 55 p11q: bỏ dấu tiếng Việt trước khi so khớp (Tên→ten, Đơn vị→donvi, Loại→loai, Tồn tối thiểu→tontoithieu)
        const norm = (s) => (s || '').toLowerCase().replace(/đ/g, 'd')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
        headers.forEach((h, i) => {
            const n = norm(h);
            if (n.includes('ten') || n.includes('name')) map.name = i;
            else if (n.includes('donvi') || n.includes('unit')) map.unit = i;
            else if (n.includes('loai') || n.includes('category')) map.material_category_id = i;
            else if (n.includes('ton') && n.includes('thieu') || n.includes('min')) map.minimum_stock = i;
        });
        // Mặc định: cột đầu = tên nếu chưa map
        if (map.name === undefined && headers.length > 0) map.name = 0;
        return map;
    };

    const handleImportFile = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        // Gói 55 p11s: upload lên backend parse bằng PhpSpreadsheet (hỗ trợ xlsx/xls/csv)
        const fd = new FormData();
        fd.append('file', f);
        try {
            const res = await axios.post(API + '/materials/import-preview', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (res.data?.success) {
                const { headers, rows } = res.data.data;
                setImportHeaders(headers);
                setImportRows(rows);
                setImportMap(autoMapColumns(headers));
                setShowImport(true);
            }
        } catch (err) {
            alert(err.response?.data?.message || 'Không đọc được file');
        }
        e.target.value = '';
    };

    const doImport = async () => {
        if (importMap.name === undefined) return alert('Chưa map cột "Tên nguyên liệu"');
        setImporting(true);
        let ok = 0;
        // Map tên loại -> id
        const catByName = {};
        (categories || []).forEach((c) => { catByName[c.name.toLowerCase()] = c.id; });
        for (const row of importRows) {
            const name = row[importMap.name]?.trim();
            if (!name) continue;
            try {
                const payload = { name };
                if (importMap.unit !== undefined) payload.unit = row[importMap.unit]?.trim() || 'g';
                if (importMap.minimum_stock !== undefined) payload.minimum_stock = Number(row[importMap.minimum_stock]) || 0;
                if (importMap.material_category_id !== undefined) {
                    const catName = row[importMap.material_category_id]?.trim().toLowerCase();
                    if (catName && catByName[catName]) payload.material_category_id = catByName[catName];
                }
                await axios.post(`${API}/materials`, payload);
                ok++;
            } catch { /* bỏ qua dòng lỗi */ }
        }
        setImporting(false);
        setShowImport(false);
        alert(`Đã nhập ${ok}/${importRows.length} nguyên liệu.`);
        onChange();
    };

    const resetForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm({ name: '', unit: 'g', material_category_id: '', minimum_stock: 0, waste_threshold_pct: 5, is_active: true }); // Gói 55 p11aa
        setUnits([]); setNewUnit({ unit_name: '', conversion_rate: '' });
        setLinkedProducts([]);
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
            material_category_id: m.material_category_id ?? '',
            minimum_stock: m.minimum_stock ?? 0,
            waste_threshold_pct: m.waste_threshold_pct ?? 5, // Gói 55 p11b
            is_active: m.is_active ?? true, // Gói 55 p11aa
        });
        // Gói 55 p11m: nạp đơn vị quy đổi + mặt hàng liên kết
        // Gói 55 p11ab: API trả chiều lưu kho (1 mua = 1/X cơ sở) → đảo sang chiều tự nhiên (1 cơ sở = X mua) để hiển thị/sửa
        setUnits((m.units || []).map((u) => ({
            unit_name: u.unit_name,
            conversion_rate: u.conversion_rate && Number(u.conversion_rate) > 0
                ? Number((1 / Number(u.conversion_rate)).toFixed(4))
                : '',
        })));
        setNewUnit({ unit_name: '', conversion_rate: '' });
        setLinkedProducts([]);
        axios.get(API + '/materials/' + m.id + '/linked-products').then((r) => {
            if (r.data?.success) setLinkedProducts(r.data.data || []);
        }).catch(() => {});
        setShowForm(true);
    };

    const editingStock = editingId ? stock.find((s) => s.material_id === editingId) : null;
    const hasBatches = editingStock && editingStock.batches_count > 0;

    const handleSave = async () => {
        if (!form.name.trim() || !form.unit.trim()) return alert('Nhập tên và đơn vị cơ sở');
        // Gói 55 p11m: validate đơn vị quy đổi
        for (const u of units) {
            if (!u.unit_name.trim() || !(Number(u.conversion_rate) > 0)) {
                return alert('Đơn vị quy đổi chưa đầy đủ (tên + tỉ lệ > 0)');
            }
        }
        try {
            const payload = {
                name: form.name.trim(),
                unit: form.unit.trim(),
                is_active: form.is_active ?? true, // Gói 55 p11aa
                material_category_id: form.material_category_id === '' ? null : Number(form.material_category_id),
                minimum_stock: Number(form.minimum_stock) || 0,
                waste_threshold_pct: Math.min(100, Math.max(0, Number(form.waste_threshold_pct) || 0)), // Gói 55 p11b
                units: units.map((u) => ({ unit_name: u.unit_name.trim(), conversion_rate: Number(u.conversion_rate) })),
            };
            let res;
            if (editingId) {
                // Không cho đổi đơn vị cơ sở khi đã có lô nhập (tránh lệch số liệu tồn)
                // Gói 55: chỉ delete khi hasBatches (input đã disable), còn không thì cho đổi
                if (hasBatches) delete payload.unit;
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

    // Gói 55 p11: điều chỉnh tồn nhanh ± (mở popup nhập số lượng)
    // Gói 55 p11ag: backend bắt buộc lý do (min 10 ký tự) — prompt thêm lý do
    const quickAdjust = async (s, dir) => {
        const qtyStr = window.prompt(
            `${dir > 0 ? 'Nhập' : 'Xuất'} nhanh: ${s.name}\nNhập số lượng (${s.unit}):`, '1'
        );
        if (qtyStr === null) return;
        const qty = Number(qtyStr);
        if (!qty || qty <= 0) { alert('Số lượng phải > 0.'); return; }
        const reason = window.prompt(
            `Lý do điều chỉnh kho (${dir > 0 ? 'nhập' : 'xuất'} ${qty} ${s.unit} — ${s.name}):\n(Bắt buộc, tối thiểu 10 ký tự)`
        );
        if (reason === null) return;
        if (!reason || reason.trim().length < 10) { alert('Lý do phải từ 10 ký tự trở lên.'); return; }
        try {
            await axios.post(`${API}/inventory/quick-adjust`, {
                material_id: s.material_id,
                quantity: dir > 0 ? qty : -qty,
                branch_id: branchId, // Gói 55: chi nhánh hiện tại thay vì hardcode 1
                reason: reason.trim(),
            });
            onChange();
        } catch (err) {
            alert(err.response?.data?.message || 'Thao tác thất bại.');
        }
    };

    // Gói 55 p11z: màn chỉnh sửa nhanh kiểu bảng tính
    if (bulkEdit) {
        return (
            <MaterialBulkEdit
                selectedIds={[...selected]}
                materials={materials}
                categories={categories}
                bulkFields={bulkFields}
                setBulkFields={setBulkFields}
                bulkRows={bulkRows}
                bulkCellEditor={bulkCellEditor}
                bulkFieldDef={bulkFieldDef}
                saveBulkEdit={saveBulkEdit}
                bulkSaving={bulkSaving}
                onBack={() => { setBulkEdit(false); setBulkRows({}); }}
            />
        );
    }

    return (
        <div>
            {/* Gói 14: cảnh báo tồn thấp gọn 1 dòng trong card, chỉ hiện khi có */}
            {lowCount > 0 && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-[13px] text-red-700">
                    ⚠ <b>{lowCount}</b> nguyên liệu sắp hết (dưới tồn tối thiểu)
                </div>
            )}

            {/* Gói 55 p11p: modal mapping cột import */}
            {showImport && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowImport(false)}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[680px] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
                            <h3 className="font-bold text-[16px]">Nhập nguyên liệu từ Excel</h3>
                            <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 py-4">
                            <div className="text-[13px] text-gray-500 mb-3">
                                Hệ thống đã <b>tự động nhận diện</b> cột (kể cả file CSV dấu chấm phẩy của Excel bản Việt). Đại Vương kiểm tra và điều chỉnh lại nếu cần. Cột không map sẽ được bỏ qua.
                            </div>
                            <div className="space-y-2 mb-4">
                                {IMPORT_FIELDS.map((f) => (
                                    <div key={f.key} className="flex items-center gap-3">
                                        <div className="w-40 text-[13px] font-medium shrink-0">
                                            {f.label}
                                            {f.required && <span className="text-red-500 ml-1">*</span>}
                                        </div>
                                        <select
                                            value={importMap[f.key] ?? ''}
                                            onChange={(e) => setImportMap({
                                                ...importMap,
                                                [f.key]: e.target.value === '' ? undefined : Number(e.target.value),
                                            })}
                                            className="flex-1 px-3 py-2 text-[13px] border border-gray-300 rounded-lg focus:outline-none focus:border-[#0d6efd]">
                                            <option value="">— Bỏ qua —</option>
                                            {importHeaders.map((h, i) => (
                                                <option key={i} value={i}>Cột {i + 1}: {h || '(trống)'}</option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                            <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Xem trước (5 dòng đầu)</div>
                            <div className="border border-gray-200 rounded-lg overflow-x-auto">
                                <table className="w-full text-[12px]">
                                    <thead>
                                        <tr className="bg-gray-50 text-gray-500">
                                            {importHeaders.map((h, i) => (
                                                <th key={i} className="px-2 py-2 font-medium text-left whitespace-nowrap border-b">
                                                    {h || `(Cột ${i + 1})`}
                                                    {Object.entries(importMap).map(([k, v]) => v === i ? (
                                                        <span key={k} className="block text-[10px] text-[#0d6efd] font-bold">
                                                            → {IMPORT_FIELDS.find((f) => f.key === k)?.label}
                                                        </span>
                                                    ) : null)}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {importRows.slice(0, 5).map((r, i) => (
                                            <tr key={i} className="border-b border-gray-50">
                                                {importHeaders.map((_, j) => (
                                                    <td key={j} className="px-2 py-1.5 whitespace-nowrap">{r[j] || ''}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="text-[12px] text-gray-400 mt-2">Tổng {importRows.length} dòng dữ liệu.</div>
                        </div>
                        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 shrink-0">
                            <button onClick={() => setShowImport(false)} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                            <button onClick={doImport} disabled={importing || importMap.name === undefined}
                                className="flex-1 h-11 rounded-xl bg-[#0d6efd] text-white text-[14px] font-semibold disabled:opacity-40">
                                {importing ? 'Đang nhập...' : `Nhập ${importRows.length} dòng`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Gói 55 p11n: modal popup sửa nguyên liệu kiểu Sapo */}
            {showForm && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={resetForm}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[720px] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
                            <h3 className="font-bold text-[16px]">{editingId ? 'Sửa nguyên liệu' : 'Thêm nguyên liệu mới'}</h3>
                            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none" title="Đóng">×</button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 py-4">
                    {/* Gói 55 p11m: section Thông tin chung */}
                    <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2 pb-2 border-b border-gray-100">Thông tin chung</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    <div>
                        <label className="text-xs text-gray-500">Tên nguyên liệu *</label>
                        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="VD: Syrup đường" className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">Đơn vị cơ sở *</label>
                        {/* Gói 55 p11aa: chọn từ danh sách đơn vị trong Thiết lập */}
                        <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                            disabled={hasBatches}
                            title={hasBatches ? 'Đã có lô nhập — không thể đổi đơn vị cơ sở' : ''}
                            className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd] disabled:bg-gray-100 bg-white">
                            <option value="">— Chọn đơn vị —</option>
                            {sysUnits.map((u) => (
                                <option key={u.id || u.name} value={u.name || u}>{u.name || u}</option>
                            ))}
                        </select>
                        {hasBatches && <div className="text-[11px] text-amber-600 mt-1">Đã có lô nhập — không đổi được đơn vị cơ sở</div>}
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
                    {/* Gói 55 p11b: ngưỡng hao hụt cho phép (%) — báo cáo đánh dấu đỏ khi vượt */}
                    <div>
                        <label className="text-xs text-gray-500">Ngưỡng hao hụt cho phép (%)</label>
                        <input type="number" min="0" max="100" step="0.5" value={form.waste_threshold_pct} onChange={(e) => setForm({ ...form, waste_threshold_pct: e.target.value })}
                            className="w-full mt-1 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                    </div>
                    {/* Gói 55 p11aa: trạng thái hoạt động/ngưng bán */}
                    <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                            <input type="checkbox" checked={form.is_active ?? true}
                                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                                className="w-4 h-4 accent-[#24305E]" />
                            <span className="font-medium">Đang hoạt động</span>
                        </label>
                    </div>
                    </div>
                    {/* Gói 55 p11m: section Đơn vị quy đổi (nhiều đơn vị) */}
                    <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2 pb-2 border-b border-gray-100">
                        Đơn vị quy đổi <span className="normal-case font-normal text-gray-400">(1 {form.unit || 'đơn vị cơ sở'} = ? đơn vị mua)</span>
                    </div>
                    <div className="mb-4">
                        {units.map((u, i) => (
                            <div key={i} className="flex items-center gap-2 mb-2 text-[13px]">
                                <span className="font-medium">1 {form.unit}</span>
                                <span className="text-gray-400">=</span>
                                <span className="font-medium">{Number(u.conversion_rate).toLocaleString('vi-VN')} {u.unit_name}</span>
                                <button onClick={() => setUnits(units.filter((_, j) => j !== i))}
                                    className="text-red-500 text-xs hover:underline ml-1">Xóa</button>
                            </div>
                        ))}
                        {units.length === 0 && <div className="text-[12px] text-gray-400 mb-2">Chưa có đơn vị quy đổi. Nhập theo đơn vị cơ sở.</div>}
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-[13px]">1 {form.unit || '—'} =</span>
                            <input type="number" min="0" step="any" value={newUnit.conversion_rate}
                                onChange={(e) => setNewUnit({ ...newUnit, conversion_rate: e.target.value })}
                                placeholder="VD: 30 (1 Cuộn = 30 Cái)"
                                className="w-40 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                            {/* Gói 55 p11aa: chọn từ danh sách đơn vị trong Thiết lập */}
                            <select value={newUnit.unit_name} onChange={(e) => setNewUnit({ ...newUnit, unit_name: e.target.value })}
                                className="w-36 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd] bg-white">
                                <option value="">— Chọn ĐV —</option>
                                {sysUnits.map((u) => (
                                    <option key={u.id || u.name} value={u.name || u}>{u.name || u}</option>
                                ))}
                            </select>
                            <button onClick={() => {
                                if (!newUnit.unit_name.trim() || !(Number(newUnit.conversion_rate) > 0)) return alert('Chọn đơn vị và nhập tỉ lệ > 0');
                                if (units.some((x) => x.unit_name.toLowerCase() === newUnit.unit_name.trim().toLowerCase())) return alert('Đơn vị này đã có');
                                setUnits([...units, { unit_name: newUnit.unit_name.trim(), conversion_rate: Number(newUnit.conversion_rate) }]);
                                setNewUnit({ unit_name: '', conversion_rate: '' });
                            }} className="px-3 py-2 bg-gray-100 text-[13px] rounded hover:bg-gray-200">+ Thêm</button>
                        </div>
                    </div>
                    {/* Gói 55 p11m: section Thông tin mặt hàng liên kết */}
                    {editingId && (
                        <>
                            <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2 pb-2 border-b border-gray-100">Thông tin mặt hàng liên kết</div>
                            <div className="mb-4">
                                {linkedProducts.length === 0 && <div className="text-[12px] text-gray-400">Chưa dùng trong món hay công thức chế biến nào.</div>}
                                {linkedProducts.map((p) => (
                                    <div key={p.link_type + '-' + p.link_id} className="flex items-center justify-between py-1.5 border-b border-gray-50 text-[13px]">
                                        <span className="font-medium">{p.name}</span>
                                        <span className="flex items-center gap-2">
                                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{p.via}</span>
                                            <button
                                                onClick={async () => {
                                                    if (!window.confirm(`Hủy liên kết "${p.name}" khỏi nguyên liệu này?`)) return;
                                                    try {
                                                        const r = await axios.post(API + '/materials/' + editingId + '/unlink', {
                                                            link_id: p.link_id, link_type: p.link_type,
                                                        });
                                                        if (r.data?.success) {
                                                            const lr = await axios.get(API + '/materials/' + editingId + '/linked-products');
                                                            if (lr.data?.success) setLinkedProducts(lr.data.data || []);
                                                        }
                                                    } catch (e) { alert(e.response?.data?.message || 'Hủy liên kết thất bại'); }
                                                }}
                                                title="Hủy liên kết"
                                                className="text-red-400 hover:text-red-600 text-[11px] border border-red-200 rounded-full px-2 py-0.5">
                                                Hủy liên kết
                                            </button>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    <div className="flex gap-2 mt-2">
                        <button onClick={handleSave} className="px-6 py-2.5 bg-[#0d6efd] text-white text-[14px] font-medium rounded-lg hover:bg-[#0b5ed7]">
                            {editingId ? 'Cập nhật' : 'Lưu'}
                        </button>
                        <button onClick={resetForm} className="px-6 py-2.5 text-[14px] text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50">Hủy</button>
                    </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Gói 55 p11i: nút import/export dưới tiêu đề, kiểu Sapo */}
            <div className="flex items-center gap-6 mb-4">
                <button onClick={exportExcel} className="flex items-center gap-1.5 text-[#0d6efd] text-[14px] hover:underline">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#6c757d"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
                    Xuất danh sách
                </button>
                <label className="flex items-center gap-1.5 text-[#0d6efd] text-[14px] hover:underline cursor-pointer">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#6c757d"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
                    Nhập danh sách
                    <input type="file" accept=".xlsx,.xls,.csv" title="Chọn file Excel/CSV" onChange={handleImportFile} className="hidden" />
                </label>
            </div>

            {/* Gói 55 p11: thanh lọc + tìm kiếm kiểu Sapo */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="flex flex-1 min-w-[280px]">
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                        className="border border-gray-300 border-r-0 rounded-l px-3 py-2 text-[13px] bg-white focus:outline-none">
                        <option value="">Lọc nguyên liệu ▾</option>
                        <option value="ok">Còn hàng</option>
                        <option value="low">Sắp hết</option>
                        <option value="out">Hết hàng</option>
                    </select>
                    {/* Gói 55 p11w: lọc theo loại nguyên liệu */}
                    <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                        className="border border-gray-300 border-r-0 px-3 py-2 text-[13px] bg-white focus:outline-none">
                        <option value="">Tất cả loại ▾</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <div className="flex flex-1 items-center border border-gray-300 rounded-r px-3 bg-white">
                        <span className="text-gray-400 mr-2" style={{display:"flex"}}><SearchIcon size={16} /></span>
                        <input value={searchText} onChange={(e) => setSearchText(e.target.value)}
                            placeholder="Tìm kiếm theo tên nguyên liệu..."
                            className="flex-1 py-2 text-[13px] focus:outline-none" />
                    </div>
                </div>
            </div>

            {/* Gói 55 p11l: thanh thao tác hàng loạt */}
            {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <span className="text-[13px] font-medium text-[#24305E]">Đã chọn {selected.size} nguyên liệu</span>
                    <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value)}
                        className="px-3 py-2 text-[13px] border border-gray-300 rounded-lg bg-white focus:outline-none">
                        <option value="">Chọn thao tác...</option>
                        <option value="category">Đổi loại nguyên liệu</option>
                        <option value="min_stock">Đặt tồn tối thiểu</option>
                        <option value="status">Bật/Tắt hoạt động</option>
                        <option value="edit">✏️ Chỉnh sửa nhanh…</option>
                        <option value="delete">Xóa</option>
                    </select>
                    {bulkAction === 'category' && (
                        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                            className="px-3 py-2 text-[13px] border border-gray-300 rounded-lg bg-white focus:outline-none">
                            <option value="">— Chọn loại —</option>
                            {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    )}
                    {bulkAction === 'min_stock' && (
                        <input type="number" min="0" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                            placeholder="Số lượng"
                            className="px-3 py-2 text-[13px] border border-gray-300 rounded-lg w-32 focus:outline-none" />
                    )}
                    {bulkAction === 'status' && (
                        <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                            className="px-3 py-2 text-[13px] border border-gray-300 rounded-lg bg-white focus:outline-none">
                            <option value="">— Chọn —</option>
                            <option value="active">Đang hoạt động</option>
                            <option value="inactive">Ngưng bán</option>
                        </select>
                    )}
                    <button onClick={doBulk} disabled={!bulkAction}
                        className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded-lg hover:bg-[#0b5ed7] disabled:bg-gray-300">
                        Áp dụng
                    </button>
                    <button onClick={() => setSelected(new Set())} className="text-[13px] text-gray-500 hover:underline">
                        Bỏ chọn
                    </button>
                </div>
            )}

            <div className="border border-gray-100 rounded overflow-x-auto">
                <table className="w-full text-[13px] min-w-[800px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="px-3 py-3 font-medium" style={{ width: 40 }}>
                                <input type="checkbox" checked={filteredStock.length > 0 && selected.size === filteredStock.length}
                                    onChange={toggleSelectAll} className="w-4 h-4 cursor-pointer" />
                            </th>
                            <th className="px-4 py-3 font-medium">Nguyên liệu</th>
                            <th className="px-3 py-3 font-medium">Loại</th>
                            <th className="px-3 py-3 font-medium text-right">Tồn hiện tại</th>
                            <th className="px-3 py-3 font-medium text-right">Tồn tối thiểu</th>
                            <th className="px-3 py-3 font-medium">Quy đổi nhập</th>
                            <th className="px-3 py-3 font-medium">Tồn kho</th>
                            <th className="px-3 py-3 font-medium">Trạng thái</th>
                            <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredStock.map((s) => (
                            <tr key={s.material_id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                <td className="px-3 py-3">
                                    <input type="checkbox" checked={selected.has(s.material_id)}
                                        onChange={() => toggleSelect(s.material_id)} className="w-4 h-4 cursor-pointer" />
                                </td>
                                <td className="px-4 py-3 font-medium">
                                    <span className="text-[#0d6efd] cursor-pointer hover:underline" onClick={() => startEdit(s.material_id)}>{s.name}</span>
                                </td>
                                <td className="px-3 py-3">
                                    {(() => {
                                        const m = materials.find((x) => x.id === s.material_id);
                                        const cn = m?.category?.name;
                                        if (cn) return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-50 text-blue-700 border-blue-200">{cn}</span>;
                                        // Gói 55: dùng is_semi_finished thay type cũ
                                        if (m?.is_semi_finished) return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-violet-50 text-violet-700 border-violet-200">Bán thành phẩm</span>;
                                        return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-gray-50 text-gray-500 border-gray-200">Chưa phân loại</span>;
                                    })()}
                                </td>
                                <td className="px-3 py-3 text-right font-bold">{Number(s.current_stock).toLocaleString('vi-VN')} {s.unit}</td>
                                <td className="px-3 py-3 text-right text-gray-500">{Number(s.minimum_stock).toLocaleString('vi-VN')} {s.unit}</td>
                                <td className="px-3 py-3 text-gray-500 text-xs">
                                    {(() => {
                                        // Gói 55: render từ m.units thay field legacy
                                        // Gói 55 p11ab: hiển thị chiều tự nhiên "1 cơ sở = X mua"
                                        const m = materials.find((x) => x.id === s.material_id);
                                        const us = m?.units || [];
                                        if (!us.length) return '—';
                                        const parts = us.map((u) => {
                                            const v = invRate(u.conversion_rate);
                                            return v ? `1 ${s.unit} = ${v} ${u.unit_name}` : null;
                                        }).filter(Boolean);
                                        return parts.length ? parts.join('; ') : '—';
                                    })()}
                                </td>
                                {/* Gói 55 p11aa: cột Tồn kho riêng */}
                                <td className="px-3 py-3 whitespace-nowrap">
                                    {Number(s.current_stock) <= 0
                                        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-50 text-red-600 border border-red-200">Hết hàng</span>
                                        : s.is_low_stock
                                        ? <span className="text-red-600 font-medium text-xs">⚠ Sắp hết</span>
                                        : <span className="text-emerald-600 text-xs">Ổn định</span>}
                                </td>
                                {/* Gói 55 p11aa: cột Trạng thái hoạt động riêng */}
                                <td className="px-3 py-3 whitespace-nowrap">
                                    <button onClick={() => toggleActive(s)} title="Bật/tắt hoạt động"
                                        className={`px-2 py-0.5 rounded-full text-[11px] border ${
                                            (s.is_active ?? true)
                                                ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                                                : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                        {(s.is_active ?? true) ? '● Đang hoạt động' : '○ Ngưng bán'}
                                    </button>
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                    {/* Gói 55 p11: thao tác kho nhanh −/+ */}
                                    <button onClick={() => quickAdjust(s, -1)} title="Xuất nhanh 1"
                                        className="w-7 h-7 rounded-full border-[1.5px] border-red-500 text-red-500 font-bold mr-1 hover:bg-red-50">−</button>
                                    <button onClick={() => quickAdjust(s, 1)} title="Nhập nhanh 1"
                                        className="w-7 h-7 rounded-full border-[1.5px] border-[#0d6efd] text-[#0d6efd] font-bold mr-3 hover:bg-blue-50">+</button>
                                    <button onClick={() => startEdit(s.material_id)}
                                        className="text-[#0d6efd] hover:underline text-[13px] mr-3">Sửa</button>
                                    <button onClick={() => delMaterial(s)}
                                        className="text-red-600 hover:underline text-[13px]">Xóa</button>
                                </td>
                            </tr>
                        ))}
                        {filteredStock.length === 0 && (
                            <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Không tìm thấy nguyên liệu nào.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Gói 55 p11w: modal sửa nhanh hàng loạt */}
        </div>
    );
}

// Gói 55 p11z: màn chỉnh sửa nhanh nguyên liệu kiểu bảng tính (như Products)
function MaterialBulkEdit({ selectedIds, materials, categories, bulkFields, setBulkFields, bulkRows, bulkCellEditor, bulkFieldDef, saveBulkEdit, bulkSaving, onBack }) {
    const defs = [
        { key: 'unit', label: 'Đơn vị cơ sở', type: 'text' },
        { key: 'material_category_id', label: 'Loại nguyên liệu', type: 'category' },
        { key: 'minimum_stock', label: 'Tồn tối thiểu', type: 'number' },
        { key: 'is_active', label: 'Đang hoạt động', type: 'checkbox' },
        { key: 'units_text', label: 'ĐV quy đổi', type: 'text' },
    ];
    const unusedFields = defs.filter((f) => !bulkFields.includes(f.key));
    const [addOpen, setAddOpen] = useState(false);
    const selMaterials = selectedIds.map((id) => materials.find((m) => m.id === id)).filter(Boolean);

    return (
        <div>
            <button onClick={onBack} className="text-[13px] font-semibold text-[#0d6efd] hover:underline mb-2">
                ‹ Quay lại danh sách nguyên liệu
            </button>
            <h2 className="text-[18px] font-bold">Chỉnh sửa nhanh nguyên liệu</h2>
            <p className="text-[13px] text-gray-500 mt-1 mb-4">
                Đang sửa <b>{selMaterials.length}</b> nguyên liệu: {selMaterials.slice(0, 3).map((m) => m.name).join(', ')}{selMaterials.length > 3 ? '...' : ''}
                <br />Để trống ô nào = giữ nguyên giá trị cũ.
            </p>

            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                <div className="text-[13px] font-bold mb-2">Các cột chỉnh sửa</div>
                <div className="flex flex-wrap gap-2 items-center">
                    {bulkFields.map((key) => {
                        const d = defs.find((x) => x.key === key);
                        if (!d) return null;
                        return (
                            <span key={key} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium border bg-gray-50 border-gray-200">
                                {d.label}
                                <button onClick={() => setBulkFields((fs) => fs.filter((x) => x !== key))}
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] hover:bg-red-100 hover:text-red-600" title="Bỏ cột này">✕</button>
                            </span>
                        );
                    })}
                    <div className="relative">
                        <button onClick={() => setAddOpen((v) => !v)} className="px-3 py-1.5 text-[12.5px] border border-gray-300 rounded-lg hover:bg-gray-50">+ Thêm cột ▾</button>
                        {addOpen && (
                            <>
                                <div className="fixed inset-0 z-30" onClick={() => setAddOpen(false)} />
                                <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded-lg shadow-xl border min-w-[220px] py-1">
                                    {unusedFields.length === 0 && <div className="px-3 py-2 text-[12.5px] text-gray-400">Đã dùng hết các cột</div>}
                                    {unusedFields.map((f) => (
                                        <button key={f.key} onClick={() => { setBulkFields((fs) => [...fs, f.key]); setAddOpen(false); }}
                                            className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50">{f.label}</button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="border border-gray-100 rounded-xl overflow-hidden mb-4 bg-white">
                <div className="overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[900px]">
                        <thead>
                            <tr className="text-left text-gray-500 border-b border-gray-100">
                                <th className="px-3 py-3 font-medium" style={{ width: 44 }}>STT</th>
                                <th className="px-4 py-3 font-medium">Nguyên liệu</th>
                                {bulkFields.map((key) => {
                                    const d = defs.find((x) => x.key === key);
                                    return <th key={key} className="px-3 py-3 font-medium">{d ? d.label : key}</th>;
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {selMaterials.map((m, i) => (
                                <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                                    <td className="px-4 py-2 font-medium whitespace-nowrap">
                                        {m.name}
                                        <span className="text-gray-400 font-normal"> ({m.unit})</span>
                                    </td>
                                    {bulkFields.map((key) => (
                                        <td key={key} className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                            {bulkCellEditor(m.id, { key })}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex justify-end gap-2 sticky bottom-0 py-3 bg-white">
                <button onClick={() => { if (window.confirm('Bỏ các thay đổi chưa lưu?')) onBack(); }}
                    className="px-5 py-2.5 border border-gray-300 rounded-lg text-[14px]">Hủy</button>
                <button onClick={saveBulkEdit} disabled={bulkSaving}
                    className="px-5 py-2.5 bg-[#24305E] text-white rounded-lg text-[14px] font-semibold disabled:bg-gray-300">
                    {bulkSaving ? 'Đang lưu...' : `Lưu thay đổi (${selMaterials.length} NL)`}
                </button>
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
    // K-R1: duyệt phiếu nhập nháp của NV (cộng kho + sinh phiếu chi)
    const approveReceipt = async (id) => {
        if (!window.confirm('Duyệt phiếu nhập này? Kho sẽ tăng theo phiếu và sinh phiếu chi.')) return;
        try {
            await axios.post(`${API}/inbound-receipts/${id}/approve`);
            setDetail(null);
            fetchReceipts();
            onDone();
        } catch (e) { alert(e.response?.data?.message || 'Không duyệt được'); }
    };

    return (
        <div>
            {/* Gói 55 p11z: link nhân viên */}
            <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-[12.5px] text-blue-700">
                📱 Link nhân viên tạo phiếu nhập: <b>{typeof window !== 'undefined' ? window.location.origin : ''}/nhap-kho</b>
            </div>
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
                                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : r.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {r.status === 'confirmed' ? 'Đã nhập' : r.status === 'draft' ? 'Nháp' : 'Đã hủy'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                        <button onClick={() => openDetail(r.id)} className="text-[#0d6efd] text-[12px] font-medium mr-3">Xem</button>
                                        {/* K-R1: duyệt/hủy phiếu nháp */}
                                        {r.status === 'draft' && (
                                            <>
                                                <button onClick={() => approveReceipt(r.id)} className="text-green-600 text-[12px] font-medium mr-3">Duyệt</button>
                                                <button onClick={() => cancelReceipt(r.id)} className="text-red-500 text-[12px]">Hủy</button>
                                            </>
                                        )}
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
    const [showPicker, setShowPicker] = useState(false); // Gói 55 p11aa: popup chọn NL
    const [categories, setCategories] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        axios.get(`${API}/material-categories`).then((r) => {
            if (r.data?.success) setCategories(r.data.data || []);
        }).catch(() => {});
    }, []);

    const addLine = (m) => {
        if (lines.some((l) => l.material_id === m.id)) return;
        setLines([...lines, { material_id: m.id, name: m.name, unit: m.unit, purchase_unit: m.purchase_unit || m.unit, conversion_rate: m.conversion_rate || 1, purchase_quantity: '', unit_cost: '', expired_at: '' }]);
    };
    // Gói 55 p11aa: chọn nhiều từ popup
    const addLines = (selected) => {
        const arr = Array.isArray(selected) ? selected : [selected];
        arr.forEach((m) => addLine(m));
        setShowPicker(false);
    };
    const setLine = (mid, field, value) => {
        setLines(lines.map((l) => l.material_id === mid ? { ...l, [field]: value } : l));
    };
    const removeLine = (mid) => setLines(lines.filter((l) => l.material_id !== mid));

    const subtotal = lines.reduce((s, l) => s + Number(l.purchase_quantity || 0) * Number(l.unit_cost || 0), 0);
    const rate = Number(taxRate) || 0;
    const vat = taxIncluded ? (rate > 0 ? subtotal * rate / (100 + rate) : 0) : (rate > 0 ? subtotal * rate / 100 : 0);
    const grand = subtotal - Number(discount || 0) + Number(shipping || 0) + (taxIncluded ? 0 : vat);

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
                        {/* Gói 55 p11aa: popup chọn NL thay dropdown inline */}
                        <button onClick={() => setShowPicker(true)}
                            className="w-full px-3 py-2.5 border-[1.5px] border-dashed border-[#0d6efd] text-[#0d6efd] rounded-lg text-[13px] font-medium hover:bg-blue-50">
                            ＋ Thêm nguyên liệu ({lines.length} dòng)
                        </button>
                        {showPicker && (
                            <MaterialPicker materials={materials} categories={categories}
                                multi={true} excludeIds={lines.map((l) => l.material_id)}
                                onSelect={addLines} onClose={() => setShowPicker(false)} />
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
            {/* Gói 55 p11z: link nhân viên */}
            <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-[12.5px] text-blue-700">
                📱 Link nhân viên tạo phiếu chuyển: <b>{typeof window !== 'undefined' ? window.location.origin : ''}/chuyen-kho</b>
            </div>
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
    const [showPicker, setShowPicker] = useState(false); // Gói 55 p11m: popup chọn NL
    const [stocks, setStocks] = useState({}); // {materialId: {quantity, unit}}
    const [submitting, setSubmitting] = useState(false);
    // categories lấy từ props cha — truyền qua materials[].category hoặc prop riêng
    const [categories, setCategories] = useState([]);

    useEffect(() => {
        // Nạp danh sách loại nguyên liệu để nhóm trong popup
        axios.get(`${API}/material-categories`).then((r) => {
            if (r.data?.success) setCategories(r.data.data || []);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        setStocks({});
        setLines([]);
    }, [fromId]);

    const addLine = async (m) => {
        if (lines.some((l) => l.material_id === m.id)) return;
        setLines([...lines, { material_id: m.id, name: m.name, unit: m.unit, quantity: '' }]);
        try {
            const res = await axios.get(`${API}/stock-transfer-stock`, { params: { branch_id: fromId, material_id: m.id } });
            setStocks((prev) => ({ ...prev, [m.id]: res.data?.data }));
        } catch { /* bỏ qua */ }
    };
    // Gói 55 p11m: chọn nhiều từ popup
    const addLines = (selected) => {
        const arr = Array.isArray(selected) ? selected : [selected];
        arr.forEach((m) => addLine(m));
        setShowPicker(false);
    };
    const setLine = (mid, v) => setLines(lines.map((l) => l.material_id === mid ? { ...l, quantity: v } : l));
    const removeLine = (mid) => setLines(lines.filter((l) => l.material_id !== mid));

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
                    {/* Gói 55 p11m: nút mở popup chọn nguyên liệu + danh sách hàng ngang gọn */}
                    <div>
                        <div className="text-[12px] text-gray-500 mb-1">Nguyên liệu {!fromId && <span className="text-red-400">(chọn kho nguồn trước)</span>}</div>
                        <button onClick={() => fromId && setShowPicker(true)} disabled={!fromId}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] border border-gray-300 rounded-lg text-gray-500 hover:border-[#0d6efd] disabled:bg-gray-100 disabled:cursor-not-allowed">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                            Bấm để chọn nguyên liệu... {lines.length > 0 && <span className="ml-auto text-[#0d6efd] font-medium">({lines.length})</span>}
                        </button>
                    </div>
                    {lines.map((l) => (
                        <div key={l.material_id} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2">
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-[13px] truncate">{l.name}</div>
                                <div className="text-[11px] text-gray-400">
                                    Tồn nguồn: {stocks[l.material_id] ? <b className="text-gray-600">{vnd(stocks[l.material_id].quantity)} {stocks[l.material_id].unit}</b> : '...'}
                                </div>
                            </div>
                            <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(l.material_id, e.target.value)}
                                placeholder="SL" className={inp + ' w-24 text-right'} />
                            <span className="text-[12px] text-gray-500 w-8">{l.unit}</span>
                            <button onClick={() => removeLine(l.material_id)} className="text-red-400 text-lg leading-none px-1">×</button>
                        </div>
                    ))}
                    {showPicker && (
                        <MaterialPicker materials={materials} categories={categories}
                            multi={true} excludeIds={lines.map((l) => l.material_id)}
                            onSelect={addLines} onClose={() => setShowPicker(false)} />
                    )}
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


// ================= POPUP CHỌN NGUYÊN LIỆU (Gói 55 p11m) =================
// Dùng chung cho Chuyển kho, Kiểm kê...: tìm kiếm + nhóm theo loại nguyên liệu
function MaterialPicker({ materials, categories, onSelect, onClose, multi = false, excludeIds = [] }) {
    const [search, setSearch] = useState('');
    const [picked, setPicked] = useState(new Set());

    const groups = useMemo(() => {
        const sorted = (categories || []).slice()
            .sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || (a.id - b.id));
        const q = search.trim().toLowerCase();
        const result = [];
        const uncat = [];
        const byCat = {};
        (materials || []).forEach((m) => {
            if (excludeIds.includes(m.id)) return;
            if (q && !m.name.toLowerCase().includes(q)) return;
            const cid = m.material_category_id;
            if (!cid) { uncat.push(m); return; }
            if (!byCat[cid]) byCat[cid] = [];
            byCat[cid].push(m);
        });
        sorted.forEach((c) => {
            if (byCat[c.id]?.length) result.push({ id: c.id, name: c.name, items: byCat[c.id] });
        });
        if (uncat.length) result.push({ id: 0, name: 'Chưa phân loại', items: uncat });
        return result;
    }, [materials, categories, search, excludeIds]);

    const toggle = (m) => {
        if (!multi) { onSelect(m); return; }
        const next = new Set(picked);
        if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
        setPicked(next);
    };

    const confirmMulti = () => {
        const selected = (materials || []).filter((m) => picked.has(m.id));
        onSelect(selected);
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[520px] max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 pb-3 shrink-0 border-b border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold text-[15px]">Chọn nguyên liệu</h3>
                        <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
                    </div>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                        </span>
                        <input value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Tìm nguyên liệu..."
                            autoFocus
                            className="w-full pl-9 pr-3 py-2.5 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-[#0d6efd]" />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-2">
                    {groups.length === 0 && <div className="text-center text-gray-400 py-10 text-[13px]">Không tìm thấy nguyên liệu.</div>}
                    {groups.map((g) => (
                        <div key={g.id} className="mb-3">
                            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 sticky top-0 bg-white">
                                {g.name} <span className="text-gray-300">({g.items.length})</span>
                            </div>
                            {g.items.map((m) => (
                                <button key={m.id} onClick={() => toggle(m)}
                                    className={'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-[13px] mb-1 ' + (picked.has(m.id) ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent')}>
                                    <span>
                                        <span className="font-medium">{m.name}</span>
                                        <span className="text-gray-400 text-[11px] ml-2">{m.unit}</span>
                                    </span>
                                    {multi && picked.has(m.id) && <span className="text-[#0d6efd] font-bold">✓</span>}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
                {multi && (
                    <div className="p-4 pt-3 border-t border-gray-100 shrink-0">
                        <button onClick={confirmMulti} disabled={picked.size === 0}
                            className="w-full h-11 rounded-xl bg-[#0d6efd] text-white text-[14px] font-semibold disabled:opacity-40">
                            Chọn {picked.size > 0 ? `(${picked.size})` : ''}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}


// ================= TAB CHẾ BIẾN =================
function ProductionTab({ materials, matById, onDone, branchId }) {
    const [history, setHistory] = useState([]);
    const [produce, setProduce] = useState({ material_id: '', quantity: '', note: '' });

    const semis = materials.filter((m) => m.is_semi_finished);

    const fetchData = async () => {
        try {
            const hRes = await axios.get(`${API}/productions`, { params: { branch_id: branchId } });
            if (hRes.data?.success) setHistory(hRes.data.data);
        } catch (err) { console.error('Lỗi tải chế biến:', err); }
    };
    useEffect(() => { fetchData(); }, [branchId]);

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
        <div>
            {/* Gói 55 p11: bỏ phần định mức (đã tách tab riêng) — chỉ còn phiếu chế biến */}
            <div className="grid md:grid-cols-2 gap-4">
                {/* Phiếu chế biến */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
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
            {/* Link trang chế biến cho nhân viên */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
                <p className="text-[13px]">🔗 Trang <b>/che-bien</b> cho nhân viên (đăng nhập PIN): xem nguyên liệu sẽ trừ rồi xác nhận chế biến.</p>
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

    const handleConfirm = async (withBalance = false) => {
        // Gói 55 p11k: tự động lưu số liệu trước khi chốt (tránh lỗi chưa nhập khi nhập 0)
        const items = Object.entries(counts)
            .filter(([, v]) => v !== '' && v !== null)
            .map(([stocktake_item_id, counted_qty]) => ({ stocktake_item_id: Number(stocktake_item_id), counted_qty: Number(counted_qty) }));
        if (items.length > 0) {
            try {
                await axios.patch(API + '/stocktakes/' + detail.id + '/counts', { items });
            } catch (err) {
                alert(err.response?.data?.message || 'Lưu số liệu thất bại');
                return;
            }
        }
        const msg = withBalance
            ? 'Cân bằng kho? Tồn kho sẽ được điều chỉnh về đúng số thực đếm. Không thể sửa sau khi chốt.'
            : 'Hoàn thành kiểm kho? Chênh lệch sẽ được lưu vào lịch sử (không tự động điều chỉnh tồn kho). Không thể sửa sau khi chốt.';
        if (!window.confirm(msg)) return;
        try {
            const res = await axios.post(API + '/stocktakes/' + detail.id + '/confirm', {
                checked_at: checkDate && checkTime ? checkDate + ' ' + checkTime + ':00' : undefined,
                with_balance: withBalance,
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

                {/* Gói 55 p11j: dạng danh sách gọn — mỗi nguyên liệu 1 dòng */}
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[640px]">
                        <thead>
                            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                                <th className="px-3 py-2.5 font-medium">Nguyên liệu</th>
                                <th className="px-3 py-2.5 font-medium text-right">Tồn LT</th>
                                <th className="px-3 py-2.5 font-medium text-right">Chênh lệch</th>
                                <th className="px-3 py-2.5 font-medium text-right" style={{ width: 150 }}>Tồn thực tế</th>
                                <th className="px-3 py-2.5 font-medium text-right" style={{ width: 110 }}>Trạng thái</th>
                            </tr>
                        </thead>
                        <tbody>
                            {groupItems(curCat).map((it) => {
                                const d = diffOf(it);
                                return (
                                    <tr key={it.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                        <td className="px-3 py-2">
                                            <div className="font-medium">{it.material?.name}</div>
                                            <div className="text-[11px] text-gray-400">Đơn vị: {it.material?.unit}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-medium">{stFmtQty(it.system_qty)}</td>
                                        <td className={'px-3 py-2 text-right font-medium ' + (d == null ? 'text-gray-300' : d === 0 ? 'text-gray-400' : d > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                            {d == null ? '—' : (d > 0 ? '+' : '') + stFmtQty(d)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <input type="number" min="0" step="any" inputMode="decimal"
                                                value={counts[it.id] ?? ''}
                                                onChange={(e) => setCounts({ ...counts, [it.id]: e.target.value })}
                                                placeholder="Nhập SL"
                                                className="w-full px-2 py-1.5 text-[14px] border border-gray-300 rounded text-right focus:outline-none focus:border-[#0d6efd]" />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {d == null
                                                ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500">Chưa kiểm</span>
                                                : d === 0
                                                    ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500">Khớp</span>
                                                    : d > 0
                                                        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">Thừa</span>
                                                        : <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-50 text-red-600 border border-red-200">Thiếu</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                            {groupItems(curCat).length === 0 && (
                                <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Nhóm này chưa có nguyên liệu.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-100 mt-4 -mx-1 px-1 py-3 flex items-center gap-3">
                    <button onClick={handleSaveCounts} className="px-4 py-3 border border-gray-300 text-[14px] rounded-lg text-gray-600 hover:bg-gray-50">
                        Lưu số liệu
                    </button>
                    <button onClick={() => handleConfirm(false)} disabled={doneCount !== total}
                        className="flex-1 px-5 py-3 bg-[#0d6efd] text-white text-[14px] font-medium rounded-lg hover:bg-[#0b5ed7] disabled:bg-gray-300 disabled:cursor-not-allowed">
                        Hoàn thành kiểm kho{doneCount !== total ? ' (' + doneCount + '/' + total + ')' : ''}
                    </button>
                    <button onClick={() => handleConfirm(true)} disabled={doneCount !== total}
                        title="Chốt và điều chỉnh tồn kho về đúng số thực đếm"
                        className="px-5 py-3 bg-[#F5A623] text-[#24305E] text-[14px] font-bold rounded-lg hover:bg-[#e09513] disabled:bg-gray-300 disabled:cursor-not-allowed">
                        Cân bằng kho
                    </button>
                </div>
                <div className="text-[12px] text-gray-400 mt-1">
                    "Hoàn thành" chỉ lưu lịch sử chênh lệch. "Cân bằng kho" sẽ điều chỉnh tồn kho về đúng số thực đếm.
                </div>
            </div>
        );
    }

    // ---------- MÀN DANH SÁCH + LỊCH SỬ ----------
    return (
        <div>
            {/* Gói 55 p11f: gợi ý link kiểm kê cho nhân viên */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 flex items-start gap-2">
                <span className="text-blue-600 text-lg">💡</span>
                <div className="text-[13px]">
                    <b className="text-blue-800">Link kiểm kê cho nhân viên:</b>
                    <span className="text-blue-700"> Nhân viên đăng nhập PIN tại </span>
                    <code className="bg-white px-2 py-0.5 rounded border border-blue-200 text-blue-800 font-mono text-[12px]">/kiem-ke</code>
                    <span className="text-blue-700"> để tự tạo và chốt phiếu kiểm kê của chi nhánh mình — không cần vào admin.</span>
                    <button onClick={() => { navigator.clipboard?.writeText(window.location.origin + '/kiem-ke'); alert('Đã copy link!'); }}
                        className="ml-2 px-2 py-1 bg-blue-600 text-white text-[12px] rounded hover:bg-blue-700">Copy link</button>
                </div>
            </div>
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

// ================= TAB ĐỊNH MỨC BÁN THÀNH PHẨM (Gói 55 p11) =================
// Quản lý định mức BOM cho bán thành phẩm (dùng API production-recipes hiện có)
function BomTab({ materials, onDone }) {
    const [recipes, setRecipes] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null); // material_id đang sửa (null = tạo mới)
    // Form tạo/sửa đầy đủ: chọn BTP + SL mỗi mẻ + danh sách dòng
    const [formMatId, setFormMatId] = useState('');
    const [formBatchQty, setFormBatchQty] = useState(''); // Gói 55 p11c: SL BTP mỗi mẻ
    const [formLines, setFormLines] = useState([]); // [{raw_material_id, quantity}]

    const fetchRecipes = async () => {
        try {
            const res = await axios.get(`${API}/production-recipes`);
            setRecipes(res.data?.data || []);
        } catch { /* bỏ qua */ }
    };
    useEffect(() => { fetchRecipes(); }, []);

    // Nhóm theo bán thành phẩm
    const grouped = {};
    recipes.forEach((r) => {
        const mid = r.material_id;
        if (!grouped[mid]) grouped[mid] = { material: r.material, lines: [] };
        grouped[mid].lines.push(r);
    });
    const groupList = Object.values(grouped);

    // Mở modal tạo mới: chọn BTP + thêm nhiều dòng
    const openCreate = () => {
        setEditingId(null);
        setFormMatId('');
        setFormBatchQty('');
        setFormLines([{ raw_material_id: '', quantity: '' }]);
        setShowForm(true);
    };
    // Mở modal sửa: nạp các dòng hiện có
    const openEdit = (g) => {
        setEditingId(g.material?.id);
        setFormMatId(String(g.material?.id));
        setFormBatchQty(g.lines[0]?.batch_output_qty || '');
        setFormLines(g.lines.map((l) => ({ id: l.id, raw_material_id: String(l.raw_material_id), quantity: l.quantity })));
        setShowForm(true);
    };
    const addFormLine = () => setFormLines([...formLines, { raw_material_id: '', quantity: '' }]);
    const removeFormLine = (i) => setFormLines(formLines.filter((_, j) => j !== i));

    const saveForm = async () => {
        if (!formMatId) return alert('Chọn bán thành phẩm.');
        if (!Number(formBatchQty)) return alert('Nhập số lượng BTP mỗi mẻ chế biến (VD: 500).');
        const valid = formLines.filter((l) => l.raw_material_id && Number(l.quantity) > 0);
        if (!valid.length) return alert('Thêm ít nhất 1 nguyên liệu với số lượng.');
        try {
            // Gói 55: tạo mới TRƯỚC, chỉ xóa cũ sau khi tất cả POST thành công
            // (tránh mất định mức nếu lỗi giữa chừng)
            const createdIds = [];
            try {
                for (const l of valid) {
                    const r = await axios.post(`${API}/production-recipes`, {
                        material_id: Number(formMatId),
                        raw_material_id: Number(l.raw_material_id),
                        quantity: Number(l.quantity),
                        batch_output_qty: Number(formBatchQty),
                    });
                    if (r.data?.data?.id) createdIds.push(r.data.data.id);
                }
            } catch (e) {
                // Rollback: xóa các dòng vừa tạo
                for (const id of createdIds) { try { await axios.delete(`${API}/production-recipes/${id}`); } catch {} }
                throw e;
            }
            if (editingId) {
                const oldIds = grouped[editingId]?.lines.map((l) => l.id) || [];
                for (const id of oldIds) {
                    try { await axios.delete(`${API}/production-recipes/${id}`); }
                    catch (e) { console.error('Không xóa được dòng cũ #' + id, e); }
                }
            }
            setShowForm(false);
            fetchRecipes();
            onDone();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const delGroup = async (g) => {
        if (!window.confirm(`Xóa toàn bộ định mức "${g.material?.name}"?`)) return;
        try {
            for (const l of g.lines) { try { await axios.delete(`${API}/production-recipes/${l.id}`); } catch {} }
            fetchRecipes();
            onDone();
        } catch { alert('Xóa thất bại'); }
    };

    const semiFinished = materials.filter((m) => m.is_semi_finished);
    const rawMaterials = materials.filter((m) => !m.is_semi_finished);
    const inp = 'border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:border-[#0d6efd]';

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <p className="text-[13px] text-gray-500">VD: Kem Buôn Mê 500gr = 200gr bột kem béo + 50gr sữa đặc + 300ml sữa tươi + 50ml cốt cà phê</p>
                <button onClick={openCreate} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">+ Tạo định mức</button>
            </div>
            {/* Gói 55 p11: danh sách bảng gọn — mỗi dòng 1 định mức hoàn chỉnh */}
            <div className="border border-gray-100 rounded overflow-x-auto">
                <table className="w-full text-[13px] min-w-[600px]">
                    <thead><tr className="text-left text-gray-500 border-b border-gray-100">
                        <th className="px-4 py-3 font-medium">Tên bán thành phẩm</th>
                        <th className="px-3 py-3 font-medium">Mỗi mẻ ra</th>
                        <th className="px-3 py-3 font-medium">Số nguyên liệu</th>
                        <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                    </tr></thead>
                    <tbody>
                        {groupList.map((g) => (
                            <tr key={g.material?.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                <td className="px-4 py-3 font-medium">{g.material?.name} <span className="text-gray-400 font-normal">({g.material?.unit})</span></td>
                                <td className="px-3 py-3 font-bold text-[#0d6efd]">
                                    {g.lines[0]?.batch_output_qty ? `${Number(g.lines[0].batch_output_qty).toLocaleString('vi-VN')} ${g.material?.unit}` : '—'}
                                </td>
                                <td className="px-3 py-3 text-gray-500">{g.lines.length} nguyên liệu</td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <button onClick={() => openEdit(g)} className="px-3 py-1.5 border border-[#0d6efd] text-[#0d6efd] text-[13px] rounded hover:bg-blue-50 mr-2">Sửa</button>
                                    <button onClick={() => delGroup(g)} className="px-3 py-1.5 border border-gray-300 text-red-600 text-[13px] rounded hover:bg-red-50">Xóa</button>
                                </td>
                            </tr>
                        ))}
                        {groupList.length === 0 && (
                            <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">Chưa có định mức nào. Bấm "+ Tạo định mức".</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <p className="text-[12px] text-gray-500 mt-2">💡 Mỗi dòng là 1 định mức hoàn chỉnh. Bấm <b>Sửa</b> để thêm/bớt nguyên liệu bên trong.</p>

            {showForm && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
                    <div className="bg-white rounded-2xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
                        <h3 className="font-bold text-lg mb-4">{editingId ? 'Sửa định mức' : 'Tạo định mức bán thành phẩm'}</h3>
                        <div className="mb-4">
                            <label className="text-xs text-gray-500">Bán thành phẩm *</label>
                            <select value={formMatId} onChange={(e) => setFormMatId(e.target.value)}
                                disabled={!!editingId} className={`w-full mt-1 ${inp} ${editingId ? 'bg-gray-50' : ''}`}>
                                <option value="">— Chọn —</option>
                                {/* Gói 55 p11o: khi tạo mới liệt kê tất cả NL (NL nào có định mức thì thành BTP) */}
                                {(editingId ? semiFinished : materials).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                            </select>
                        </div>
                        {/* Gói 55 p11c: số lượng BTP mỗi mẻ */}
                        <div className="mb-4">
                            <label className="text-xs text-gray-500">Số lượng bán thành phẩm mỗi mẻ chế biến *</label>
                            <div className="flex items-center gap-2 mt-1">
                                <input type="number" min="0" step="any" value={formBatchQty}
                                    onChange={(e) => setFormBatchQty(e.target.value)}
                                    className={`flex-1 ${inp}`} placeholder="VD: 500" />
                                <span className="text-[13px] text-gray-500">{materials.find((m) => String(m.id) === String(formMatId))?.unit || 'đơn vị'}</span>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1">VD: 1 mẻ ra 500gr Kem Buôn Mê — định mức nguyên liệu bên dưới tính cho 500gr này.</p>
                        </div>
                        <label className="text-[13px] font-medium">Nguyên liệu trong định mức *</label>
                        <div className="mt-2 space-y-2">
                            {formLines.map((l, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <select value={l.raw_material_id}
                                        onChange={(e) => setFormLines(formLines.map((x, j) => j === i ? { ...x, raw_material_id: e.target.value } : x))}
                                        className={`flex-1 ${inp}`}>
                                        <option value="">— Nguyên liệu thô —</option>
                                        {rawMaterials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                                    </select>
                                    <input type="number" min="0" step="any" placeholder="SL" value={l.quantity}
                                        onChange={(e) => setFormLines(formLines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                                        className={`w-24 ${inp}`} />
                                    <button onClick={() => removeFormLine(i)} className="text-red-500 hover:text-red-700 px-1">×</button>
                                </div>
                            ))}
                        </div>
                        <button onClick={addFormLine} className="mt-3 text-[#0d6efd] text-[13px] hover:underline">⊕ Thêm nguyên liệu</button>
                        <div className="flex justify-end gap-2 mt-5">
                            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[13px] text-gray-500">Hủy</button>
                            <button onClick={saveForm} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] rounded hover:bg-[#0b5ed7]">Lưu định mức</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ================= TAB XUẤT KHO (Gói 55 p11) =================
// Danh sách phiếu xuất — dùng chung cấu trúc với nhập kho
// Gói 55 p11aa: tab Xuất kho với API thật
function OutboundTab({ materials, onDone, branchId, branches }) {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('');
    const [searchText, setSearchText] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [detail, setDetail] = useState(null);
    const [categories, setCategories] = useState([]);

    const REASONS = { damaged: 'Hủy hàng', internal_use: 'Dùng nội bộ', sale: 'Xuất bán', other: 'Khác' };

    const fetchList = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API}/outbound-receipts`, { params: { branch_id: branchId, per_page: 50 } });
            setList(res.data?.data?.data || res.data?.data || []);
        } catch { /* bỏ qua */ }
        setLoading(false);
    };
    useEffect(() => {
        fetchList();
        axios.get(`${API}/material-categories`).then((r) => {
            if (r.data?.success) setCategories(r.data.data || []);
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    const openDetail = async (id) => {
        try {
            const res = await axios.get(`${API}/outbound-receipts/${id}`);
            setDetail(res.data?.data);
        } catch (e) { alert(e.response?.data?.message || 'Không tải được phiếu'); }
    };
    const doConfirm = async (id) => {
        if (!window.confirm('Chốt phiếu xuất? Kho sẽ bị trừ theo FIFO, không hoàn tác được.')) return;
        try {
            await axios.post(`${API}/outbound-receipts/${id}/confirm`);
            alert('Đã chốt phiếu xuất.');
            setDetail(null); fetchList(); onDone();
        } catch (e) { alert(e.response?.data?.message || 'Chốt thất bại'); }
    };
    const doCancel = async (id) => {
        if (!window.confirm('Hủy phiếu xuất này?')) return;
        try {
            await axios.post(`${API}/outbound-receipts/${id}/cancel`);
            setDetail(null); fetchList();
        } catch (e) { alert(e.response?.data?.message || 'Không hủy được'); }
    };

    const filtered = (list || []).filter((r) => {
        if (filterStatus && r.status !== filterStatus) return false;
        if (searchText.trim() && !(r.code || '').toLowerCase().includes(searchText.trim().toLowerCase())) return false;
        return true;
    });

    const statusBadge = (s) => s === 'draft'
        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-yellow-50 text-yellow-700 border border-yellow-200">Nháp</span>
        : s === 'confirmed'
        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-600 border border-emerald-200">Đã xuất</span>
        : <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500 border border-gray-200">Đã hủy</span>;

    return (
        <div>
            <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-[12.5px] text-blue-700">
                📱 Link nhân viên tạo phiếu xuất: <b>{typeof window !== 'undefined' ? window.location.origin : ''}/xuat-kho</b>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="flex flex-1 min-w-[280px]">
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                        className="border border-gray-300 border-r-0 rounded-l px-3 py-2 text-[13px] bg-white focus:outline-none">
                        <option value="">Lọc phiếu ▾</option>
                        <option value="draft">Nháp</option>
                        <option value="confirmed">Đã xuất</option>
                        <option value="cancelled">Đã hủy</option>
                    </select>
                    <div className="flex flex-1 items-center border border-gray-300 rounded-r px-3 bg-white">
                        <span className="text-gray-400 mr-2" style={{display:"flex"}}><SearchIcon size={16} /></span>
                        <input value={searchText} onChange={(e) => setSearchText(e.target.value)}
                            placeholder="Tìm theo mã phiếu..." className="flex-1 py-2 text-[13px] focus:outline-none" />
                    </div>
                </div>
                <span className="flex-1"></span>
                <button onClick={() => setShowForm(true)}
                    className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">+ Tạo phiếu xuất</button>
            </div>
            <div className="border border-gray-100 rounded overflow-x-auto">
                <table className="w-full text-[13px] min-w-[600px]">
                    <thead><tr className="text-left text-gray-500 border-b border-gray-100">
                        <th className="px-4 py-3 font-medium">Mã phiếu</th>
                        <th className="px-3 py-3 font-medium">Ngày</th>
                        <th className="px-3 py-3 font-medium">Lý do</th>
                        <th className="px-3 py-3 font-medium">SL dòng</th>
                        <th className="px-3 py-3 font-medium">Trạng thái</th>
                    </tr></thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Đang tải...</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Chưa có phiếu xuất — bấm "+ Tạo phiếu xuất".</td></tr>
                        ) : filtered.map((r) => (
                            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer" onClick={() => openDetail(r.id)}>
                                <td className="px-4 py-3 font-medium text-[#0d6efd]">{r.code}</td>
                                <td className="px-3 py-3">{r.created_at ? new Date(r.created_at).toLocaleDateString('vi-VN') : '—'}</td>
                                <td className="px-3 py-3">{REASONS[r.reason] || r.reason}</td>
                                <td className="px-3 py-3">{r.items_count ?? '—'}</td>
                                <td className="px-3 py-3">{statusBadge(r.status)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showForm && (
                <OutboundForm materials={materials} categories={categories} branchId={branchId}
                    onClose={() => setShowForm(false)}
                    onDone={() => { setShowForm(false); fetchList(); onDone(); }} />
            )}

            {detail && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetail(null)}>
                    <div className="bg-white rounded-2xl p-6 w-[92%] max-w-[560px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-[16px] font-bold mb-1">{detail.code}</h3>
                        <p className="text-[13px] text-gray-500 mb-4">
                            {REASONS[detail.reason] || detail.reason} · {statusBadge(detail.status)}
                            {detail.note && <><br />Ghi chú: {detail.note}</>}
                        </p>
                        <table className="w-full text-[13px]">
                            <thead><tr className="text-left text-gray-500 border-b">
                                <th className="py-2 font-medium">Nguyên liệu</th>
                                <th className="py-2 font-medium text-right">Số lượng</th>
                            </tr></thead>
                            <tbody>
                                {(detail.items || []).map((it) => (
                                    <tr key={it.id} className="border-b border-gray-50">
                                        <td className="py-2">{it.material?.name || '—'}</td>
                                        <td className="py-2 text-right font-medium">{Number(it.quantity).toLocaleString('vi-VN')} {it.unit}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setDetail(null)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-[14px]">Đóng</button>
                            {detail.status === 'draft' && (
                                <>
                                    <button onClick={() => doCancel(detail.id)} className="flex-1 px-4 py-2.5 border border-red-300 text-red-600 rounded-lg text-[14px]">Hủy phiếu</button>
                                    <button onClick={() => doConfirm(detail.id)} className="flex-1 px-4 py-2.5 bg-[#24305E] text-white rounded-lg text-[14px] font-semibold">Chốt xuất kho</button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Gói 55 p11aa: form tạo phiếu xuất
function OutboundForm({ materials, categories, branchId, onClose, onDone }) {
    const [reason, setReason] = useState('damaged');
    const [note, setNote] = useState('');
    const [lines, setLines] = useState([]);
    const [showPicker, setShowPicker] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const addLines = (selected) => {
        const arr = Array.isArray(selected) ? selected : [selected];
        const next = [...lines];
        arr.forEach((m) => {
            if (!next.some((l) => l.material_id === m.id)) {
                next.push({ material_id: m.id, name: m.name, unit: m.unit, quantity: '' });
            }
        });
        setLines(next);
        setShowPicker(false);
    };
    const setLine = (mid, v) => setLines(lines.map((l) => l.material_id === mid ? { ...l, quantity: v } : l));
    const removeLine = (mid) => setLines(lines.filter((l) => l.material_id !== mid));

    const submit = async () => {
        const items = lines.filter((l) => Number(l.quantity) > 0);
        if (!items.length) return alert('Thêm ít nhất 1 nguyên liệu có số lượng');
        if (!window.confirm(`Tạo phiếu xuất ${items.length} dòng? Chốt sau mới trừ kho.`)) return;
        setSubmitting(true);
        try {
            const res = await axios.post(`${API}/outbound-receipts`, {
                branch_id: branchId, reason, note: note || null,
                items: items.map((l) => ({ material_id: l.material_id, quantity: Number(l.quantity) })),
            });
            if (res.data?.success) { alert('Đã tạo phiếu xuất. Bấm "Chốt xuất kho" để trừ kho.'); onDone(); }
        } catch (e) { alert(e.response?.data?.message || 'Tạo phiếu thất bại'); }
        finally { setSubmitting(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-white rounded-2xl p-6 w-[94%] max-w-[600px] max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-[16px] font-bold mb-4">Tạo phiếu xuất kho</h3>
                <div className="grid grid-cols-2 gap-3 mb-4 text-[13px]">
                    <div>
                        <label className="font-medium block mb-1">Lý do xuất</label>
                        <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
                            <option value="damaged">Hủy hàng</option>
                            <option value="internal_use">Dùng nội bộ</option>
                            <option value="sale">Xuất bán</option>
                            <option value="other">Khác</option>
                        </select>
                    </div>
                    <div>
                        <label className="font-medium block mb-1">Ghi chú</label>
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: hàng hỏng, hết HSD..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                </div>
                <button onClick={() => setShowPicker(true)}
                    className="w-full py-2.5 mb-3 border-2 border-dashed border-gray-300 rounded-lg text-[13px] text-gray-500 hover:border-[#0d6efd] hover:text-[#0d6efd]">
                    ＋ Thêm nguyên liệu ({lines.length} dòng)
                </button>
                {lines.map((l) => (
                    <div key={l.material_id} className="flex items-center gap-2 mb-2 text-[13px]">
                        <span className="flex-1 font-medium">{l.name} <span className="text-gray-400">({l.unit})</span></span>
                        <input type="number" min="0" value={l.quantity} onChange={(e) => setLine(l.material_id, e.target.value)}
                            placeholder="SL" className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-right" />
                        <button onClick={() => removeLine(l.material_id)} className="text-red-500 text-lg">×</button>
                    </div>
                ))}
                <div className="flex gap-2 mt-5">
                    <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-[14px]">Hủy</button>
                    <button onClick={submit} disabled={submitting} className="flex-1 px-4 py-2.5 bg-[#0d6efd] text-white rounded-lg text-[14px] font-semibold disabled:bg-gray-300">
                        {submitting ? 'Đang tạo...' : 'Tạo phiếu xuất'}
                    </button>
                </div>
            </div>
            {showPicker && (
                <MaterialPicker materials={materials} categories={categories} multi={true}
                    excludeIds={lines.map((l) => l.material_id)}
                    onSelect={addLines} onClose={() => setShowPicker(false)} />
            )}
        </div>
    );
}
