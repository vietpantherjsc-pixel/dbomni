import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { fmtPrice } from '../../utils/number';
import { useBranch } from '../../contexts/BranchContext'; // Gói 25: badge ẩn/hiện theo CN
import { useAuth } from '../../contexts/AuthContext'; // Gói 33: phân quyền bulk

const BASE = 'http://localhost/api';
const COLOR_PRESETS = ['#24305E', '#2F3E2E', '#00B14F', '#E8830C', '#C0392B', '#6C3FA3', '#D6336C', '#0EA5E9', '#78716C', '#1F2937'];

// Gói 8a (2026-10-05): Form mặt hàng đầy đủ kiểu Sapo — tabs:
// Thông tin | Giá theo kênh | Định mức NL | Nhóm tùy chọn | Thuế.
// Bấm vào dòng để sửa; nút Xóa chỉ nằm trong form sửa.
const TABS = [
    { id: 'info', label: 'Thông tin' },
    { id: 'prices', label: 'Giá theo kênh' },
    { id: 'bom', label: 'Định mức NL' },
    { id: 'groups', label: 'Nhóm tùy chọn' },
    { id: 'tax', label: 'Thuế' },
];

const initialFormState = {
    category_id: '',
    name: '',
    slug: '',
    base_price: '',
    description: '',
    color: '',
    image_url: '',
    tax_rate: '',
    is_active: true,
    sell_on_pos: true,
    sell_on_zalo: false,
    price_on_demand: false, // Gói 10c: giá nhập khi chọn món trên POS, ẩn trên Mini App
    option_group_ids: [],
    prices: [],   // [{price_list_id, price, is_active}]
    recipes: [],  // [{material_id, quantity, kind}]
    option_recipes: [], // Gói 8c: [{product_option_id, material_id, quantity, kind}]
};

