<?php

namespace App\Games;

// Mô-đun G1 — "Hứng Trân Châu" (spec mục 7). Toàn bộ luật riêng của game nằm
// tại đây + component client tương ứng; Lớp A không biết gì về game này.
// Lịch rơi tất định từ seed qua LCG dùng chung — bản JS trong
// zalo-miniapp/src/pages/games/hungTranChauEngine.js là BẢN GƯƠNG từng dòng:
// thứ tự tiêu thụ số ngẫu nhiên cho mỗi sự kiện: khoảng chờ → loại → vị trí x →
// tốc độ. Đổi thứ tự/công thức = đổi lịch, phải cập nhật vector kiểm tra 2 phía.
class HungTranChauGame extends GameModule
{
    // Chiều cao danh nghĩa của sân khi tính thời điểm hụt sớm nhất có thể (px)
    private const FALL_FIELD_PX = 520;

    public function gameId(): string
    {
        return 'hung_tran_chau';
    }

    public function defaultConfig(): array
    {
        return [
            'mg_htc_duration_seconds' => 45,
            'mg_htc_points_pearl' => 10,   // trân châu
            'mg_htc_points_leaf' => 15,    // lá trà
            'mg_htc_points_coffee' => 20,  // hạt cà phê
            'mg_htc_points_sun' => 40,     // mặt trời Daybreak (hiếm)
            'mg_htc_points_burnt' => 15,   // hạt cháy: TRỪ chừng này điểm
            'mg_htc_max_misses' => 3,
            'mg_htc_interval_start_ms' => 620,
            'mg_htc_interval_end_ms' => 330,
            'mg_htc_speed_min' => 120,     // px/s
            'mg_htc_speed_max' => 190,     // px/s
            'mg_htc_speed_gain_per_s' => 2.2, // px/s cộng thêm mỗi giây trôi qua
            'mg_htc_ratio_pearl' => 44,
            'mg_htc_ratio_leaf' => 27,
            'mg_htc_ratio_coffee' => 20,
            'mg_htc_ratio_sun' => 4,
            'mg_htc_ratio_burnt' => 5,
        ];
    }

    public function generateSchedule(int $seed, array $config): array
    {
        $rng = new Lcg($seed);
        $durationMs = (int) ($config['mg_htc_duration_seconds'] ?? 45) * 1000;
        $intervalStart = (float) ($config['mg_htc_interval_start_ms'] ?? 620);
        $intervalEnd = (float) ($config['mg_htc_interval_end_ms'] ?? 330);
        $speedMin = (float) ($config['mg_htc_speed_min'] ?? 120);
        $speedMax = (float) ($config['mg_htc_speed_max'] ?? 190);
        $speedGain = (float) ($config['mg_htc_speed_gain_per_s'] ?? 2.2);
        $rPearl = (float) ($config['mg_htc_ratio_pearl'] ?? 44);
        $rLeaf = $rPearl + (float) ($config['mg_htc_ratio_leaf'] ?? 27);
        $rCoffee = $rLeaf + (float) ($config['mg_htc_ratio_coffee'] ?? 20);
        $rSun = $rCoffee + (float) ($config['mg_htc_ratio_sun'] ?? 4);

        $events = [];
        $t = 0;
        while (true) {
            $progress = $durationMs > 0 ? min(1.0, $t / $durationMs) : 0.0;
            $baseInterval = $intervalStart + ($intervalEnd - $intervalStart) * $progress;
            // 1) khoảng chờ (jitter ±30% quanh nhịp cơ sở tại thời điểm đó)
            $wait = (int) round($baseInterval * (0.7 + 0.6 * $rng->nextFloat()));
            $t += $wait;
            if ($t >= $durationMs) {
                break;
            }
            // 2) loại vật theo tỉ lệ cấu hình
            $rType = $rng->nextFloat() * 100;
            $type = $rType < $rPearl ? 'pearl'
                : ($rType < $rLeaf ? 'leaf'
                : ($rType < $rCoffee ? 'coffee'
                : ($rType < $rSun ? 'sun' : 'burnt')));
            // 3) vị trí ngang (% bề ngang sân, chừa mép)
            $x = 4 + $rng->nextFloat() * 92;
            // 4) tốc độ rơi (px/s): ngẫu nhiên trong dải + tăng theo thời gian
            $speed = $speedMin + $rng->nextFloat() * ($speedMax - $speedMin) + $speedGain * ($t / 1000);
            $events[] = [
                't_ms' => $t,
                'type' => $type,
                'x' => round($x, 4),
                'speed' => round($speed, 4),
            ];
        }
        return $events;
    }

    public function spawnCounts(int $seed, array $config): array
    {
        $counts = ['pearl' => 0, 'leaf' => 0, 'coffee' => 0, 'sun' => 0, 'burnt' => 0];
        foreach ($this->generateSchedule($seed, $config) as $e) {
            $counts[$e['type']]++;
        }
        return $counts;
    }

