import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { getBranch } from './api';
import { storage } from './utils/storage'; // Spec P4-P5: qua module storage (zmp-sdk)

const ShopContext = createContext(null);
export const useShop = () => useContext(ShopContext);

// Giỏ hàng: mỗi dòng {key, product, option, toppings:[], qty, note}
// Persist qua module storage (zmp-sdk trong Zalo) để không mất khi reload/trở lại app.
export function ShopProvider({ children }) {
  const [branch, setBranchState] = useState(() => getBranch());
  const [cart, setCart] = useState(() => {
    return storage.getJSON('zm_cart', []);
  });

  useEffect(() => {
    storage.set('zm_cart', cart);
  }, [cart]);

  const setBranch = (b) => {
    const curId = branch && branch.id;
    const newId = b && b.id;
    // Lát 3b (2026-11-04): đổi chi nhánh khi giỏ còn món → CHẶN, trả false để
    // trang chọn chi nhánh hiện thông báo lý do. Trước đây hỏi bằng
    // window.confirm — hộp thoại nguyên thủy bị webview Zalo nuốt im lặng
    // nên lần chọn "không dính" mà khách không hiểu vì sao (tái hiện #17).
    if (curId && newId && String(curId) !== String(newId) && cart.length > 0) {
      return false;
    }
    setBranchState(b);
    storage.set('zm_branch', b);
    return true;
  };

  const addToCart = (line) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === line.key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + line.qty };
        return next;
      }
      return [...prev, line];
    });
  };

  const updateQty = (key, delta) => {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0)
    );
  };

  const clearCart = () => setCart([]);

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart]
  );
  const count = useMemo(() => cart.reduce((s, l) => s + l.qty, 0), [cart]);

  return (
    <ShopContext.Provider value={{ branch, setBranch, cart, addToCart, updateQty, clearCart, subtotal, count }}>
      {children}
    </ShopContext.Provider>
  );
}
