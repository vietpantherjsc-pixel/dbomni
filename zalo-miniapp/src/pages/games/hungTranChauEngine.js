// Engine phía client của G1 "Hứng Trân Châu" — BẢN GƯƠNG của mô-đun PHP
// App\Games\HungTranChauGame (spec mục 2.1/7.2): lịch sinh từ seed phải giống
// HỆT phía server. Thứ tự tiêu thụ số ngẫu nhiên cho mỗi sự kiện:
// khoảng chờ → loại → vị trí x → tốc độ. Đổi công thức/thứ tự = đổi lịch.

// LCG 32-bit khóa cứng: state = (state * 1664525 + 1013904223) mod 2^32
export function makeLcg(seed) {
  let state = seed >>> 0;
  return function nextFloat() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const round4 = (v) => Math.round(v * 10000) / 10000;

export function generateSchedule(seed, config) {
  const next = makeLcg(seed);
  const durationMs = (config.mg_htc_duration_seconds ?? 45) * 1000;
  const intervalStart = Number(config.mg_htc_interval_start_ms ?? 620);
  const intervalEnd = Number(config.mg_htc_interval_end_ms ?? 330);
  const speedMin = Number(config.mg_htc_speed_min ?? 120);
  const speedMax = Number(config.mg_htc_speed_max ?? 190);
  const speedGain = Number(config.mg_htc_speed_gain_per_s ?? 2.2);
  const rPearl = Number(config.mg_htc_ratio_pearl ?? 44);
  const rLeaf = rPearl + Number(config.mg_htc_ratio_leaf ?? 27);
  const rCoffee = rLeaf + Number(config.mg_htc_ratio_coffee ?? 20);
  const rSun = rCoffee + Number(config.mg_htc_ratio_sun ?? 4);

  const events = [];
  let t = 0;
  while (true) {
    const progress = durationMs > 0 ? Math.min(1, t / durationMs) : 0;
    const baseInterval = intervalStart + (intervalEnd - intervalStart) * progress;
    const wait = Math.round(baseInterval * (0.7 + 0.6 * next()));
    t += wait;
    if (t >= durationMs) break;
    const rType = next() * 100;
    const type = rType < rPearl ? 'pearl'
      : rType < rLeaf ? 'leaf'
      : rType < rCoffee ? 'coffee'
      : rType < rSun ? 'sun' : 'burnt';
    const x = 4 + next() * 92;
    const speed = speedMin + next() * (speedMax - speedMin) + speedGain * (t / 1000);
    events.push({ t_ms: t, type, x: round4(x), speed: round4(speed) });
  }
  return events;
}

export function spawnCounts(schedule) {
  const counts = { pearl: 0, leaf: 0, coffee: 0, sun: 0, burnt: 0 };
  for (const e of schedule) counts[e.type] = (counts[e.type] || 0) + 1;
  return counts;
}

export function pointsOf(config, type) {
  return Number(config[`mg_htc_points_${type}`] ?? 0);
}

export function scoreFromCounters(counters, config) {
  let score = 0;
  for (const type of ['pearl', 'leaf', 'coffee', 'sun']) {
    score += (counters[type] || 0) * pointsOf(config, type);
  }
  score -= (counters.burnt || 0) * pointsOf(config, 'burnt');
  return Math.max(0, score);
}

export function maxScore(schedule, config) {
  return schedule.reduce((s, e) => (e.type === 'burnt' ? s : s + pointsOf(config, e.type)), 0);
}

// ===== Chế độ GIẢI TRÍ (spec 7.4) — cục bộ hoàn toàn, không seed server =====
// Độ khó theo thời gian sống sót t (giây)
export function casualParams(tSec) {
  return {
    intervalMs: Math.max(640 - 5.5 * tSec, 240),
    speed: Math.min(150 + 6.5 * tSec, 560),
    pairChance: tSec < 30 ? 0 : tSec <= 60 ? 0.15 : 0.25,
    burntRatio: tSec < 60 ? 5 : tSec < 90 ? 8 : 11,
    sunRatio: 3,
  };
}

// Chọn loại vật cho 1 sự kiện giải trí (Math.random cục bộ — không cần tất định)
export function casualType(tSec) {
  const p = casualParams(tSec);
  const r = Math.random() * 100;
  if (r < p.burntRatio) return 'burnt';
  if (r < p.burntRatio + p.sunRatio) return 'sun';
  // Phần còn lại chia theo tỉ lệ gốc 44/27/20 của trân châu/lá trà/hạt cà phê
  const rest = (r - p.burntRatio - p.sunRatio) / (100 - p.burntRatio - p.sunRatio) * 91;
  if (rest < 44) return 'pearl';
  if (rest < 71) return 'leaf';
  return 'coffee';
}
