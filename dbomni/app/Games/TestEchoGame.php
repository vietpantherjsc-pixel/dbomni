<?php

namespace App\Games;

// Mô-đun GIẢ LẬP phục vụ kiểm thử kiến trúc (spec mục 13, ca T-01): chứng minh
// Lớp A chạy với bất kỳ game nào đăng ký qua registry mà không cần sửa Lớp A.
// KHÔNG đăng ký trong config/minigame.php ở bản chạy thật — TESTER tự thêm
// dòng 'test_echo' => TestEchoGame::class ở môi trường test khi kiểm T-01.
// Luật chơi giả: 12 sự kiện loại a/b rơi đều trong 30 giây, hứng a = 5 điểm,
// b = 10 điểm, hụt tối đa 3 lần.
class TestEchoGame extends GameModule
{
    public function gameId(): string
    {
        return 'test_echo';
    }

    public function defaultConfig(): array
    {
        return [
            'echo_duration_seconds' => 30,
            'echo_points_a' => 5,
            'echo_points_b' => 10,
            'echo_max_misses' => 3,
        ];
    }

    public function generateSchedule(int $seed, array $config): array
    {
        $rng = new Lcg($seed);
        $durationMs = (int) ($config['echo_duration_seconds'] ?? 30) * 1000;
        $events = [];
        $t = 0;
        for ($i = 0; $i < 12; $i++) {
            // Thứ tự tiêu thụ: khoảng chờ → loại → vị trí x → tốc độ
            $t += 1500 + (int) floor($rng->nextFloat() * 1000);
            if ($t >= $durationMs) break;
            $type = $rng->nextFloat() < 0.5 ? 'a' : 'b';
            $x = 5 + $rng->nextFloat() * 90;
            $speed = 120 + $rng->nextFloat() * 60;
            $events[] = ['t_ms' => $t, 'type' => $type, 'x' => $x, 'speed' => $speed];
        }
        return $events;
    }

    public function spawnCounts(int $seed, array $config): array
    {
        $counts = ['a' => 0, 'b' => 0];
        foreach ($this->generateSchedule($seed, $config) as $e) {
            $counts[$e['type']]++;
        }
        return $counts;
    }

    public function maxScore(int $seed, array $config): int
    {
        return $this->scoreFromCounters($this->spawnCounts($seed, $config), $config);
    }

    public function scoreFromCounters(array $counters, array $config): int
    {
        return (int) ($counters['a'] ?? 0) * (int) ($config['echo_points_a'] ?? 5)
            + (int) ($counters['b'] ?? 0) * (int) ($config['echo_points_b'] ?? 10);
    }

    public function minDurationMs(array $schedule, array $counters, array $config): int
    {
        $misses = (int) ($counters['misses'] ?? 0);
        if ($misses < (int) ($config['echo_max_misses'] ?? 3)) {
            return (int) ($config['echo_duration_seconds'] ?? 30) * 1000 - 1500;
        }
        return 0;
    }

    public function validateCounters(array $schedule, array $counters, int $durationMs, array $config): ?string
    {
        $durationCap = (int) ($config['echo_duration_seconds'] ?? 30) * 1000 + 15000;
        if ($durationMs > $durationCap) {
            return 'Thời lượng phiên vượt quá giới hạn hợp lệ.';
        }
        $min = $this->minDurationMs($schedule, $counters, $config);
        if ($min > 0 && $durationMs < $min) {
            return 'Thời lượng phiên ngắn bất thường so với lịch rơi.';
        }
        return null;
    }

    public function maxScoreForDuration(int $durationMs, array $config): int
    {
        return (int) ceil($durationMs / 1500) * (int) ($config['echo_points_b'] ?? 10);
    }

    public function displayConfig(array $config): array
    {
        return [
            'duration_seconds' => (int) ($config['echo_duration_seconds'] ?? 30),
            'points' => [
                'a' => (int) ($config['echo_points_a'] ?? 5),
                'b' => (int) ($config['echo_points_b'] ?? 10),
            ],
        ];
    }
}
