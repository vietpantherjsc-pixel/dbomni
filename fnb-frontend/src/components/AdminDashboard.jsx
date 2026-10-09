import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  ShoppingBag, 
  TrendingUp, 
  AlertTriangle, 
  Package, 
  ArrowLeft, 
  PlusCircle, 
  RefreshCw,
  CreditCard,
  Layers
} from 'lucide-react';
import DateInput from '../components/DateInput';

const API_BASE = 'http://localhost/api';

export default function AdminDashboard({ onBackToApp }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Modal Nhập Kho Nhanh
  const [isInwardModalOpen, setIsInwardModalOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const [inwardQuantity, setInwardQuantity] = useState('');
  const [inwardCost, setInwardCost] = useState('');
  const [inwardExpired, setInwardExpired] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const authHeaders = () => ({
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
  });

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/dashboard/stats`, { headers: authHeaders() });
      const result = await res.json();
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('Lỗi tải thống kê:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const res = await fetch(`${API_BASE}/branches`, { headers: authHeaders() });
      const result = await res.json();
      if (result.success && result.data.length > 0) {
        setBranches(result.data);
        setSelectedBranch(String(result.data[0].id));
      }
    } catch (error) {
      console.error('Lỗi tải chi nhánh:', error);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchBranches();
  }, []);

  const handleInwardSubmit = async (e) => {
    e.preventDefault();
    if (!selectedMaterial || !inwardQuantity || !selectedBranch) {
      return alert('Vui lòng chọn chi nhánh, nguyên liệu và nhập số lượng');
    }
    if (!inwardCost) {
      return alert('Vui lòng nhập đơn giá vốn của lô hàng');
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/admin/inventory/inward`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          branch_id: Number(selectedBranch),
          material_id: Number(selectedMaterial),
          quantity: Number(inwardQuantity),
          unit_cost: Number(inwardCost),
          expired_at: inwardExpired || null,
        }),
      });
      const result = await res.json();
      if (result.success) {
        alert(result.message);
        setIsInwardModalOpen(false);
        setSelectedMaterial('');
        setInwardQuantity('');
        setInwardCost('');
        setInwardExpired('');
        fetchStats();
      } else {
        alert(result.message || 'Lỗi nhập kho');
      }
    } catch (err) {
      alert('Không thể kết nối đến máy chủ');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-600">
        <RefreshCw className="animate-spin mr-2" size={24} /> Đang tải bảng điều khiển quản trị...
      </div>
    );
  }

  const overview = data?.overview || {};
  const topProducts = data?.top_products || [];
  const lowStockAlerts = data?.low_stock_alerts || [];
  const allMaterials = data?.all_materials || [];

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-800">
      {/* Header Quản Trị */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToApp}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center gap-1.5 text-sm font-semibold transition"
          >
            <ArrowLeft size={18} /> Về App
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">📊 Quản Trị & Kho Vận</h1>
            <p className="text-xs text-slate-500">Giám sát doanh thu và nguyên vật liệu chuỗi</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsInwardModalOpen(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
          >
            <PlusCircle size={16} /> Nhập Nguyên Liệu
          </button>
          <button
            onClick={fetchStats}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
            title="Làm mới dữ liệu"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        {/* 1. THẺ CHỈ SỐ TỔNG QUAN (METRICS) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Doanh thu hôm nay</span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {Number(overview.today_revenue || 0).toLocaleString('vi-VN')} đ
              </div>
              <div className="flex gap-2 text-[11px] text-slate-500 mt-1.5 font-medium">
                <span>TM: {Number(overview.cash_revenue || 0).toLocaleString('vi-VN')}đ</span>
                <span>•</span>
                <span>CK: {Number(overview.transfer_revenue || 0).toLocaleString('vi-VN')}đ</span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <DollarSign size={24} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Số đơn hoàn tất</span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {overview.today_orders_count || 0} đơn
              </div>
              <span className="text-[11px] text-emerald-600 font-semibold mt-1.5 block">Đơn tại quầy & giao hàng</span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ShoppingBag size={24} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Giá trị đơn TB (AOV)</span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {Number(overview.average_order_value || 0).toLocaleString('vi-VN')} đ
              </div>
              <span className="text-[11px] text-slate-500 mt-1.5 block">Doanh thu / số lượng đơn</span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <TrendingUp size={24} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cảnh báo tồn kho</span>
              <div className="text-2xl font-black text-red-600 mt-1">
                {lowStockAlerts.length} mặt hàng
              </div>
              <span className="text-[11px] text-red-500 mt-1.5 block font-medium">Chạm ngưỡng an toàn</span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>

        {/* 2. KHU VỰC TOP MÓN & CẢNH BÁO KHO */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top 5 Món Bán Chạy */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Layers size={18} className="text-blue-600" /> Top Sản Phẩm Bán Chạy Nhất
              </h2>
              <span className="text-xs text-slate-400">Xếp theo số lượng ly</span>
            </div>

            <div className="divide-y divide-slate-100">
              {topProducts.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">Chưa có dữ liệu bán hàng</div>
              ) : (
                topProducts.map((item, index) => (
                  <div key={item.product_id} className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        index === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {index + 1}
                      </span>
                      <img
                        src={item.product?.image_url}
                        alt={item.product?.name}
                        className="w-10 h-10 rounded-lg object-cover border"
                      />
                      <div>
                        <div className="text-xs font-bold text-slate-800">{item.product?.name}</div>
                        <div className="text-[11px] text-slate-500">
                          Doanh số: {Number(item.total_sales).toLocaleString('vi-VN')} đ
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-extrabold text-blue-600">{item.total_quantity}</span>
                      <span className="text-xs text-slate-400 ml-1">ly/phần</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Cảnh Báo Kho Sắp Hết */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" /> Cần Nhập Thêm Kho
              </h2>
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                {lowStockAlerts.length}
              </span>
            </div>

            <div className="space-y-3">
              {lowStockAlerts.length === 0 ? (
                <div className="text-center py-8 text-xs text-emerald-600 font-medium">
                  Tồn kho tất cả nguyên vật liệu đều an toàn!
                </div>
              ) : (
                lowStockAlerts.map((mat) => (
                  <div key={mat.id} className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-bold text-red-900">
                      <span>{mat.name}</span>
                      <span>{Number(mat.current_stock).toLocaleString('vi-VN')} {mat.unit}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-red-700">
                      <span>Mức tối thiểu: {Number(mat.minimum_stock).toLocaleString('vi-VN')} {mat.unit}</span>
                      <button
                        onClick={() => {
                          setSelectedMaterial(mat.id);
                          setIsInwardModalOpen(true);
                        }}
                        className="underline font-bold hover:text-red-900"
                      >
                        Nhập ngay
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 3. BẢNG TỒN KHO NGUYÊN VẬT LIỆU TỨC THỜI */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Package size={18} className="text-slate-700" /> Bảng Kiểm Kê Tồn Kho Tức Thời
            </h2>
            <span className="text-xs text-slate-400">Tự động trừ khi Barista hoàn tất đơn</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b">
                <tr>
                  <th className="p-3">Nguyên liệu</th>
                  <th className="p-3">Đơn vị</th>
                  <th className="p-3">Tồn kho hiện tại</th>
                  <th className="p-3">Ngưỡng cảnh báo</th>
                  <th className="p-3">Loại</th>
                  <th className="p-3 text-right">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allMaterials.map((mat) => {
                  const isLow = Number(mat.current_stock) <= Number(mat.minimum_stock);
                  return (
                    <tr key={mat.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-800">{mat.name}</td>
                      <td className="p-3 text-slate-500">{mat.unit}</td>
                      <td className="p-3 font-semibold text-slate-900">
                        {Number(mat.current_stock).toLocaleString('vi-VN')}
                      </td>
                      <td className="p-3 text-slate-500">
                        {Number(mat.minimum_stock).toLocaleString('vi-VN')}
                      </td>
                      <td className="p-3 text-slate-600">
                        {mat.type === 'raw' ? 'Thô' : mat.type === 'semi_finished' ? 'Bán thành phẩm' : 'Tiêu hao'}
                      </td>
                      <td className="p-3 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isLow ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {isLow ? 'Sắp hết' : 'An toàn'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* MODAL NHẬP THÊM NGUYÊN LIỆU */}
      {isInwardModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Phiếu Nhập Nguyên Liệu Vào Kho</h3>
            <form onSubmit={handleInwardSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Chi nhánh nhập kho (*):</label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="w-full p-2 border rounded-lg bg-white"
                  required
                >
                  <option value="">-- Chọn chi nhánh --</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Chọn nguyên vật liệu (*):</label>
                <select
                  value={selectedMaterial}
                  onChange={(e) => setSelectedMaterial(e.target.value)}
                  className="w-full p-2 border rounded-lg bg-white"
                  required
                >
                  <option value="">-- Chọn nguyên liệu --</option>
                  {allMaterials.map((mat) => (
                    <option key={mat.id} value={mat.id}>
                      {mat.name} ({mat.unit}) - Hiện tồn: {Number(mat.current_stock).toLocaleString('vi-VN')}
                    </option>
                  ))}
                </select>
              </div>

              {/* ĐOẠN MỚI ĐÃ THÊM ĐƠN VỊ TỰ ĐỘNG: */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Số lượng nhập thêm (*):</label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    placeholder="Nhập số lượng..."
                    value={inwardQuantity}
                    onChange={(e) => setInwardQuantity(e.target.value)}
                    className="w-full p-2 pr-14 border rounded-lg font-bold text-blue-600"
                    required
                  />
                  {selectedMaterial && (
                    <span className="absolute right-3 top-2.5 text-slate-400 font-bold text-sm pointer-events-none">
                      {allMaterials.find(mat => mat.id.toString() === selectedMaterial.toString())?.unit}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Đơn giá vốn của lô hàng (*):</label>
                <input
                  type="number"
                  placeholder="Đơn giá nhập..."
                  value={inwardCost}
                  onChange={(e) => setInwardCost(e.target.value)}
                  className="w-full p-2 border rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Hạn sử dụng (nếu có):</label>
                <DateInput
                  value={inwardExpired}
                  onChange={setInwardExpired}
                  className="w-full p-2 border rounded-lg"
                  placeholder="dd/mm/yyyy"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsInwardModalOpen(false)}
                  className="flex-1 py-2 border rounded-lg text-slate-600 font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 disabled:bg-slate-300"
                >
                  {isSubmitting ? 'Đang lưu...' : 'Xác nhận nhập'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}