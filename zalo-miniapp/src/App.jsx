import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ShopProvider } from './store';
import BranchSelect from './pages/BranchSelect';
import Home from './pages/Home';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Success from './pages/Success';
import WaitingPayment from './pages/WaitingPayment'; // Spec QR 2026-10-21: màn "Chờ thanh toán" (L15)
import TrackOrder from './pages/TrackOrder';
import Account from './pages/Account';
import ScanClaim from './pages/ScanClaim'; // Gói 11: quét QR tích điểm
import GroupRoom, { CreateGroup } from './pages/GroupOrder'; // Gói 9: đơn nhóm
import Coupons from './pages/Coupons'; // SPEC-02: ví ưu đãi
import Invite from './pages/Invite'; // SPEC-02: mời bạn
import './index.css';
import { loadTheme, captureRef } from './api';

// Minigame (2026-11-01): trang game + thể lệ tải LƯỜI — code game không vào
// bundle của các trang khác (kiểm chứng ở build: chỉ nằm trong chunk /game)
const GamePage = lazy(() => import('./pages/games/HungTranChau'));
const GameRules = lazy(() => import('./pages/GameRules'));

export default function App() {
  // Gói Đón Bình Minh (2026-10-28): bắt mã mời ngay khi app khởi động (cả 2
  // nguồn: URL + tham số khởi động zmp-sdk) — không phụ thuộc trang đích.
  useEffect(() => { loadTheme(); captureRef(); }, []);
  return (
    <ShopProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/branches" element={<BranchSelect />} />
          <Route path="/" element={<Home />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/success/:code" element={<Success />} />
          <Route path="/pay-wait/:code" element={<WaitingPayment />} />
          <Route path="/track" element={<TrackOrder />} />
          <Route path="/account" element={<Account />} />
          <Route path="/game" element={<Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: '#24305E' }}>Đang tải game…</div>}><GamePage /></Suspense>} />
          <Route path="/game-rules" element={<Suspense fallback={<div style={{ padding: 24, textAlign: 'center', color: '#24305E' }}>Đang tải…</div>}><GameRules /></Suspense>} />
          <Route path="/scan" element={<ScanClaim />} />
          <Route path="/group/new" element={<CreateGroup />} />
          <Route path="/group/:code" element={<GroupRoom />} />
          <Route path="/coupons" element={<Coupons />} />
          <Route path="/invite" element={<Invite />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ShopProvider>
  );
}
