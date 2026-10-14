import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, fmt, priceOf, imgUrl, getProfile, captureRef } from '../api';
import { useShop } from '../store';
import ProductSheet from '../components/ProductSheet';

// Gói 55 p1: tính trạng thái mở/đóng cửa từ giờ mở cửa chi nhánh.
import { openStatus } from '../utils/openingHours';

// Gói 55 p10: openStatus chuyển vào utils/openingHours.js để Checkout dùng chung

// Gói 55 p2: icon SVG đơn sắc, hiện đại (hạn chế màu)
const Ic = {
  users: (s = 18) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>),
  search: (s = 18) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>),
  chevD: (s = 16) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>),
};

// Gói 9 (2026-10-05): Trang chủ kiểu GrabFood.
// - Cover nổi bật (đổi trong admin) + nút chọn chi nhánh thay nút "Giao hàng"
// - 2 nút: Đặt đơn nhóm / Chia sẻ (link giới thiệu tính điểm affiliate)
// - Slider khuyến mại, slider Ưu đãi hôm nay (kéo ngang, ẩn scrollbar)
// - Lưới "Dành cho bạn" 2x2 từ món yêu thích (tim đỏ trong admin)
export default function Home() {
  const { branch, setBranch, cart, count, subtotal } = useShop();
  const [menu, setMenu] = useState([]);
  const [promos, setPromos] = useState([]);
  const [sales, setSales] = useState([]);
  const [shopInfo, setShopInfo] = useState({ cover_url: '', ref_bonus_points: 100 });
  const [topIds, setTopIds] = useState(new Set()); // Gói 34: ids top 10 bán chạy
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(null);
  const [stuck, setStuck] = useState(false); // Gói 55 p2: hiện sticky header khi lướt qua card
  const [menuOpen, setMenuOpen] = useState(false); // Gói 55 p2: dropdown chọn nhanh thực đơn
  const [searchOpen, setSearchOpen] = useState(false); // Gói 55 p2: mở ô tìm kiếm từ icon
  const [selCat, setSelCat] = useState(null); // Gói 55 p2: thực đơn đang chọn trong dropdown
  const nav = useNavigate();

  useEffect(() => { captureRef(); }, []); // Gói 9: giữ mã giới thiệu ?ref=
  useEffect(() => { if (!branch) { nav('/branches'); return; } }, [branch]);

  useEffect(() => { api.menu(branch?.id).then(setMenu).catch(() => {}); }, [branch]); // Gói 25: lọc theo CN
  useEffect(() => { api.shopInfo(branch?.id).then(setShopInfo).catch(() => {}); }, [branch]);
  // Gói 55 p2: làm mới thông tin chi nhánh (SĐT, giờ mở cửa) — tránh cache localStorage cũ thiếu dữ liệu
  useEffect(() => {
    if (!branch?.id || branch.opening_hours !== undefined) return;
    api.branches().then((list) => {
      const fresh = (list || []).find((b) => String(b.id) === String(branch.id));
      if (fresh) setBranch(fresh);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { api.saleProducts().then(setSales).catch(() => {}); }, []); // Gói 34: map KM theo món
  useEffect(() => { // Gói 34: top 10 bán chạy theo chi nhánh
    api.topProducts(branch?.id).then((rows) => setTopIds(new Set((rows || []).map((r) => r.product_id)))).catch(() => {});
  }, [branch]);

  useEffect(() => {
    if (!menu.length) return;
    api.eligiblePromotions({ subtotal: 0, items: [], channel: 'online' }).then(setPromos).catch(() => {});
  }, [menu]);

  // Gói 55 p2: theo dõi scroll để hiện sticky header
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 260);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Gói 55 p2b: chạm ra ngoài → tự ẩn dropdown thực đơn + khung tìm kiếm
  const stickyRef = React.useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (stickyRef.current && !stickyRef.current.contains(e.target)) {
        setMenuOpen(false);
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, []);

  // Gói 55 p2b: tên thực đơn trong ô tự đổi theo vị trí user đang xem (scroll-spy)
  // Dùng `menu` thay vì `filtered` để tránh lỗi temporal dead zone (filtered khai báo sau return)
  useEffect(() => {
    if (!menu.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          const id = Number(en.target.id.replace('zm-cat-', ''));
          setSelCat(id);
        }
      });
    }, { rootMargin: '-120px 0px -60% 0px' });
    menu.forEach((c) => {
      const el = document.getElementById(`zm-cat-${c.id}`);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [menu]);

  // Gói 55 p2: nhảy tới thực đơn
  const jumpToCat = (id) => {
    setSelCat(id);
    setMenuOpen(false);
    const el = document.getElementById(`zm-cat-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
      {/* Gói 55 p2: sticky header khi lướt xuống */}
      {stuck && (
        <div className="zm-sticky" ref={stickyRef}>
          <div className="zm-sticky-top">
            <div className="zm-sticky-name">{branch.name}</div>
            <button className="zm-sticky-group" onClick={() => nav('/group/new')}>
              {Ic.users(16)} Đặt đơn nhóm
            </button>
          </div>
          <div className="zm-sticky-nav">
            <div className="zm-menu-wrap">
              <button className="zm-menu-select" onClick={() => setMenuOpen((v) => !v)}>
                <span>{menu.find((c) => c.id === selCat)?.name || 'Thực đơn'}</span>
                {Ic.chevD(16)}
              </button>
              {menuOpen && (
                <div className="zm-menu-drop">
                  {filtered.map((c) => (
                    <button key={c.id} onClick={() => jumpToCat(c.id)}>{c.name}</button>
                  ))}
                </div>
              )}
            </div>
            <button className="zm-search-ic" onClick={() => setSearchOpen((v) => !v)} aria-label="Tìm món">
              {Ic.search(18)}
            </button>
          </div>
          {searchOpen && (
            <div className="zm-sticky-search">
              <input placeholder="Tìm món..." value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </div>
          )}
        </div>
      )}
      {/* Cover + nút chọn chi nhánh */}
      <div className="zm-cover">
        {shopInfo.cover_url ? (
          <img src={imgUrl(shopInfo.cover_url)} alt="cover" onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="zm-cover-fallback">☕</div>
        )}
        <button className="zm-branch-pill" onClick={() => nav('/branches')}>
          📍 {branch.name} ▾
        </button>
      </div>
      {/* Gói 55 p1: card thông tin chi nhánh theo style ảnh mẫu — SĐT + trạng thái mở cửa */}
      <div className="zm-branch-card">
        <div className="zm-branch-card-name">{branch.name}</div>
        {branch.address && (
          <div className="zm-branch-card-row"><span>📍</span><span>{branch.address}</span></div>
        )}
        {branch.phone && (
          <div className="zm-branch-card-row"><span>📞</span><span>{branch.phone}</span></div>
        )}
        {(() => {
          const st = openStatus(branch);
          if (!st) return null;
          return (
            <div className="zm-branch-card-row">
              <span>🕐</span>
              <span className={st.open ? 'zm-open' : 'zm-closed'}>
                {st.open ? 'Đang mở cửa' : 'Đã đóng cửa'}
                {st.hours && <span className="zm-hours"> · {st.hours}</span>}
              </span>
            </div>
          );
        })()}
        {/* Gói 55 p1: 2 nút segmented nằm TRONG card, giống demo */}
        <div className="zm-seg in-card">
          <button className="zm-seg-btn active" onClick={() => nav('/group/new')}>
            👥 Đặt đơn nhóm
          </button>
          <button className="zm-seg-btn" onClick={share}>
            🔗 Chia sẻ
          </button>
        </div>
      </div>

      <div className="zm-search">
        <input placeholder="Tìm món..." value={q} onChange={(e) => setQ(e.target.value)} />
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
                <div className="zm-sale-badge">-{Math.round((1 - s.sale_price / priceOf(s)) * 100)}%</div>
                <div className="zm-card-name">{s.name}</div>
                <div>
                  <span className="zm-card-price" style={{ color: '#e11d48' }}>{fmt(s.sale_price)}đ</span>
                  <span className="zm-row-old">{fmt(priceOf(s))}đ</span>
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
                <div className="zm-card-price">{sale ? (<><span>{fmt(sale.sale_price)}đ</span> <span className="zm-row-old">{fmt(priceOf(p))}đ</span></>) : (<>{fmt(priceOf(p))}đ</>)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {forYou.length === 0 && <div className="zm-empty">Chưa có món nào.</div>}

      {/* Thực đơn đầy đủ (Gói 34c: bỏ tiêu đề "Thực đơn" theo yêu cầu Đại Vương) */}
      {filtered.map((cat) => (
        <div key={cat.id} id={`zm-cat-${cat.id}`}>
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
                      ? (<><span>{fmt(sale.sale_price)}đ</span><span className="zm-row-old">{fmt(priceOf(p))}đ</span></>)
                      : (<>{fmt(priceOf(p))}đ</>)}
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
        <div className="zm-cartbar above-tab">
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