// Gói 8c: cấu hình định mức theo món cho 1 nhóm per_product (VD: Size)
// Mỗi option: nguyên liệu tăng thêm (chỉ trong định mức cơ bản) + bao bì riêng.
const PerProductGroupConfig = ({ group, baseMaterials, materials, optionRecipes, onChange }) => {
    const linesFor = (optionId, kind) =>
        optionRecipes.filter((l) => String(l.product_option_id) === String(optionId) && (l.kind || 'ingredient') === kind);

    const setLines = (optionId, kind, nl) => {
        const rest = optionRecipes.filter((l) => !(String(l.product_option_id) === String(optionId) && (l.kind || 'ingredient') === kind));
        onChange([...rest, ...nl.map((l) => ({ ...l, product_option_id: optionId, kind }))]);
    };

    const baseSet = new Set(baseMaterials.map(String));

    return (
        <div className="mt-4 p-4 rounded-lg border" style={{ borderColor: 'var(--m-line)', background: 'var(--m-bg-soft)' }}>
            <div className="text-sm font-bold mb-1" style={{ color: 'var(--m-ink)' }}>
                {group.name} <span className="m-badge" style={{ background: '#FEF3C7', color: '#92400E' }}>Theo món</span>
            </div>
            <p className="text-xs mb-3" style={{ color: 'var(--m-ink-faint)' }}>
                Định mức <b>tăng thêm</b> so với size nhỏ nhất. VD: Size M cà phê +40ml cà phê · Size M trà +70ml trà.
            </p>
            {(group.options || []).map((o) => (
                <div key={o.id} className="mb-3 p-3 rounded-lg" style={{ background: 'var(--m-surface)', border: '1px solid var(--m-line)' }}>
                    <div className="text-sm font-semibold mb-2" style={{ color: 'var(--m-ink)' }}>{o.name}</div>
                    <div className="text-xs font-semibold mb-1" style={{ color: 'var(--m-ink-soft)' }}>Nguyên liệu tăng thêm <span style={{color:'var(--m-ink-faint)'}}>(chỉ chọn trong định mức cơ bản)</span></div>
                    {baseMaterials.length === 0 ? (
                        <p className="text-xs mb-2" style={{ color: 'var(--m-danger)' }}>Chưa có nguyên liệu cơ bản — nhập ở tab "Định mức NL" trước.</p>
                    ) : (
                        <BomLines
                            lines={linesFor(o.id, 'ingredient')}
                            materials={materials}
                            materialFilter={(m) => baseSet.has(String(m.id))}
                            onChange={(nl) => setLines(o.id, 'ingredient', nl)}
                            addLabel="+ Thêm nguyên liệu"
                        />
                    )}
                    <div className="text-xs font-semibold mt-3 mb-1" style={{ color: 'var(--m-ink-soft)' }}>Bao bì <span style={{color:'var(--m-ink-faint)'}}>(VD: Size S → 1 ly nhựa 360ml)</span></div>
                    <BomLines
                        lines={linesFor(o.id, 'packaging')}
                        materials={materials}
                        onChange={(nl) => setLines(o.id, 'packaging', nl)}
                        addLabel="+ Thêm bao bì"
                    />
                </div>
            ))}
        </div>
    );
};
const BomLines = ({ lines, materials, onChange, materialFilter, addLabel }) => {
    const setLine = (i, k, v) => onChange(lines.map((l, j) => j === i ? { ...l, [k]: v } : l));
    const matUnit = (id) => { const m = materials.find((x) => String(x.id) === String(id)); return m ? m.unit : ''; };
    const matName = (id) => { const m = materials.find((x) => String(x.id) === String(id)); return m ? m.name : ''; };
    const list = materialFilter ? materials.filter(materialFilter) : materials;
    return (
        <>
            {lines.map((l, i) => (
                <div key={i} className="grid gap-2 mb-2 items-center" style={{ gridTemplateColumns: '1fr 150px 40px' }}>
                    <select className="m-input" value={l.material_id} onChange={(e) => setLine(i, 'material_id', e.target.value)}>
                        <option value="">— Chọn —</option>
                        {list.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                    </select>
                    <input type="number" min="0" step="0.5" className="m-input" placeholder={`SL (${matUnit(l.material_id) || 'đv'})`}
                        value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
                    <button type="button" className="m-btn m-btn-ghost m-btn-sm !px-0" onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button>
                </div>
            ))}
            <button type="button" className="m-btn m-btn-ghost m-btn-sm mt-1" onClick={() => onChange([...lines, { material_id: '', quantity: '' }])}>
                {addLabel || '+ Thêm dòng'}
            </button>
            {lines.some((l) => l.material_id && l.quantity) && (
                <div className="text-xs mt-2 space-y-1" style={{ color: 'var(--m-ink-soft)' }}>
                    {lines.filter((l) => l.material_id && l.quantity).map((l, i) => (
                        <div key={i}>• {l.quantity} {matUnit(l.material_id)} {matName(l.material_id)}</div>
                    ))}
                </div>
            )}
        </>
    );
};

const Products = () => {
    const branchCtx = useBranch();
    const ctxBranchId = (branchCtx && branchCtx.branchId) || '0'; // Gói 25
    const { can } = useAuth();
    const canBulk = can('products.bulk'); // Gói 33: CHỈ admin cấp cao nhất
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [priceLists, setPriceLists] = useState([]);
    const [optionGroups, setOptionGroups] = useState([]);
    const [materials, setMaterials] = useState([]);
    const [loading, setLoading] = useState(true);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [tab, setTab] = useState('info');
    const [costPrice, setCostPrice] = useState(null);
    const [formData, setFormData] = useState(initialFormState);

    // Gói 33: chọn + thao tác hàng loạt
    const [selected, setSelected] = useState({});
    const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
    const [bulkModal, setBulkModal] = useState(null); // 'category' | 'channels'
    const [bulkCatId, setBulkCatId] = useState('');
    const [bulkChannels, setBulkChannels] = useState({});
    const headerCbRef = useRef(null);
    // Gói 33: màn chỉnh sửa nhanh
    const [bulkEdit, setBulkEdit] = useState(false);
    const [bulkFields, setBulkFields] = useState(['base_price', 'price_grabfood', 'price_shopeefood', 'unit', 'print_label']);
    const [bulkRows, setBulkRows] = useState({});
    const [addFieldOpen, setAddFieldOpen] = useState(false);
    const [bulkSaving, setBulkSaving] = useState(false);

    const selectedIds = Object.keys(selected).filter((k) => selected[k]).map(Number);
    const toggleSelect = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
    useEffect(() => {
        if (headerCbRef.current) {
            headerCbRef.current.indeterminate = selectedIds.length > 0 && selectedIds.length < products.length;
        }
    });

    // Giá kênh hiện tại của món (từ relation prices.price_list)
    const priceOf = (p, code) => {
        const row = (p.prices || []).find((x) => x.price_list?.code === code);
        return row ? row.price : '';
    };

    // Định nghĩa field cho màn chỉnh sửa nhanh (kênh động theo priceLists)
    const allBulkFields = () => ([
        { key: 'base_price', label: 'Giá bán tại quán', type: 'number' },
        ...priceLists.map((pl) => ({ key: 'price_' + pl.code, label: 'Giá bán ' + pl.name, type: 'number' })),
        { key: 'unit', label: 'Đơn vị', type: 'text' },
        { key: 'print_label', label: 'In tem', type: 'checkbox' },
        { key: 'category_id', label: 'Danh mục', type: 'category' },
        { key: 'cost_price', label: 'Giá vốn', type: 'number' },
        { key: 'tax_rate', label: 'Thuế suất (%)', type: 'number' },
        { key: 'is_active', label: 'Đang bán', type: 'checkbox' },
    ]);
    const bulkFieldDef = (key) => allBulkFields().find((f) => f.key === key);

    useEffect(() => {
        fetchProducts();
        fetchCategories();
        fetchMeta();
    }, []);

    const fetchProducts = async () => {
        try {
            const response = await axios.get(`${BASE}/products`);
            setProducts(response.data);
        } catch (error) {
            console.error("Lỗi khi tải danh sách mặt hàng:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCategories = async () => {
        try {
            const response = await axios.get(`${BASE}/categories`);
            setCategories(response.data);
        } catch (error) { console.error(error); }
    };

    const fetchMeta = async () => {
        try {
            const [pl, og, mt] = await Promise.all([
                axios.get(`${BASE}/price-lists`),
                axios.get(`${BASE}/option-groups`),
                axios.get(`${BASE}/materials`),
            ]);
            setPriceLists(Array.isArray(pl.data) ? pl.data : []);
            setOptionGroups(og.data?.data || []);
            const m = mt.data?.data || mt.data || [];
            setMaterials(Array.isArray(m) ? m : []);
        } catch (error) { console.error(error); }
    };

    const handleNameChange = (e) => {
        const name = e.target.value;
        const slug = name.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-').replace(/^-|-$/g, '');
        setFormData({ ...formData, name, slug });
    };

    const openAdd = () => {
        setFormData({
            ...initialFormState,
            prices: priceLists.filter((p) => p.is_active).map((p) => ({ price_list_id: p.id, price: '', is_active: true })),
        });
        setEditingId(null);
        setCostPrice(null);
        setTab('info');
        setIsModalOpen(true);
    };

    // Bấm vào dòng -> mở sửa (Gói 8a)
    // Gói 9: tim yêu thích — bấm chuyển đỏ, đưa món vào "Dành cho bạn" trên Mini App
    const toggleFav = async (product) => {
        try {
            const res = await axios.patch(`http://localhost/api/products/${product.id}/favorite`);
            setProducts((ps) => ps.map((p) => p.id === product.id ? { ...p, is_favorite: res.data.is_favorite } : p));
        } catch (e) { alert('Không lưu được, thử lại.'); }
    };

    // ================= Gói 33: thao tác hàng loạt =================
    const runBulkAction = async (action, params) => {
        if (!selectedIds.length) return;
        try {
            const res = await axios.post(`${BASE}/products/bulk-action`, { ids: selectedIds, action, params });
            alert(`Đã cập nhật ${res.data?.updated ?? selectedIds.length} mặt hàng.`);
            setSelected({}); setBulkMenuOpen(false); setBulkModal(null);
            fetchProducts();
        } catch (e) { alert(e.response?.data?.message || 'Thao tác hàng loạt thất bại'); }
    };
    const confirmBulkDelete = () => {
        if (!window.confirm(`XÓA ${selectedIds.length} mặt hàng đã chọn?\n\nMón đã xóa không khôi phục được.`)) return;
        runBulkAction('delete', {});
    };
    const openChannelsModal = () => {
        const init = { pos: true, zalo: true };
        priceLists.forEach((pl) => { init[pl.code] = true; });
        setBulkChannels(init);
        setBulkModal('channels');
        setBulkMenuOpen(false);
    };
    // Màn chỉnh sửa nhanh: nạp giá trị hiện tại của các món đã chọn
    const openBulkEdit = () => {
        const rows = {};
        selectedIds.forEach((id) => {
            const p = products.find((x) => x.id === id);
            if (!p) return;
            const vals = {
                base_price: p.base_price ?? '', unit: p.unit ?? '', print_label: !!p.print_label,
                category_id: p.category_id ?? '', cost_price: p.cost_price ?? '',
                tax_rate: p.tax_rate ?? '', is_active: !!p.is_active,
            };
            priceLists.forEach((pl) => { vals['price_' + pl.code] = priceOf(p, pl.code); });
            rows[id] = vals;
        });
        setBulkRows(rows);
        // Field mặc định như demo (chỉ lấy kênh giá tồn tại thật)
        const codes = new Set(priceLists.map((pl) => pl.code));
        setBulkFields(['base_price', 'price_grabfood', 'price_shopeefood', 'unit', 'print_label']
            .filter((k) => !k.startsWith('price_') || codes.has(k.slice(6))));
        setBulkEdit(true);
    };
    const setBulkCell = (id, field, value) => {
        setBulkRows((r) => ({ ...r, [id]: { ...r[id], [field]: value } }));
    };
    const saveBulkEdit = async () => {
        const rows = selectedIds.map((id) => {
            const values = {};
            bulkFields.forEach((f) => {
                const v = bulkRows[id]?.[f];
                const def = bulkFieldDef(f);
                if (v === '' || v === undefined || v === null) return; // trống = giữ nguyên
                if (def?.type === 'number') values[f] = Number(v);
                else if (def?.type === 'checkbox') values[f] = !!v;
                else if (f === 'category_id') values[f] = v === '' ? null : v;
                else values[f] = v;
            });
            return { id, values };
        }).filter((r) => Object.keys(r.values).length > 0);
        if (!rows.length) return alert('Chưa sửa ô nào.');
        setBulkSaving(true);
        try {
            const res = await axios.post(`${BASE}/products/bulk-update`, { rows });
            alert(`Đã lưu ${res.data?.updated ?? rows.length} mặt hàng.`);
            setBulkEdit(false); setSelected({});
            fetchProducts();
        } catch (e) { alert(e.response?.data?.message || 'Lưu hàng loạt thất bại'); }
        finally { setBulkSaving(false); }
    };
    // Ô nhập cho từng loại field trong màn chỉnh sửa nhanh
    const bulkCellEditor = (id, f) => {
        const def = bulkFieldDef(f.key);
        const v = bulkRows[id]?.[f.key];
        if (!def) return null;
        if (def.type === 'checkbox') {
            return <input type="checkbox" checked={!!v} onChange={(e) => setBulkCell(id, f.key, e.target.checked)} className="w-4 h-4 accent-[#24305E]" />;
        }
        if (def.type === 'category') {
            return (
                <select value={v ?? ''} onChange={(e) => setBulkCell(id, f.key, e.target.value)} className="m-input !py-1.5 min-w-[140px]">
                    <option value="">— Chưa phân loại —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            );
        }
        return (
            <input type={def.type === 'number' ? 'number' : 'text'} min="0"
                value={v ?? ''} onChange={(e) => setBulkCell(id, f.key, e.target.value)}
                className="m-input !py-1.5 min-w-[110px]" placeholder="—" />
        );
    };
    // ================= /Gói 33 =================
    const handleEdit = async (product) => {
        try {
            const r = await axios.get(`${BASE}/products/${product.id}`);
            const p = r.data;
            setFormData({
                category_id: p.category_id || '',
                name: p.name || '',
                slug: p.slug || '',
                base_price: p.base_price ?? '',
                description: p.description || '',
                color: p.color || '',
                image_url: p.image_url || '',
                tax_rate: p.tax_rate ?? '',
                is_active: Boolean(p.is_active),
                sell_on_pos: Boolean(p.sell_on_pos),
                sell_on_zalo: Boolean(p.sell_on_zalo),
                price_on_demand: Boolean(p.price_on_demand), // Gói 10c
                option_group_ids: (p.option_group_ids || []).map(Number),
                prices: priceLists.map((pl) => {
                    const ex = (p.prices || []).find((x) => x.price_list_id === pl.id);
                    return { price_list_id: pl.id, price: ex ? ex.price : '', is_active: ex ? Boolean(ex.is_active) : false };
                }),
                recipes: (p.recipes || []).filter((x) => !x.product_option_id)
                    .map((x) => ({ material_id: String(x.material_id), quantity: x.quantity, kind: x.kind || 'ingredient' })),
                // Gói 8c: định mức theo món
                option_recipes: (p.option_recipes || [])
                    .map((x) => ({ product_option_id: x.product_option_id, material_id: String(x.material_id), quantity: x.quantity, kind: x.kind || 'ingredient' })),
            });
            setCostPrice(p.cost_price ?? null);
        } catch (e) {
            // fallback: dùng dữ liệu dòng
            setFormData({
                ...initialFormState,
                category_id: product.category_id || '',
                name: product.name, slug: product.slug, base_price: product.base_price,
                is_active: Boolean(product.is_active),
                sell_on_pos: Boolean(product.sell_on_pos),
                sell_on_zalo: Boolean(product.sell_on_zalo),
                price_on_demand: Boolean(product.price_on_demand), // Gói 10c
                prices: priceLists.map((pl) => ({ price_list_id: pl.id, price: '', is_active: false })),
            });
            setCostPrice(null);
        }
        setEditingId(product.id);
        setTab('info');
        setIsModalOpen(true);
    };

    // Xóa chỉ nằm trong form sửa (tránh bấm nhầm)
    const handleDelete = async () => {
        if (!editingId) return;
        if (!window.confirm(`Xóa mặt hàng "${formData.name}"? Không thể hoàn tác.`)) return;
        try {
            await axios.delete(`${BASE}/products/${editingId}`);
            handleCloseModal();
            fetchProducts();
        } catch (error) {
            alert("Lỗi khi xóa: " + (error.response?.data?.message || "Vui lòng thử lại"));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const payload = {
                ...formData,
                category_id: formData.category_id || null,
                base_price: Number(formData.base_price) || 0,
                tax_rate: formData.tax_rate === '' ? null : Number(formData.tax_rate),
                color: formData.color || null,
                prices: formData.prices
                    .filter((x) => x.is_active && x.price !== '' && Number(x.price) >= 0)
                    .map((x) => ({ price_list_id: x.price_list_id, price: Number(x.price), is_active: true })),
                recipes: formData.recipes
                    .filter((x) => x.material_id && Number(x.quantity) > 0)
                    .map((x) => ({ material_id: Number(x.material_id), quantity: Number(x.quantity), kind: x.kind || 'ingredient' })),
                // Gói 8c: định mức theo món
                option_recipes: (formData.option_recipes || [])
                    .filter((x) => x.product_option_id && x.material_id && Number(x.quantity) > 0)
                    .map((x) => ({ product_option_id: Number(x.product_option_id), material_id: Number(x.material_id), quantity: Number(x.quantity), kind: x.kind || 'ingredient' })),
            };
            if (editingId) {
                await axios.put(`${BASE}/products/${editingId}`, payload);
            } else {
                await axios.post(`${BASE}/products`, payload);
            }
            handleCloseModal();
            fetchProducts();
        } catch (error) {
            alert("Có lỗi xảy ra: " + (error.response?.data?.message || "Vui lòng kiểm tra lại dữ liệu"));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData(initialFormState);
        setEditingId(null);
        setTab('info');
    };

    // ---- helpers cho tab giá ----
    const setPriceRow = (plId, patch) => {
        setFormData((p) => ({
            ...p,
            prices: p.prices.map((x) => x.price_list_id === plId ? { ...x, ...patch } : x),
        }));
    };

    // ---- helpers cho tab định mức ----
    const toggleGroup = (gid) => {
        setFormData((p) => ({
            ...p,
            option_group_ids: p.option_group_ids.includes(gid)
                ? p.option_group_ids.filter((x) => x !== gid)
                : [...p.option_group_ids, gid],
        }));
    };

    // ================= Gói 33: màn CHỈNH SỬA NHANH =================
    if (bulkEdit) {
        const defs = allBulkFields();
        const unusedFields = defs.filter((f) => !bulkFields.includes(f.key));
        const selProducts = selectedIds.map((id) => products.find((p) => p.id === id)).filter(Boolean);
        return (
            <AdminLayout>
                <div className="p-6 max-w-[1200px] mx-auto">
                    <button onClick={() => setBulkEdit(false)} className="text-[13px] font-semibold hover:underline mb-2" style={{ color: 'var(--m-primary)' }}>
                        ‹ Quay lại danh sách mặt hàng
                    </button>
                    <h1 className="text-[22px] font-bold text-[var(--m-ink)]">Chỉnh sửa nhanh mặt hàng</h1>
                    <p className="text-sm mt-1 mb-4" style={{ color: 'var(--m-ink-soft)' }}>
                        Đang sửa <b>{selProducts.length}</b> món: {selProducts.slice(0, 3).map((p) => p.name).join(', ')}{selProducts.length > 3 ? '...' : ''}
                    </p>

                    <div className="m-card p-4 mb-4">
                        <div className="text-[13px] font-bold mb-2" style={{ color: 'var(--m-ink)' }}>Các thông tin chỉnh sửa</div>
                        <div className="flex flex-wrap gap-2 items-center">
                            {bulkFields.map((key) => {
                                const d = bulkFieldDef(key);
                                if (!d) return null;
                                return (
                                    <span key={key} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium border"
                                        style={{ background: 'var(--m-bg-soft)', borderColor: 'var(--m-line)', color: 'var(--m-ink)' }}>
                                        {d.label}
                                        <button onClick={() => setBulkFields((fs) => fs.filter((x) => x !== key))}
                                            className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] hover:bg-red-100 hover:text-red-600" title="Bỏ trường này">✕</button>
                                    </span>
                                );
                            })}
                            <div className="relative">
                                <button onClick={() => setAddFieldOpen((v) => !v)} className="m-btn m-btn-ghost m-btn-sm">+ Thêm trường chỉnh sửa ▾</button>
                                {addFieldOpen && (
                                    <>
                                        <div className="fixed inset-0 z-30" onClick={() => setAddFieldOpen(false)} />
                                        <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded-lg shadow-xl border min-w-[220px] py-1" style={{ borderColor: 'var(--m-line)' }}>
                                            {unusedFields.length === 0 && <div className="px-3 py-2 text-[12.5px] text-gray-400">Đã dùng hết các trường</div>}
                                            {unusedFields.map((f) => (
                                                <button key={f.key} onClick={() => { setBulkFields((fs) => [...fs, f.key]); setAddFieldOpen(false); }}
                                                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50">{f.label}</button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="m-card overflow-hidden mb-4">
                        <div className="overflow-x-auto">
                            <table className="m-table min-w-[900px]">
                                <thead>
                                    <tr>
                                        <th style={{ width: 44 }}>STT</th>
                                        <th>Tên món</th>
                                        {bulkFields.map((key) => {
                                            const d = bulkFieldDef(key);
                                            return <th key={key}>{d ? d.label : key}</th>;
                                        })}
                                    </tr>
                                </thead>
                                <tbody>
                                    {selProducts.map((p, i) => (
                                        <tr key={p.id}>
                                            <td className="text-gray-400">{i + 1}</td>
                                            <td className="font-medium whitespace-nowrap">{p.name}</td>
                                            {bulkFields.map((key) => (
                                                <td key={key} onClick={(e) => e.stopPropagation()}>
                                                    {bulkCellEditor(p.id, { key })}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 sticky bottom-0 py-3" style={{ background: 'var(--m-bg)' }}>
                        <button onClick={() => { if (window.confirm('Bỏ các thay đổi chưa lưu?')) setBulkEdit(false); }} className="m-btn m-btn-ghost">Hủy</button>
                        <button onClick={saveBulkEdit} disabled={bulkSaving} className="m-btn m-btn-primary">
                            {bulkSaving ? 'Đang lưu...' : `Lưu thay đổi (${selProducts.length} món)`}
                        </button>
                    </div>
                </div>
            </AdminLayout>
        );
    }
    // ================= /Gói 33 =================

    return (
        <AdminLayout>
            <div className="p-6 max-w-[1200px] mx-auto">
            <div className="flex justify-between items-center mb-4">
                <div>
                    <h1 className="text-[22px] font-bold text-[var(--m-ink)]">Mặt hàng</h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--m-ink-soft)' }}>Bấm vào dòng để sửa · Quản lý giá theo kênh, định mức, nhóm tùy chọn</p>
                </div>
                <button onClick={openAdd} className="m-btn m-btn-primary">+ Thêm mặt hàng</button>
            </div>

            {/* Gói 33: thanh thao tác hàng loạt — CHỈ admin cấp cao nhất */}
            {canBulk && selectedIds.length > 0 && (
                <div className="m-card p-3 mb-3 flex flex-wrap items-center gap-3" style={{ background: 'var(--m-accent-soft)', borderColor: '#d5ddf2' }}>
                    <span className="text-[13.5px] font-bold" style={{ color: 'var(--m-primary)' }}>
                        ✓ Đã chọn {selectedIds.length} mặt hàng
                    </span>
                    <div className="relative">
                        <button onClick={() => setBulkMenuOpen((v) => !v)} className="m-btn m-btn-primary m-btn-sm">
                            Chọn thao tác ▾
                        </button>
                        {bulkMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-30" onClick={() => setBulkMenuOpen(false)} />
                                <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded-lg shadow-xl border min-w-[230px] py-1" style={{ borderColor: 'var(--m-line)' }}>
                                    <button onClick={() => { setBulkCatId(''); setBulkModal('category'); setBulkMenuOpen(false); }}
                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50">Đổi danh mục</button>
                                    <button onClick={() => { openChannelsModal(); }}
                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50">Bật/tắt kênh bán hàng</button>
                                    <button onClick={() => runBulkAction('set_visibility', { visible: true })}
                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50">Hiện mặt hàng</button>
                                    <button onClick={() => runBulkAction('set_visibility', { visible: false })}
                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50">Ẩn mặt hàng</button>
                                    <button onClick={confirmBulkDelete}
                                        className="w-full text-left px-3 py-2 text-[13px] text-red-600 hover:bg-red-50">Xóa mặt hàng</button>
                                </div>
                            </>
                        )}
                    </div>
                    <button onClick={openBulkEdit} className="m-btn m-btn-sm text-white font-semibold" style={{ background: 'var(--m-stamp)' }}>
                        Chỉnh sửa nhanh
                    </button>
                    <button onClick={() => setSelected({})} className="text-[12.5px] underline" style={{ color: 'var(--m-ink-soft)' }}>
                        Bỏ chọn
                    </button>
                </div>
            )}

            <div className="m-card overflow-hidden">
                <table className="m-table">
                    <thead>
                        <tr>
                            {canBulk && (
                                <th style={{ width: 40 }}>
                                    <input ref={headerCbRef} type="checkbox" className="w-4 h-4 accent-[#24305E] align-middle"
                                        checked={products.length > 0 && selectedIds.length === products.length}
                                        onChange={(e) => {
                                            const next = {};
                                            if (e.target.checked) products.forEach((p) => { next[p.id] = true; });
                                            setSelected(next);
                                        }} />
                                </th>
                            )}
                            <th style={{ width: 56 }}></th>
                            <th>Tên mặt hàng</th>
                            <th>Danh mục</th>
                            <th>Giá bán</th>
                            <th title="Món yêu thích — hiện ở mục Dành cho bạn trên Mini App">♥</th>
                            <th>Trạng thái</th>
                            <th>Kênh bán</th>
                            <th className="text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={canBulk ? 9 : 8} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Đang tải dữ liệu...</td></tr>
                        ) : products.length === 0 ? (
                            <tr><td colSpan={canBulk ? 9 : 8} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có mặt hàng nào.</td></tr>
                        ) : (
                            products.map(product => (
                                <tr key={product.id} onClick={() => handleEdit(product)} className="cursor-pointer">
                                    {canBulk && (
                                        <td onClick={(e) => e.stopPropagation()}>
                                            <input type="checkbox" className="w-4 h-4 accent-[#24305E] align-middle"
                                                checked={!!selected[product.id]}
                                                onChange={() => toggleSelect(product.id)} />
                                        </td>
                                    )}
                                    <td onClick={(e) => e.stopPropagation()}>
                                        {product.image_url ? (
                                            <img src={product.image_url} alt={product.name}
                                                className="w-11 h-11 rounded-lg object-cover border"
                                                style={{ borderColor: 'var(--m-line)' }}
                                                onError={(e) => { e.target.style.display = 'none'; }} />
                                        ) : product.color ? (
                                            <div className="w-11 h-11 rounded-lg flex items-center justify-center text-lg text-white font-bold" style={{ background: product.color }}>
                                                {product.name.charAt(0)}
                                            </div>
                                        ) : (
                                            <div className="w-11 h-11 rounded-lg flex items-center justify-center text-lg"
                                                style={{ background: 'var(--m-bg)', color: 'var(--m-ink-faint)' }}>☕</div>
                                        )}
                                    </td>
                                    <td className="font-medium">
                                        {product.name}
                                        {/* Gói 25: badge ẩn/hiện theo CN — chế độ Tất cả: liệt kê CN; CN cụ thể: báo nếu ẩn ở CN này */}
                                        {(() => {
                                            const hb = product.hidden_branches || [];
                                            if (!hb.length) return null;
                                            if (ctxBranchId === '0') {
                                                return (
                                                    <span className="m-badge m-badge-red block mt-1" style={{ whiteSpace: 'normal' }}>
                                                        Đang ẩn ở: {hb.map((h) => h.name).join(', ')}
                                                    </span>
                                                );
                                            }
                                            const me = hb.find((h) => String(h.id) === String(ctxBranchId));
                                            return me ? (
                                                <span className="m-badge m-badge-red block mt-1">Đang ẩn ở CN này</span>
                                            ) : null;
                                        })()}
                                    </td>
                                    <td style={{ color: 'var(--m-ink-soft)' }}>{product.category?.name || 'Chưa phân loại'}</td>
                                    <td className="font-semibold m-num">{fmtPrice(product.base_price)} ₫</td>
                                    <td onClick={(e) => e.stopPropagation()} title={product.is_favorite ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}>
                                        <button onClick={() => toggleFav(product)}
                                            style={{ fontSize: 20, color: product.is_favorite ? '#e11d48' : '#d1d5db', cursor: 'pointer', background: 'none', border: 'none', padding: 4 }}>
                                            {product.is_favorite ? '♥' : '♡'}
                                        </button>
                                    </td>
                                    <td>
                                        <span className={`m-badge ${product.is_active ? 'm-badge-green' : 'm-badge-red'}`}>
                                            {product.is_active ? 'Đang bán' : 'Ngừng bán'}
                                        </span>
                                    </td>
                                    <td className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>
                                        {product.sell_on_pos === 1 && <span className="block">POS</span>}
                                        {product.sell_on_zalo === 1 && <span className="block">Zalo</span>}
                                    </td>
                                    <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                        <button onClick={() => handleEdit(product)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--m-primary)' }}>Sửa</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <div className="m-modal-backdrop" onClick={handleCloseModal}>
                    <div className="m-modal !max-w-3xl" onClick={(e) => e.stopPropagation()}>
                        <div className="m-modal-head">{editingId ? 'Cập nhật mặt hàng' : 'Thêm mặt hàng mới'}</div>
                        {/* Tabs */}
                        <div className="flex gap-1 px-6 pt-3 border-b" style={{ borderColor: 'var(--m-line)' }}>
                            {TABS.map((t) => (
                                <button key={t.id} type="button" onClick={() => setTab(t.id)}
                                    className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors`}
                                    style={tab === t.id
                                        ? { borderColor: 'var(--m-primary)', color: 'var(--m-primary)' }
                                        : { borderColor: 'transparent', color: 'var(--m-ink-soft)' }}>
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <form onSubmit={handleSubmit}>
                        <div className="m-modal-body min-h-[380px]">

                            {/* ===== TAB THÔNG TIN ===== */}
                            {tab === 'info' && (<>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="m-label">Tên mặt hàng *</label>
                                        <input type="text" required value={formData.name} onChange={handleNameChange} className="m-input" placeholder="VD: Cà phê sữa đá" />
                                    </div>
                                    <div>
                                        <label className="m-label">Danh mục</label>
                                        <select value={formData.category_id} onChange={(e) => setFormData({...formData, category_id: e.target.value})} className="m-select">
                                            <option value="">-- Chưa phân loại --</option>
                                            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="m-label">Giá bán cơ bản (VNĐ) *</label>
                                        <input type="number" required min="0" value={formData.base_price} onChange={(e) => setFormData({...formData, base_price: e.target.value})} className="m-input" />
                                        {/* Gói 10c */}
                                        <label className="flex items-start text-sm mt-2 cursor-pointer" style={{ color: 'var(--m-ink)' }}>
                                            <input type="checkbox" checked={!!formData.price_on_demand} onChange={(e) => setFormData({...formData, price_on_demand: e.target.checked})} className="w-4 h-4 mr-2 mt-0.5 accent-[#24305E]" />
                                            <span>Giá nhập khi chọn món <span className="text-xs" style={{color:'var(--m-ink-faint)'}}>— thu ngân bắt buộc nhập giá lúc bán, món ẩn trên Zalo Mini App (VD: Phí dịch vụ)</span></span>
                                        </label>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="m-label">Mô tả</label>
                                        <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className="m-input" rows={2} placeholder="Mô tả ngắn về món…" />
                                    </div>
                                    <div>
                                        <label className="m-label">Màu sắc đại diện</label>
                                        <div className="flex flex-wrap gap-2 items-center">
                                            {COLOR_PRESETS.map((c) => (
                                                <button key={c} type="button" onClick={() => setFormData({...formData, color: c})}
                                                    className="w-8 h-8 rounded-full border-2"
                                                    style={{ background: c, borderColor: formData.color === c ? 'var(--m-ink)' : 'var(--m-line)' }} />
                                            ))}
                                            <input type="color" value={formData.color || '#24305E'} onChange={(e) => setFormData({...formData, color: e.target.value.toUpperCase()})} className="w-8 h-8 p-0 border-0 cursor-pointer" title="Tự chọn" />
                                            {formData.color && <button type="button" onClick={() => setFormData({...formData, color: ''})} className="text-xs underline" style={{color:'var(--m-ink-faint)'}}>Xóa</button>}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="m-label">Ảnh đại diện (URL)</label>
                                        <input type="text" value={formData.image_url} onChange={(e) => setFormData({...formData, image_url: e.target.value})} className="m-input" placeholder="https://…" />
                                    </div>
                                </div>
                                <div className="space-y-3 mt-4">
                                    <label className="flex items-center text-sm" style={{ color: 'var(--m-ink)' }}>
                                        <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({...formData, is_active: e.target.checked})} className="w-4 h-4 mr-2 accent-[#24305E]" />
                                        Kích hoạt bán
                                    </label>
                                    <label className="flex items-center text-sm" style={{ color: 'var(--m-ink)' }}>
                                        <input type="checkbox" checked={formData.sell_on_pos} onChange={(e) => setFormData({...formData, sell_on_pos: e.target.checked})} className="w-4 h-4 mr-2 accent-[#24305E]" />
                                        Hiển thị trên máy POS (Thu ngân)
                                    </label>
                                    <label className="flex items-center text-sm" style={{ color: 'var(--m-ink)' }}>
                                        <input type="checkbox" checked={formData.sell_on_zalo} onChange={(e) => setFormData({...formData, sell_on_zalo: e.target.checked})} className="w-4 h-4 mr-2 accent-[#24305E]" />
                                        Hiển thị trên Zalo Mini App
                                    </label>
                                </div>
                            </>)}

                            {/* ===== TAB GIÁ THEO KÊNH ===== */}
                            {tab === 'prices' && (<>
                                <p className="text-xs mb-3" style={{ color: 'var(--m-ink-soft)' }}>
                                    Tick kênh muốn bán và nhập giá riêng. Kênh không tick = món ẩn trên kênh đó.
                                    Quản lý danh sách kênh tại <b>Kênh bán hàng</b>.
                                </p>
                                {priceLists.length === 0 && <div className="text-sm" style={{color:'var(--m-ink-faint)'}}>Chưa có kênh bán hàng nào.</div>}
                                {priceLists.map((pl) => {
                                    const row = formData.prices.find((x) => x.price_list_id === pl.id) || { price: '', is_active: false };
                                    return (
                                        <div key={pl.id} className="grid items-center gap-3 py-2 border-b" style={{ gridTemplateColumns: 'auto 190px 1fr', borderColor: 'var(--m-line)' }}>
                                            <input type="checkbox" checked={!!row.is_active}
                                                onChange={(e) => setPriceRow(pl.id, { is_active: e.target.checked })}
                                                className="w-4 h-4 accent-[#24305E]" />
                                            <span className="text-sm font-medium truncate" title={pl.name} style={{ color: row.is_active ? 'var(--m-ink)' : 'var(--m-ink-faint)' }}>{pl.name}</span>
                                            <input type="number" min="0" step="500" placeholder="Giá (đ)" disabled={!row.is_active}
                                                value={row.price} onChange={(e) => setPriceRow(pl.id, { price: e.target.value })}
                                                className="m-input" style={!row.is_active ? { opacity: 0.4 } : {}} />
                                        </div>
                                    );
                                })}
                            </>)}

                            {/* ===== TAB ĐỊNH MỨC NL ===== */}
                            {tab === 'bom' && (<>
                                <div className="flex items-center justify-between mb-3">
                                    <p className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>
                                        Định lượng <b>cơ bản</b> (size nhỏ nhất).
                                    </p>
                                    {costPrice !== null && (
                                        <span className="m-badge" style={{ background: 'var(--m-accent-soft)', color: 'var(--m-primary)' }}>
                                            Giá vốn: {Number(costPrice).toLocaleString('vi-VN')} ₫
                                        </span>
                                    )}
                                </div>

                                <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{color:'var(--m-ink)'}}>1. Nguyên liệu cơ bản</div>
                                <BomLines
                                    lines={formData.recipes.filter((l) => (l.kind || 'ingredient') === 'ingredient')}
                                    materials={materials}
                                    onChange={(nl) => setFormData((p) => ({
                                        ...p,
                                        recipes: [...nl.map((l) => ({ ...l, kind: 'ingredient' })), ...p.recipes.filter((l) => (l.kind || 'ingredient') !== 'ingredient')],
                                    }))}
                                />

                                <div className="text-xs font-bold uppercase tracking-wide mt-5 mb-2" style={{color:'var(--m-ink)'}}>2. Bao bì</div>
                                <p className="text-xs mb-2" style={{color:'var(--m-ink-faint)'}}>Bao bì dùng cho món khi bán không qua nhóm size (nếu có).</p>
                                <BomLines
                                    lines={formData.recipes.filter((l) => l.kind === 'packaging')}
                                    materials={materials}
                                    onChange={(nl) => setFormData((p) => ({
                                        ...p,
                                        recipes: [...p.recipes.filter((l) => (l.kind || 'ingredient') !== 'packaging'), ...nl.map((l) => ({ ...l, kind: 'packaging' }))],
                                    }))}
                                />
                            </>)}

                            {/* ===== TAB NHÓM TÙY CHỌN ===== */}
                            {tab === 'groups' && (<>
                                <p className="text-xs mb-3" style={{ color: 'var(--m-ink-soft)' }}>Chọn các nhóm tùy chọn áp dụng cho món này (Size, Topping…).</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {optionGroups.map((g) => (
                                        <label key={g.id} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer"
                                            style={{ borderColor: formData.option_group_ids.includes(g.id) ? 'var(--m-primary)' : 'var(--m-line)', background: formData.option_group_ids.includes(g.id) ? 'var(--m-accent-soft)' : 'var(--m-surface)' }}>
                                            <input type="checkbox" checked={formData.option_group_ids.includes(g.id)}
                                                onChange={() => toggleGroup(g.id)} className="w-4 h-4 accent-[#24305E]" />
                                            <span>
                                                <span className="block text-sm font-semibold" style={{color:'var(--m-ink)'}}>
                                                    {g.name}{' '}
                                                    <span className="m-badge" style={g.quantity_mode === 'per_product'
                                                        ? { background: '#FEF3C7', color: '#92400E', fontSize: 10 }
                                                        : { background: 'var(--m-bg)', color: 'var(--m-ink-faint)', fontSize: 10 }}>
                                                        {g.quantity_mode === 'per_product' ? 'Theo món' : 'Cố định'}
                                                    </span>
                                                </span>
                                                <span className="block text-xs" style={{color:'var(--m-ink-faint)'}}>{g.options?.length || 0} tùy chọn</span>
                                            </span>
                                        </label>
                                    ))}
                                    {optionGroups.length === 0 && <div className="text-sm col-span-2" style={{color:'var(--m-ink-faint)'}}>Chưa có nhóm tùy chọn nào.</div>}
                                </div>

                                {/* Gói 8c: định mức theo món cho nhóm per_product đã tick */}
                                {optionGroups.filter((g) => g.quantity_mode === 'per_product' && formData.option_group_ids.includes(g.id)).map((g) => (
                                    <PerProductGroupConfig
                                        key={g.id}
                                        group={g}
                                        baseMaterials={formData.recipes.filter((l) => l.material_id && (l.kind || 'ingredient') === 'ingredient').map((l) => l.material_id)}
                                        materials={materials}
                                        optionRecipes={formData.option_recipes}
                                        onChange={(nr) => setFormData((p) => ({ ...p, option_recipes: nr }))}
                                    />
                                ))}
                            </>)}

                            {/* ===== TAB THUẾ ===== */}
                            {tab === 'tax' && (<>
                                <p className="text-xs mb-4" style={{ color: 'var(--m-ink-soft)' }}>
                                    Để trống = dùng thuế suất mặc định của hệ thống (cài tại Thiết lập).
                                    Chỉ nhập khi món này có thuế suất riêng.
                                </p>
                                <div className="max-w-xs">
                                    <label className="m-label">Thuế suất riêng của món (%)</label>
                                    <input type="number" min="0" max="100" step="0.5" value={formData.tax_rate}
                                        onChange={(e) => setFormData({...formData, tax_rate: e.target.value})}
                                        className="m-input" placeholder="VD: 8 (để trống = mặc định)" />
                                </div>
                            </>)}
                        </div>
                        <div className="m-modal-foot !justify-between">
                            <div>
                                {editingId && (
                                    <button type="button" onClick={handleDelete} className="m-btn m-btn-sm" style={{ color: 'var(--m-danger)', border: '1px solid var(--m-danger)' }}>
                                        Xóa mặt hàng
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={handleCloseModal} className="m-btn m-btn-ghost">Hủy</button>
                                <button type="submit" disabled={isSubmitting} className="m-btn m-btn-primary" style={isSubmitting ? { opacity: 0.5 } : {}}>
                                    {isSubmitting ? 'Đang lưu...' : 'Lưu mặt hàng'}
                                </button>
                            </div>
                        </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Gói 33: modal đổi danh mục hàng loạt */}
            {bulkModal === 'category' && (
                <div className="m-modal-backdrop" onClick={() => setBulkModal(null)}>
                    <div className="m-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="m-modal-head">Đổi danh mục — {selectedIds.length} mặt hàng</div>
                        <div className="m-modal-body">
                            <label className="m-label">Danh mục mới</label>
                            <select value={bulkCatId} onChange={(e) => setBulkCatId(e.target.value)} className="m-select">
                                <option value="">— Chưa phân loại —</option>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="m-modal-foot">
                            <button onClick={() => setBulkModal(null)} className="m-btn m-btn-ghost">Hủy</button>
                            <button onClick={() => runBulkAction('change_category', { category_id: bulkCatId === '' ? null : Number(bulkCatId) })}
                                className="m-btn m-btn-primary">Áp dụng</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Gói 33: modal bật/tắt kênh bán hàng loạt */}
            {bulkModal === 'channels' && (
                <div className="m-modal-backdrop" onClick={() => setBulkModal(null)}>
                    <div className="m-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="m-modal-head">Bật/tắt kênh bán — {selectedIds.length} mặt hàng</div>
                        <div className="m-modal-body">
                            <p className="text-[12.5px] mb-3" style={{ color: 'var(--m-ink-soft)' }}>
                                Tick kênh muốn BÁN, bỏ tick kênh muốn TẮT. Áp dụng giống nhau cho tất cả món đã chọn.
                            </p>
                            <div className="space-y-2">
                                {[{ code: 'pos', name: 'Máy POS (tại quán)' }, { code: 'zalo', name: 'Zalo Mini App' },
                                  ...priceLists.map((pl) => ({ code: pl.code, name: pl.name }))].map((ch) => (
                                    <label key={ch.code} className="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer"
                                        style={{ borderColor: 'var(--m-line)' }}>
                                        <input type="checkbox" checked={!!bulkChannels[ch.code]}
                                            onChange={(e) => setBulkChannels((s) => ({ ...s, [ch.code]: e.target.checked }))}
                                            className="w-4 h-4 accent-[#24305E]" />
                                        <span className="text-[13.5px] font-medium">{ch.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="m-modal-foot">
                            <button onClick={() => setBulkModal(null)} className="m-btn m-btn-ghost">Hủy</button>
                            <button onClick={() => runBulkAction('set_channels', { channels: bulkChannels })}
                                className="m-btn m-btn-primary">Áp dụng</button>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </AdminLayout>
    );
};

export default Products;
