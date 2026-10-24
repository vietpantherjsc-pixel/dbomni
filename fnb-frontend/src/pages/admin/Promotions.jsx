import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import DateTimeInput from '../../components/DateTimeInput';
import TimeInput from '../../components/TimeInput';
import { fmtDate, fmtDateTime } from '../../utils/format';
import { API } from '../../utils/api';
import { useSharedCategories, labelMap } from '../../utils/sharedCategories'; // Spec danh mục dùng chung
import VoucherManager from './VoucherManager'; // Spec 5 (2026-10-21): tab "Mã voucher" trong trang Khuyến mại

// Gói 50b: backend trả URL tuyệt đối đúng host — dùng trực tiếp, fallback ghép host khi còn relative
const imgSrc = (u) => {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  try { return new URL(API).origin + (u.startsWith('/') ? u : '/' + u); }
  catch { return u; }
};

const TYPE_LABELS_FB = { percent: 'Theo phần trăm', fixed: 'Theo số tiền', fixed_price: 'Đồng giá', gift: 'Tặng món', shipping: '🚚 Giảm/miễn phí vận chuyển' };
const SCOPE_LABELS_FB = { order: 'Hóa đơn', category: 'Danh mục', menu: 'Thực đơn', product: 'Mặt hàng' };
const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// SPEC-02b: giải thích từng trigger + JSON mẫu để quản lý không chuyên tự nhập được.
// suggest_days: số ngày hiệu lực gợi ý khi chọn trigger.
const TRIGGER_HELP = {
    '': {
        label: 'Không (thủ công)',
        desc: 'Khuyến mại thường: tự áp dụng khi đơn đủ điều kiện, không phát coupon vào ví khách.',
        sample: '{}', sample_note: 'Không cần tham số thêm.', suggest_days: 7,
    },
    manual: {
        label: 'Thủ công — khách tự lấy trong ví (CP-04/CP-05/CP-09)',
        desc: 'Coupon nằm trong mục "Ưu đãi" trên Mini App, khách tự bấm lấy. Dùng cho deal giờ vàng, BOGO theo đợt.',
        sample: '{}', sample_note: 'Không cần tham số thêm.', suggest_days: 1,
    },
    first_order: {
        label: 'CP-01 · Đơn đầu tiên',
        desc: 'Hệ thống tự tặng coupon cho khách ngay khi họ đặt đơn đầu tiên trên Mini App.',
        sample: '{\n  "max_gift_value": 45000,\n  "gift_product_ids": []\n}',
        sample_note: 'max_gift_value: trị giá tối đa của món quà (đ). gift_product_ids: id các món được chọn làm quà — để [] nếu dùng ô "Món tặng" bên dưới.',
        suggest_days: 7,
    },
    referral: {
        label: 'CP-02 · Giới thiệu bạn',
        desc: 'Khi bạn mới đặt đơn đầu tiên, cả người giới thiệu và bạn mới đều được tặng coupon.',
        sample: '{\n  "referral_min_order": 50000\n}',
        sample_note: 'referral_min_order: đơn đầu của bạn mới phải từ số tiền này trở lên thì cả hai mới được thưởng (đ).',
        suggest_days: 30,
    },
    stamp: {
        label: 'CP-03 · Tích tem',
        desc: 'Khách tích đủ số tem sẽ tự nhận coupon đổi quà.',
        sample: '{\n  "stamps_required": 5,\n  "window_days": 30,\n  "min_cups_per_order": 1,\n  "max_gift_value": 45000\n}',
        sample_note: 'stamps_required: số tem cần để đổi quà. window_days: tem chỉ tính trong X ngày gần nhất. min_cups_per_order: mỗi đơn phải có ít nhất X cốc mới được tính tem. max_gift_value: trị giá tối đa của quà (đ).',
        suggest_days: 30,
    },
    inactive: {
        label: 'CP-06 · 14 ngày không đơn ("Nhớ bạn")',
        desc: 'Tự gửi coupon cho khách đã lâu không đặt đơn, kéo khách quay lại quán.',
        sample: '{\n  "inactive_days": 14\n}',
        sample_note: 'inactive_days: số ngày không có đơn thì gửi coupon. Hiệu lực nên để 3 ngày (72 giờ) để tạo cảm giác gấp.',
        suggest_days: 3,
    },
    birthday: {
        label: 'CP-07 · Sinh nhật',
        desc: 'Tự tặng coupon quà sinh nhật cho khách trong tháng sinh nhật.',
        sample: '{\n  "max_gift_value": 55000\n}',
        sample_note: 'max_gift_value: trị giá tối đa của quà sinh nhật (đ).',
        suggest_days: 30,
    },
    new_product: {
        label: 'CP-08 · Món mới',
        desc: 'Tặng coupon dùng thử khi quán ra món mới.',
        sample: '{\n  "new_product_ids": [],\n  "target_category_ids": []\n}',
        sample_note: 'new_product_ids: id các món mới. target_category_ids: id nhóm món được giảm — để [] nếu áp dụng mọi món.',
        suggest_days: 7,
    },
    next_order: {
        label: 'CP-10 · Đơn tiếp theo',
        desc: 'Sau khi khách hoàn tất 1 đơn, tự tặng coupon dùng cho đơn kế tiếp (chỉ Mini App).',
        sample: '{}',
        sample_note: 'Không cần tham số thêm — mức giảm lấy từ ô "Giảm giá (%)" bên dưới.',
        suggest_days: 7,
    },
};