    public function maxScore(int $seed, array $config): int
    {
        $sum = 0;
        foreach ($this->generateSchedule($seed, $config) as $e) {
            if ($e['type'] !== 'burnt') {
                $sum += (int) ($config['mg_htc_points_' . $e['type']] ?? 0);
            }
        }
        return $sum;
    }

    public function scoreFromCounters(array $counters, array $config): int
    {
        $score = 0;
        foreach (['pearl', 'leaf', 'coffee', 'sun'] as $type) {
            $score += (int) ($counters[$type] ?? 0) * (int) ($config['mg_htc_points_' . $type] ?? 0);
        }
        $score -= (int) ($counters['burnt'] ?? 0) * (int) ($config['mg_htc_points_burnt'] ?? 15);
        return max(0, $score); // điểm không xuống dưới 0 (luật 7.1)
    }

    public function penaltyTypes(): array
    {
        return ['burnt'];
    }

    public function minDurationMs(array $schedule, array $counters, array $config): int
    {
        $misses = (int) ($counters['misses'] ?? 0);
        $maxMisses = (int) ($config['mg_htc_max_misses'] ?? 3);
        $durationMs = (int) ($config['mg_htc_duration_seconds'] ?? 45) * 1000;
        if ($misses < $maxMisses) {
            // Phiên chạy trọn: cho phép nộp sớm tối đa 1,5 giây so với thời lượng
            return $durationMs - 1500;
        }
        // Kết thúc sớm vì đủ số hụt: thời điểm hụt-cuối-cùng sớm nhất có thể =
        // lúc vật tốt thứ maxMisses xuất hiện + thời gian rơi tối thiểu của nó,
        // trừ dung sai 2 giây (luật 7.3)
        $good = array_values(array_filter($schedule, fn ($e) => $e['type'] !== 'burnt'));
        if (count($good) < $maxMisses) {
            return 0;
        }
        $third = $good[$maxMisses - 1];
        $fallMs = self::FALL_FIELD_PX / max(1.0, (float) $third['speed']) * 1000;
        return max(0, (int) floor($third['t_ms'] + $fallMs) - 2000);
    }

    public function validateCounters(array $schedule, array $counters, int $durationMs, array $config): ?string
    {
        $durationCap = (int) ($config['mg_htc_duration_seconds'] ?? 45) * 1000 + 15000;
        if ($durationMs > $durationCap) {
            return 'Thời lượng phiên vượt quá giới hạn hợp lệ.';
        }
        $goodSpawn = count(array_filter($schedule, fn ($e) => $e['type'] !== 'burnt'));
        if ((int) ($counters['misses'] ?? 0) > $goodSpawn) {
            return 'Số lần hụt vượt quá số vật đã rơi.';
        }
        if ($durationMs < $this->minDurationMs($schedule, $counters, $config)) {
            return 'Thời lượng phiên không khớp luật chơi (kết thúc quá sớm).';
        }
        return null;
    }

    public function maxScoreForDuration(int $durationMs, array $config): int
    {
        // Trần vật lý chế độ giải trí: nhịp rơi dày nhất 240ms, sau 30 giây có
        // thể rơi đôi → số sự kiện tối đa; mỗi sự kiện tối đa điểm vật cao nhất.
        $single = (int) ceil(min($durationMs, 30000) / 240);
        $paired = (int) ceil(max(0, $durationMs - 30000) / 240) * 2;
        $maxPoints = max(
            (int) ($config['mg_htc_points_pearl'] ?? 10),
            (int) ($config['mg_htc_points_leaf'] ?? 15),
            (int) ($config['mg_htc_points_coffee'] ?? 20),
            (int) ($config['mg_htc_points_sun'] ?? 40)
        );
        return ($single + $paired) * $maxPoints;
    }

    public function extraAnomalyFlags(array $schedule, array $counters, array $config): array
    {
        // sun_ratio: hứng gần như toàn bộ mặt trời (vật hiếm 4%) trong phiên có
        // đủ nhiều mặt trời để tỉ lệ có ý nghĩa
        $sunSpawn = count(array_filter($schedule, fn ($e) => $e['type'] === 'sun'));
        $sunCaught = (int) ($counters['sun'] ?? 0);
        if ($sunSpawn >= 3 && $sunCaught / $sunSpawn >= 0.9) {
            return ['sun_ratio'];
        }
        return [];
    }

    public function displayConfig(array $config): array
    {
        return [
            'duration_seconds' => (int) ($config['mg_htc_duration_seconds'] ?? 45),
            'max_misses' => (int) ($config['mg_htc_max_misses'] ?? 3),
            'points' => [
                'pearl' => (int) ($config['mg_htc_points_pearl'] ?? 10),
                'leaf' => (int) ($config['mg_htc_points_leaf'] ?? 15),
                'coffee' => (int) ($config['mg_htc_points_coffee'] ?? 20),
                'sun' => (int) ($config['mg_htc_points_sun'] ?? 40),
                'burnt' => (int) ($config['mg_htc_points_burnt'] ?? 15),
            ],
        ];
    }
}
