import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, getProfile, profileIdentity, authWithZalo } from '../../api';
import ConsentCheck from '../../components/ConsentCheck';
import { generateSchedule, scoreFromCounters, casualParams, casualType } from './hungTranChauEngine';
// Tài sản hình NGUYÊN BẢN của Đại Vương (không vẽ lại): chi tiết chữ K +
// mặt trời crop từ file logo gốc (huy hiệu thẻ chia sẻ + biểu tượng điểm);
// toàn bộ hình trong game (ly + 5 vật) tách từ TỜ ASSETS ngài vẽ
// (gamehungtranchau.png) bằng tách nền trắng→trong suốt, giữ nguyên nét.
import kSunUrl from '../../assets/daybreak-k-sun.png';
import cupUrl from '../../assets/game-cup.png';
import pearlUrl from '../../assets/game-pearl.png';
import leafUrl from '../../assets/game-tea-leaf.png';
import coffeeUrl from '../../assets/game-coffee-bean.png';
import burntUrl from '../../assets/game-burnt-bean.png';
import specialUrl from '../../assets/game-special.png';

const kSunImg = new Image();
kSunImg.src = kSunUrl;
const SPRITES = {};
for (const [key, url] of Object.entries({ cup: cupUrl, pearl: pearlUrl, leaf: leafUrl, coffee: coffeeUrl, burnt: burntUrl, sun: specialUrl })) {
  const im = new Image();
  im.src = url;
  SPRITES[key] = im;
}
// Bọc 1 promise với hạn giờ: quá hạn thì reject để chuỗi rơi xuống tầng dự
// phòng, KHÔNG BAO GIỜ treo câm. (Gốc lỗi 2026-11-01: bước tải thẻ lên và
// openShareSheet không có timeout — 1 lần nghẽn mạng là đứng mãi ở dòng
// "Đang dựng thẻ chia sẻ…", không rơi được xuống tầng dự phòng nào.)
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('share-timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Đường bo góc an toàn mọi webview: ctx.roundRect là API mới (Chrome 99+/
// Safari 16+) — webview Zalo trên máy đời cũ chưa có, gọi thẳng sẽ văng và
// làm gãy bước dựng thẻ chia sẻ (lỗi máy thật 2026-11-07: app rơi vào dòng
// "Không dựng được thẻ"). Có sẵn thì dùng, không thì tự đi đường bo bằng
// arcTo — hình ra giống hệt.
function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Vẽ 1 sprite canh giữa tại (0,0) theo chiều cao h, giữ đúng tỉ lệ thật
function drawSprite(ctx, img, h) {
  if (!img.complete || img.naturalWidth === 0) return;
  const w = (h * img.naturalWidth) / img.naturalHeight;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
}

// =====================================================================
// Minigame G1 "Hứng Trân Châu" (2026-11-01) — trang /game tải lười.
// 2 chế độ: Có thưởng (phiên server cấp seed, server tính thưởng — client
// chỉ hiển thị) và Giải trí (cục bộ hoàn toàn, chỉ lưu kỷ lục cá nhân).
// Mọi số (mốc/trần/điểm từng vật/thời lượng) lấy từ API state + snapshot
// phiên — không hardcode. Toàn bộ hình ly + vật trong game là TRANH GỐC
// của Đại Vương tách từ tờ assets (src/assets/game-*.png, lệnh 2026-11-01).
// =====================================================================
const W = 360;
const H = 450;
const CUP_W = 84;
const CUP_H = Math.round(CUP_W * 1.35);
const CUP_TOP = H - CUP_H - 10;
const CATCH_Y = CUP_TOP + 8;
const R = 14;
const NAVY = '#24305E';

const identity = () => profileIdentity(getProfile());
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Biểu tượng K + mặt trời NGUYÊN BẢN (ảnh crop từ logo gốc) cho các vị trí
// DOM: HUD, đầu trang, chú thích điểm — thay bản tự vẽ đã bị bác.
export function SunMarkIcon({ size = 16, style }) {
  return (
    <img src={kSunUrl} alt="Daybreak" style={{ height: Math.round(size * 1.34), width: 'auto', display: 'inline-block', ...style }} />
  );
}

// ---------- Ly hứng (tranh gốc của Đại Vương) tại (cx, top), bề ngang w ----------
export function drawCup(ctx, cx, top, w) {
  // Ly = tranh nguyên bản của Đại Vương đã có sẵn logo trên thân (không đè
  // thêm lớp logo nào). Giữ khung hình học cũ: chiều cao = 1,35 × bề ngang
  // danh nghĩa; bề ngang thật theo tỉ lệ ảnh, canh giữa tại cx.
  const h = w * 1.35;
  const img = SPRITES.cup;
  if (img.complete && img.naturalWidth > 0) {
    const iw = (h * img.naturalWidth) / img.naturalHeight;
    ctx.drawImage(img, cx - iw / 2, top, iw, h);
  }
}

// ---------- Vẽ vật rơi (vector, mục 8) ----------
function drawItem(ctx, type, x, y) {
  // Mọi vật rơi = tranh nguyên bản của Đại Vương (drawImage), kích thước
  // hiển thị neo theo R như engine hiện tại, tỉ lệ theo ảnh thật từng vật.
  ctx.save();
  ctx.translate(x, y);
  if (type === 'pearl') drawSprite(ctx, SPRITES.pearl, R * 2);
  else if (type === 'leaf') drawSprite(ctx, SPRITES.leaf, R * 2.7);
  else if (type === 'coffee') drawSprite(ctx, SPRITES.coffee, R * 1.9);
  else if (type === 'burnt') drawSprite(ctx, SPRITES.burnt, R * 2.7);
  else if (type === 'sun') drawSprite(ctx, SPRITES.sun, R * 3.6);
  ctx.restore();
}

const ITEM_LABEL = {
  pearl: 'Trân châu', leaf: 'Lá trà', coffee: 'Hạt cà phê', sun: 'Mặt trời', burnt: 'Hạt cháy',
};

export default function HungTranChau() {
  const nav = useNavigate();
  const [state, setState] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [mode, setMode] = useState('reward');
  // Spec đăng ký Zalo B §2.3: lối vào phụ ở trang Minigame — khách chưa có
  // định danh bấm chế độ có thưởng → lời dẫn + nút Zalo (dùng chung authWithZalo
  // và component đồng ý với trang Tài khoản, không chép luồng thứ hai).
  const [gameAgree, setGameAgree] = useState(false);
  const [gameZaloBusy, setGameZaloBusy] = useState(false);
  const [gameB3, setGameB3] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle|starting|playing|submitting|result|aborted
  const [hud, setHud] = useState({ score: 0, misses: 0, timeLeft: 0, elapsed: 0 });
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [shareCardImg, setShareCardImg] = useState('');
  const canvasRef = useRef(null);
  const gameRef = useRef(null); // toàn bộ trạng thái vòng lặp (ngoài React)
  const rafRef = useRef(0);
  const finishRef = useRef(null); // vòng lặp (đóng gói 1 lần) gọi bản finishGame mới nhất qua ref này

  const profile = getProfile();
  const myPoints = profile?.points ?? null;

  const modePickedRef = useRef(false); // chế độ mặc định chỉ chọn 1 lần lúc mở trang
  const shareBusyRef = useRef(false); // chặn bấm đúp nút Chia sẻ khi chuỗi đang chạy
  const loadState = useCallback(() => {
    api.minigameState(identity())
      .then((d) => {
        setState(d);
        // Nạp lại state sau mỗi phiên KHÔNG được đổi chế độ đang chọn —
        // trước đây dòng này nhảy Giải trí → Có thưởng khi còn lượt (lỗi
        // Đại Vương báo 2026-11-01). Chỉ lần tải đầu tiên mới tự chọn.
        if (!modePickedRef.current) {
          modePickedRef.current = true;
          setMode(d.plays_left_today > 0 ? 'reward' : 'casual');
        }
      })
      .catch(() => setLoadErr(true));
  }, []);
  useEffect(() => { loadState(); }, [loadState]);

  const stopLoop = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };

  // ---------- Vòng lặp chơi ----------
  const runLoop = useCallback(() => {
    const cv = canvasRef.current;
    const g = gameRef.current;
    if (!cv || !g) return;
    const ctx = cv.getContext('2d');
    let lastTs = performance.now();
    let lastHudSec = -1;

    const frame = (ts) => {
      if (!gameRef.current || gameRef.current !== g || g.ended) return;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const elapsed = ts - g.startAt - g.pausedTotal;
      g.elapsed = elapsed;

      // Sinh vật rơi
      if (g.mode === 'reward') {
        while (g.spawnIdx < g.schedule.length && g.schedule[g.spawnIdx].t_ms <= elapsed) {
          const ev = g.schedule[g.spawnIdx++];
          g.items.push({ type: ev.type, x: (ev.x / 100) * W, y: -R - 4, speed: ev.speed, counted: false });
        }
      } else if (elapsed >= g.nextSpawnAt) {
        const tSec = elapsed / 1000;
        const p = casualParams(tSec);
        const mk = () => ({ type: casualType(tSec), x: 24 + Math.random() * (W - 48), y: -R - 4, speed: p.speed * (0.9 + Math.random() * 0.25), counted: false });
        g.items.push(mk());
        if (Math.random() < p.pairChance) g.items.push(mk());
        g.nextSpawnAt = elapsed + p.intervalMs * (0.75 + Math.random() * 0.5);
      }

      // Ly đuổi theo ngón kéo (mượt)
      g.cupX += (g.targetX - g.cupX) * Math.min(1, dt * 20);
      g.cupX = Math.max(CUP_W / 2, Math.min(W - CUP_W / 2, g.cupX));

      // Di chuyển + hứng/hụt
      const pts = g.config;
      for (const it of g.items) {
        it.y += it.speed * dt;
        if (!it.counted && it.y >= CATCH_Y) {
          it.counted = true;
          if (Math.abs(it.x - g.cupX) <= CUP_W / 2 - 2) {
            it.caught = true;
            g.counters[it.type] = (g.counters[it.type] || 0) + 1;
            const val = it.type === 'burnt' ? -Number(pts.mg_htc_points_burnt || 0) : Number(pts[`mg_htc_points_${it.type}`] || 0);
            g.floaters.push({ x: it.x, y: CATCH_Y - 14, text: `${val > 0 ? '+' : ''}${val}`, color: val >= 0 ? NAVY : '#D43A2F', t0: ts });
          }
        }
        if (!it.caught && it.y > H + R + 4 && !it.missed) {
          it.missed = true;
          if (it.type !== 'burnt') {
            g.counters.misses = (g.counters.misses || 0) + 1;
          }
        }
      }
      g.items = g.items.filter((it) => !it.caught && !it.missed);
      g.floaters = g.floaters.filter((f) => ts - f.t0 < 800);

      // Vẽ sân
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#F7F9FD'); bg.addColorStop(1, '#E9EDF6');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      for (const it of g.items) drawItem(ctx, it.type, it.x, it.y);
      drawCup(ctx, g.cupX, CUP_TOP, CUP_W);
      ctx.textAlign = 'center';
      for (const f of g.floaters) {
        const k = (ts - f.t0) / 800;
        ctx.globalAlpha = 1 - k;
        ctx.font = '800 17px system-ui, sans-serif';
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y - k * 26);
      }
      ctx.globalAlpha = 1;

      // HUD + điều kiện kết thúc
      const score = scoreFromCounters(g.counters, g.config);
      const misses = g.counters.misses || 0;
      const maxMisses = Number(g.config.mg_htc_max_misses || 3);
      const hudSec = Math.floor(elapsed / 250);
      if (hudSec !== lastHudSec) {
        lastHudSec = hudSec;
        setHud({
          score, misses, elapsed,
          timeLeft: g.mode === 'reward' ? Math.max(0, (g.durationMs - elapsed) / 1000) : elapsed / 1000,
        });
      }
      if (misses >= maxMisses || (g.mode === 'reward' && elapsed >= g.durationMs)) {
        g.ended = true;
        finishRef.current?.(Math.round(elapsed));
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spec đăng ký Zalo B §2.3: đăng ký từ trang game, xong quay lại chơi có thưởng
  // với định danh mới (loadState nạp lại lượt/thưởng; identity() đọc hồ sơ mới).
  const handleGameZaloRegister = async () => {
    if (!gameAgree) return;
    setGameZaloBusy(true);
    try {
      const json = await authWithZalo();
      if (json.code === 'not_zalo') { alert('Chức năng này chỉ hoạt động trên Zalo Mini App thật.'); return; }
      if (!json.success) {
        if (json.code === 'phone_permission_required') { setGameB3(true); return; }
        alert(json.message || 'Không đăng ký được bằng Zalo.');
        return;
      }
      setGameB3(false);
      loadState();
    } catch { /* từ chối hộp thoại quyền Zalo → giữ nguyên trang */ }
    finally { setGameZaloBusy(false); }
  };

  const startGame = async () => {
    setNotice(''); setResult(null); setShareStatus(''); setShareCardImg('');
    if (mode === 'reward') {
      setPhase('starting');
      try {
        const s = await api.minigameSession(identity(), state.game_id);
        const config = s.config;
        gameRef.current = {
          mode: 'reward', sessionId: s.session_id, config,
          schedule: generateSchedule(s.seed, config), spawnIdx: 0,
          durationMs: Number(config.mg_htc_duration_seconds || 45) * 1000,
          items: [], floaters: [], counters: { misses: 0 },
          cupX: W / 2, targetX: W / 2, startAt: performance.now(), pausedTotal: 0, elapsed: 0, ended: false,
        };
        setPhase('playing');
        runLoop();
      } catch (e) {
        setPhase('idle');
        setNotice(e.message || 'Không cấp được phiên chơi.');
        loadState();
      }
    } else {
      const pts = state.game?.points || {};
      const config = {
        mg_htc_points_pearl: pts.pearl, mg_htc_points_leaf: pts.leaf,
        mg_htc_points_coffee: pts.coffee, mg_htc_points_sun: pts.sun,
        mg_htc_points_burnt: pts.burnt, mg_htc_max_misses: state.game?.max_misses || 3,
      };
      gameRef.current = {
        mode: 'casual', config, items: [], floaters: [], counters: { misses: 0 },
        nextSpawnAt: 0, cupX: W / 2, targetX: W / 2,
        startAt: performance.now(), pausedTotal: 0, elapsed: 0, ended: false,
      };
      setPhase('playing');
      runLoop();
    }
  };

  const finishGame = async (durationMs) => {
    const g = gameRef.current;
    stopLoop();
    if (!g) return;
    const claimed = scoreFromCounters(g.counters, g.config);
    if (g.mode === 'casual') {
      const prevBest = state.casual_best?.score || 0;
      let bestData = null;
      try {
        bestData = await api.minigameBest(identity(), { game_id: state.game_id, score: claimed, duration_ms: durationMs });
      } catch { /* kỷ lục chỉ là phụ — lỗi mạng không chặn màn kết quả */ }
      setResult({
        mode: 'casual', score: claimed, durationMs,
        best: bestData?.best_score ?? Math.max(prevBest, claimed),
        isNewBest: claimed > prevBest,
      });
      setPhase('result');
      loadState();
      return;
    }
    setPhase('submitting');
    try {
      const r = await api.minigameSubmit(identity(), {
        session_id: g.sessionId, duration_ms: durationMs,
        counters: g.counters, claimed_score: claimed,
      });
      setResult({ mode: 'reward', ...r });
      setPhase('result');
      loadState();
    } catch (e) {
      // Giữ nguyên dữ kiện để nộp lại (phiên còn hạn nộp theo TTL server)
      setResult({ mode: 'reward', error: e.message || 'Không nộp được kết quả.', durationMs, claimed });
      setPhase('result');
    }
  };

  finishRef.current = finishGame;

  const retrySubmit = async () => {
    const g = gameRef.current;
    if (!g || g.mode !== 'reward') return;
    setPhase('submitting');
    try {
      const r = await api.minigameSubmit(identity(), {
        session_id: g.sessionId, duration_ms: result.durationMs,
        counters: g.counters, claimed_score: result.claimed,
      });
      setResult({ mode: 'reward', ...r });
      setPhase('result');
      loadState();
    } catch (e) {
      setResult({ mode: 'reward', error: e.message || 'Không nộp được kết quả.', durationMs: result.durationMs, claimed: result.claimed });
      setPhase('result');
    }
  };

  // Tạm dừng khi app bị ẩn: có thưởng → hủy phiên (không nộp, lượt đã trừ theo
  // thể lệ); giải trí → chỉ dừng đồng hồ, chơi tiếp được (mục 6.2.6)
  useEffect(() => {
    const onVis = () => {
      const g = gameRef.current;
      if (!g || phase !== 'playing') return;
      if (document.hidden) {
        g.hiddenAt = performance.now();
        if (g.mode === 'reward') {
          g.ended = true;
          stopLoop();
          setPhase('aborted');
          loadState();
        }
      } else if (g.hiddenAt) {
        g.pausedTotal += performance.now() - g.hiddenAt;
        g.hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, loadState]);

  useEffect(() => () => stopLoop(), []);

  const onPointer = (e) => {
    const g = gameRef.current;
    const cv = canvasRef.current;
    if (!g || !cv || phase !== 'playing') return;
    const rect = cv.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    g.targetX = ((clientX - rect.left) / rect.width) * W;
  };

  // ---------- Chia sẻ thẻ kết quả (mục 9 — 3 tầng dự phòng, không chặn kết quả) ----------
  const buildShareCard = (score, modeLabel, dateStr) => {
    const cv = document.createElement('canvas');
    cv.width = 600; cv.height = 760;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 600, 760);
    ctx.fillStyle = NAVY; ctx.fillRect(0, 0, 600, 120);
    // Chi tiết K + mặt trời NGUYÊN BẢN ở header — đặt trong huy hiệu trắng
    // bo góc để thân k navy nổi trên nền header navy
    roundedRectPath(ctx, 22, 14, 92, 92, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    if (kSunImg.complete && kSunImg.naturalWidth > 0) {
      const ih = 84;
      const iw = (ih * kSunImg.naturalWidth) / kSunImg.naturalHeight;
      ctx.drawImage(kSunImg, 68 - iw / 2, 60 - ih / 2, iw, ih);
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('daybreak', 126, 62);
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText('Tea & Coffee', 128, 94);
    ctx.fillStyle = NAVY;
    ctx.textAlign = 'center';
    ctx.font = '800 40px system-ui, sans-serif';
    ctx.fillText('Hứng Trân Châu', 300, 200);
    ctx.font = '800 110px system-ui, sans-serif';
    ctx.fillText(fmt(score), 300, 330);
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillStyle = '#5B6478';
    ctx.fillText(`điểm · ${modeLabel} · ${dateStr}`, 300, 380);
    drawCup(ctx, 300, 430, 150);
    ctx.fillStyle = '#8A93A6';
    ctx.font = '500 21px system-ui, sans-serif';
    ctx.fillText('Chơi Hứng Trân Châu tại Mini App Daybreak — mục Tài khoản', 300, 716);
    return cv.toDataURL('image/png');
  };

  const doShare = async () => {
    if (!result || shareBusyRef.current) return;
    shareBusyRef.current = true;
    try {
      setShareStatus('Đang dựng thẻ chia sẻ…');
      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
      const score = result.mode === 'reward' ? (result.verified_score ?? result.claimed ?? 0) : result.score;
      let dataUrl = '';
      try {
        dataUrl = buildShareCard(score, result.mode === 'reward' ? 'Có thưởng' : 'Giải trí', dateStr);
      } catch {
        // Kể cả dựng thẻ lỗi cũng phải có trạng thái cuối rõ ràng
        setShareStatus('Không dựng được thẻ — bạn hãy chụp màn hình kết quả này để chia sẻ nhé.');
        return;
      }
      // Tầng ảnh: tải thẻ lên (hạn 10s) rồi mở khung chia sẻ ảnh (hạn 15s).
      // Mọi await đều qua withTimeout — nghẽn ở đâu cũng reject để rơi tầng.
      let uploadedUrl = '';
      try {
        const r = await withTimeout(api.minigameShareCard(identity(), dataUrl.split(',')[1]), 10000);
        uploadedUrl = r.url;
        const { openShareSheet } = await import('zmp-sdk/apis');
        await withTimeout(openShareSheet({ type: 'image', data: { imageUrls: [uploadedUrl] } }), 15000);
        setShareStatus('');
        return;
      } catch { /* rơi xuống tầng dự phòng */ }
      // Tầng zmp (theo §9): tải ảnh thành công → kèm thumbnail là URL thẻ;
      // tải ảnh LỖI/quá hạn → vẫn thử zmp không thumbnail (chỉ title +
      // path), SDK từ chối hoặc treo quá 15s thì rơi xuống tầng hiện thẻ.
      setShareStatus('Đang thử cách chia sẻ khác…');
      try {
        const { openShareSheet } = await import('zmp-sdk/apis');
        const zmpData = { title: `Tôi vừa đạt ${fmt(score)} điểm ở Hứng Trân Châu — Daybreak`, path: '/game' };
        if (uploadedUrl) zmpData.thumbnail = uploadedUrl;
        await withTimeout(openShareSheet({ type: 'zmp', data: zmpData }), 15000);
        setShareStatus('');
        return;
      } catch { /* rơi xuống tầng cuối */ }
      setShareCardImg(dataUrl);
      setShareStatus('Không mở được khung chia sẻ của Zalo — bạn có thể chụp màn hình thẻ dưới đây để chia sẻ.');
    } finally {
      shareBusyRef.current = false;
    }
  };

  // ---------- Render ----------
  if (loadErr) {
    return (
      <div style={{ padding: 24 }}>
        <button onClick={() => nav('/account')} style={{ background: 'none', border: 0, color: NAVY, fontWeight: 700, minHeight: 44 }}>‹ Tài khoản</button>
        <div className="zm-empty" style={{ padding: 20 }}>Không tải được thông tin game. Kiểm tra mạng rồi thử lại nhé.</div>
      </div>
    );
  }
  if (!state) {
    return <div style={{ padding: 24, textAlign: 'center', color: NAVY }}>Đang tải game…</div>;
  }
  if (!state.enabled) {
    return (
      <div style={{ padding: 24 }}>
        <button onClick={() => nav('/account')} style={{ background: 'none', border: 0, color: NAVY, fontWeight: 700, minHeight: 44 }}>‹ Tài khoản</button>
        <div className="zm-empty" style={{ padding: 20 }}>🧋 Game đang tạm nghỉ để bảo trì. Quay lại sau nhé!</div>
      </div>
    );
  }

  const tiers = state.tiers || [];
  const pts = state.game?.points || {};
  const playing = phase === 'playing';

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 28 }}>
      {/* Header navy */}
      <div style={{ background: NAVY, color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav('/account')} style={{ background: 'none', border: 0, color: '#fff', fontSize: 20, minWidth: 44, minHeight: 44 }}>‹</button>
        <div style={{ flex: 1, fontWeight: 800, fontSize: 16 }}>🧋 Hứng Trân Châu</div>
        {myPoints !== null && <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><SunMarkIcon size={16} style={{ filter: 'brightness(1.6)' }} />{fmt(myPoints)} điểm</div>}
      </div>

      <div style={{ padding: '14px 16px 0' }}>
        {/* Chọn chế độ */}
        <div style={{ display: 'flex', background: '#E8ECF4', borderRadius: 12, padding: 3, gap: 3 }}>
          <button disabled={playing} onClick={() => setMode('reward')} style={{ flex: 1, minHeight: 44, border: 0, borderRadius: 9, fontWeight: 700, fontSize: 13.5, background: mode === 'reward' ? '#fff' : 'transparent', color: NAVY, boxShadow: mode === 'reward' ? '0 1px 4px rgba(20,30,70,.15)' : 'none' }}>
            🏆 Có thưởng · còn {state.plays_left_today} lượt
          </button>
          <button disabled={playing} onClick={() => setMode('casual')} style={{ flex: 1, minHeight: 44, border: 0, borderRadius: 9, fontWeight: 700, fontSize: 13.5, background: mode === 'casual' ? '#fff' : 'transparent', color: NAVY, boxShadow: mode === 'casual' ? '0 1px 4px rgba(20,30,70,.15)' : 'none' }}>
            🎈 Giải trí · không giới hạn
          </button>
        </div>

        {/* Sân chơi */}
        <div style={{ position: 'relative', marginTop: 12 }}>
          <canvas
            ref={canvasRef} width={W} height={H}
            onTouchMove={onPointer} onMouseMove={onPointer}
            style={{ width: '100%', aspectRatio: '4/5', borderRadius: 16, border: '1px solid #E3E8F2', display: 'block', touchAction: 'none', background: '#F7F9FD' }}
          />
          {/* HUD */}
          <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14, color: NAVY, pointerEvents: 'none' }}>
            {mode === 'reward' ? (
              <>
                <span>⏱ {Math.ceil(hud.timeLeft)}s</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><SunMarkIcon size={17} />{fmt(hud.score)}</span>
                <span>{'💧'.repeat(Math.max(0, (state.game?.max_misses || 3) - hud.misses))}{'🤍'.repeat(hud.misses)}</span>
              </>
            ) : (
              <>
                <span>⏱ {fmtTime(hud.elapsed / 1000)}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><SunMarkIcon size={17} />{fmt(hud.score)}</span>
                <span>🏅 {fmt(state.casual_best?.score || 0)}</span>
              </>
            )}
          </div>
          {phase === 'idle' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.72)', borderRadius: 16, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 15, color: NAVY, fontWeight: 700, lineHeight: 1.5 }}>
                Kéo ly hứng trân châu 🧋 lá trà 🍃 hạt cà phê ☕<br />Tránh hạt cháy ✖ · Hụt {state.game?.max_misses || 3} vật tốt là thua
              </div>
              {mode === 'reward' && !(getProfile()?.phone && getProfile()?.member_code) ? (
                <div style={{ marginTop: 16, width: '100%', maxWidth: 340, background: '#fff', borderRadius: 12, padding: 14, textAlign: 'left' }}>
                  <div style={{ fontSize: 13.5, color: NAVY, fontWeight: 700, lineHeight: 1.5 }}>Chế độ có thưởng cần tài khoản thành viên để ghi điểm.</div>
                  <div style={{ marginTop: 10 }}>
                    <ConsentCheck checked={gameAgree} onChange={setGameAgree} />
                  </div>
                  {!gameB3 ? (
                    <>
                      <button className="zm-btn-primary" style={{ marginTop: 12, minHeight: 48, width: '100%', background: !gameAgree ? '#c3cadb' : undefined }} disabled={!gameAgree || gameZaloBusy} onClick={handleGameZaloRegister}>
                        {gameZaloBusy ? 'Đang xử lý...' : 'Đăng ký bằng Zalo'}
                      </button>
                      {!gameAgree && <div style={{ fontSize: 12.5, color: '#888', marginTop: 8, textAlign: 'center' }}>Tích ô đồng ý ở trên để bật nút đăng ký.</div>}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: '#9A3412', marginTop: 12, lineHeight: 1.5 }}>Cần số điện thoại đã xác thực từ Zalo để tạo tài khoản. Không có dữ liệu nào được tạo từ lần thử vừa rồi.</div>
                      <button className="zm-btn-primary" style={{ marginTop: 12, minHeight: 48, width: '100%' }} disabled={gameZaloBusy} onClick={() => { setGameB3(false); handleGameZaloRegister(); }}>Thử lại</button>
                    </>
                  )}
                  <button onClick={() => setMode('casual')} style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 0, color: NAVY, fontSize: 13, fontWeight: 700 }}>Chơi giải trí không cần tài khoản ›</button>
                </div>
              ) : (
                <button className="zm-btn-primary" style={{ marginTop: 16, minHeight: 48, padding: '0 34px', width: 'auto' }} onClick={startGame}>
                  {mode === 'reward' ? `Chơi có thưởng (${state.plays_left_today} lượt)` : 'Chơi giải trí'}
                </button>
              )}
              {notice && <div style={{ marginTop: 10, fontSize: 13, color: '#D43A2F', fontWeight: 600 }}>{notice}</div>}
            </div>
          )}
          {phase === 'starting' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.72)', borderRadius: 16, fontWeight: 700, color: NAVY }}>Đang cấp phiên chơi…</div>
          )}
          {phase === 'submitting' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.72)', borderRadius: 16, fontWeight: 700, color: NAVY }}>Đang chờ quán xác nhận kết quả…</div>
          )}
          {phase === 'aborted' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.85)', borderRadius: 16, padding: 20, textAlign: 'center' }}>
              <div style={{ fontWeight: 700, color: NAVY, fontSize: 15, lineHeight: 1.5 }}>Phiên chơi đã hủy vì app bị ẩn giữa chừng.<br />Lượt này đã trừ theo thể lệ — không tính thưởng.</div>
              <button className="zm-btn-primary" style={{ marginTop: 14, minHeight: 48, padding: '0 28px', width: 'auto' }} onClick={() => setPhase('idle')}>Chơi phiên mới</button>
            </div>
          )}
          {phase === 'result' && result && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.9)', borderRadius: 16, padding: 20, textAlign: 'center', overflowY: 'auto' }}>
              {result.mode === 'reward' && result.error ? (
                <>
                  <div style={{ fontSize: 34 }}>😢</div>
                  <div style={{ fontWeight: 800, color: NAVY, fontSize: 16, marginTop: 6 }}>Chưa ghi được kết quả</div>
                  <div style={{ fontSize: 13.5, color: '#5B6478', marginTop: 6, lineHeight: 1.5 }}>{result.error}</div>
                  <button className="zm-btn-primary" style={{ marginTop: 14, minHeight: 48, padding: '0 28px', width: 'auto' }} onClick={retrySubmit}>Nộp lại kết quả</button>
                </>
              ) : result.mode === 'reward' ? (
                <>
                  <div style={{ fontSize: 34 }}>🏆</div>
                  <div style={{ fontWeight: 800, color: NAVY, fontSize: 17, marginTop: 4 }}>Bạn đạt {fmt(result.verified_score)} điểm</div>
                  <div style={{ fontSize: 15, marginTop: 8, color: NAVY }}>
                    {result.reward_points > 0
                      ? <>Cộng <b style={{ color: '#1E9E62' }}>+{fmt(result.reward_points)} điểm</b> vào tài khoản{result.mission_awarded ? ' (gồm nhiệm vụ ngày 🎯)' : ''}</>
                      : 'Chưa đạt mốc thưởng hoặc đã chạm trần điểm hôm nay'}
                  </div>
                  <div style={{ fontSize: 13, color: '#5B6478', marginTop: 6 }}>Hôm nay đã nhận {fmt(result.earned_today)}/{fmt(state.daily_cap_points)} điểm · còn {result.plays_left} lượt</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 34 }}>{result.isNewBest ? '🏅' : '🎈'}</div>
                  <div style={{ fontWeight: 800, color: NAVY, fontSize: 17, marginTop: 4 }}>Bạn đạt {fmt(result.score)} điểm</div>
                  {result.isNewBest && <div style={{ fontWeight: 800, color: '#B97E10', marginTop: 4 }}>🏅 Kỷ lục mới!</div>}
                  <div style={{ fontSize: 13.5, color: '#5B6478', marginTop: 6 }}>Sống sót {fmtTime(result.durationMs / 1000)} · Kỷ lục của bạn: {fmt(result.best)} điểm</div>
                </>
              )}
              {!result.error && (
                <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {/* Chơi tiếp = giữ nguyên đúng chế độ vừa chơi (cả hai chiều) */}
                  <button className="zm-btn-primary" style={{ minHeight: 48, padding: '0 22px', width: 'auto' }} onClick={() => { setMode(result.mode); modePickedRef.current = true; setPhase('idle'); }}>Chơi tiếp</button>
                  <button className="zm-btn-outline" style={{ minHeight: 48, padding: '0 22px', width: 'auto' }} onClick={doShare}>Chia sẻ kết quả</button>
                </div>
              )}
              {shareStatus && <div style={{ fontSize: 12.5, color: '#5B6478', marginTop: 10, lineHeight: 1.5 }}>{shareStatus}</div>}
              {shareCardImg && <img src={shareCardImg} alt="Thẻ kết quả" style={{ marginTop: 10, width: 220, borderRadius: 12, border: '1px solid #E3E8F2' }} />}
            </div>
          )}
        </div>

        {/* Khối thông tin theo chế độ */}
        {mode === 'reward' ? (
          <div style={{ background: '#fff', border: '1px solid #E3E8F2', borderRadius: 14, padding: '13px 16px', marginTop: 12 }}>
            <div style={{ fontWeight: 800, color: NAVY, fontSize: 14 }}>Mốc thưởng mỗi phiên ({state.game?.duration_seconds || 45} giây)</div>
            {tiers.map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '7px 0', borderBottom: i < tiers.length - 1 ? '1px solid #F1F4FA' : 'none' }}>
                <span>Đạt {fmt(t.score)} điểm</span><b style={{ color: NAVY }}>+{fmt(t.points)} điểm</b>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '7px 0', borderTop: '1px solid #F1F4FA' }}>
              <span>🎯 Nhiệm vụ ngày: 1 phiên đạt {fmt(state.mission.score)} điểm</span>
              <b style={{ color: state.mission.done ? '#1E9E62' : NAVY }}>{state.mission.done ? 'Đã xong ✓' : `+${fmt(state.mission.points)} điểm`}</b>
            </div>
            <div style={{ fontSize: 12.5, color: '#8A93A6', marginTop: 6 }}>Điểm game hôm nay: {fmt(state.earned_today)}/{fmt(state.daily_cap_points)} · Còn {state.plays_left_today} lượt</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: '#5B6478', marginTop: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><img src={pearlUrl} alt="" style={{ height: 18 }} /> +{pts.pearl}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><img src={leafUrl} alt="" style={{ height: 18 }} /> +{pts.leaf}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><img src={coffeeUrl} alt="" style={{ height: 15 }} /> +{pts.coffee}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><img src={specialUrl} alt="" style={{ height: 20 }} /> +{pts.sun}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><img src={burntUrl} alt="" style={{ height: 18 }} /> cháy −{pts.burnt}</span>
            </div>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E3E8F2', borderRadius: 14, padding: '13px 16px', marginTop: 12 }}>
            <div style={{ fontWeight: 800, color: NAVY, fontSize: 14 }}>Kỷ lục giải trí của bạn</div>
            <div style={{ fontSize: 13.5, padding: '7px 0' }}>
              {state.casual_best
                ? <>Điểm cao nhất: <b style={{ color: NAVY }}>{fmt(state.casual_best.score)} điểm</b> · sống sót {fmtTime((state.casual_best.duration_ms || 0) / 1000)} · đã chơi {fmt(state.casual_best.plays_count)} phiên</>
                : 'Chưa có kỷ lục — chơi phiên đầu tiên nào!'}
            </div>
            <div style={{ fontSize: 12.5, color: '#8A93A6', lineHeight: 1.55 }}>Chế độ giải trí không tính điểm thưởng, không giới hạn lượt. Vật rơi nhanh dần theo thời gian — hụt {state.game?.max_misses || 3} vật tốt là kết thúc.</div>
          </div>
        )}

        <button className="zm-btn-outline" style={{ marginTop: 12, minHeight: 44 }} onClick={() => nav('/game-rules')}>📜 Thể lệ chương trình</button>
        <div style={{ fontSize: 11.5, color: '#A7B0BF', textAlign: 'center', marginTop: 10 }}>{Object.entries(ITEM_LABEL).map(([k, v]) => `${v} `).join('· ')}</div>
      </div>
    </div>
  );
}
