import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  CreditCard, 
  Plus, 
  Minus, 
  Trash2, 
  Printer, 
  Lock, 
  Unlock, 
  TrendingDown, 
  Search, 
  CheckCircle2, 
  ArrowLeft,
  X
} from 'lucide-react';

const API_BASE = 'http://localhost/api';

// Gói 1 (2026-10-04): fetch không tự gắn token như axios -> gắn thủ công
const authHeaders = () => ({
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
});

export default function PosScreen({ onBackToApp }) {
  // Trạng thái Ca làm việc
  const [shift, setShift] = useState(null);
  const [isOpenShiftModal, setIsOpenShiftModal] = useState(false);
  const [isCloseShiftModal, setIsCloseShiftModal] = useState(false);
  const [isExpenseModal, setIsExpenseModal] = useState(false);

  // Dữ liệu mở/đóng ca & chi phí
  const [cashierName, setCashierName] = useState('Thu Ngân 01');
  const [openingCash, setOpeningCash] = useState(500000);
  const [closingCashActual, setClosingCashActual] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseReason, setExpenseReason] = useState('');

  // Thực đơn & Giỏ hàng POS
  const [products, setProducts] = useState([]);
  // Thiết lập số lượng món hiển thị trên 1 hàng (Mặc định 4 cột)
  const [gridCols, setGridCols] = useState(4); // 3 | 4 | 5
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState([]);

  // Modal tùy biến món (Size, Đá, Đường, Topping)
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [selectedIce, setSelectedIce] = useState('100%');
  const [selectedSugar, setSelectedSugar] = useState('100%');
  const [selectedToppings, setSelectedToppings] = useState([]);
  const [customQuantity, setCustomQuantity] = useState(1);

  // Thanh toán
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' | 'transfer'
  const [receivedCash, setReceivedCash] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastOrderCompleted, setLastOrderCompleted] = useState(null);

  useEffect(() => {
    fetchCurrentShift();
    fetchMenu();
  }, []);

  const fetchCurrentShift = async () => {
    try {
      const res = await fetch(`${API_BASE}/shifts/current`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success && data.is_open) {
        setShift(data.data);
      } else {
        setShift(null);
      }
    } catch (err) {
      console.error('Lỗi kiểm tra ca:', err);
    }
  };

  const fetchMenu = async () => {
    try {
      const res = await fetch(`${API_BASE}/menu`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setCategories(data.data);
        const allProds = data.data.flatMap((cat) => cat.products || []);
        setProducts(allProds);
      }
    } catch (err) {
      console.error('Lỗi tải menu:', err);
    }
  };

  // 1. Quản lý Ca
  const handleOpenShift = async () => {
    try {
      const res = await fetch(`${API_BASE}/shifts/open`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cashier_name: cashierName, opening_cash: Number(openingCash) })
      });
      const data = await res.json();
      if (data.success) {
        setShift(data.data);
        setIsOpenShiftModal(false);
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Không thể mở ca');
    }
  };

  const handleCloseShift = async () => {
    if (!closingCashActual) return alert('Vui lòng nhập số tiền thực đếm trong két');
    try {
      const res = await fetch(`${API_BASE}/shifts/${shift.id}/close`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ closing_cash_actual: Number(closingCashActual) })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Chốt ca thành công! Tiền chênh lệch: ${Number(data.data.difference).toLocaleString('vi-VN')} đ`);
        setShift(null);
        setIsCloseShiftModal(false);
      }
    } catch (err) {
      alert('Lỗi chốt ca');
    }
  };

  const handleAddExpense = async () => {
    if (!expenseAmount || !expenseReason) return alert('Nhập đủ số tiền và lý do');
    try {
      const res = await fetch(`${API_BASE}/shifts/${shift.id}/expense`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amount: Number(expenseAmount), reason: expenseReason })
      });
      const data = await res.json();
      if (data.success) {
        setIsExpenseModal(false);
        setExpenseAmount('');
        setExpenseReason('');
        fetchCurrentShift();
      }
    } catch (err) {
      alert('Lỗi lưu phiếu chi');
    }
  };

  // 2. Chọn món & Mở Modal Tùy biến
  const handleSelectProduct = (product) => {
    if (!shift) {
      alert('Vui lòng Mở Ca trước khi bán hàng');
      setIsOpenShiftModal(true);
      return;
    }

    // Nếu món có options/toppings -> Mở modal tùy biến
    if (product.options && product.options.length > 0) {
      setSelectedProduct(product);

      // Lấy danh sách options (nếu có từ API)
      const rawOptions = product.options || [];

      // Mặc định chọn size đầu tiên hoặc Size M
      const sizeOpts = product.options.filter(o => o.type === 'size');
      setSelectedProduct(product);
      setSelectedSize(sizeOpts.length > 0 ? sizeOpts[0] : null);
      setSelectedIce('100%');
      setSelectedSugar('100%');
      setSelectedToppings([]);
      setCustomQuantity(1);
    } else {
      // Món không có option (như Bánh ngọt) -> thêm trực tiếp
      addItemToCart(product, null, '100%', '100%', [], 1);
    }
  };

  const toggleTopping = (topping) => {
    if (selectedToppings.some(t => t.id === topping.id)) {
      setSelectedToppings(selectedToppings.filter(t => t.id !== topping.id));
    } else {
      setSelectedToppings([...selectedToppings, topping]);
    }
  };

  const calculateCustomPrice = () => {
    if (!selectedProduct) return 0;
    let base = Number(selectedProduct.price);
    if (selectedSize) base += Number(selectedSize.additional_price || 0);
    const toppingTotal = selectedToppings.reduce((sum, t) => sum + Number(t.additional_price || 0), 0);
    return (base + toppingTotal) * customQuantity;
  };

  const confirmAddToCart = () => {
    addItemToCart(selectedProduct, selectedSize, selectedIce, selectedSugar, selectedToppings, customQuantity);
    setSelectedProduct(null);
  };

  const addItemToCart = (product, size, ice, sugar, toppings, qty) => {
    let unitPrice = Number(product.price);
    if (size) unitPrice += Number(size.additional_price || 0);
    const toppingsExtra = toppings.reduce((sum, t) => sum + Number(t.additional_price || 0), 0);
    unitPrice += toppingsExtra;

    // Tạo ghi chú option ngắn gọn
    const optNotes = [];
    if (size) optNotes.push(`Size ${size.name}`);
    if (ice !== '100%') optNotes.push(`Đá ${ice}`);
    if (sugar !== '100%') optNotes.push(`Đường ${sugar}`);
    if (toppings.length > 0) optNotes.push(`+${toppings.map(t => t.name).join(', ')}`);
    const optionsText = optNotes.length > 0 ? optNotes.join(' • ') : null;

    // Khóa duy nhất đại diện cho món cùng các tùy chọn
    const cartItemId = `${product.id}-${size?.id || 'base'}-${toppings.map(t => t.id).sort().join('-')}-${ice}-${sugar}`;

    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.cartItemId === cartItemId);
      if (existingIndex > 0 || existingIndex === 0) {
        const updated = [...prev];
        updated[existingIndex].quantity += qty;
        return updated;
      }
      return [
        ...prev,
        {
          cartItemId,
          product_id: product.id,
          product_option_id: size?.id || null,
          toppings: toppings.map(t => t.id),
          name: product.name,
          optionsText,
          price: unitPrice,
          quantity: qty,
        }
      ];
    });
  };

  const updateQuantity = (cartItemId, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.cartItemId === cartItemId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean)
    );
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const changeDue = Math.max(0, (Number(receivedCash) || 0) - totalAmount);

  // 3. Thanh toán & Hoàn tất đơn
  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (paymentMethod === 'cash' && Number(receivedCash) < totalAmount) {
      return alert('Số tiền khách đưa không đủ');
    }

    setIsProcessing(true);
    try {
      const orderPayload = {
        branch_id: 1,
        customer_name: 'Khách tại quầy',
        payment_method: paymentMethod,
        items: cart.map((i) => ({ 
          product_id: i.product_id, 
          product_option_id: i.product_option_id,
          quantity: i.quantity,
          note: i.optionsText
        })),
      };

      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(orderPayload),
      });
      const data = await res.json();

      if (data.success || data.data) {
        const completedOrder = {
          code: data.data?.code || 'POS-' + Date.now().toString().slice(-4),
          items: [...cart],
          total: totalAmount,
          method: paymentMethod,
          date: new Date().toLocaleTimeString('vi-VN'),
        };
        setLastOrderCompleted(completedOrder);
        setCart([]);
        setReceivedCash('');
        fetchCurrentShift();
      }
    } catch (err) {
      alert('Không thể tạo đơn POS');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesCat = activeCategory === 'ALL' || p.category_id.toString() === activeCategory.toString();
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="flex h-screen bg-slate-100 font-sans select-none overflow-hidden">
      {/* CỘT TRÁI: THỰC ĐƠN BÁN HÀNG */}
      <div className="flex-1 flex flex-col border-r border-slate-200">
        <div className="h-16 bg-white border-b px-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <button 
              onClick={onBackToApp} 
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center gap-1 text-sm font-medium"
            >
              <ArrowLeft size={18} /> Về App
            </button>
            <span className="text-xl font-bold text-slate-800 tracking-tight">☕ POS Thu Ngân</span>
          </div>

          <div className="flex items-center gap-2">
            {shift ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                <Unlock size={16} className="text-emerald-600" />
                <span className="text-xs text-emerald-800 font-medium">Ca: {shift.cashier_name}</span>
                <button
                  onClick={() => setIsExpenseModal(true)}
                  className="text-xs bg-white border border-emerald-300 px-2 py-1 rounded text-slate-700 hover:bg-emerald-100 font-medium"
                >
                  + Chi tiền
                </button>
                <button
                  onClick={() => setIsCloseShiftModal(true)}
                  className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 font-medium"
                >
                  Chốt ca
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsOpenShiftModal(true)}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm"
              >
                <Lock size={16} /> Mở Ca Làm Việc
              </button>
            )}
          </div>
        </div>

        {/* Bộ lọc Danh mục & Ô tìm kiếm */}
        <div className="p-3 bg-white border-b flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Tìm nhanh tên món..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            <button
              onClick={() => setActiveCategory('ALL')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg shrink-0 ${
                activeCategory === 'ALL' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Tất cả
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`px-3 py-2 text-xs font-semibold rounded-lg shrink-0 ${
                  activeCategory === c.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>



        {/* Bộ lọc Danh mục & Ô tìm kiếm & Chọn số cột */}
        <div className="p-3 bg-white border-b flex gap-3 items-center justify-between">
          <div className="relative w-64 shrink-0">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Tìm nhanh tên món..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto flex-1 px-2">
            <button
              onClick={() => setActiveCategory('ALL')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg shrink-0 ${
                activeCategory === 'ALL' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Tất cả
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`px-3 py-2 text-xs font-semibold rounded-lg shrink-0 ${
                  activeCategory === c.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Bộ chọn số lượng món / hàng */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg shrink-0 border border-slate-200">
            <span className="text-[11px] font-bold text-slate-500 px-1.5">Cột:</span>
            {[3, 4, 5].map((cols) => (
              <button
                key={cols}
                onClick={() => setGridCols(cols)}
                className={`px-2 py-1 text-xs font-bold rounded transition ${
                  gridCols === cols
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cols}
              </button>
            ))}
          </div>
        </div>



        {/* Lưới sản phẩm chuẩn POS */}
        <div className="flex-1 overflow-y-auto p-4">
          <div
            className={`grid gap-3.5 ${
              gridCols === 3
                ? 'grid-cols-3'
                : gridCols === 5
                ? 'grid-cols-5'
                : 'grid-cols-4'
            }`}
          >
            {filteredProducts.map((p) => (
              <div
                key={p.id}
                onClick={() => handleSelectProduct(p)}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden cursor-pointer hover:border-blue-500 hover:shadow-lg transition-all active:scale-95 flex flex-col h-fit group"
              >
                {/* Ảnh món cố định tỉ lệ */}
                <div className="w-full aspect-square bg-slate-100 overflow-hidden relative">
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                  />
                </div>

                {/* Thông tin món nằm sát chân ảnh */}
                <div className="p-3 bg-white flex flex-col justify-between">
                  <h4 className="font-semibold text-xs text-slate-800 line-clamp-2 h-8 leading-snug">
                    {p.name}
                  </h4>
                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-100">
                    <span className="text-sm font-extrabold text-blue-600">
                      {Number(p.price).toLocaleString('vi-VN')} đ
                    </span>
                    <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold group-hover:bg-blue-600 group-hover:text-white transition">
                      +
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CỘT PHẢI: GIỎ HÀNG & THANH TOÁN */}
      <div className="w-96 bg-white flex flex-col shadow-xl z-10 border-l border-slate-200">
        <div className="p-3 border-b flex justify-between items-center bg-slate-50">
          <span className="font-bold text-slate-700 text-sm">Đơn hàng tại quầy</span>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-red-500 text-xs flex items-center gap-1 hover:underline">
              <Trash2 size={14} /> Xóa hết
            </button>
          )}
        </div>

        {/* Danh sách món chọn */}
        <div className="flex-1 overflow-y-auto p-3 divide-y divide-slate-100">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs">
              Chưa chọn món nào
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.cartItemId} className="py-2.5 flex justify-between items-center">
                <div className="flex-1 pr-2">
                  <div className="text-xs font-semibold text-slate-800">{item.name}</div>
                  {item.optionsText && (
                    <div className="text-[11px] text-blue-600 font-medium">{item.optionsText}</div>
                  )}
                  <div className="text-xs text-slate-500">{(item.price * item.quantity).toLocaleString('vi-VN')} đ</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateQuantity(item.cartItemId, -1)}
                    className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.cartItemId, 1)}
                    className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Khu vực tính tiền & Hoàn tất */}
        <div className="p-4 bg-slate-50 border-t space-y-3">
          <div className="flex justify-between text-base font-bold text-slate-800">
            <span>Tổng thanh toán:</span>
            <span className="text-blue-600 text-lg">{totalAmount.toLocaleString('vi-VN')} đ</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border ${
                paymentMethod === 'cash' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700'
              }`}
            >
              <DollarSign size={14} /> Tiền Mặt
            </button>
            <button
              onClick={() => setPaymentMethod('transfer')}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border ${
                paymentMethod === 'transfer' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700'
              }`}
            >
              <CreditCard size={14} /> Quét VietQR
            </button>
          </div>

          {paymentMethod === 'cash' && (
            <div className="space-y-1.5 pt-1">
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Tiền khách đưa..."
                  value={receivedCash}
                  onChange={(e) => setReceivedCash(e.target.value)}
                  className="w-full text-xs p-2 rounded border border-slate-300 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => setReceivedCash(totalAmount)}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs px-2.5 rounded font-semibold whitespace-nowrap"
                >
                  Đủ tiền
                </button>
              </div>
              <div className="flex justify-between text-xs text-slate-600 pt-1 font-medium">
                <span>Tiền thừa trả khách:</span>
                <span className="text-red-600 font-bold">{changeDue.toLocaleString('vi-VN')} đ</span>
              </div>
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || isProcessing}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-sm shadow-md transition"
          >
            {isProcessing ? 'Đang thanh toán...' : 'XÁC NHẬN & TẠO ĐƠN'}
          </button>
        </div>
      </div>

      {/* MODAL TÙY BIẾN MÓN DÀNH CHO POS (Size, Đá, Đường, Topping) */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-start border-b pb-3">
              <div>
                <h3 className="font-bold text-slate-800 text-base">{selectedProduct.name}</h3>
                <span className="text-xs text-blue-600 font-bold">
                  Gốc: {Number(selectedProduct.price).toLocaleString('vi-VN')} đ
                </span>
              </div>
              <button 
                onClick={() => setSelectedProduct(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
              {/* Chọn Size */}
              {/* Chọn Size (Tự động hiển thị Size Tiêu Chuẩn nếu món chưa có size trong DB) */}
              <div>
                <label className="font-bold text-slate-700 block mb-1.5">Kích cỡ (Size):</label>
                <div className="grid grid-cols-2 gap-2">
                  {selectedProduct.options?.filter(o => o.type === 'size').length > 0 ? (
                    selectedProduct.options.filter(o => o.type === 'size').map(size => (
                      <button
                        key={size.id}
                        onClick={() => setSelectedSize(size)}
                        className={`p-2 rounded-lg border text-left flex justify-between items-center ${
                          selectedSize?.id === size.id ? 'border-blue-600 bg-blue-50 font-bold text-blue-700' : 'border-slate-200'
                        }`}
                      >
                        <span>{size.name}</span>
                        <span>+{Number(size.additional_price).toLocaleString('vi-VN')}đ</span>
                      </button>
                    ))
                  ) : (
                    <div className="p-2 rounded-lg border border-blue-600 bg-blue-50 font-bold text-blue-700 text-xs col-span-2 text-center">
                      Size Tiêu Chuẩn (Ly thường)
                    </div>
                  )}
                </div>
              </div>

              {/* Chọn Mức Đá */}
              <div>
                <label className="font-bold text-slate-700 block mb-1.5">Mức đá:</label>
                <div className="grid grid-cols-3 gap-2">
                  {['100%', '50%', 'Không đá'].map(ice => (
                    <button
                      key={ice}
                      onClick={() => setSelectedIce(ice)}
                      className={`py-2 rounded-lg border text-center font-medium ${
                        selectedIce === ice ? 'border-blue-600 bg-blue-50 font-bold text-blue-700' : 'border-slate-200'
                      }`}
                    >
                      {ice}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chọn Mức Đường */}
              <div>
                <label className="font-bold text-slate-700 block mb-1.5">Mức ngọt:</label>
                <div className="grid grid-cols-3 gap-2">
                  {['100%', '50%', 'Không đường'].map(sugar => (
                    <button
                      key={sugar}
                      onClick={() => setSelectedSugar(sugar)}
                      className={`py-2 rounded-lg border text-center font-medium ${
                        selectedSugar === sugar ? 'border-blue-600 bg-blue-50 font-bold text-blue-700' : 'border-slate-200'
                      }`}
                    >
                      {sugar}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chọn Topping */}
              {selectedProduct.options?.filter(o => o.type === 'topping').length > 0 && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1.5">Topping thêm:</label>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedProduct.options.filter(o => o.type === 'topping').map(top => {
                      const isChecked = selectedToppings.some(t => t.id === top.id);
                      return (
                        <button
                          key={top.id}
                          onClick={() => toggleTopping(top)}
                          className={`p-2 rounded-lg border text-left flex justify-between items-center ${
                            isChecked ? 'border-emerald-600 bg-emerald-50 font-bold text-emerald-700' : 'border-slate-200'
                          }`}
                        >
                          <span>{top.name}</span>
                          <span>+{Number(top.additional_price).toLocaleString('vi-VN')}đ</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Chân Modal: Số lượng & Xác nhận thêm vào giỏ */}
            <div className="border-t pt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCustomQuantity(Math.max(1, customQuantity - 1))}
                  className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center text-slate-700 font-bold hover:bg-slate-200"
                >
                  -
                </button>
                <span className="font-bold text-sm w-4 text-center">{customQuantity}</span>
                <button
                  onClick={() => setCustomQuantity(customQuantity + 1)}
                  className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center text-slate-700 font-bold hover:bg-slate-200"
                >
                  +
                </button>
              </div>

              <button
                onClick={confirmAddToCart}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md flex items-center gap-1.5"
              >
                <span>Thêm vào đơn:</span>
                <span>{calculateCustomPrice().toLocaleString('vi-VN')} đ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL MỞ CA */}
      {isOpenShiftModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-800 text-lg">Mở Ca Làm Việc Mới</h3>
            <div>
              <label className="text-xs text-slate-500 font-medium">Tên thu ngân</label>
              <input
                type="text"
                value={cashierName}
                onChange={(e) => setCashierName(e.target.value)}
                className="w-full p-2 border rounded-lg mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Tiền lẻ ban đầu trong két (Floating Cash)</label>
              <input
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                className="w-full p-2 border rounded-lg mt-1 text-sm font-bold text-blue-600"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setIsOpenShiftModal(false)} className="flex-1 py-2 text-slate-500 text-sm">
                Hủy
              </button>
              <button onClick={handleOpenShift} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">
                Xác nhận Mở Ca
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CHỐT CA */}
      {isCloseShiftModal && shift && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-800 text-lg">Chốt Ca & Bàn Giao Két</h3>
            <div className="bg-slate-50 p-3 rounded-lg text-xs space-y-1 text-slate-600">
              <div className="flex justify-between">
                <span>Tiền đầu ca:</span>
                <b>{Number(shift.opening_cash).toLocaleString('vi-VN')} đ</b>
              </div>
              <div className="flex justify-between">
                <span>Bán tiền mặt:</span>
                <b>+{Number(shift.cash_sales).toLocaleString('vi-VN')} đ</b>
              </div>
              <div className="flex justify-between">
                <span>Chuyển khoản QR:</span>
                <b>{Number(shift.transfer_sales).toLocaleString('vi-VN')} đ</b>
              </div>
              <div className="flex justify-between text-red-500">
                <span>Đã chi tiền mặt:</span>
                <b>-{Number(shift.cash_out).toLocaleString('vi-VN')} đ</b>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold text-slate-800 text-sm">
                <span>Tiền mặt lý thuyết trong két:</span>
                <span>{Number(shift.expected_cash).toLocaleString('vi-VN')} đ</span>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-700 font-bold">Tiền mặt thực đếm trong két (*):</label>
              <input
                type="number"
                placeholder="Nhập số tiền kiểm đếm..."
                value={closingCashActual}
                onChange={(e) => setClosingCashActual(e.target.value)}
                className="w-full p-2 border-2 border-blue-500 rounded-lg mt-1 font-bold text-base text-blue-700"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setIsCloseShiftModal(false)} className="flex-1 py-2 text-slate-500 text-sm">
                Đóng
              </button>
              <button onClick={handleCloseShift} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-bold">
                Xác nhận Chốt Ca
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PHIẾU CHI */}
      {isExpenseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-800 text-base">Tạo Phiếu Chi Tiền Mặt</h3>
            <input
              type="number"
              placeholder="Số tiền chi (đ)..."
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className="w-full p-2 border rounded-lg text-sm"
            />
            <input
              type="text"
              placeholder="Lý do (mua đá, phụ phí...)"
              value={expenseReason}
              onChange={(e) => setExpenseReason(e.target.value)}
              className="w-full p-2 border rounded-lg text-sm"
            />
            <div className="flex gap-2">
              <button onClick={() => setIsExpenseModal(false)} className="flex-1 py-2 text-slate-500 text-sm">
                Hủy
              </button>
              <button onClick={handleAddExpense} className="flex-1 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold">
                Lưu Phiếu Chi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POPUP THÀNH CÔNG & MẪU IN HÓA ĐƠN K80 */}
      {lastOrderCompleted && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xs p-5 shadow-2xl text-center space-y-3">
            <CheckCircle2 size={48} className="text-emerald-500 mx-auto" />
            <h3 className="font-bold text-base text-slate-800">Đơn Hàng {lastOrderCompleted.code}</h3>
            <p className="text-xs text-slate-500">Đã gửi dữ liệu sang màn hình KDS cho Barista</p>

            <div id="thermal-receipt" className="border border-dashed p-3 text-left text-[11px] font-mono bg-slate-50 rounded">
              <div className="text-center font-bold text-xs pb-1 border-b">CAFE & TEA OMNI</div>
              <div className="pt-1 text-[10px] text-slate-500">Giờ: {lastOrderCompleted.date}</div>
              <div className="text-[10px] text-slate-500">Mã: {lastOrderCompleted.code}</div>
              <div className="my-1.5 border-t border-dashed"></div>
              {lastOrderCompleted.items.map((it, idx) => (
                <div key={idx} className="py-0.5">
                  <div className="flex justify-between">
                    <span>{it.quantity}x {it.name}</span>
                    <span>{(it.price * it.quantity).toLocaleString('vi-VN')}</span>
                  </div>
                  {it.optionsText && (
                    <div className="text-[9px] text-slate-500 pl-3">↳ {it.optionsText}</div>
                  )}
                </div>
              ))}
              <div className="my-1.5 border-t border-dashed"></div>
              <div className="flex justify-between font-bold text-xs">
                <span>TỔNG CỘNG:</span>
                <span>{lastOrderCompleted.total.toLocaleString('vi-VN')} đ</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1"
              >
                <Printer size={14} /> In K80
              </button>
              <button
                onClick={() => setLastOrderCompleted(null)}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold"
              >
                Tiếp tục
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}