// SPEC-02c (phương án A — form động theo trigger, giấu JSON):
// suy field nhập liệu từ JSON mẫu của từng trigger.
// type: 'number' → ô nhập số; 'products' → checklist món; 'categories' → checklist nhóm món.
const TRIGGER_FIELDS = {
    first_order: [
        { key: 'max_gift_value', type: 'number', label: 'Trị giá tối đa của món quà (đ)', hint: 'Món quà tặng không vượt quá số tiền này.' },
        { key: 'gift_product_ids', type: 'products', label: 'Các món được chọn làm quà', hint: 'Để trống nếu dùng ô "Món tặng" ở bên dưới.' },
    ],
    referral: [
        { key: 'referral_min_order', type: 'number', label: 'Đơn đầu của bạn mới tối thiểu (đ)', hint: 'Đơn đầu từ số này trở lên thì cả người giới thiệu và bạn mới đều được thưởng.' },
    ],
    stamp: [
        { key: 'stamps_required', type: 'number', label: 'Số tem cần để đổi quà', hint: '' },
        { key: 'window_days', type: 'number', label: 'Tem chỉ tính trong X ngày gần nhất', hint: '' },
        { key: 'min_cups_per_order', type: 'number', label: 'Mỗi đơn ít nhất X cốc mới tính tem', hint: '' },
        { key: 'max_gift_value', type: 'number', label: 'Trị giá tối đa của quà (đ)', hint: '' },
    ],
    inactive: [
        { key: 'inactive_days', type: 'number', label: 'Số ngày không có đơn thì gửi coupon', hint: '' },
    ],
    birthday: [
        { key: 'max_gift_value', type: 'number', label: 'Trị giá tối đa của quà sinh nhật (đ)', hint: '' },
    ],
    new_product: [
        { key: 'new_product_ids', type: 'products', label: 'Các món mới', hint: '' },
        { key: 'target_category_ids', type: 'categories', label: 'Nhóm món được giảm', hint: 'Để trống = áp dụng mọi món.' },
    ],
    // '': Không có tham số riêng. 'manual': tham số theo đợt (nhập ở Nâng cao). 'next_order': không cần tham số thêm.
};

