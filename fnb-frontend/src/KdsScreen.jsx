import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  ChefHat, Clock, CheckCircle2, AlertCircle, RefreshCw, 
  Volume2, VolumeX, ArrowRight, Check, Coffee, Store
} from 'lucide-react';

const API_BASE = 'http://localhost/api';

export default function KdsScreen({ onBackToClient }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState(1);
  const [branches, setBranches] = useState([]); // Gói 10d: dropdown chọn chi nhánh
  const previousOrderCount = useRef(0);

  // Phát âm thanh chuông báo khi có đơn hàng mới đổ về
  const playNotificationSound = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // Nốt D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.15); // Nốt A5
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
      console.warn('Không thể phát âm thanh thông báo:', e);
    }
  };

  const fetchKdsOrders = async () => {
    try {
      const res = await axios.get(`${API_BASE}/kds/orders?branch_id=${selectedBranch}`);
      if (res.data.success) {
        const newOrders = res.data.data;
        // Nếu số lượng đơn nhiều hơn lần trước => có đơn mới => đổ chuông
        if (newOrders.length > previousOrderCount.current && previousOrderCount.current !== 0) {
          playNotificationSound();
        }
        previousOrderCount.current = newOrders.length;
        setOrders(newOrders);
      }
    } catch (error) {
      console.error('Lỗi khi tải đơn KDS:', error);
    }
  };

  // Tự động kiểm tra đơn mới mỗi 3 giây
  useEffect(() => {
    fetchKdsOrders();
    const timer = setInterval(fetchKdsOrders, 3000);
    return () => clearInterval(timer);
  }, [selectedBranch]);

  // Gói 10d: nạp danh sách chi nhánh cho dropdown
  useEffect(() => {
    axios.get(`${API_BASE}/branches`)
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        setBranches(list);
      })
      .catch(() => {});
  }, []);

  // Cập nhật trạng thái đơn hàng (pending -> processing -> ready -> completed)
  const handleUpdateStatus = async (orderCode, nextStatus) => {
    try {
      const res = await axios.patch(`${API_BASE}/orders/${orderCode}/status`, {
        status: nextStatus
      });
      if (res.data.success) {
        fetchKdsOrders();
      }
    } catch (error) {
      alert(error.response?.data?.message || 'Không thể cập nhật trạng thái');
    }
  };

  // Phân nhóm đơn theo cột
  const pendingOrders = orders.filter((o) => o.status === 'pending');
  const processingOrders = orders.filter((o) => o.status === 'processing');
  const readyOrders = orders.filter((o) => o.status === 'ready');

  // Tính thời gian chờ (phút)
  const getElapsedMinutes = (dateString) => {
    const diffMs = new Date() - new Date(dateString);
    return Math.max(0, Math.floor(diffMs / 60000));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* 1. THANH ĐIỀU KHIỂN ĐẦU TRANG (HEADER BAR) */}
      <header className="h-16 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-lg tracking-wide">
            <ChefHat className="w-6 h-6" />
            <span>KDS BARISTA MONITOR</span>
          </div>
          {/* Gói 10d: dropdown chọn chi nhánh (trước đây chỉ là nhãn, không bấm được) */}
          <label className="text-xs bg-slate-800 text-slate-300 px-3 py-1 rounded-full border border-slate-700 flex items-center gap-1.5 cursor-pointer hover:border-emerald-500/50">
            <Store className="w-3.5 h-3.5 text-emerald-500" />
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(Number(e.target.value))}
              className="bg-transparent outline-none cursor-pointer text-slate-200 font-semibold [&>option]:text-slate-900"
            >
              {branches.length > 0 ? branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              )) : (
                <option value={selectedBranch}>Chi nhánh {selectedBranch}</option>
              )}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3">
          {/* Nút bật/tắt chuông */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl text-xs flex items-center gap-1.5 border transition ${
              soundEnabled 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Chuông Bật' : 'Chuông Tắt'}</span>
          </button>

          {/* Nút làm mới */}
          <button
            onClick={fetchKdsOrders}
            className="p-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Làm mới</span>
          </button>

          {/* Nút quay về màn hình Khách (Mini App) */}
          <button
            onClick={onBackToClient}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-emerald-900/30"
          >
            Mở App Khách Đặt
          </button>
        </div>
      </header>

      {/* 2. KHÔNG GIAN BẢNG KANBAN 3 CỘT */}
      <main className="flex-1 p-6 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-hidden">

        {/* CỘT 1: CHỜ TIẾP NHẬN (PENDING) */}
        <section className="bg-slate-900/90 rounded-3xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-amber-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              <h2 className="font-extrabold text-sm text-amber-400 tracking-wider uppercase">Chờ Pha Chế</h2>
            </div>
            <span className="text-xs font-mono font-bold bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full">
              {pendingOrders.length}
            </span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4 no-scrollbar">
            {pendingOrders.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">Không có đơn hàng nào chờ</p>
            ) : (
              pendingOrders.map((ord) => {
                const elapsed = getElapsedMinutes(ord.created_at);
                return (
                  <div key={ord.id} className="bg-slate-800/90 rounded-2xl p-4 border border-slate-700 space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-mono font-extrabold text-emerald-400 text-sm">#{ord.code}</span>
                      <span className={`flex items-center gap-1 font-bold ${elapsed > 10 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`}>
                        <Clock className="w-3.5 h-3.5" /> {elapsed} phút
                      </span>
                    </div>

                    <div className="border-t border-slate-700/60 pt-2 space-y-1.5 text-xs">
                      {ord.items?.map((it) => (
                        <div key={it.id} className="flex justify-between">
                          <span className="font-bold text-slate-100">
                            {it.product?.name} {it.option ? `(${it.option.name})` : ''}
                          </span>
                          <span className="font-mono font-extrabold text-amber-400">x{it.quantity}</span>
                        </div>
                      ))}
                    </div>

                    {ord.note && (
                      <p className="text-[11px] bg-slate-900/80 text-amber-300/90 p-2 rounded-xl italic">
                        "{ord.note}"
                      </p>
                    )}

                    <button
                      onClick={() => handleUpdateStatus(ord.code, 'processing')}
                      className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-md"
                    >
                      <span>Bắt đầu pha chế</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* CỘT 2: ĐANG PHA CHẾ (PROCESSING) */}
        <section className="bg-slate-900/90 rounded-3xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-blue-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
              <h2 className="font-extrabold text-sm text-blue-400 tracking-wider uppercase">Đang Pha Chế</h2>
            </div>
            <span className="text-xs font-mono font-bold bg-blue-500/20 text-blue-300 px-2.5 py-0.5 rounded-full">
              {processingOrders.length}
            </span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4 no-scrollbar">
            {processingOrders.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">Không có đơn đang làm</p>
            ) : (
              processingOrders.map((ord) => (
                <div key={ord.id} className="bg-slate-800/90 rounded-2xl p-4 border border-blue-500/30 space-y-3 shadow-lg shadow-blue-950/20">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-mono font-extrabold text-blue-400 text-sm">#{ord.code}</span>
                    <span className="text-slate-400 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {getElapsedMinutes(ord.created_at)} phút
                    </span>
                  </div>

                  <div className="border-t border-slate-700/60 pt-2 space-y-1.5 text-xs">
                    {ord.items?.map((it) => (
                      <div key={it.id} className="flex justify-between">
                        <span className="font-bold text-slate-100">
                          {it.product?.name} {it.option ? `(${it.option.name})` : ''}
                        </span>
                        <span className="font-mono font-extrabold text-blue-400">x{it.quantity}</span>
                      </div>
                    ))}
                  </div>

                  {ord.note && (
                    <p className="text-[11px] bg-slate-900/80 text-amber-300/90 p-2 rounded-xl italic">
                      "{ord.note}"
                    </p>
                  )}

                  <button
                    onClick={() => handleUpdateStatus(ord.code, 'ready')}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-extrabold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-md"
                  >
                    <span>Làm xong / Báo sẵn sàng</span>
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* CỘT 3: SẴN SÀNG / CHỜ GIAO (READY) */}
        <section className="bg-slate-900/90 rounded-3xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-emerald-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 className="font-extrabold text-sm text-emerald-400 tracking-wider uppercase">Chờ Khách Nhận</h2>
            </div>
            <span className="text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full">
              {readyOrders.length}
            </span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4 no-scrollbar">
            {readyOrders.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">Không có đơn chờ lấy</p>
            ) : (
              readyOrders.map((ord) => (
                <div key={ord.id} className="bg-slate-800/90 rounded-2xl p-4 border border-emerald-500/40 space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-mono font-extrabold text-emerald-400 text-sm">#{ord.code}</span>
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Đã xong
                    </span>
                  </div>

                  <div className="border-t border-slate-700/60 pt-2 space-y-1 text-xs text-slate-300">
                    <p className="font-bold text-white">{ord.customer_name} ({ord.customer_phone})</p>
                    <p className="text-slate-400 text-[11px]">{ord.items?.length} món đồ uống</p>
                  </div>

                  <button
                    onClick={() => handleUpdateStatus(ord.code, 'completed')}
                    className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-extrabold rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <span>Khách đã nhận / Hoàn tất</span>
                    <Check className="w-4 h-4 text-emerald-400" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

      </main>
    </div>
  );
}