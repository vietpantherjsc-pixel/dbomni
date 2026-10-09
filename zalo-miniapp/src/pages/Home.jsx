import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, fmt, getProfile, captureRef } from '../api';
import { useShop } from '../store';
import ProductSheet from '../components/ProductSheet';

// Gói 9 (2026-10-05): Trang chủ kiểu GrabFood.
// - Cover nổi bật (đổi trong admin) + nút chọn chi nhánh thay nút "Giao hàng"
// - 2 nút: Đặt đơn nhóm / Chia sẻ (link giới thiệu tính điểm affiliate)
// - Slider khuyến mại, slider Ưu đãi hôm nay (kéo ngang, ẩn scrollbar)
// - Lưới "Dành cho bạn" 2x2 từ món yêu thích (tim đỏ trong admin)
export default function Home() {
  const { branch, cart, count, subtotal } = useShop();
  const [menu, setMenu] = useState([]);
  const [promos, setPromos] = useState([]);
  const [sales, setSales] = useState([]);
  const [shopInfo, setShopInfo] = useState({ cover_url: '', ref_bonus_points: 100 });
  const [topIds, setTopIds] = useState(new Set()); // Gói 34: ids top 10 bán chạy
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(null);
  const nav = useNavigate();

  useEffect(() => { captureRef(); }, []); // Gói 9: giữ mã giới thiệu ?ref=
  useEffect(() => { if (!branch) { nav('/branches'); return; } }, [branch]);

  useEffect(() => { api.menu(branch?.id).then(setMenu).catch(() => {}); }, [branch]); // Gói 25: lọc theo CN
  useEffect(() => { api.shopInfo(branch?.id).then(setShopInfo).catch(() => {}); }, [branch]);
  useEffect(() => { api.saleProducts().then(setSales).catch(() => {}); }, []); // Gói 34: map KM theo món
  useEffect(() => { // Gói 34: top 10 bán chạy theo chi nhánh
    api.topProducts(branch?.id).then((rows) => setTopIds(new Set((rows || []).map((r) => r.product_id)))).catch(() => {});
  }, [branch]);

  useEffect(() => {
    if (!menu.length) return;
    api.eligiblePromotions({ subtotal: 0, items: [], channel: 'online' }).then(setPromos).catch(() => {});
  }, [menu]);

  if (!branch) return null;
  const img = (p) => p.image_url || 'https://via.placeholder.com/300?text=☕';
  const allProducts = menu.flatMap((c) => c.products || []);
  const favorites = allProducts.filter((p) => p.is_favorite);
  const forYou = (favorites.length ? favorites : allProducts).slice(0, 4);
  const saleMap = {}; // Gói 34: KM theo món (từ /sale-products)
  sales.forEach((s) => { saleMap[s.id] = s; });

  const filtered = q    ? menu.map((c) => ({ ...c, products: (c.products || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) })).filter((c) => c.products.length)
    : menu;

  // Gói 9: nút Chia sẻ — copy link giới thiệu (lưu ref để tính điểm affiliate sau này)
  const share = async () => {
    const code = getProfile()?.member_code || '';
    const url = `${window.location.origin}${window.location.pathname}${code ? `?ref=${code}` : ''}`;
    const msg = code
      ? `Đã copy link giới thiệu! Người đặt qua link này, bạn được +${shopInfo.ref_bonus_points} điểm khi đơn hoàn tất.`
      : 'Đã copy link quán! Vào mục Tài khoản nhập SĐT để lấy link giới thiệu riêng của bạn.';
    try {
      await navigator.clipboard.writeText(url);
      alert(msg);
    } catch (e) {
      prompt('Copy link:', url);
    }
  };

  const openSale = (s) => {
    const full = allProducts.find((p) => p.id === s.id);
    if (full) setSheet(full);
  };

  return (
    <div className="zm-page">
      {/* Cover + nút chọn chi nhánh */}
      <div className="zm-cover">
        {shopInfo.cover_url ? (
          <img src={shopInfo.cover_url} alt="cover" onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="zm-cover-fallback">☕</div>
        )}
        <button className="zm-branch-pill" onClick={() => nav('/branches')}>
          📍 {branch.name} ▾
        </button>
      </div>
      <h1 className="zm-branch-name">{branch.name}</h1>

      <div className="zm-search">
        <input placeholder="Tìm món..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* 2 nút hành động */}
      <div className="zm-actions">
        <button className="zm-action-btn primary" onClick={() => nav('/group/new')}>
          <span className="ico">👥</span>
          <span><b>Đặt đơn nhóm</b><small>Tạo link, rủ bạn bè đặt chung</small></span>
        </button>
        <button className="zm-action-btn" onClick={share}>
          <span className="ico">🔗</span>
          <span><b>Chia sẻ</b><small>Nhận điểm khi bạn bè đặt món</small></span>
        </button>
      </div>

      {/* Slider khuyến mại */}
      {promos.length > 0 && (
        <>
          <div className="zm-section-title">🎁 Khuyến mại</div>
          <div className="zm-hscroll">
            {promos.map((p) => (
              <div key={p.id} className="zm-promo-slide">
                <div className="zm-promo-slide-title">{p.name}</div>
                <div className="zm-promo-slide-desc">{p.description || 'Áp dụng tự động khi đặt món'}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Slider Ưu đãi hôm nay */}
      {sales.length > 0 && (
        <>
          <div className="zm-section-title">⚡ Ưu đãi hôm nay</div>
          <div className="zm-hscroll">
            {sales.map((s) => (
              <div key={s.id} className="zm-sale-card" onClick={() => openSale(s)}>
                <img src={s.image_url || 'https://via.placeholder.com/300?text=☕'} alt={s.name} loading="lazy" />
                <div className="zm-sale-badge">-{Math.round((1 - s.sale_price / s.base_price) * 100)}%</div>
                <div className="zm-card-name">{s.name}</div>
                <div>
                  <span className="zm-card-price" style={{ color: '#e11d48' }}>{fmt(s.sale_price)}đ</span>
                  <span className="zm-row-old">{fmt(s.base_price)}đ</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Lưới Dành cho bạn */}
      <div className="zm-section-title">💚 Dành cho bạn</div>
      <div className="zm-grid2">
        {forYou.map((p) => {
          const isTop = topIds.has(p.id); // Gói 34
          const sale = saleMap[p.id];
          return (
            <div key={p.id} className="zm-card" onClick={() => setSheet(p)}>
              {isTop
                ? <div className="zm-badge-hot zm-badge-best">Bán chạy</div>
                : (p.is_favorite && <div className="zm-badge-hot">Được yêu thích</div>)}
              <div className="zm-card-media">
                <img src={img(p)} alt={p.name} loading="lazy" />
                <button className="zm-card-add" aria-label="Thêm món" onClick={(e) => { e.stopPropagation(); setSheet(p); }}>+</button>
              </div>
              <div className="zm-card-body">
                {sale && <div className="zm-promo-line">{sale.promo_name}</div>}
                <div className="zm-card-name">{p.name}</div>
                <div className="zm-card-price">{sale ? (<><span>{fmt(sale.sale_price)}đ</span> <span className="zm-row-old">{fmt(p.base_price)}đ</span></>) : (<>{fmt(p.base_price)}đ</>)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {forYou.length === 0 && <div className="zm-empty">Chưa có món nào.</div>}

      {/* Thực đơn đầy đủ (Gói 34c: bỏ tiêu đề "Thực đơn" theo yêu cầu Đại Vương) */}
      {filtered.map((cat) => (
        <div key={cat.id}>
          <div className="zm-cat-title">{cat.name}</div>
          {(cat.products || []).map((p) => {
            const isTop = topIds.has(p.id); // Gói 34
            const sale = saleMap[p.id];
            return (
              <div key={p.id} className="zm-row-item" onClick={() => setSheet(p)}>
                <img src={img(p)} alt={p.name} loading="lazy" />
                <div className="zm-row-info">
                  {isTop
                    ? <div className="zm-best">Bán chạy</div>
                    : (p.is_favorite && <div style={{ color: '#e11d48', fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Được yêu thích</div>)}
                  {sale && <div className="zm-promo-line">{sale.promo_name}</div>}
                  <div className="zm-row-name">{p.name}</div>
                  {p.description && <div className="zm-row-desc">{p.description}</div>}
                  <div className="zm-row-price">
                    {sale
                      ? (<><span>{fmt(sale.sale_price)}đ</span><span className="zm-row-old">{fmt(p.base_price)}đ</span></>)
                      : (<>{fmt(p.base_price)}đ</>)}
                  </div>
                </div>
                <button className="zm-add-btn" onClick={(e) => { e.stopPropagation(); setSheet(p); }}>+</button>
              </div>
            );
          })}
        </div>
      ))}
      {filtered.length === 0 && <div className="zm-empty">Chưa có món nào.</div>}

      {sheet && <ProductSheet product={sheet} onClose={() => setSheet(null)} />}

      {count > 0 && (
        <div className="zm-cartbar">
          <button className="zm-btn-primary" onClick={() => nav('/cart')}>
            🛒 Xem giỏ hàng · {count} món · {fmt(subtotal)}đ
          </button>
        </div>
      )}
      <TabBar />
    </div>
  );
}

export function TabBar() {
  // Gói 10c: thêm tab Giỏ hàng (luôn hiện, có badge số món) — trước đây giỏ trống thì không có đường vào giỏ
  let count = 0;
  try { count = useShop().count || 0; } catch (e) { /* ngoài provider */ }
  return (
    <nav className="zm-tabbar">
      <Link to="/" className={location.pathname === '/' ? 'on' : ''}><span className="ico">🏠</span>Trang chủ</Link>
      <Link to="/cart" className={location.pathname === '/cart' ? 'on' : ''}>
        <span className="ico" style={{ position: 'relative' }}>🛒
          {count > 0 && <span className="zm-tabbar-badge">{count > 99 ? '99+' : count}</span>}
        </span>Giỏ hàng
      </Link>
      <Link to="/track" className={location.pathname === '/track' ? 'on' : ''}><span className="ico">📦</span>Đơn hàng</Link>
      <Link to="/account" className={location.pathname === '/account' ? 'on' : ''}><span className="ico">👤</span>Tài khoản</Link>
    </nav>
  );
}
