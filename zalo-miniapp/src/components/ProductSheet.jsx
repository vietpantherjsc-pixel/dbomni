import React, { useState, useMemo } from 'react';
import { fmt } from '../api';
import { useShop } from '../store';

// Sheet chi tiết món kiểu Grab.
// Gói 7g: dùng optionGroups thật (Size/Độ ngọt/Đá/Topping) thay vì đoán theo tên.
export default function ProductSheet({ product, onClose, onAdd, addLabel }) {
  const { addToCart } = useShop();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  // Gói 7g: lựa chọn theo nhóm {groupId: id | [ids]}
  const [sel, setSel] = useState({});
  // Fallback cũ (khi món chưa có nhóm)
  const [sizeId, setSizeId] = useState(null);
  const [toppings, setToppings] = useState([]);

  const groups = useMemo(
    () => (product.option_groups || []).filter((g) => g.options && g.options.length),
    [product]
  );
  const useGroups = groups.length > 0;

  const sizes = useMemo(() => (product.options || []).filter((o) => /size/i.test(o.name)), [product]);
  const extras = useMemo(() => (product.options || []).filter((o) => !/size/i.test(o.name)), [product]);

  // Giá = giá gốc + tổng giá các tùy chọn đã chọn
  const selectedOpts = useMemo(() => {
    if (!useGroups) return [];
    const out = [];
    for (const g of groups) {
      const v = sel[g.id];
      if (v === undefined || v === null) continue;
      const ids = Array.isArray(v) ? v : [v];
      for (const id of ids) {
        const o = g.options.find((x) => x.id === id);
        if (o) out.push(o);
      }
    }
    return out;
  }, [groups, sel, useGroups]);

  const size = sizes.find((o) => o.id === sizeId);
  const unitPrice = useGroups
    ? Number(product.base_price) + selectedOpts.reduce((s, o) => s + Number(o.additional_price || 0), 0)
    : Number(product.base_price) + (size ? Number(size.additional_price) : 0)
      + toppings.reduce((s, t) => s + Number(t.additional_price), 0);

  const pickSingle = (gid, oid) => setSel((p) => ({ ...p, [gid]: oid }));
  const toggleMulti = (gid, oid) => setSel((p) => {
    const cur = Array.isArray(p[gid]) ? p[gid] : [];
    return { ...p, [gid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] };
  });
  const toggleTopping = (t) => {
    setToppings((prev) => prev.some((x) => x.id === t.id) ? prev.filter((x) => x.id !== t.id) : [...prev, t]);
  };

  const needRequired = useGroups
    ? groups.some((g) => g.is_required && (sel[g.id] === undefined || (Array.isArray(sel[g.id]) && !sel[g.id].length)))
    : sizes.some((o) => o.is_required) && !size;

  const add = () => {
    const optNames = useGroups
      ? selectedOpts.map((o) => o.name)
      : [size ? size.name : null, ...toppings.map((t) => t.name)];
    const key = useGroups
      ? [product.id, selectedOpts.map((o) => o.id).sort().join('-'), note].join('|')
      : [product.id, sizeId || 0, toppings.map((t) => t.id).sort().join('-'), note].join('|');
    const optionIds = useGroups ? selectedOpts.map((o) => o.id) : [sizeId, ...toppings.map((t) => t.id)].filter(Boolean);
    const line = {
      key,
      optionIds,
      product: { id: product.id, name: product.name, base_price: product.base_price, image_url: product.image_url },
      optionId: useGroups ? null : sizeId,
      optionName: useGroups ? null : (size ? size.name : null),
      toppings: useGroups ? [] : toppings.map((t) => t.name),
      unitPrice,
      qty,
      note,
      optText: optNames.filter(Boolean).join(', '),
    };
    if (onAdd) onAdd(line); else addToCart(line); // Gói 9: đơn nhóm dùng onAdd riêng
    onClose();
  };

  const renderOpt = (o, checked, onPick, radio) => (
    <div key={o.id} className="zm-opt" onClick={onPick}>
      <div className={`zm-opt-check ${radio ? 'radio' : ''} ${checked ? 'on' : ''}`}>{checked ? (radio ? '●' : '✓') : ''}</div>
      <span>{o.name}</span>
      {Number(o.additional_price) > 0 && <span className="zm-opt-price">+{fmt(o.additional_price)}đ</span>}
    </div>
  );

  return (
    <div className="zm-modal-mask" onClick={onClose}>
      <div className="zm-sheet" onClick={(e) => e.stopPropagation()}>
        <img className="zm-sheet-hero" src={product.image_url || 'https://via.placeholder.com/400?text=☕'} alt={product.name} />
        <div className="zm-sheet-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h2 style={{ fontSize: 18 }}>{product.name}</h2>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{fmt(product.base_price)}đ</div>
              <div style={{ fontSize: 11, color: '#aaa' }}>Giá gốc</div>
            </div>
          </div>
          {product.description && <p style={{ fontSize: 13, color: '#666', marginTop: 8, lineHeight: 1.5 }}>{product.description}</p>}

          {useGroups ? groups.map((g) => {
            const isSingle = g.type === 'single';
            return (
              <div key={g.id} className="zm-opt-group">
                <div className="zm-opt-title">
                  {g.name} <span className={`zm-opt-hint ${g.is_required ? 'req' : ''}`}>
                    {g.is_required ? 'Bắt buộc' : 'Không bắt buộc'} · {isSingle ? 'Chọn 1' : 'Chọn nhiều'}
                  </span>
                </div>
                {g.options.map((o) => {
                  const v = sel[g.id];
                  const checked = isSingle ? v === o.id : (Array.isArray(v) && v.includes(o.id));
                  return renderOpt(o, checked, () => (isSingle ? pickSingle(g.id, o.id) : toggleMulti(g.id, o.id)), isSingle);
                })}
              </div>
            );
          }) : (
            <>
              {sizes.length > 0 && (
                <div className="zm-opt-group">
                  <div className="zm-opt-title">Kích thước <span className={`zm-opt-hint ${sizes.some((o) => o.is_required) ? 'req' : ''}`}>{sizes.some((o) => o.is_required) ? 'Chọn 1' : 'Không bắt buộc'}</span></div>
                  {sizes.map((o) => renderOpt(o, sizeId === o.id, () => setSizeId(o.id), true))}
                </div>
              )}
              {extras.length > 0 && (
                <div className="zm-opt-group">
                  <div className="zm-opt-title">Thêm <span className="zm-opt-hint">Không bắt buộc</span></div>
                  {extras.map((o) => renderOpt(o, toppings.some((x) => x.id === o.id), () => toggleTopping(o), false))}
                </div>
              )}
            </>
          )}

          <div className="zm-field" style={{ marginTop: 16 }}>
            <input placeholder="Ghi chú (ít đá, ít đường...)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {/* Gói 10h: căn giữa cụm stepper (trước space-between với 1 con nên dính lề trái) */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '16px 0' }}>
            <div className="zm-qty">
              <button onClick={() => setQty((v) => Math.max(1, v - 1))}>−</button>
              <span>{qty}</span>
              <button onClick={() => setQty((v) => Math.min(20, v + 1))}>+</button>
            </div>
          </div>

          <button className="zm-btn-primary" disabled={needRequired} onClick={add}>
            {addLabel || 'Thêm vào giỏ hàng'} - {fmt(unitPrice * qty)}đ
          </button>
          <div style={{ height: 12 }} />
        </div>
      </div>
    </div>
  );
}
