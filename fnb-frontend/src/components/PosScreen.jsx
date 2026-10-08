import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  DollarSign,
  CreditCard,
  Plus,
  Minus,
  Trash2,
  Printer,
  Lock,
  Unlock,
  Search,
  CheckCircle2,
  ArrowLeft,
  X,
  Delete,
  Users,
  Bell,
  LayoutGrid,
  Percent,
  UserPlus,
  QrCode,
  ChefHat,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { printBill, printLabels } from '../utils/print';

// =====================================================================
// Gói 3d (2026-10-04): Redesign POS theo giao diện Sapo (theme tối).
// - Topbar tối: khách hàng, số khách, tìm món (F3), ca làm việc, đơn lưu, thoát.
// - Rail danh mục dọc bên trái, lưới món ở giữa, panel giỏ hàng bên phải.
// - Bàn phím số nhập tiền khách đưa, nút Lưu đơn / Thanh toán.
// - GIỮ NGUYÊN toàn bộ logic Gói 3/3b/3c: loại đơn, bàn, chiết khấu,
//   lưu đơn (held), nạp đơn lưu vào giỏ, tách/gộp ở trang Hóa đơn, in bill/tem.
// =====================================================================

const API_BASE = 'http://localhost/api';

const authHeaders = () => ({
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
});

const ORDER_TYPES = [
  { key: 'takeaway', label: 'Mang đi' },
  { key: 'delivery', label: 'Giao hàng' },
  { key: 'dine_in', label: 'Tại bàn' },
];

const catEmoji = (name) => {
  const n = (name || '');
  // Gói 7g: tên thực đơn đã có sẵn emoji (VD: ❄️ TRÀ NGON MÁT LẠNH 🍊) -> không thêm nữa
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(n)) return '';
  const l = n.toLowerCase();
  if (l.includes('cà phê') || l.includes('cafe')) return '☕';
  if (l.includes('trà sữa')) return '🧋';
  if (l.includes('trà')) return '🍵';
  if (l.includes('ép') || l.includes('sinh tố')) return '🧃';
  if (l.includes('đá xay')) return '🥤';
  if (l.includes('bánh') || l.includes('ăn')) return '🍰';
  if (l.includes('mới')) return '✨';
  return '🍹';
};

