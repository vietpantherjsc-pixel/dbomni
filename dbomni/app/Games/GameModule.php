<?php

namespace App\Games;

// Hợp đồng Lớp B — mô-đun game (spec mục 2.1). Mỗi game khai báo toàn bộ phần
// riêng của mình tại đây; Lớp A (MinigameService) chỉ biết các khái niệm chung:
// lịch sự kiện, bộ đếm theo khóa chuỗi, điểm, thời lượng — không biết tên vật
// rơi hay luật riêng của bất kỳ game nào.
// Sự kiện lịch: ['t_ms' => int, 'type' => string, 'x' => float (0-100% bề ngang),
//                'speed' => float (px/s)]
// Bộ đếm khách nộp: [type => số hứng được, ..., 'misses' => số hụt vật tốt]
abstract class GameModule
{
    abstract public function gameId(): string;

    /** Giá trị mặc định các khóa cấu hình RIÊNG của game (key => giá trị). */
    abstract public function defaultConfig(): array;

    /** Sinh lịch sự kiện tất định từ seed + config — PHP và JS phải giống hệt. */
    abstract public function generateSchedule(int $seed, array $config): array;

    /** Số lượng tối đa từng loại sự kiện trong lịch của seed này. */
    abstract public function spawnCounts(int $seed, array $config): array;

    /** Điểm tối đa lý thuyết của phiên theo lịch. */
    abstract public function maxScore(int $seed, array $config): int;

    /** Tính lại điểm từ bộ đếm khách nộp. */
    abstract public function scoreFromCounters(array $counters, array $config): int;

    /**
     * Luật hợp lệ riêng của game (thời lượng…). Trả null khi hợp lệ,
     * hoặc câu thông báo lỗi để Lớp A trả 422.
     */
    abstract public function validateCounters(array $schedule, array $counters, int $durationMs, array $config): ?string;

    /** Thời lượng tối thiểu hợp lệ của phiên theo lịch + bộ đếm (dùng cho validate + cờ fast_submit). */
    abstract public function minDurationMs(array $schedule, array $counters, array $config): int;

    /** Trần điểm vật lý có thể đạt trong durationMs ở mật độ tối đa (kiểm hợp lý cho chế độ giải trí). */
    abstract public function maxScoreForDuration(int $durationMs, array $config): int;

    /** Các loại sự kiện mang tính PHẠT (điểm âm) — Lớp A loại khỏi phép tính "hứng hoàn hảo". */
    public function penaltyTypes(): array
    {
        return [];
    }

    /** Cờ bất thường riêng của game (nếu có) — Lớp A gộp với cờ chung. */
    public function extraAnomalyFlags(array $schedule, array $counters, array $config): array
    {
        return [];
    }

    /** Cấu hình hiển thị cho client (điểm từng loại, thời lượng…) — client không hardcode số. */
    public function displayConfig(array $config): array
    {
        return [];
    }
}
