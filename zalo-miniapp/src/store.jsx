import React, { createContext, useContext, useState, useMemo } from 'react';
import { getBranch } from './api';

const ShopContext = createContext(null);
export const useShop = () => useContext(ShopContext);

// Giỏ hàng: mỗi dòng {key, product, option, toppings:[], qty, note}
export function ShopProvider({ children }) {
  const [branch, setBranchState] = useState(() => getBranch());
  const [cart, setCart] = useState([]);

  const setBranch = (b) => {
    setBranchState(b);
    try { localStorage.setItem('zm_branch', JSON.stringify(b)); } catch {}
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