export default function PosScreen({ onBackToApp }) {
  const navigate = useNavigate(); // Gói 18: chuyển nhanh sang KDS
  // ---- Ca làm việc ----
  const [shift, setShift] = useState(null);
  const [isOpenShiftModal, setIsOpenShiftModal] = useState(false);
  const [isCloseShiftModal, setIsCloseShiftModal] = useState(false);
  const [isExpenseModal, setIsExpenseModal] = useState(false);
  const [cashierName, setCashierName] = useState('Thu Ngân 01');
  const [openingCash, setOpeningCash] = useState(500000);
  const [closingCashActual, setClosingCashActual] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseReason, setExpenseReason] = useState('');

  // ---- Menu & giỏ ----
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState([]);
  const searchRef = useRef(null);

  // ---- Modal tùy biến món (kiểu Sapo: 3 tabs) ----
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [modalTab, setModalTab] = useState('general'); // general | options | promo
  // Gói 10: chọn tùy chọn theo NHÓM động (Gói 8) — {groupId: optionId | [optionIds]}
  const [selGroups, setSelGroups] = useState({});
  const [customQuantity, setCustomQuantity] = useState(1);
  // Gói 3e: giá bán tùy chỉnh, ghi chú, giảm giá từng món
  const [customPrice, setCustomPrice] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [itemDiscType, setItemDiscType] = useState('none'); // none | percent | amount
  const [itemDiscValue, setItemDiscValue] = useState('');

  // ---- Thanh toán ----
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [receivedCash, setReceivedCash] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastOrderCompleted, setLastOrderCompleted] = useState(null);
  // Gói 11: QR tích điểm — khách quét để gán TV vào đơn
  const [qrClaim, setQrClaim] = useState(null); // {id, code, token, expires_at, member}
  const [qrLoading, setQrLoading] = useState(false);

  // ---- Gói 3: loại đơn, bàn, chiết khấu ----
  const [orderType, setOrderType] = useState('takeaway');
  const [tables, setTables] = useState([]);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [discountType, setDiscountType] = useState('none');
  const [discountValue, setDiscountValue] = useState('');

  // ---- Gói 3b/3c: đơn lưu ----
  const [heldOrders, setHeldOrders] = useState([]);
  const [isHeldDrawerOpen, setIsHeldDrawerOpen] = useState(false);
  const [heldChecked, setHeldChecked] = useState({});
  const [resumingHeldId, setResumingHeldId] = useState(null);
  const [resumingHeldCode, setResumingHeldCode] = useState('');

  // ---- Khách hàng ----
  const [customerName, setCustomerName] = useState('Khách lẻ');
  const [guestCount, setGuestCount] = useState(1);

  // ---- Gói 5: CRM (khách thành viên, điểm, khuyến mại) ----
  const [memberCustomer, setMemberCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAdd, setQuickAdd] = useState({ name: '', phone: '' });
  const [pointsRedeemInput, setPointsRedeemInput] = useState('');
  const [eligiblePromos, setEligiblePromos] = useState([]);
  const [selectedPromoId, setSelectedPromoId] = useState(null);
  const [redeemCfg, setRedeemCfg] = useState({ points: 10, amount: 1000 });

  // ---- Đồng hồ status bar ----
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // ---- Phím tắt F3: focus ô tìm món ----
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      // Gói 3e: trong popup chọn món — Esc đóng, Enter xác nhận
      if (selectedProduct) {
        if (e.key === 'Escape') setSelectedProduct(null);
        else if (e.key === 'Enter' && document.activeElement?.tagName !== 'INPUT') confirmAddToCart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    fetchCurrentShift();
    fetchMenu();
    fetchTables();
    fetchHeldOrders();
    // Gói 5: cấu hình quy đổi điểm
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/membership-tiers`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success && data.redeem_config) setRedeemCfg(data.redeem_config);
      } catch (e) { /* giữ mặc định */ }
    })();
  }, []);

  const fetchCurrentShift = async () => {
    try {
      const res = await fetch(`${API_BASE}/shifts/current`, { headers: authHeaders() });
      const data = await res.json();
      setShift(data.success && data.is_open ? data.data : null);
    } catch (err) { console.error('Lỗi kiểm tra ca:', err); }
  };

  const fetchMenu = async () => {
    try {
      // Gói 7g: hiển thị theo Thực đơn (bảng menus, cột T) thay vì Danh mục
      const res = await fetch(`${API_BASE}/display-menus`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setCategories(data.data);
        // 1 món có thể thuộc nhiều thực đơn -> loại trùng khi tìm kiếm
        const seen = new Set();
        setProducts(data.data.flatMap((cat) => cat.products || []).filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        }));
      }
    } catch (err) { console.error('Lỗi tải menu:', err); }
  };

  const fetchTables = async () => {
    try {
      const res = await fetch(`${API_BASE}/tables?branch_id=1`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setTables(data.data);
    } catch (err) { console.error('Lỗi tải bàn:', err); }
  };

  // Gói 11: QR tích điểm — tạo token, hiện QR cho khách quét
  const openQrClaim = async () => {
    if (!lastOrderCompleted?.id) { alert('Không tìm thấy đơn hàng.'); return; }
    setQrLoading(true);
    try {
      const res = await fetch(`${API_BASE}/orders/${lastOrderCompleted.id}/claim-qr`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Lỗi');
      setQrClaim({ id: lastOrderCompleted.id, code: data.data.code, token: data.data.token, member: null });
    } catch (e) { alert(e.message); }
    finally { setQrLoading(false); }
  };

  // Gói 11: poll đơn trong lúc mở QR — khách quét xong thì hiện thông tin TV
  useEffect(() => {
    if (!qrClaim || qrClaim.member) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/orders/code/${qrClaim.code}`, { headers: authHeaders() });
        const data = await res.json();
        const c = data.data?.customer;
        if (c) {
          setQrClaim((prev) => prev ? { ...prev, member: { name: c.name, member_code: c.member_code, tier: c.tier?.name } } : prev);
          clearInterval(t);
        }
      } catch { /* bỏ qua */ }
    }, 3000);
    return () => clearInterval(t);
  }, [qrClaim?.code, qrClaim?.member]);

  const fetchHeldOrders = async () => {
    try {
      const res = await fetch(`${API_BASE}/orders/held?branch_id=1`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setHeldOrders(data.data);
    } catch (err) { console.error('Lỗi tải đơn lưu:', err); }
  };

  // ================= GÓI 5: CRM =================
  const searchCustomers = async (q) => {
    const query = (q ?? customerSearch).trim();
    if (!query) { setCustomerResults([]); setShowCustomerResults(false); return; }
    try {
      const res = await fetch(`${API_BASE}/customers?search=${encodeURIComponent(query)}&per_page=5`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setCustomerResults(data.data.data || []);
        setShowCustomerResults(true);
      }
    } catch (err) { console.error('Lỗi tìm KH:', err); }
  };

  const selectCustomer = (c) => {
    setMemberCustomer(c);
    setCustomerName(c.name);
    setShowCustomerResults(false);
    setCustomerSearch('');
    setPointsRedeemInput('');
    setSelectedPromoId(null);
  };

  const clearCustomer = () => {
    setMemberCustomer(null);
    setCustomerName('Khách lẻ');
    setPointsRedeemInput('');
    setSelectedPromoId(null);
  };

  const quickAddCustomer = async () => {
    if (!quickAdd.name.trim() || !quickAdd.phone.trim()) return alert('Nhập tên và SĐT');
    try {
      const res = await fetch(`${API_BASE}/customers`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ name: quickAdd.name.trim(), phone: quickAdd.phone.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        selectCustomer(data.data);
        setShowQuickAdd(false);
        setQuickAdd({ name: '', phone: '' });
      } else {
        alert(data.message || 'Thêm KH thất bại');
      }
    } catch (err) { alert('Không thể thêm khách hàng'); }
  };

  // ================= CA LÀM VIỆC =================
  const handleOpenShift = async () => {
    try {
      const res = await fetch(`${API_BASE}/shifts/open`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ cashier_name: cashierName, opening_cash: Number(openingCash) })
      });
      const data = await res.json();
      if (data.success) { setShift(data.data); setIsOpenShiftModal(false); }
      else alert(data.message);
    } catch (err) { alert('Không thể mở ca'); }
  };

  const handleCloseShift = async () => {
    if (!closingCashActual) return alert('Vui lòng nhập số tiền thực đếm trong két');
    try {
      const res = await fetch(`${API_BASE}/shifts/${shift.id}/close`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ closing_cash_actual: Number(closingCashActual) })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Chốt ca thành công! Tiền chênh lệch: ${Number(data.data.difference).toLocaleString('vi-VN')} đ`);
        setShift(null); setIsCloseShiftModal(false);
      }
    } catch (err) { alert('Lỗi chốt ca'); }
  };

  const handleAddExpense = async () => {
    if (!expenseAmount || !expenseReason) return alert('Nhập đủ số tiền và lý do');
    try {
      const res = await fetch(`${API_BASE}/shifts/${shift.id}/expense`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ amount: Number(expenseAmount), reason: expenseReason })
      });
      const data = await res.json();
      if (data.success) {
        setIsExpenseModal(false); setExpenseAmount(''); setExpenseReason('');
        fetchCurrentShift();
      }
    } catch (err) { alert('Lỗi lưu phiếu chi'); }
  };

  // ================= CHỌN MÓN =================
  // Gói 10: đọc NHÓM TÙY CHỌN động (Gói 8) thay vì size/đá/đường cứng.
  // Món có nhóm -> mở popup; món không có nhóm -> thêm thẳng vào giỏ.
  const modalGroups = (selectedProduct?.option_groups || []).filter((g) => g.options && g.options.length);

  const handleSelectProduct = (product) => {
    if (!shift) { alert('Vui lòng Mở Ca trước khi bán hàng'); setIsOpenShiftModal(true); return; }
    const groups = (product.option_groups || []).filter((g) => g.options && g.options.length);
    // Gói 10c: món "giá nhập khi chọn món" luôn mở popup để thu ngân nhập giá (kể cả không có nhóm)
    if (groups.length > 0 || product.price_on_demand) {
      // Nhóm chọn 1 -> chọn sẵn option đầu (giữ tốc độ thao tác POS như cũ)
      const init = {};
      groups.forEach((g) => { init[g.id] = g.type === 'single' ? g.options[0].id : []; });
      setSelGroups(init);
      setSelectedProduct(product);
      setModalTab('general');
      setCustomQuantity(1);
      setCustomPrice(''); setCustomNote(''); setItemDiscType('none'); setItemDiscValue('');
    } else {
      // Gói 10: fix crash "bấm món không có tác vụ" — addItemToCart nhận object
      addItemToCart({ product, groupOpts: [], qty: 1, unitPrice: Number(product.price), itemDiscount: 0, note: null });
    }
  };

  const pickGroupSingle = (gid, oid) => setSelGroups((p) => ({ ...p, [gid]: oid }));
  const toggleGroupMulti = (gid, oid) => setSelGroups((p) => {
    const cur = Array.isArray(p[gid]) ? p[gid] : [];
    return { ...p, [gid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] };
  });

  // Các option đã chọn trong popup (kèm tên nhóm để hiển thị)
  const selectedGroupOpts = () => {
    const out = [];
    modalGroups.forEach((g) => {
      const v = selGroups[g.id];
      const ids = v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]);
      ids.forEach((id) => {
        const o = (g.options || []).find((x) => x.id === id);
        if (o) out.push({ ...o, groupName: g.name });
      });
    });
    return out;
  };

  // Gói 3e: giá đơn vị trong modal = giá tùy chỉnh (nếu nhập) hoặc giá menu + tùy chọn
  // Gói 10: cộng giá các tùy chọn đã chọn trong nhóm
  const calcModalUnitBase = () => {
    if (!selectedProduct) return 0;
    let base = Number(selectedProduct.price);
    base += selectedGroupOpts().reduce((sum, o) => sum + Number(o.additional_price || 0), 0);
    return base;
  };
  const modalUnitPrice = customPrice !== '' && Number(customPrice) >= 0 ? Number(customPrice) : calcModalUnitBase();
  const modalGross = modalUnitPrice * customQuantity;
  const modalItemDisc = itemDiscType === 'percent'
    ? Math.min(modalGross, Math.round(modalGross * (Number(itemDiscValue) || 0) / 100))
    : itemDiscType === 'amount' ? Math.min(modalGross, Number(itemDiscValue) || 0) : 0;
  const modalLineNet = modalGross - modalItemDisc;

  // Gói 10: text tùy chọn gom theo nhóm — "Size: L • Topping: Trân châu, Thạch"
  const buildOptionsText = (groupOpts) => {
    if (!groupOpts || groupOpts.length === 0) return null;
    const byGroup = {};
    groupOpts.forEach((o) => { (byGroup[o.groupName || 'Tùy chọn'] = byGroup[o.groupName || 'Tùy chọn'] || []).push(o.name); });
    return Object.entries(byGroup).map(([g, ns]) => `${g}: ${ns.join(', ')}`).join(' • ');
  };

  const confirmAddToCart = () => {
    // Gói 10c: món "giá nhập khi chọn món" bắt buộc nhập giá > 0 mới cho xác nhận
    if (selectedProduct?.price_on_demand && !(Number(customPrice) > 0)) {
      alert(`Món "${selectedProduct.name}" yêu cầu nhập giá bán trước khi xác nhận.`);
      return;
    }
    addItemToCart({
      product: selectedProduct,
      groupOpts: selectedGroupOpts(),
      qty: customQuantity,
      unitPrice: modalUnitPrice,
      itemDiscount: modalItemDisc,
      note: customNote.trim() || null,
    });
    setSelectedProduct(null);
  };

  const addItemToCart = ({ product, groupOpts = [], qty, unitPrice, itemDiscount = 0, note = null }) => {
    const optionsText = buildOptionsText(groupOpts);
    const optIds = groupOpts.map((o) => o.id).sort((a, b) => a - b);
    const cartItemId = `${product.id}-${optIds.join('-') || 'base'}-${unitPrice}-${itemDiscount}-${note || ''}`;

    setCart((prev) => {
      const idx = prev.findIndex((item) => item.cartItemId === cartItemId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + qty };
        return updated;
      }
      return [...prev, {
        cartItemId,
        product_id: product.id,
        product_option_id: null,
        option_ids: optIds, // Gói 10: gửi tùy chọn nhóm để trừ kho đúng định mức Gói 8
        name: product.name,
        optionsText,
        customNote: note,
        price: unitPrice,
        quantity: qty,
        itemDiscount,
      }];
    });
  };

  const updateQuantity = (cartItemId, delta) => {
    setCart((prev) => prev.map((item) => {
      if (item.cartItemId === cartItemId) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : null;
      }
      return item;
    }).filter(Boolean));
  };

  // ================= TÍNH TIỀN (Gói 3e: trừ chiết khấu từng món trước) =================
  const lineNet = (item) => item.price * item.quantity - (item.itemDiscount || 0);
  const subtotalAmount = cart.reduce((sum, item) => sum + lineNet(item), 0);
  const discountAmount = discountType === 'percent'
    ? Math.min(subtotalAmount, Math.round(subtotalAmount * (Number(discountValue) || 0) / 100))
    : discountType === 'amount' ? Math.min(subtotalAmount, Number(discountValue) || 0) : 0;
  // Gói 5: khuyến mại + đổi điểm
  const selectedPromo = eligiblePromos.find((p) => p.id === selectedPromoId) || null;
  const promoDiscount = selectedPromo ? Math.min(selectedPromo.discount, Math.max(0, subtotalAmount - discountAmount)) : 0;
  const redeemPreview = (() => {
    if (!memberCustomer || !(Number(pointsRedeemInput) > 0)) return { points: 0, discount: 0 };
    const cfgPoints = Math.max(1, Number(redeemCfg.points) || 10);
    const cfgAmount = Math.max(1, Number(redeemCfg.amount) || 1000);
    const usable = Math.min(Number(pointsRedeemInput), memberCustomer.points);
    const steps = Math.floor(usable / cfgPoints);
    const discount = Math.min(steps * cfgAmount, Math.max(0, subtotalAmount - discountAmount - promoDiscount));
    const stepsActual = Math.floor(discount / cfgAmount);
    return { points: stepsActual * cfgPoints, discount };
  })();
  const totalAmount = subtotalAmount - discountAmount - promoDiscount - redeemPreview.discount;
  const changeDue = Math.max(0, (Number(receivedCash) || 0) - totalAmount);

  // Gói 5: tải KM đủ điều kiện khi giỏ hàng / khách hàng thay đổi
  useEffect(() => {
    setSelectedPromoId(null);
    if (cart.length === 0) { setEligiblePromos([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/promotions/eligible`, {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({
            subtotal: subtotalAmount,
            items: cart.map((i) => ({
              product_id: i.product_id,
              category_id: products.find((p) => p.id === i.product_id)?.category_id || null,
              quantity: i.quantity,
              line_total: lineNet(i),
              unit_price: i.price,
            })),
            customer_id: memberCustomer?.id || null,
            channel: 'pos',
          }),
        });
        const data = await res.json();
        if (data.success) setEligiblePromos(data.data || []);
      } catch (e) { /* bỏ qua */ }
    }, 500);
    return () => clearTimeout(t);
  }, [cart, memberCustomer]);

  const buildItemsPayload = () => cart.map((i) => ({
    product_id: i.product_id,
    product_option_id: i.product_option_id,
    option_ids: i.option_ids || [], // Gói 10: tùy chọn nhóm (trừ kho đúng định mức Gói 8)
    quantity: i.quantity,
    unit_price: i.price, // Gói 3e: giá bán có thể tùy chỉnh từ popup
    discount_amount: i.itemDiscount || 0, // Gói 3e: giảm giá từng món
    note: [i.optionsText, i.customNote].filter(Boolean).join(' • ') || null,
  }));

  const buildDiscountPayload = () => ({
    discount_percent: discountType === 'percent' ? Number(discountValue) || 0 : 0,
    discount_amount: discountType === 'amount' ? Number(discountValue) || 0 : 0,
  });

  const resetCartState = () => {
    setCart([]); setReceivedCash('');
    setDiscountType('none'); setDiscountValue('');
    setSelectedTableId('');
    // Gói 5: reset CRM
    setMemberCustomer(null); setCustomerName('Khách lẻ');
    setPointsRedeemInput(''); setSelectedPromoId(null); setEligiblePromos([]);
  };

  // ================= THANH TOÁN =================
  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (paymentMethod === 'cash' && Number(receivedCash) < totalAmount) {
      return alert('Số tiền khách đưa không đủ');
    }
    setIsProcessing(true);
    try {
      const orderPayload = {
        branch_id: 1,
        order_type: orderType,
        table_id: orderType === 'dine_in' && selectedTableId ? Number(selectedTableId) : null,
        customer_id: memberCustomer?.id || null, // Gói 5
        customer_name: customerName.trim() || 'Khách lẻ',
        payment_method: paymentMethod,
        promotion_id: selectedPromoId, // Gói 5
        points_redeem: redeemPreview.points || 0, // Gói 5
        ...buildDiscountPayload(),
        note: guestCount > 1 ? `${guestCount} khách` : null,
        items: buildItemsPayload(),
      };
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(orderPayload),
      });
      const data = await res.json();
      if (data.success || data.data) {
        const completedOrder = {
          id: data.data?.id,
          code: data.data?.code || 'POS-' + Date.now().toString().slice(-4),
          items: [...cart],
          subtotal: subtotalAmount, discount: discountAmount, total: totalAmount,
          method: paymentMethod, order_type: orderType,
          customer_name: customerName.trim() || 'Khách lẻ',
          table_name: orderType === 'dine_in' ? (tables.find(t => t.id === Number(selectedTableId))?.name || '') : '',
          date: new Date().toLocaleTimeString('vi-VN'),
        };
        setLastOrderCompleted(completedOrder);
        resetCartState();
        if (resumingHeldId) {
          try {
            await fetch(`${API_BASE}/orders/${resumingHeldId}/cancel`, {
              method: 'POST', headers: authHeaders(),
              body: JSON.stringify({ reason: 'Đã thanh toán (đơn mới ' + completedOrder.code + ')', restock: false }),
            });
          } catch (e) { console.error('Lỗi hủy đơn lưu cũ:', e); }
          setResumingHeldId(null); setResumingHeldCode('');
          fetchHeldOrders();
        }
        fetchCurrentShift(); fetchTables();
      } else {
        alert(data.message || 'Tạo đơn thất bại, vui lòng thử lại');
      }
    } catch (err) { alert('Không thể tạo đơn POS'); }
    finally { setIsProcessing(false); }
  };

  // ================= LƯU ĐƠN (HELD) =================
  const handleHoldOrder = async () => {
    if (cart.length === 0) return;
    if (orderType === 'dine_in' && !selectedTableId) {
      return alert('Vui lòng chọn bàn trước khi lưu đơn.');
    }
    try {
      const orderPayload = {
        branch_id: 1,
        order_type: orderType,
        table_id: orderType === 'dine_in' && selectedTableId ? Number(selectedTableId) : null,
        customer_id: memberCustomer?.id || null, // Gói 5
        customer_name: customerName.trim() || 'Khách lẻ',
        payment_method: paymentMethod,
        promotion_id: selectedPromoId, // Gói 5
        points_redeem: redeemPreview.points || 0, // Gói 5
        ...buildDiscountPayload(),
        save_as_hold: true,
        note: guestCount > 1 ? `${guestCount} khách` : null,
        items: buildItemsPayload(),
      };
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(orderPayload),
      });
      const data = await res.json();
      if (data.success || data.data) {
        const newHeldId = data.data?.id || null;
        alert(`Đã lưu đơn ${data.data?.code || ''}. Kho chưa trừ — sẽ trừ khi thanh toán.`);
        if (resumingHeldId && newHeldId && newHeldId !== resumingHeldId) {
          try {
            await fetch(`${API_BASE}/orders/${resumingHeldId}/cancel`, {
              method: 'POST', headers: authHeaders(),
              body: JSON.stringify({ reason: 'Lưu đè bằng đơn ' + (data.data?.code || ''), restock: false }),
            });
          } catch (e) { console.error('Lỗi hủy đơn lưu cũ:', e); }
        }
        setResumingHeldId(null); setResumingHeldCode('');
        resetCartState();
        fetchHeldOrders(); fetchTables();
      } else {
        alert(data.message || 'Lưu đơn thất bại');
      }
    } catch (err) { alert('Không thể lưu đơn'); }
  };

  const resumeHeldOrder = (o) => {
    if (cart.length > 0 && !window.confirm(`Giỏ hiện tại có ${cart.length} dòng món. Nạp đơn lưu ${o.code} sẽ THAY THẾ giỏ hiện tại. Tiếp tục?`)) return;
    setCart((o.items || []).map((it) => ({
      cartItemId: `held-${it.id}`,
      product_id: it.product_id,
      product_option_id: it.product_option_id,
      name: it.product_name,
      optionsText: it.note || null,
      customNote: null,
      price: Number(it.unit_price),
      quantity: it.quantity,
      itemDiscount: Number(it.discount_amount) || 0, // Gói 3e
    })));
    setOrderType(o.order_type || 'takeaway');
    setSelectedTableId(o.table_id ? String(o.table_id) : '');
    if (Number(o.discount_amount) > 0) {
      setDiscountType('amount');
      setDiscountValue(String(Math.round(Number(o.discount_amount))));
    } else { setDiscountType('none'); setDiscountValue(''); }
    setCustomerName(o.customer_name || 'Khách lẻ');
    // Gói 5: khôi phục khách thành viên của đơn lưu
    if (o.customer_id) {
      (async () => {
        try {
          const r = await fetch(`${API_BASE}/customers/${o.customer_id}`, { headers: authHeaders() });
          const d = await r.json();
          if (d.success) { setMemberCustomer(d.data); setCustomerName(d.data.name); }
        } catch (e) { /* bỏ qua */ }
      })();
    } else {
      setMemberCustomer(null);
    }
    setPointsRedeemInput(''); setSelectedPromoId(null);
    setResumingHeldId(o.id); setResumingHeldCode(o.code);
    setIsHeldDrawerOpen(false); setReceivedCash('');
  };

  const cancelResuming = () => { setResumingHeldId(null); setResumingHeldCode(''); };

  const cancelHeldOrder = async (o, e) => {
    e.stopPropagation();
    const reason = window.prompt(`Lý do hủy đơn lưu ${o.code}:`, 'Khách đổi ý');
    if (reason === null) return;
    try {
      const res = await fetch(`${API_BASE}/orders/${o.id}/cancel`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ reason: reason || 'Hủy đơn lưu', restock: false }),
      });
      const data = await res.json();
      if (data.success) {
        if (resumingHeldId === o.id) cancelResuming();
        fetchHeldOrders(); fetchTables();
      } else alert(data.message || 'Hủy đơn thất bại');
    } catch (err) { alert('Không thể hủy đơn lưu'); }
  };

  const handleMergeHeld = async () => {
    const ids = Object.keys(heldChecked).filter((k) => heldChecked[k]).map(Number);
    if (ids.length < 2) return alert('Tick chọn ít nhất 2 đơn lưu để gộp.');
    const target = heldOrders.find((o) => o.id === ids[0]);
    if (!window.confirm(`Gộp ${ids.length} đơn lưu vào đơn ${target?.code}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/orders/merge`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ target_order_id: ids[0], order_ids: ids }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message); setHeldChecked({});
        fetchHeldOrders(); fetchTables();
      } else alert(data.message || 'Gộp đơn thất bại');
    } catch (err) { alert('Không thể gộp đơn lưu'); }
  };

  // ================= BÀN PHÍM SỐ (nhập tiền khách đưa) =================
  const keypadInput = (key) => {
    if (paymentMethod !== 'cash') setPaymentMethod('cash');
    if (key === 'clear') setReceivedCash('');
    else if (key === 'back') setReceivedCash((p) => p.slice(0, -1));
    else setReceivedCash((p) => (p + key).slice(0, 12));
  };

  // Gói 10: rail hiện THỰC ĐƠN (Gói 7g) — lọc món theo thực đơn đang chọn.
  // Trước đây so sánh sai menu.id với product.category_id nên thực đơn trống trơn.
  const menuProductMap = useMemo(() => {
    const map = {};
    (categories || []).forEach((m) => { map[m.id] = m.products || []; });
    return map;
  }, [categories]);

  const filteredProducts = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (q) return products.filter((p) => (p.name || '').toLowerCase().includes(q));
    if (activeCategory === 'ALL') return products;
    return menuProductMap[activeCategory] || [];
  }, [products, menuProductMap, activeCategory, searchQuery]);

  const typeLabel = (ORDER_TYPES.find(t => t.key === orderType) || {}).label || '';

  return (
    <div className="flex flex-col h-screen bg-[#151e2e] text-slate-100 font-sans select-none overflow-hidden">
      {/* ============ TOPBAR ============ */}
      <div className="h-14 bg-[#1a2436] border-b border-white/10 flex items-center gap-3 px-3 shrink-0">
        <button onClick={onBackToApp} className="p-2 hover:bg-white/10 rounded-lg text-slate-300" title="Về App">
          <ArrowLeft size={18} />
        </button>
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          className="bg-transparent text-sm font-semibold w-28 focus:outline-none focus:border-b focus:border-emerald-400 placeholder-slate-500"
          placeholder="Tên khách"
        />
        <div className="flex items-center gap-1 text-slate-300 text-xs">
          <Users size={14} />
          <button onClick={() => setGuestCount(Math.max(1, guestCount - 1))} className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 font-bold">−</button>
          <span className="w-12 text-center font-semibold">{guestCount} Khách</span>
          <button onClick={() => setGuestCount(guestCount + 1)} className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 font-bold">+</button>
        </div>

        <div className="flex-1 flex justify-center">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Tìm món (F3)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        <button
          onClick={() => { fetchHeldOrders(); setIsHeldDrawerOpen(true); }}
          className="relative flex items-center gap-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 px-3 py-2 rounded-lg text-xs font-semibold"
        >
          Đơn lưu
          {heldOrders.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {heldOrders.length}
            </span>
          )}
        </button>

        {/* Gói 18: nút chuyển nhanh sang KDS (bếp), không cần thoát ra admin */}
        <button
          onClick={() => navigate('/kds')}
          title="Sang màn hình Bếp (KDS)"
          className="flex items-center gap-1.5 bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 text-orange-300 px-3 py-2 rounded-lg text-xs font-semibold"
        >
          <ChefHat size={14} />
          <span className="hidden sm:inline">KDS</span>
        </button>

        {shift ? (
          <div className="flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/40 px-3 py-1.5 rounded-lg">
            <Unlock size={14} className="text-emerald-400" />
            <span className="text-xs text-emerald-300 font-medium">Ca: {shift.cashier_name}</span>
            <button onClick={() => setIsExpenseModal(true)} className="text-[11px] bg-white/10 px-2 py-1 rounded text-slate-200 hover:bg-white/20">+ Chi</button>
            <button onClick={() => setIsCloseShiftModal(true)} className="text-[11px] bg-red-500/80 px-2 py-1 rounded text-white hover:bg-red-500">Chốt ca</button>
          </div>
        ) : (
          <button onClick={() => setIsOpenShiftModal(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-semibold">
            <Lock size={14} /> Mở ca
          </button>
        )}

        <button className="p-2 hover:bg-white/10 rounded-lg text-slate-400"><LayoutGrid size={18} /></button>
        <button className="p-2 hover:bg-white/10 rounded-lg text-slate-400"><Bell size={18} /></button>
        <button onClick={onBackToApp} className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-semibold text-slate-200">Thoát</button>
      </div>

      {/* ============ THÂN ============ */}
      <div className="flex flex-1 overflow-hidden">
        {/* Rail danh mục */}
        <div className="pos-scroll w-[76px] bg-[#101724] flex flex-col items-stretch py-2 gap-1 overflow-y-auto shrink-0">
          {[{ id: 'ALL', name: 'Tất cả' }, ...categories].map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`flex flex-col items-center gap-1 py-2.5 px-1 text-[10px] font-medium transition ${
                activeCategory === c.id ? 'text-emerald-400 bg-white/5 border-l-2 border-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border-l-2 border-transparent'
              }`}
            >
              <span className="text-xl">{c.id === 'ALL' ? '🧾' : catEmoji(c.name)}</span>
              <span className="leading-tight text-center">{c.name}</span>
            </button>
          ))}
        </div>

        {/* Lưới món */}
        <div className="pos-scroll flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {filteredProducts.map((p) => (
              <div
                key={p.id}
                onClick={() => handleSelectProduct(p)}
                className="bg-[#1e2a3f] border border-white/5 rounded-xl overflow-hidden cursor-pointer hover:border-emerald-400/60 hover:shadow-lg hover:shadow-emerald-500/10 transition-all active:scale-95 flex flex-col"
              >
                <div className="w-full aspect-[4/3] bg-white/5 overflow-hidden relative">
                  <span className="absolute top-1.5 left-1.5 z-10 bg-[#1877f2] text-white text-[11px] font-bold px-2 py-0.5 rounded">
                    {Number(p.price).toLocaleString('vi-VN')}đ
                  </span>
                  {p.image_url
                    ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-4xl">☕</div>}
                </div>
                <div className="p-2.5">
                  <h4 className="font-medium text-xs text-slate-100 line-clamp-2 h-8 leading-snug">{p.name}</h4>
                </div>
              </div>
            ))}
          </div>
          {filteredProducts.length === 0 && (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">Không tìm thấy món nào</div>
          )}
        </div>

        {/* Panel giỏ hàng */}
        <div className="w-[380px] bg-[#1a2436] border-l border-white/10 flex flex-col shrink-0">
          <button
            onClick={() => { resetCartState(); cancelResuming(); }}
            className="m-3 mb-0 py-2.5 bg-[#00b14f] hover:bg-[#00a346] text-white font-bold rounded-lg text-sm shadow"
          >
            + Tạo đơn mới
          </button>

          {/* Loại đơn */}
          <div className="px-3 pt-2">
            <div className="grid grid-cols-3 gap-1 bg-white/5 p-1 rounded-lg">
              {ORDER_TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setOrderType(t.key)}
                  className={`py-1.5 text-xs font-bold rounded-md ${orderType === t.key ? 'bg-[#00b14f] text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {orderType === 'dine_in' && (
              <select
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                className="w-full mt-2 p-2 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-emerald-400 [&>option]:text-slate-900"
              >
                <option value="">-- Chọn bàn --</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} {t.status === 'occupied' ? '(có khách)' : ''}</option>
                ))}
              </select>
            )}
          </div>

          {/* Banner đang sửa đơn lưu */}
          {resumingHeldId && (
            <div className="mx-3 mt-2 px-3 py-2 bg-amber-500/15 border border-amber-500/40 rounded-lg flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-300">Đang sửa đơn lưu <b>{resumingHeldCode}</b></span>
              <button onClick={cancelResuming} className="text-[11px] text-slate-400 hover:text-slate-200 underline">Bỏ</button>
            </div>
          )}

          {/* Danh sách món */}
          <div className="pos-scroll flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-[60px]">
            {cart.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">Chưa chọn món nào</div>
            ) : (
              cart.map((item) => (
                <div key={item.cartItemId} className="bg-white/5 rounded-lg p-2.5 flex justify-between items-center">
                  <div className="flex-1 pr-2 min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">{item.name}</div>
                    {item.optionsText && <div className="text-[11px] text-emerald-400/90">{item.optionsText}</div>}
                    {item.customNote && <div className="text-[11px] text-slate-400 italic">📝 {item.customNote}</div>}
                    <div className="text-xs text-slate-400">
                      {lineNet(item).toLocaleString('vi-VN')} đ
                      {(item.itemDiscount || 0) > 0 && (
                        <span className="text-emerald-400 ml-1">(-{(item.itemDiscount).toLocaleString('vi-VN')})</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => updateQuantity(item.cartItemId, -1)} className="w-7 h-7 rounded bg-white/10 flex items-center justify-center text-slate-300 hover:bg-white/20"><Minus size={13} /></button>
                    <span className="text-xs font-bold w-5 text-center">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.cartItemId, 1)} className="w-7 h-7 rounded bg-white/10 flex items-center justify-center text-slate-300 hover:bg-white/20"><Plus size={13} /></button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Gói 5: Khách hàng thành viên */}
          <div className="px-3 py-2 border-t border-white/10 bg-[#161f30]">
            {!memberCustomer ? (
              <div className="relative">
                <div className="flex gap-1.5">
                  <input
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') searchCustomers(); }}
                    placeholder="SĐT / tên / mã TV / quét QR..."
                    className="flex-1 text-xs p-1.5 rounded bg-white/5 border border-white/10 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-400"
                  />
                  <button onClick={() => searchCustomers()} className="px-2.5 py-1.5 bg-white/10 rounded text-slate-300 hover:bg-white/20" title="Tìm khách hàng"><Search size={13} /></button>
                  <button onClick={() => setShowQuickAdd(!showQuickAdd)} className="px-2.5 py-1.5 bg-white/10 rounded text-slate-300 hover:bg-white/20" title="Thêm KH mới"><UserPlus size={13} /></button>
                </div>
                {showCustomerResults && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-[#1f2b40] border border-white/10 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
                    {customerResults.map((c) => (
                      <button key={c.id} onClick={() => selectCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-white/10 flex justify-between items-center">
                        <span><span className="text-xs font-bold">{c.name}</span> <span className="text-[11px] text-slate-400">{c.phone}</span></span>
                        <span className="text-[11px] text-amber-400 font-bold whitespace-nowrap">{Number(c.points).toLocaleString('vi-VN')} điểm</span>
                      </button>
                    ))}
                    {customerResults.length === 0 && <div className="px-3 py-2 text-[11px] text-slate-500">Không tìm thấy. Bấm + để thêm mới.</div>}
                  </div>
                )}
                {showQuickAdd && (
                  <div className="mt-1.5 p-2 bg-white/5 rounded-lg space-y-1.5">
                    <input value={quickAdd.name} onChange={(e) => setQuickAdd({ ...quickAdd, name: e.target.value })} placeholder="Tên *"
                      className="w-full text-xs p-1.5 rounded bg-white/5 border border-white/10 placeholder-slate-500 focus:outline-none focus:border-emerald-400" />
                    <input value={quickAdd.phone} onChange={(e) => setQuickAdd({ ...quickAdd, phone: e.target.value })} placeholder="SĐT *"
                      className="w-full text-xs p-1.5 rounded bg-white/5 border border-white/10 placeholder-slate-500 focus:outline-none focus:border-emerald-400" />
                    <button onClick={quickAddCustomer} className="w-full py-1.5 bg-[#00b14f] rounded text-xs font-bold hover:bg-emerald-600">Thêm & chọn</button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-emerald-400">{memberCustomer.name}</span>
                    {memberCustomer.tier?.name && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">{memberCustomer.tier.name}</span>}
                  </div>
                  <button onClick={clearCustomer} className="text-slate-500 hover:text-red-400"><X size={14} /></button>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[11px] text-amber-400 font-bold whitespace-nowrap">{Number(memberCustomer.points).toLocaleString('vi-VN')} điểm</span>
                  <input type="text" inputMode="numeric" value={pointsRedeemInput}
                    onChange={(e) => setPointsRedeemInput(e.target.value.replace(/\D/g, ''))}
                    placeholder={`Đổi điểm (${redeemCfg.points}điểm=${Number(redeemCfg.amount).toLocaleString('vi-VN')}đ)`}
                    className="flex-1 text-xs p-1.5 rounded bg-white/5 border border-white/10 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-400" />
                </div>
                {redeemPreview.discount > 0 && (
                  <div className="text-[11px] text-emerald-400 mt-1">Đổi {redeemPreview.points} điểm → −{redeemPreview.discount.toLocaleString('vi-VN')} đ</div>
                )}
              </div>
            )}
          </div>

          {/* Gói 5: Khuyến mại đủ điều kiện */}
          {eligiblePromos.length > 0 && (
            <div className="px-3 py-2 border-t border-white/10 bg-[#161f30]">
              <div className="text-[11px] text-slate-400 font-bold mb-1.5">🎁 Khuyến mại</div>
              <div className="pos-scroll space-y-1 max-h-28 overflow-y-auto">
                {eligiblePromos.map((p) => (
                  <button key={p.id} onClick={() => setSelectedPromoId(selectedPromoId === p.id ? null : p.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg border text-[11px] flex justify-between items-center gap-2 ${selectedPromoId === p.id ? 'border-emerald-400 bg-emerald-500/10' : 'border-white/10 bg-white/5 hover:border-white/25'}`}>
                    <span className="font-medium truncate">{p.name}{p.type === 'gift' && p.gift_product_name ? ` (tặng ${p.gift_quantity}× ${p.gift_product_name})` : ''}</span>
                    <span className="text-emerald-400 font-bold whitespace-nowrap">{p.type === 'gift' ? 'Quà tặng' : `−${p.discount.toLocaleString('vi-VN')}đ`}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tính tiền */}
          <div className="px-3 py-2 border-t border-white/10 space-y-1.5 bg-[#161f30]">
            <div className="flex items-center gap-2">
              <div className="flex bg-white/10 p-0.5 rounded-lg shrink-0">
                {[['none', 'Không'], ['percent', '%'], ['amount', 'đ']].map(([k, label]) => (
                  <button key={k} onClick={() => { setDiscountType(k); setDiscountValue(''); }}
                    className={`px-2 py-1 text-[11px] font-bold rounded-md ${discountType === k ? 'bg-[#00b14f] text-white' : 'text-slate-400'}`}>{label}</button>
                ))}
              </div>
              {discountType !== 'none' && (
                <input type="number" min="0" placeholder={discountType === 'percent' ? 'Nhập % giảm...' : 'Nhập số tiền giảm...'}
                  value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
                  className="flex-1 text-xs p-1.5 rounded bg-white/5 border border-white/10 text-slate-100 focus:outline-none focus:border-emerald-400" />
              )}
              {cart.length > 0 && (
                <button onClick={() => setCart([])} className="text-red-400 text-[11px] flex items-center gap-1 hover:underline shrink-0"><Trash2 size={13} /></button>
              )}
            </div>
            <div className="flex justify-between text-xs text-slate-400"><span>Tạm tính:</span><span>{subtotalAmount.toLocaleString('vi-VN')} đ</span></div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-emerald-400"><span>Chiết khấu:</span><span>-{discountAmount.toLocaleString('vi-VN')} đ</span></div>
            )}
            {promoDiscount > 0 && (
              <div className="flex justify-between text-xs text-emerald-400"><span>Khuyến mại{selectedPromo ? ` (${selectedPromo.name})` : ''}:</span><span>-{promoDiscount.toLocaleString('vi-VN')} đ</span></div>
            )}
            {redeemPreview.discount > 0 && (
              <div className="flex justify-between text-xs text-amber-400"><span>Đổi {redeemPreview.points} điểm:</span><span>-{redeemPreview.discount.toLocaleString('vi-VN')} đ</span></div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold">Tổng tiền {typeLabel ? `(${typeLabel})` : ''}:</span>
              <span className="text-emerald-400 text-xl font-extrabold">{totalAmount.toLocaleString('vi-VN')} đ</span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => setPaymentMethod('cash')}
                className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border ${paymentMethod === 'cash' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white/5 text-slate-300 border-white/10'}`}>
                <DollarSign size={14} /> Tiền mặt
              </button>
              <button onClick={() => setPaymentMethod('transfer')}
                className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border ${paymentMethod === 'transfer' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/5 text-slate-300 border-white/10'}`}>
                <CreditCard size={14} /> Chuyển khoản
              </button>
            </div>

            {paymentMethod === 'cash' && (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <input type="text" inputMode="numeric" placeholder="Tiền khách đưa..."
                    value={receivedCash ? Number(receivedCash).toLocaleString('vi-VN') : ''}
                    onChange={(e) => setReceivedCash(e.target.value.replace(/\D/g, '').slice(0, 12))}
                    className="flex-1 text-sm p-2 rounded bg-white/5 border border-white/10 text-slate-100 font-bold focus:outline-none focus:border-emerald-400" />
                  <button onClick={() => setReceivedCash(String(totalAmount))} className="bg-white/10 hover:bg-white/20 text-xs px-3 rounded font-semibold whitespace-nowrap">Đủ tiền</button>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Tiền thừa trả khách:</span>
                  <span className="text-red-400 font-bold">{changeDue.toLocaleString('vi-VN')} đ</span>
                </div>
                {/* Bàn phím số kiểu Sapo */}
                <div className="grid grid-cols-3 gap-1.5">
                  {['1','2','3','4','5','6','7','8','9','00','0'].map((k) => (
                    <button key={k} onClick={() => keypadInput(k)}
                      className="py-2 bg-white/5 hover:bg-white/15 rounded-lg text-sm font-bold text-slate-100 border border-white/5">{k}</button>
                  ))}
                  <button onClick={() => keypadInput('clear')} className="py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs font-bold text-red-300 border border-red-500/30">Xóa</button>
                  <button onClick={() => keypadInput('back')} className="py-2 bg-white/5 hover:bg-white/15 rounded-lg text-slate-200 border border-white/5 flex items-center justify-center"><Delete size={16} /></button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1 pb-1">
              <button onClick={handleHoldOrder} disabled={cart.length === 0 || isProcessing}
                className="py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white font-bold rounded-lg text-sm">
                Lưu đơn
              </button>
              <button onClick={handleCheckout} disabled={cart.length === 0 || isProcessing}
                className="py-3 bg-[#00b14f] hover:bg-[#00a346] disabled:opacity-40 text-white font-bold rounded-lg text-sm shadow">
                {isProcessing ? 'Đang xử lý...' : 'Thanh toán'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============ STATUS BAR ============ */}
      <div className="h-8 bg-[#101724] border-t border-white/10 flex items-center justify-between px-4 text-[11px] text-slate-500 shrink-0">
        <div className="flex gap-4">
          <span>Chi nhánh: <b className="text-slate-300">CN-Q1</b></span>
          <span>Thu ngân: <b className="text-slate-300">{shift?.cashier_name || '—'}</b></span>
        </div>
        <div className="flex gap-4">
          <span>{now.toLocaleDateString('vi-VN')} {now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
          <span>POS v3.0</span>
        </div>
      </div>

      {/* ============ DRAWER ĐƠN LƯU ============ */}
      {isHeldDrawerOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex justify-end" onClick={() => setIsHeldDrawerOpen(false)}>
          <div className="bg-[#1a2436] w-full max-w-sm h-full shadow-2xl flex flex-col border-l border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-bold">Đơn đang lưu ({heldOrders.length})</h3>
              <button onClick={() => setIsHeldDrawerOpen(false)} className="p-1 text-slate-400 hover:text-slate-200"><X size={20} /></button>
            </div>
            <p className="px-4 pt-2 text-[11px] text-slate-500">Bấm vào đơn để nạp vào giỏ chỉnh sửa rồi thanh toán như thường.</p>
            <div className="pos-scroll flex-1 overflow-y-auto p-3 space-y-2">
              {heldOrders.length === 0 ? (
                <p className="text-center text-slate-500 text-xs py-10">Chưa có đơn lưu nào</p>
              ) : (
                heldOrders.map((o) => (
                  <div key={o.id}
                    onClick={() => resumeHeldOrder(o)}
                    className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-2 hover:border-amber-400/60 cursor-pointer">
                    <input type="checkbox" checked={!!heldChecked[o.id]}
                      onChange={() => setHeldChecked((p) => ({ ...p, [o.id]: !p[o.id] }))}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-amber-500 w-4 h-4 shrink-0" title="Tick để gộp đơn" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold">{o.code}</div>
                      <div className="text-[11px] text-slate-400">
                        {o.table?.name ? `Bàn ${o.table.name}` : (o.order_type === 'delivery' ? 'Giao hàng' : 'Mang đi')}
                        {' • '}{(o.items || []).reduce((s, i) => s + i.quantity, 0)} món
                      </div>
                    </div>
                    <div className="text-xs font-bold text-amber-400 whitespace-nowrap">{Number(o.total_amount).toLocaleString('vi-VN')} đ</div>
                    <button onClick={(e) => cancelHeldOrder(o, e)} className="text-slate-500 hover:text-red-400 text-lg leading-none px-1" title="Hủy đơn lưu">×</button>
                  </div>
                ))
              )}
            </div>
            {Object.values(heldChecked).filter(Boolean).length >= 2 && (
              <div className="p-3 border-t border-white/10">
                <button onClick={handleMergeHeld} className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl text-sm">
                  Gộp {Object.values(heldChecked).filter(Boolean).length} đơn lưu
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ MODAL CHỌN MÓN KIỂU SAPO (3 tabs) ============ */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white text-slate-800 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Tiêu đề */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-[15px] text-slate-700">{selectedProduct.name}</h3>
              <button onClick={() => setSelectedProduct(null)} className="text-red-500 hover:text-red-700 text-xl leading-none">×</button>
            </div>

            {/* Tabs */}
            <div className="flex px-6 pt-3 gap-2">
              {[
                ['general', 'Phần chung'],
                ['options', 'Lựa chọn thêm'],
                ['promo', 'Khuyến mại'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setModalTab(key)}
                  className={`flex-1 py-2.5 text-sm border rounded-t-lg transition ${
                    modalTab === key
                      ? 'text-sky-600 border-sky-500 border-b-2 font-medium bg-sky-50/50'
                      : 'text-slate-400 border-slate-200 hover:text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Nội dung tab */}
            <div className="flex-1 overflow-y-auto px-6 py-5 min-h-[320px]">
              {modalTab === 'general' && (
                <div className="space-y-5">
                  {/* Giá bán — Gói 10c: khóa khi món đã có giá; chỉ món "giá nhập khi chọn món" được sửa */}
                  <div>
                    <label className="font-semibold text-[13px] text-slate-600 block mb-1">Giá bán</label>
                    <div className="text-xs text-slate-400 mb-1.5">
                      {selectedProduct?.price_on_demand ? 'Giá nhập khi chọn món' : 'Giá thường'}
                    </div>
                    <input
                      type="number" min="0"
                      value={selectedProduct?.price_on_demand ? customPrice : calcModalUnitBase()}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      disabled={!selectedProduct?.price_on_demand}
                      placeholder={selectedProduct?.price_on_demand ? 'Nhập giá bán…' : String(calcModalUnitBase().toLocaleString('vi-VN'))}
                      className={`w-48 px-4 py-2.5 text-center text-[15px] font-medium border rounded-lg focus:outline-none ${selectedProduct?.price_on_demand ? 'bg-sky-50 border-sky-300 focus:border-sky-500' : 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'}`}
                    />
                    <span className="text-xs text-slate-400 ml-2">đ {selectedProduct?.price_on_demand ? '(bắt buộc nhập)' : '(giá cố định theo menu)'}</span>
                  </div>

                  {/* Số lượng + Ghi chú */}
                  <div className="flex gap-6">
                    <div>
                      <label className="font-semibold text-[13px] text-slate-600 block mb-1.5">Số lượng - Ly</label>
                      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden w-40">
                        <button onClick={() => setCustomQuantity(Math.max(1, customQuantity - 1))}
                          className="w-12 h-11 text-xl text-slate-400 hover:bg-slate-50">−</button>
                        <span className="flex-1 text-center font-medium">{customQuantity}</span>
                        <button onClick={() => setCustomQuantity(customQuantity + 1)}
                          className="w-12 h-11 text-xl text-slate-400 hover:bg-slate-50">+</button>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="font-semibold text-[13px] text-slate-600 block mb-1.5">Ghi chú</label>
                      <div className="flex">
                        <input
                          type="text"
                          value={customNote}
                          onChange={(e) => setCustomNote(e.target.value)}
                          placeholder="Ghi chú"
                          className="flex-1 px-3 h-11 text-sm border border-slate-200 rounded-l-lg focus:outline-none focus:border-sky-500 placeholder-slate-300"
                        />
                        <button onClick={() => setCustomNote('')}
                          className="px-4 h-11 text-sm bg-slate-400 hover:bg-slate-500 text-white rounded-r-lg">Xoá</button>
                      </div>
                    </div>
                  </div>

                  {/* Giảm giá mặt hàng */}
                  <div>
                    <label className="font-semibold text-[13px] text-slate-600 block mb-1.5">Giảm giá mặt hàng</label>
                    <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                      <div className="flex shrink-0">
                        {[['percent', '%'], ['amount', 'đ']].map(([k, label]) => (
                          <button
                            key={k}
                            onClick={() => { setItemDiscType(itemDiscType === k ? 'none' : k); setItemDiscValue(''); }}
                            className={`w-12 h-11 flex items-center justify-center text-lg font-bold ${
                              itemDiscType === k ? 'bg-sky-500 text-white' : 'bg-white text-slate-300 hover:text-slate-500'
                            }`}
                            title={k === 'percent' ? 'Giảm theo %' : 'Giảm số tiền'}
                          >
                            {label === '%' ? <Percent size={20} /> : <span className="text-slate-400">đ</span>}
                          </button>
                        ))}
                      </div>
                      <input
                        type="number" min="0"
                        value={itemDiscValue}
                        onChange={(e) => { setItemDiscValue(e.target.value); if (itemDiscType === 'none') setItemDiscType('percent'); }}
                        placeholder={itemDiscType === 'percent' ? 'Nhập % giảm cho món này...' : 'Nhập số tiền giảm cho món này...'}
                        className="flex-1 px-3 text-sm focus:outline-none placeholder-slate-300"
                      />
                    </div>
                    {modalItemDisc > 0 && (
                      <div className="text-xs text-emerald-600 mt-1">
                        Giảm {modalItemDisc.toLocaleString('vi-VN')} đ → còn {modalLineNet.toLocaleString('vi-VN')} đ
                      </div>
                    )}
                  </div>
                </div>
              )}

              {modalTab === 'options' && (
                <div className="space-y-6">
                  {/* Gói 10: render NHÓM TÙY CHỌN động (Gói 8) — Size/Topping/... theo từng món */}
                  {modalGroups.length === 0 && (
                    <div className="text-center text-slate-400 py-8 text-sm leading-relaxed">
                      Món này chưa có nhóm tùy chọn nào.<br />
                      Gán nhóm trong Mặt hàng → tab Nhóm tùy chọn.
                    </div>
                  )}
                  {modalGroups.map((g) => {
                    const isSingle = g.type === 'single';
                    const v = selGroups[g.id];
                    return (
                      <div key={g.id}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-[13px]">{g.name}</span>
                          {g.is_required ? (
                            <span className="text-[11px] bg-red-100 text-red-600 px-2 py-0.5 rounded">Bắt buộc</span>
                          ) : (
                            <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded">Không bắt buộc</span>
                          )}
                          <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                            {isSingle ? 'Chỉ chọn 1' : 'Chọn nhiều'}
                          </span>
                        </div>
                        <div className={`grid ${isSingle ? 'grid-cols-3' : 'grid-cols-2'} gap-3`}>
                          {(g.options || []).map((o) => {
                            const checked = isSingle ? v === o.id : (Array.isArray(v) && v.includes(o.id));
                            return (
                              <div key={o.id}>
                                <div className="text-xs text-slate-500 mb-1 truncate">{o.name}</div>
                                <button
                                  onClick={() => (isSingle ? pickGroupSingle(g.id, o.id) : toggleGroupMulti(g.id, o.id))}
                                  className={`w-full py-3 rounded-lg border text-[15px] transition ${
                                    checked
                                      ? 'border-sky-500 bg-sky-50 text-sky-700 font-medium'
                                      : 'border-slate-200 hover:border-slate-300'
                                  }`}
                                >
                                  {Number(o.additional_price) > 0 ? `+${Number(o.additional_price).toLocaleString('vi-VN')}đ` : '0đ'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {modalTab === 'promo' && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="text-7xl mb-4">🏷️</div>
                  <p className="text-slate-400 text-[15px]">Chưa có chương trình khuyến mại cho mặt hàng này</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100">
              <div className="flex justify-between px-6 py-2 text-[11px] text-slate-400 italic">
                <span>* Bấm phím Esc để hủy thao tác và đóng popup</span>
                <span>* Bấm phím Enter để lưu và tắt popup</span>
              </div>
              <button
                onClick={confirmAddToCart}
                className="w-full py-4 bg-sky-500 hover:bg-sky-600 text-white font-bold text-lg tracking-wide"
              >
                XÁC NHẬN • {modalLineNet.toLocaleString('vi-VN')} đ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL MỞ CA ============ */}
      {isOpenShiftModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1e2a3f] border border-white/10 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">Mở Ca Làm Việc Mới</h3>
            <div>
              <label className="text-xs text-slate-400">Tên thu ngân</label>
              <input type="text" value={cashierName} onChange={(e) => setCashierName(e.target.value)}
                className="w-full p-2 bg-white/5 border border-white/10 rounded-lg mt-1 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Tiền lẻ ban đầu trong két</label>
              <input type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)}
                className="w-full p-2 bg-white/5 border border-white/10 rounded-lg mt-1 text-sm font-bold text-emerald-400 focus:outline-none focus:border-emerald-400" />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setIsOpenShiftModal(false)} className="flex-1 py-2 text-slate-400 text-sm">Hủy</button>
              <button onClick={handleOpenShift} className="flex-1 py-2 bg-[#00b14f] text-white rounded-lg text-sm font-bold">Xác nhận Mở Ca</button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL CHỐT CA ============ */}
      {isCloseShiftModal && shift && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1e2a3f] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-lg">Chốt Ca & Bàn Giao Két</h3>
            <div className="bg-white/5 p-3 rounded-lg text-xs space-y-1 text-slate-300">
              <div className="flex justify-between"><span>Tiền đầu ca:</span><b>{Number(shift.opening_cash).toLocaleString('vi-VN')} đ</b></div>
              <div className="flex justify-between"><span>Bán tiền mặt:</span><b>+{Number(shift.cash_sales).toLocaleString('vi-VN')} đ</b></div>
              <div className="flex justify-between"><span>Chuyển khoản QR:</span><b>{Number(shift.transfer_sales).toLocaleString('vi-VN')} đ</b></div>
              <div className="flex justify-between text-red-400"><span>Đã chi tiền mặt:</span><b>-{Number(shift.cash_out).toLocaleString('vi-VN')} đ</b></div>
              <div className="flex justify-between border-t border-white/10 pt-1 font-bold text-sm"><span>Tiền mặt lý thuyết:</span><span>{Number(shift.expected_cash).toLocaleString('vi-VN')} đ</span></div>
            </div>
            <div>
              <label className="text-xs font-bold">Tiền mặt thực đếm trong két (*):</label>
              <input type="number" placeholder="Nhập số tiền kiểm đếm..." value={closingCashActual} onChange={(e) => setClosingCashActual(e.target.value)}
                className="w-full p-2 bg-white/5 border-2 border-emerald-500 rounded-lg mt-1 font-bold text-emerald-300 focus:outline-none" />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setIsCloseShiftModal(false)} className="flex-1 py-2 text-slate-400 text-sm">Đóng</button>
              <button onClick={handleCloseShift} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-bold">Xác nhận Chốt Ca</button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL PHIẾU CHI ============ */}
      {isExpenseModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1e2a3f] border border-white/10 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold">Tạo Phiếu Chi Tiền Mặt</h3>
            <input type="number" placeholder="Số tiền chi (đ)..." value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)}
              className="w-full p-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-emerald-400" />
            <input type="text" placeholder="Lý do (mua đá, phụ phí...)" value={expenseReason} onChange={(e) => setExpenseReason(e.target.value)}
              className="w-full p-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-emerald-400" />
            <div className="flex gap-2">
              <button onClick={() => setIsExpenseModal(false)} className="flex-1 py-2 text-slate-400 text-sm">Hủy</button>
              <button onClick={handleAddExpense} className="flex-1 py-2 bg-slate-600 text-white rounded-lg text-sm font-bold">Lưu Phiếu Chi</button>
            </div>
          </div>
        </div>
      )}

      {/* ============ POPUP THÀNH CÔNG ============ */}
      {lastOrderCompleted && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1e2a3f] border border-white/10 rounded-2xl w-full max-w-xs p-5 shadow-2xl text-center space-y-3">
            <CheckCircle2 size={48} className="text-emerald-400 mx-auto" />
            <h3 className="font-bold text-base">Đơn Hàng {lastOrderCompleted.code}</h3>
            <p className="text-xs text-slate-400">Đã gửi dữ liệu sang màn hình KDS cho Barista</p>
            {/* Gói 11: QR tích điểm cho khách */}
            <button onClick={openQrClaim} disabled={qrLoading}
              className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5">
              <QrCode size={14} /> {qrLoading ? 'Đang tạo QR...' : 'QR tích điểm cho khách'}
            </button>
            <div className="flex gap-2 pt-1">
              <button onClick={() => printBill(lastOrderCompleted)}
                className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1">
                <Printer size={14} /> In Bill
              </button>
              <button onClick={() => printLabels(lastOrderCompleted)}
                className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1">
                <Printer size={14} /> In Tem
              </button>
              <button onClick={() => setLastOrderCompleted(null)} className="flex-1 py-2 bg-[#00b14f] text-white rounded-lg text-xs font-semibold">
                Tiếp tục
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gói 11: modal QR tích điểm */}
      {qrClaim && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1e2a3f] border border-white/10 rounded-2xl w-full max-w-xs p-5 shadow-2xl text-center space-y-3">
            <h3 className="font-bold text-base">QR tích điểm</h3>
            <p className="text-xs text-slate-400">Khách mở Mini App → Quét tích điểm → quét mã này</p>
            <div className="bg-white rounded-xl p-3 inline-block">
              <QRCodeSVG value={JSON.stringify({ code: qrClaim.code, token: qrClaim.token })} size={180} />
            </div>
            <p className="text-xs text-slate-400 font-mono">{qrClaim.code}</p>
            {qrClaim.member ? (
              <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-xl p-3">
                <p className="text-emerald-400 font-bold text-sm">✅ {qrClaim.member.name}</p>
                <p className="text-xs text-slate-300">{qrClaim.member.member_code}{qrClaim.member.tier ? ` · Hạng ${qrClaim.member.tier}` : ''}</p>
              </div>
            ) : (
              <p className="text-xs text-amber-400 animate-pulse">Đang chờ khách quét...</p>
            )}
            <button onClick={() => setQrClaim(null)} className="w-full py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-xs font-semibold">
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