// =====================================================================
// Gói 10 (2026-10-05): đồng bộ UI matcha + fix load danh mục/mặt hàng
// (API /categories và /products trả mảng trần, không bọc {data}) +
// thêm phạm vi Thực đơn.
// =====================================================================
export default function Promotions() {
    // Spec danh mục dùng chung: nhãn loại/phạm vi KM đọc từ API, fallback cứng
    const TYPE_LABELS = labelMap(useSharedCategories('promotion_types', []), TYPE_LABELS_FB);
    const SCOPE_LABELS = labelMap(useSharedCategories('promotion_scopes', []), SCOPE_LABELS_FB);
    const [list, setList] = useState([]);
    const [page, setPage] = useState(1);
    const [lastPage, setLastPage] = useState(1);
    const [mode, setMode] = useState('list'); // list | form
    const [editing, setEditing] = useState(null);
    const [categories, setCategories] = useState([]);
    const [menus, setMenus] = useState([]);
    const [products, setProducts] = useState([]);
    const [tiers, setTiers] = useState([]);
    // Spec kênh bán hàng: checklist kênh load từ DB, nhóm theo phân loại
    const [priceLists, setPriceLists] = useState([]);
    const CH_CAT_ORDER = ['store', 'online', 'partner'];
    const CH_CAT_LABELS = { store: 'Tại cửa hàng', online: 'Online', partner: 'Đối tác giao hàng' };

    const emptyForm = () => ({
        name: '', code: '', type: 'percent', value: '', scope: 'order', scope_ids: [],
        min_order_amount: 0, max_discount_amount: '', gift_product_id: '', gift_quantity: 1,
        target: 'all', tier_ids: [], starts_at: '', expires_at: '', has_expires: false,
        days_of_week: [], use_days: false, time_from: '', time_to: '', use_time: false,
        channels: [], is_active: true, banner_url: '', // Spec kênh bán hàng: [] = mọi kênh (mặc định nhóm store khi tạo mới)
        // Mô hình cộng dồn 2026-10-21 ~22:45: phía KM chỉ 1 cờ — cộng dồn với coupon (mặc định TẮT)
        stack_with_coupon: false,
        // SPEC-02: cấu hình trigger tự động (JSON)
        auto_trigger: '', auto_valid_days: 7, auto_max_per_customer: 1,
        auto_extra: '{}',
    });
    const [form, setForm] = useState(emptyForm());
    // SPEC-02b: lỗi validate hiển thị ngay dưới từng trường (thay vì alert chung chung)
    const [errs, setErrs] = useState({});
    const FE = ({ k }) => errs[k]
        ? <div className="text-[12px] mt-1 font-medium" style={{ color: 'var(--m-danger)' }}>⚠ {errs[k]}</div>
        : null;
    const errStyle = (k) => errs[k] ? { borderColor: 'var(--m-danger)' } : {};
    // SPEC-02c: form động theo trigger — nguồn sự thật là form.auto_extra (chuỗi JSON);
    // lastValidExtra giữ object parse OK gần nhất để field không crash khi JSON đang sai.
    const [showAdv, setShowAdv] = useState(false);

    // Spec 5 (2026-10-21): 2 tab — Chương trình khuyến mại | Mã voucher (deep-link ?tab=voucher)
    const [tab, setTab] = useState(() => {
        try {
            return new URLSearchParams(window.location.search).get('tab') === 'voucher' ? 'voucher' : 'promo';
        } catch { return 'promo'; }
    });
    const switchTab = (t) => {
        setTab(t);
        try {
            const u = new URL(window.location.href);
            if (t === 'voucher') u.searchParams.set('tab', 'voucher');
            else u.searchParams.delete('tab');
            window.history.replaceState(null, '', u.toString());
        } catch { /* bỏ qua */ }
    };
    const lastValidExtra = useRef({});
    const parseExtra = (str) => { try { const o = JSON.parse(str || '{}'); return (o && typeof o === 'object') ? o : null; } catch { return null; } };
    const updField = (key, val) => {
        const obj = { ...lastValidExtra.current };
        if (val === '' || val === null || val === undefined) delete obj[key];
        else obj[key] = val;
        lastValidExtra.current = obj;
        setForm((f) => ({ ...f, auto_extra: JSON.stringify(obj, null, 2) }));
        setErrs((e) => { const n = { ...e }; delete n.auto_extra; return n; });
    };
    const applySample = () => {
        const p = parseExtra(TRIGGER_HELP[form.auto_trigger]?.sample || '{}');
        if (!p) return;
        lastValidExtra.current = p;
        setForm((f) => ({ ...f, auto_extra: JSON.stringify(p, null, 2) }));
        setErrs((e) => { const n = { ...e }; delete n.auto_extra; return n; });
    };
    const onExtraChange = (e) => {
        const v = e.target.value;
        setForm((f) => ({ ...f, auto_extra: v }));
        const p = parseExtra(v);
        if (p) {
            lastValidExtra.current = p;
            setErrs((prev) => { const n = { ...prev }; delete n.auto_extra; return n; });
        } else {
            setErrs((prev) => ({ ...prev, auto_extra: 'Chuỗi JSON chưa đúng cú pháp. Sửa lại cho đúng hoặc bấm "Chèn mẫu".' }));
        }
    };

    const fetchList = async (p = 1) => {
        try {
            const res = await axios.get(`${API}/promotions`, { params: { page: p } });
            if (res.data?.success) {
                setList(res.data.data.data || []);
                setPage(res.data.data.current_page || 1);
                setLastPage(res.data.data.last_page || 1);
            }
        } catch (err) { console.error('Lỗi tải KM:', err); }
    };

    // Gói 10: /categories và /products trả MẢNG TRẦN (không bọc {data}) -> xử lý cả 2 dạng
    const asArray = (res) => {
        const d = res.data;
        if (Array.isArray(d)) return d;
        if (Array.isArray(d?.data)) return d.data;
        return [];
    };

    const fetchMeta = async () => {
        try {
            const [cRes, mRes, pRes, tRes, plRes] = await Promise.all([
                axios.get(`${API}/categories`),
                axios.get(`${API}/menus`),
                axios.get(`${API}/products`),
                axios.get(`${API}/membership-tiers`),
                axios.get(`${API}/price-lists`), // Spec kênh bán hàng: checklist kênh từ DB
            ]);
            setCategories(asArray(cRes));
            const mData = mRes.data?.success ? mRes.data.data : mRes.data;
            setMenus(Array.isArray(mData) ? mData : []);
            setProducts(asArray(pRes));
            setTiers(tRes.data?.data || []);
            const plData = plRes.data?.data || plRes.data;
            setPriceLists(Array.isArray(plData) ? plData : []);
        } catch (err) { console.error('Lỗi tải meta:', err); }
    };

    useEffect(() => { fetchList(); fetchMeta(); }, []);

    // Spec kênh bán hàng: chuẩn hóa channels về mảng ID (tương thích mảng code chuỗi cũ: pos/zalo/code kênh)
    const normalizeChannels = (raw) => {
        const out = [];
        for (const c of (raw || [])) {
            if (typeof c === 'number' || /^\d+$/.test(String(c))) { out.push(Number(c)); continue; }
            const lc = String(c).toLowerCase().trim();
            const hit = priceLists.find((pl) => String(pl.code).toLowerCase() === lc);
            if (hit) { out.push(hit.id); continue; }
            if (lc === 'pos') priceLists.filter((pl) => (pl.category || 'partner') === 'store').forEach((pl) => out.push(pl.id));
            else if (lc === 'zalo') {
                const o = priceLists.find((pl) => String(pl.code).toLowerCase() === 'online');
                if (o) out.push(o.id);
            }
        }
        return [...new Set(out)];
    };
    const channelChecked = (id) => normalizeChannels(form.channels).includes(id);
    const toggleChannel = (id) => {
        const cur = normalizeChannels(form.channels);
        setForm({ ...form, channels: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    };
    const toggleChannelGroup = (cat) => {
        const ids = priceLists.filter((pl) => pl.is_active && (pl.category || 'partner') === cat).map((pl) => pl.id);
        const cur = normalizeChannels(form.channels);
        const allIn = ids.length > 0 && ids.every((id) => cur.includes(id));
        setForm({ ...form, channels: allIn ? cur.filter((x) => !ids.includes(x)) : [...new Set([...cur, ...ids])] });
    };
    // Giữ hành vi cũ: tạo mới mặc định tick nhóm "Tại cửa hàng" (trước đây là ['pos'])
    const channelsDefaulted = useRef(false);
    useEffect(() => {
        if (mode === 'form' && !editing && priceLists.length > 0 && !channelsDefaulted.current) {
            channelsDefaulted.current = true;
            const storeIds = priceLists.filter((pl) => pl.is_active && (pl.category || 'partner') === 'store').map((pl) => pl.id);
            setForm((f) => ({ ...f, channels: storeIds }));
        }
    }, [mode, editing, priceLists]);

    const startCreate = () => { setEditing(null); setForm(emptyForm()); setErrs({}); lastValidExtra.current = {}; setShowAdv(false); channelsDefaulted.current = false; setMode('form'); };
    const startEdit = async (id) => {
        try {
            const res = await axios.get(`${API}/promotions/${id}`);
            if (res.data?.success) {
                const p = res.data.data;
                setEditing(id);
                // SPEC-02b: tách auto_config thành trigger + valid_days + max_per_customer + JSON phần còn lại
                const _ac = p.auto_config || {};
                const { trigger: _tr, valid_days: _vd, max_per_customer: _mp, ..._extra } = _ac;
                lastValidExtra.current = _extra; setShowAdv(false); setErrs({});
                setForm({
                    name: p.name, code: p.code || '', type: p.type, value: p.value ?? '', scope: p.scope, scope_ids: p.scope_ids || [],
                    auto_trigger: _tr || '', auto_valid_days: _vd ?? 7, auto_max_per_customer: _mp ?? 1,
                    auto_extra: Object.keys(_extra).length ? JSON.stringify(_extra, null, 2) : '{}',
                    min_order_amount: p.min_order_amount ?? 0, max_discount_amount: p.max_discount_amount ?? '',
                    gift_product_id: p.gift_product_id || '', gift_quantity: p.gift_quantity || 1,
                    target: p.target, tier_ids: p.tier_ids || [],
                    starts_at: p.starts_at ? p.starts_at.slice(0, 16) : '', expires_at: p.expires_at ? p.expires_at.slice(0, 16) : '',
                    has_expires: !!p.expires_at,
                    days_of_week: p.days_of_week || [], use_days: !!(p.days_of_week && p.days_of_week.length),
                    time_from: p.time_from ? p.time_from.slice(0, 5) : '', time_to: p.time_to ? p.time_to.slice(0, 5) : '',
                    use_time: !!(p.time_from && p.time_to),
                    channels: p.channels || [], is_active: !!p.is_active, banner_url: p.banner_url || '',
                    stack_with_coupon: !!p.stack_with_coupon,
                });
                setMode('form');
            }
        } catch (err) { alert('Tải KM thất bại'); }
    };

    const toggleArr = (arr, v) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

    const handleSave = async () => {
        // SPEC-02b: validate inline — gom lỗi theo từng trường, hiện đỏ ngay dưới trường
        const e = {};
        if (!(form.name || '').trim()) e.name = 'Vui lòng nhập tên khuyến mại.';
        if (form.code && form.code.trim().length > 20) e.code = 'Mã coupon tối đa 20 ký tự.';
        if (form.type !== 'gift' && form.type !== 'shipping' && !(Number(form.value) > 0)) e.value = 'Vui lòng nhập giá trị khuyến mại lớn hơn 0.';
        if (form.type === 'gift' && !form.gift_product_id) e.gift_product_id = 'Vui lòng chọn món sẽ tặng cho khách.';
        if (form.type !== 'shipping' && form.scope !== 'order' && form.scope_ids.length === 0) e.scope_ids = `Vui lòng chọn ít nhất 1 ${SCOPE_LABELS[form.scope].toLowerCase()} áp dụng.`;
        if (form.auto_trigger) {
            try { JSON.parse(form.auto_extra || '{}'); }
            catch { e.auto_extra = 'Chuỗi JSON chưa đúng cú pháp. Hãy bấm "Chèn mẫu" để lấy ví dụ đúng rồi sửa số.'; }
        }
        if (Object.keys(e).length) { setErrs(e); return; }
        setErrs({});
        try {
            // SPEC-02: build auto_config từ form
            let autoConfig = null;
            if (form.auto_trigger) {
                autoConfig = {
                    trigger: form.auto_trigger,
                    valid_days: Number(form.auto_valid_days) || 7,
                    max_per_customer: Number(form.auto_max_per_customer) || 1,
                };
                try {
                    const extra = JSON.parse(form.auto_extra || '{}');
                    autoConfig = { ...autoConfig, ...extra };
                } catch { /* bỏ qua JSON lỗi */ }
            }
            const payload = {
                // SPEC-02b: defensive — startEdit cũ từng để form.code undefined gây TypeError "Lưu thất bại" không lý do
                name: (form.name || '').trim(), code: (form.code || '').trim().toUpperCase() || null,
                type: form.type,
                value: form.type === 'gift' ? null : Number(form.value),
                scope: form.type === 'shipping' ? 'order' : form.scope, // Gói 10c: KM ship luôn áp dụng cả hóa đơn
                scope_ids: form.scope === 'order' ? null : form.scope_ids,
                min_order_amount: Number(form.min_order_amount) || 0,
                max_discount_amount: form.max_discount_amount ? Number(form.max_discount_amount) : null,
                gift_product_id: form.type === 'gift' ? Number(form.gift_product_id) : null,
                gift_quantity: Number(form.gift_quantity) || 1,
                target: form.target, tier_ids: form.target === 'tier' ? form.tier_ids : null,
                starts_at: form.starts_at || null,
                expires_at: form.has_expires ? (form.expires_at || null) : null,
                days_of_week: form.use_days ? form.days_of_week : null,
                time_from: form.use_time ? form.time_from : null,
                time_to: form.use_time ? form.time_to : null,
                channels: normalizeChannels(form.channels), is_active: form.is_active, // Spec kênh bán hàng: mảng ID price_lists
                // Mô hình cộng dồn 2026-10-21 ~22:45: cờ cộng dồn với coupon của KM này
                stack_with_coupon: !!form.stack_with_coupon,
                banner_url: form.banner_url || null, // Gói 48: ảnh banner cho Mini App
                auto_config: autoConfig, // SPEC-02
            };
            const res = editing
                ? await axios.patch(`${API}/promotions/${editing}`, payload)
                : await axios.post(`${API}/promotions`, payload);
            // SPEC-02b: 2xx và không bị success:false đánh dấu lỗi = thành công.
            // (trước đây chỉ check res.data.success nên backend trả 200 thiếu field success sẽ lặng lẽ không làm gì)
            if (res.data?.success === false) {
                alert(res.data?.message || 'Máy chủ từ chối lưu. Vui lòng kiểm tra lại các trường.');
            } else {
                setMode('list'); fetchList(page);
            }
        } catch (err) {
            // SPEC-02b: hiện lỗi THẬT — validation 422 -> inline từng trường; message server -> alert nguyên văn;
            // không bao giờ hiện "Lưu thất bại" chung chung mà không có thông tin.
            const bag = err.response?.data?.errors;
            if (bag && typeof bag === 'object' && Object.keys(bag).length) {
                const mapped = {};
                for (const [k, v] of Object.entries(bag)) mapped[k] = Array.isArray(v) ? v[0] : String(v);
                setErrs(mapped);
            } else if (err.response?.data?.message) {
                alert(err.response.data.message);
            } else if (err.response) {
                console.error('Lưu KM lỗi HTTP:', err.response);
                alert(`Máy chủ báo lỗi (mã ${err.response.status}) nhưng không kèm lý do. Hãy chụp màn hình thẻ Console (F12) gửi kỹ thuật.`);
            } else {
                console.error('Lưu KM lỗi:', err);
                alert('Không gửi được yêu cầu lưu (lỗi trình duyệt hoặc mất kết nối máy chủ). Kiểm tra backend có đang chạy không rồi thử lại.');
            }
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Xóa khuyến mại này?')) return;
        await axios.delete(`${API}/promotions/${id}`);
        fetchList(page);
    };

    const toggleActive = async (p) => {
        await axios.patch(`${API}/promotions/${p.id}`, { is_active: !p.is_active });
        fetchList(page);
    };

    const valueLabel = () => {
        switch (form.type) {
            case 'percent': return 'Giảm giá (%)';
            case 'fixed': return 'Giảm giá (đ)';
            case 'fixed_price': return 'Giá đồng giá (đ)';
            case 'shipping': return 'Số tiền giảm phí ship (để 0 = miễn phí hoàn toàn)';
            default: return '';
        }
    };

    const summaryText = () => {
        if (form.type === 'percent') return `${form.value || 0}%`;
        if (form.type === 'fixed') return `${Number(form.value || 0).toLocaleString('vi-VN')}đ`;
        if (form.type === 'fixed_price') return `Đồng giá ${Number(form.value || 0).toLocaleString('vi-VN')}đ`;
        if (form.type === 'shipping') return Number(form.value) > 0 ? `Giảm ${Number(form.value).toLocaleString('vi-VN')}đ phí ship` : 'Miễn phí vận chuyển';
        const gp = products.find((p) => p.id === Number(form.gift_product_id));
        return `Tặng ${form.gift_quantity} × ${gp?.name || '...'}`;
    };

    const scopeItems = () => {
        if (form.scope === 'category') return categories;
        if (form.scope === 'menu') return menus;
        if (form.scope === 'product') return products;
        return [];
    };

    const Switch = ({ on, onClick }) => (
        <button type="button" onClick={onClick}
            style={{ width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: on ? 'var(--m-primary)' : '#d1d5db', transition: 'background .2s' }}>
            <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
        </button>
    );

    // ================= FORM =================
    if (mode === 'form') {
        return (
            <AdminLayout>
                <div className="p-6 max-w-[1200px] mx-auto">
                    <button onClick={() => setMode('list')} className="text-xs font-semibold hover:underline mb-2" style={{ color: 'var(--m-ink-soft)' }}>‹ Quay lại danh sách khuyến mại</button>
                    <h1 className="text-xl font-bold mb-4" style={{ color: 'var(--m-ink)' }}>{editing ? 'Sửa khuyến mại' : 'Thêm mới khuyến mại'}</h1>

                    <div className="grid lg:grid-cols-3 gap-4 items-start">
                        <div className="lg:col-span-2 space-y-4">
                            <div className="m-card p-4">
                                <label className="m-label">Tên khuyến mại <span style={{ color: 'var(--m-danger)' }}>*</span></label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="Nhập tên khuyến mại" className="m-input w-full" style={errStyle('name')} />
                                <FE k="name" />
                            </div>

                            {/* SPEC-02: mã coupon + cấu hình trigger tự động */}
                            {/* SPEC-02b: thêm hướng dẫn từng trường + gợi ý JSON mẫu theo trigger */}
                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--m-ink-soft)' }}>Mã coupon & Trigger tự động (SPEC-02)</h3>
                                <div className="text-[12px] mb-3" style={{ color: 'var(--m-ink-faint)' }}>
                                    Phần này chỉ cần điền khi muốn hệ thống <b>tự phát coupon vào ví khách</b>. Khuyến mại thường (tự áp dụng khi đơn đủ điều kiện) thì bỏ qua.
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="m-label">Mã coupon (CP-01...CP-10)</label>
                                        <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                                            placeholder="VD: CP-01" className="m-input w-full" maxLength={20} style={errStyle('code')} />
                                        <FE k="code" />
                                        <div className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--m-ink-faint)' }}>
                                            Mã để hệ thống tự phát coupon, đặt theo chuẩn <b>CP-01 → CP-10</b>:
                                            CP-01 quà chào mừng đơn đầu · CP-02 giới thiệu bạn bè · CP-03 tích tem đổi quà ·
                                            CP-06 gọi khách 14 ngày không quay lại · CP-07 quà sinh nhật · CP-08 thử món mới ·
                                            CP-10 ưu đãi đơn tiếp theo. Mỗi mã chỉ dùng 1 lần — nhập trùng sẽ báo lỗi.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="m-label">Trigger tự động</label>
                                        <select value={form.auto_trigger}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                const sug = TRIGGER_HELP[v]?.suggest_days;
                                                setForm({ ...form, auto_trigger: v, ...(sug ? { auto_valid_days: sug } : {}) });
                                            }}
                                            className="m-input w-full">
                                            {Object.entries(TRIGGER_HELP).map(([k, h]) => <option key={k} value={k}>{h.label}</option>)}
                                        </select>
                                        <div className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--m-ink-faint)' }}>
                                            Khi nào hệ thống tự phát coupon này. Chọn 1 dòng ở trên sẽ hiện giải thích chi tiết bên dưới.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="m-label">Hiệu lực (ngày)</label>
                                        <input type="number" value={form.auto_valid_days} onChange={(e) => setForm({ ...form, auto_valid_days: e.target.value })}
                                            className="m-input w-full" min={1} />
                                        <div className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--m-ink-faint)' }}>
                                            Coupon tự hết hạn sau X ngày kể từ lúc vào ví khách. VD: 7 = dùng trong 1 tuần; CP-06 nên để 3 (72 giờ).
                                        </div>
                                    </div>
                                    <div>
                                        <label className="m-label">Tối đa /khách</label>
                                        <input type="number" value={form.auto_max_per_customer} onChange={(e) => setForm({ ...form, auto_max_per_customer: e.target.value })}
                                            className="m-input w-full" min={1} />
                                        <div className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--m-ink-faint)' }}>
                                            Mỗi khách được nhận tối đa X lần coupon này. VD: 1 = mỗi khách chỉ được 1 lần duy nhất.
                                        </div>
                                    </div>
                                </div>
                                {form.auto_trigger && TRIGGER_HELP[form.auto_trigger] && (
                                    <div className="mt-3 rounded-lg p-3 text-[12px] leading-relaxed" style={{ background: 'var(--m-bg-soft)', border: '1px solid var(--m-line)' }}>
                                        <div className="font-semibold mb-1">📌 {TRIGGER_HELP[form.auto_trigger].label}</div>
                                        <div style={{ color: 'var(--m-ink-soft)' }}>{TRIGGER_HELP[form.auto_trigger].desc}</div>
                                        <div className="mt-1" style={{ color: 'var(--m-ink-soft)' }}>{TRIGGER_HELP[form.auto_trigger].sample_note}</div>
                                    </div>
                                )}
                                {/* SPEC-02c: form động theo trigger — không cần đụng JSON */}
                                {form.auto_trigger && (TRIGGER_FIELDS[form.auto_trigger] || []).length > 0 && (
                                    <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--m-bg-soft)', border: '1px solid var(--m-line)' }}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[12px] font-semibold">Thông số cho trigger này</span>
                                            <button type="button" className="m-btn m-btn-sm" onClick={applySample}>📋 Chèn mẫu</button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {TRIGGER_FIELDS[form.auto_trigger].map((f) => (
                                                <div key={f.key} className={f.type === 'number' ? '' : 'col-span-2'}>
                                                    <label className="m-label">{f.label}</label>
                                                    {f.type === 'number' ? (
                                                        <input type="number" min="0" className="m-input w-full"
                                                            value={lastValidExtra.current[f.key] ?? ''}
                                                            onChange={(e) => updField(f.key, e.target.value === '' ? '' : Number(e.target.value))} />
                                                    ) : (
                                                        <div className="max-h-36 overflow-y-auto rounded p-2 bg-white" style={{ border: '1px solid var(--m-line)' }}>
                                                            {(f.type === 'products' ? products : categories).map((it) => {
                                                                const arr = lastValidExtra.current[f.key] || [];
                                                                const checked = arr.includes(it.id);
                                                                return (
                                                                    <label key={it.id} className="flex items-center gap-2 text-sm py-1">
                                                                        <input type="checkbox" checked={checked}
                                                                            onChange={() => updField(f.key, checked ? arr.filter((x) => x !== it.id) : [...arr, it.id])} />
                                                                        {it.name}
                                                                    </label>
                                                                );
                                                            })}
                                                            {(f.type === 'products' ? products : categories).length === 0 &&
                                                                <div className="text-xs py-2" style={{ color: 'var(--m-ink-faint)' }}>Chưa có dữ liệu.</div>}
                                                        </div>
                                                    )}
                                                    {f.hint && <div className="text-[11px] mt-1" style={{ color: 'var(--m-ink-faint)' }}>{f.hint}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {/* SPEC-02c: JSON thu gọn — chỉ người rành mở; đồng bộ 2 chiều với các ô trên */}
                                <div className="mt-3">
                                    <button type="button" onClick={() => setShowAdv((v) => !v)}
                                        className="text-[12px] font-semibold flex items-center gap-1" style={{ color: 'var(--m-ink-soft)' }}>
                                        <span>{showAdv ? '▾' : '▸'}</span> Nâng cao (JSON)
                                        <span className="font-normal" style={{ color: 'var(--m-ink-faint)' }}>— chỉ dành cho người rành kỹ thuật</span>
                                    </button>
                                    {showAdv && (
                                        <div className="mt-2">
                                            <textarea value={form.auto_extra} onChange={onExtraChange}
                                                className="m-input w-full font-mono text-[12px] mt-1" rows={4}
                                                placeholder='{"stamps_required": 5}' style={errStyle('auto_extra')} />
                                            <FE k="auto_extra" />
                                            <div className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--m-ink-faint)' }}>
                                                JSON là cách ghi tham số cho máy đọc, dạng <span className="font-mono">{'{"tên_tham_số": giá_trị}'}</span>.
                                                Sửa ở đây sẽ tự cập nhật các ô bên trên (và ngược lại).
                                                Mọi mức giảm/ngưỡng đều chỉnh ở đây, không có số nào bị ghi cứng trong code.
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Gói 48: ảnh banner cho Zalo Mini App */}
                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Ảnh banner (Zalo Mini App)</h3>
                                {form.banner_url && (
                                    <img src={imgSrc(form.banner_url)} alt="Banner" className="w-full rounded-lg mb-3" style={{ aspectRatio: '32/9', objectFit: 'cover', objectPosition: 'center' }} />
                                )}
                                <div className="flex items-center gap-3">
                                    <label className="m-btn m-btn-sm cursor-pointer">
                                        📤 Tải ảnh lên
                                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                if (file.size > 1024 * 1024) return alert('File tối đa 1MB.');
                                                const fd = new FormData();
                                                fd.append('image', file);
                                                try {
                                                    const res = await axios.post(`${API}/uploads/promo-banner`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                                                    const url = res.data?.data?.url;
                                                    if (url) setForm({ ...form, banner_url: url });
                                                } catch (err) { alert('Tải ảnh thất bại'); }
                                            }} />
                                    </label>
                                    {form.banner_url && (
                                        <button type="button" onClick={() => setForm({ ...form, banner_url: '' })} className="text-[13px] text-red-600 hover:underline">Xóa ảnh</button>
                                    )}
                                    <span className="text-[11px]" style={{ color: 'var(--m-ink-faint)' }}>Tỉ lệ 32:9 (VD 1600×450), jpg/png/webp ≤ 1MB. Hiện trong mục Thành viên trên Mini App. Ảnh lệch tỉ lệ sẽ tự cắt phần trên/dưới, lấy giữa ảnh — đặt nội dung chính ở giữa khung.</span>
                                </div>
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Tùy chọn khuyến mại</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="m-label">Loại khuyến mại</label>
                                        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="m-input m-select w-full">
                                            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                        </select>
                                    </div>
                                    {form.type !== 'gift' ? (
                                        <div>
                                            <label className="m-label">{valueLabel()} <span style={{ color: 'var(--m-danger)' }}>*</span></label>
                                            <input type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                                                placeholder={form.type === 'percent' ? '0 %' : '0 đ'} className="m-input w-full" style={errStyle('value')} />
                                            <FE k="value" />
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="m-label">Món tặng <span style={{ color: 'var(--m-danger)' }}>*</span></label>
                                                <select value={form.gift_product_id} onChange={(e) => setForm({ ...form, gift_product_id: e.target.value })} className="m-input m-select w-full" style={errStyle('gift_product_id')}>
                                                    <option value="">-- Chọn món --</option>
                                                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                </select>
                                                <FE k="gift_product_id" />
                                            </div>
                                            <div>
                                                <label className="m-label">Số lượng tặng</label>
                                                <input type="number" min="1" value={form.gift_quantity} onChange={(e) => setForm({ ...form, gift_quantity: e.target.value })} className="m-input w-full" />
                                            </div>
                                        </>
                                    )}
                                </div>
                                {form.type === 'percent' && (
                                    <div className="grid grid-cols-2 gap-4 mt-3">
                                        <div>
                                            <label className="m-label">Giảm giá tối đa (đ)</label>
                                            <input type="number" min="0" value={form.max_discount_amount} onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value })}
                                                placeholder="Không giới hạn" className="m-input w-full" />
                                        </div>
                                        <div>
                                            <label className="m-label">Đơn tối thiểu (đ)</label>
                                            <input type="number" min="0" value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} className="m-input w-full" />
                                        </div>
                                    </div>
                                )}
                                {(form.type === 'fixed' || form.type === 'fixed_price' || form.type === 'shipping') && (
                                    <div className="mt-3 w-1/2 pr-2">
                                        <label className="m-label">Tổng tiền hóa đơn tối thiểu (đ)</label>
                                        <input type="number" min="0" value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} className="m-input w-full" placeholder="VD: 100000" />
                                        <div className="text-[11.5px] mt-1" style={{ color: 'var(--m-ink-faint)' }}>Không bắt buộc — để 0 nghĩa là không yêu cầu đơn tối thiểu.</div>
                                    </div>
                                )}
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Thời gian áp dụng</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="m-label">Ngày bắt đầu</label>
                                        <DateTimeInput value={form.starts_at} onChange={(v) => setForm({ ...form, starts_at: v })} className="m-input w-full" /></div>
                                    <div>
                                        <label className="m-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <input type="checkbox" checked={form.has_expires} onChange={(e) => setForm({ ...form, has_expires: e.target.checked })} />
                                            Thời gian kết thúc
                                        </label>
                                        {form.has_expires ? (
                                            <DateTimeInput value={form.expires_at} onChange={(v) => setForm({ ...form, expires_at: v })} className="m-input w-full" />
                                        ) : (
                                            <div className="text-xs py-2" style={{ color: 'var(--m-ink-faint)' }}>Không giới hạn</div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid var(--m-line)' }}>
                                    <span className="text-sm">Áp dụng theo thứ trong tuần</span>
                                    <Switch on={form.use_days} onClick={() => setForm({ ...form, use_days: !form.use_days })} />
                                </div>
                                {form.use_days && (
                                    <div className="flex gap-2 mt-2">
                                        {DAYS.map((d, i) => (
                                            <button key={i} type="button" onClick={() => setForm({ ...form, days_of_week: toggleArr(form.days_of_week, i) })}
                                                className="m-btn m-btn-sm"
                                                style={form.days_of_week.includes(i)
                                                    ? { background: 'var(--m-primary)', color: '#fff', borderColor: 'var(--m-primary)' }
                                                    : {}}>
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--m-line)' }}>
                                    <span className="text-sm">Áp dụng theo khung giờ</span>
                                    <Switch on={form.use_time} onClick={() => setForm({ ...form, use_time: !form.use_time })} />
                                </div>
                                {form.use_time && (
                                    <div className="grid grid-cols-2 gap-4 mt-2">
                                        <div><label className="m-label">Từ</label>
                                            <TimeInput value={form.time_from} onChange={(v) => setForm({ ...form, time_from: v })} className="m-input w-full" /></div>
                                        <div><label className="m-label">Đến</label>
                                            <TimeInput value={form.time_to} onChange={(v) => setForm({ ...form, time_to: v })} className="m-input w-full" /></div>
                                    </div>
                                )}
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Áp dụng với</h3>
                                {form.type === 'shipping' ? (
                                    <div className="text-sm" style={{ color: 'var(--m-ink-soft)' }}>🚚 KM phí vận chuyển luôn áp dụng cho <b>cả hóa đơn</b> (không chọn phạm vi).</div>
                                ) : (
                                <div className="space-y-2">
                                    {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                                        <label key={k} className="flex items-center gap-2 text-sm">
                                            <input type="radio" checked={form.scope === k} onChange={() => setForm({ ...form, scope: k, scope_ids: [] })} />
                                            {v}
                                        </label>
                                    ))}
                                </div>
                                )}
                                {form.scope !== 'order' && (
                                    <>
                                    <div className="mt-3 max-h-44 overflow-y-auto rounded p-2" style={{ border: '1px solid var(--m-line)', ...(errs.scope_ids ? { borderColor: 'var(--m-danger)' } : {}) }}>
                                        <div className="text-[11.5px] mb-1" style={{ color: 'var(--m-ink-faint)' }}>Bắt buộc chọn ít nhất 1 mục <span style={{ color: 'var(--m-danger)' }}>*</span></div>
                                        {scopeItems().map((it) => (
                                            <label key={it.id} className="flex items-center gap-2 text-sm py-1">
                                                <input type="checkbox" checked={form.scope_ids.includes(it.id)} onChange={() => setForm({ ...form, scope_ids: toggleArr(form.scope_ids, it.id) })} />
                                                {it.name}
                                            </label>
                                        ))}
                                        {scopeItems().length === 0 && <div className="text-xs py-2" style={{ color: 'var(--m-ink-faint)' }}>Chưa có dữ liệu.</div>}
                                    </div>
                                    <FE k="scope_ids" />
                                    </>
                                )}
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: 'var(--m-ink-soft)' }}>Đối tượng áp dụng</h3>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="radio" checked={form.target === 'all'} onChange={() => setForm({ ...form, target: 'all' })} />
                                        Tất cả khách hàng
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="radio" checked={form.target === 'tier'} onChange={() => setForm({ ...form, target: 'tier' })} />
                                        Thẻ thành viên
                                    </label>
                                </div>
                                {form.target === 'tier' && (
                                    <div className="mt-3 rounded p-2" style={{ border: '1px solid var(--m-line)' }}>
                                        {tiers.map((t) => (
                                            <label key={t.id} className="flex items-center gap-2 text-sm py-1">
                                                <input type="checkbox" checked={form.tier_ids.includes(t.id)} onChange={() => setForm({ ...form, tier_ids: toggleArr(form.tier_ids, t.id) })} />
                                                {t.name}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="m-card p-4">
                                <h3 className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--m-ink-soft)' }}>Áp dụng với kênh bán hàng</h3>
                                <p className="text-xs mb-3" style={{ color: 'var(--m-ink-faint)' }}>Không tick kênh nào = áp dụng mọi kênh.</p>
                                {CH_CAT_ORDER.map((cat) => {
                                    const group = priceLists.filter((pl) => pl.is_active && (pl.category || 'partner') === cat);
                                    if (group.length === 0) return null;
                                    const ids = group.map((pl) => pl.id);
                                    const allIn = ids.every((id) => channelChecked(id));
                                    return (
                                        <div key={cat} className="mb-3">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-bold uppercase" style={{ color: 'var(--m-ink-soft)' }}>{CH_CAT_LABELS[cat]}</span>
                                                <button type="button" onClick={() => toggleChannelGroup(cat)}
                                                    className="text-xs font-medium" style={{ color: 'var(--m-primary)' }}>
                                                    {allIn ? 'Bỏ chọn cả nhóm' : 'Chọn cả nhóm'}
                                                </button>
                                            </div>
                                            <div className="space-y-1.5">
                                                {group.map((pl) => (
                                                    <label key={pl.id} className="flex items-center gap-2 text-sm">
                                                        <input type="checkbox" checked={channelChecked(pl.id)} onChange={() => toggleChannel(pl.id)} />
                                                        {pl.name}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                {priceLists.length === 0 && <div className="text-sm" style={{ color: 'var(--m-ink-faint)' }}>Đang tải danh sách kênh…</div>}
                            </div>

                            <div className="flex gap-2">
                                <button onClick={handleSave} className="m-btn m-btn-primary">Lưu</button>
                                <button onClick={() => setMode('list')} className="m-btn m-btn-ghost">Hủy</button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="m-card p-4">
                                <h3 className="text-xs mb-3" style={{ color: 'var(--m-ink-soft)' }}>Tổng quan</h3>
                                <div className="rounded-lg p-4 mb-3 text-white" style={{ background: 'linear-gradient(135deg, var(--m-primary), var(--m-primary-deep))' }}>
                                    <div className="text-2xl font-bold">{summaryText()}</div>
                                    <div className="text-xs opacity-80 mt-1">{SCOPE_LABELS[form.scope]} · {TYPE_LABELS[form.type]}</div>
                                </div>
                                <div className="text-xs space-y-1" style={{ color: 'var(--m-ink-soft)' }}>
                                    <div>Bắt đầu<br /><b style={{ color: 'var(--m-ink)' }}>{fmtDateTime(form.starts_at) || '—'}</b></div>
                                    <div>Kết thúc<br /><b style={{ color: 'var(--m-ink)' }}>{(form.has_expires && form.expires_at) ? fmtDateTime(form.expires_at) : '—'}</b></div>
                                    <div className="pt-1">• {form.target === 'all' ? 'Tất cả khách hàng' : 'Thẻ thành viên'}</div>
                                </div>
                            </div>
                            <div className="m-card p-4 flex items-center justify-between">
                                <span className="text-sm">Đang hoạt động</span>
                                <Switch on={form.is_active} onClick={() => setForm({ ...form, is_active: !form.is_active })} />
                            </div>
                            {/* Mô hình cộng dồn 2026-10-21 ~22:45: phía KM đúng 1 cờ cộng dồn.
                                Không còn công tắc toàn cục, không có cộng dồn KM + KM. */}
                            <div className="m-card p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium">Cho phép cộng dồn với coupon</div>
                                        <div className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>Bật: KM này được cộng thêm với 1 coupon/voucher khi mã đó cũng bật "Cho phép cộng dồn với khuyến mãi". Tắt (mặc định): mỗi đơn chỉ áp ưu đãi lớn hơn — hòa thì KM thắng, voucher không bị trừ.</div>
                                    </div>
                                    <Switch on={form.stack_with_coupon} onClick={() => setForm({ ...form, stack_with_coupon: !form.stack_with_coupon })} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </AdminLayout>
        );
    }

    // ================= LIST =================
    return (
        <AdminLayout>
            <div className="p-6 max-w-[1200px] mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-xl font-bold" style={{ color: 'var(--m-ink)' }}>Khuyến mại</h1>
                        <p className="text-sm" style={{ color: 'var(--m-ink-soft)' }}>Tự động áp dụng khi đơn hàng đủ điều kiện.</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--m-ink-faint)' }}>
                            📌 Lưu ý: <b>Voucher</b> (mã giảm giá nhập tay khi thanh toán) có giới hạn lượt dùng <b>theo toàn hệ thống</b>
                            và có thể đặt thêm <b>giới hạn mỗi khách hàng</b>. Mỗi lượt dùng được ghi log theo khách để truy vết khi mã bị share. Hủy đơn sẽ hoàn lại lượt dùng.
                        </p>
                    </div>
                    {tab === 'promo' && (
                        <button onClick={startCreate} className="m-btn m-btn-primary whitespace-nowrap shrink-0">+ Khuyến mại</button>
                    )}
                </div>

                {/* Spec 5: tab Chương trình khuyến mại | Mã voucher (theo tiền lệ trang Báo cáo dùng tab) */}
                <div className="flex gap-1 mb-4" style={{ borderBottom: '2px solid var(--m-line)' }}>
                    <button onClick={() => switchTab('promo')}
                        className="px-4 py-2 text-sm font-semibold"
                        style={{ color: tab === 'promo' ? 'var(--m-primary)' : 'var(--m-ink-soft)', borderBottom: tab === 'promo' ? '2px solid var(--m-primary)' : '2px solid transparent', marginBottom: -2 }}>
                        Chương trình khuyến mại
                    </button>
                    <button onClick={() => switchTab('voucher')}
                        className="px-4 py-2 text-sm font-semibold"
                        style={{ color: tab === 'voucher' ? 'var(--m-primary)' : 'var(--m-ink-soft)', borderBottom: tab === 'voucher' ? '2px solid var(--m-primary)' : '2px solid transparent', marginBottom: -2 }}>
                        Mã voucher
                    </button>
                </div>

                {tab === 'voucher' ? (
                    <VoucherManager />
                ) : (
                <>
                <div className="m-card overflow-x-auto">
                    <table className="m-table min-w-[800px]">
                        <thead>
                            <tr>
                                <th>Tên khuyến mại</th>
                                <th>Loại</th>
                                <th>Phạm vi</th>
                                <th>Giá trị</th>
                                <th>Thời gian</th>
                                <th>Trạng thái</th>
                                <th className="text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((p) => (
                                <tr key={p.id}>
                                    <td className="font-medium">{p.name}</td>
                                    <td><span className="m-badge m-badge-green">{TYPE_LABELS[p.type]}</span></td>
                                    <td><span className="m-badge m-badge-gray">{SCOPE_LABELS[p.scope] || p.scope}</span></td>
                                    <td className="font-semibold m-num">
                                        {p.type === 'percent' ? `${p.value}%` : p.type === 'gift' ? `Tặng ${p.gift_quantity} × ${p.gift_product?.name || ''}` : p.type === 'shipping' ? (Number(p.value) > 0 ? `Giảm ${Number(p.value).toLocaleString('vi-VN')}đ ship` : 'Miễn phí ship') : `${Number(p.value).toLocaleString('vi-VN')}đ`}
                                    </td>
                                    <td className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>
                                        {fmtDate(p.starts_at) || '—'}
                                        {' → '}
                                        {fmtDate(p.expires_at) || 'không giới hạn'}
                                    </td>
                                    <td>
                                        <button onClick={() => toggleActive(p)} title="Bật/tắt" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                            <span className={`m-badge ${p.is_active ? 'm-badge-green' : 'm-badge-red'}`}>
                                                {p.is_active ? 'Đang chạy' : 'Tắt'}
                                            </span>
                                        </button>
                                    </td>
                                    <td className="text-right whitespace-nowrap">
                                        <button onClick={() => startEdit(p.id)} className="text-xs font-semibold hover:underline mr-3" style={{ color: 'var(--m-primary)' }}>Sửa</button>
                                        <button onClick={() => handleDelete(p.id)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--m-danger)' }}>Xóa</button>
                                    </td>
                                </tr>
                            ))}
                            {list.length === 0 && <tr><td colSpan={7} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có khuyến mại nào.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {lastPage > 1 && (
                    <div className="flex justify-center gap-2 mt-4">
                        <button disabled={page <= 1} onClick={() => fetchList(page - 1)} className="m-btn m-btn-sm m-btn-ghost">‹ Trước</button>
                        <span className="text-xs py-2" style={{ color: 'var(--m-ink-soft)' }}>{page} / {lastPage}</span>
                        <button disabled={page >= lastPage} onClick={() => fetchList(page + 1)} className="m-btn m-btn-sm m-btn-ghost">Sau ›</button>
                    </div>
                )}
                </>
                )}
            </div>
        </AdminLayout>
    );
}
