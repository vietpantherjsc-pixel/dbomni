<?php

namespace App\Services;

use App\Games\GameModule;
use App\Models\Customer;
use App\Models\MinigamePersonalBest;
use App\Models\MinigameSession;
use App\Models\PointLot;
use App\Models\PointTransaction;
use App\Models\Setting;
use Illuminate\Support\Facades\DB;

// Minigame — LỚP A: nền phiên/điểm dùng chung cho mọi game (spec mục 2).
// Lớp này KHÔNG chứa logic/từ vựng của bất kỳ game cụ thể nào: chỉ biết lịch
// sự kiện, bộ đếm theo khóa chuỗi, điểm, thời lượng. Phần riêng của từng game
// nằm trong mô-đun Lớp B (App\Games\*) đăng ký tại config/minigame.php.
class MinigameService
{
    // Mặc định cấu hình chung (spec mục 4 — đã chốt; Admin chỉnh qua Setting)
    public const SHARED_DEFAULTS = [
        'minigame_enabled' => '0',
        'minigame_daily_plays' => 3,
        'minigame_t1_score' => 150,
        'minigame_t1_points' => 2,
        'minigame_t2_score' => 300,
        'minigame_t2_points' => 4,
        'minigame_t3_score' => 500,
        'minigame_t3_points' => 7,
        'minigame_mission_score' => 300,
        'minigame_mission_points' => 2,
        'minigame_daily_cap_points' => 15,
        'minigame_global_cap_points' => 3000,
        'minigame_session_ttl_seconds' => 150,
        'minigame_anomaly_streak' => 3,
    ];

    // Công tắc bật mặc định theo game khi Admin chưa từng lưu khóa riêng
    private const GAME_ENABLED_DEFAULTS = [
        'hung_tran_chau' => '1',
    ];

    public function __construct(private LoyaltyService $loyalty)
    {
    }

    // ---------- Registry + cấu hình ----------

    /** @return array<string, GameModule> */
    public function games(): array
    {
        $out = [];
        foreach ((array) config('minigame.games', []) as $gameId => $class) {
            if (is_string($class) && class_exists($class)) {
                $out[$gameId] = new $class();
            }
        }
        return $out;
    }

    public function module(string $gameId): ?GameModule
    {
        return $this->games()[$gameId] ?? null;
    }

    public function enabled(): bool
    {
        return (string) Setting::get('minigame_enabled', self::SHARED_DEFAULTS['minigame_enabled']) === '1';
    }

    public function gameEnabled(string $gameId): bool
    {
        $default = self::GAME_ENABLED_DEFAULTS[$gameId] ?? '0';
        return (string) Setting::get("minigame_game_{$gameId}_enabled", $default) === '1';
    }

    /** Game đang bật để hiển thị (đợt này 1 game; nhiều game sau này lấy game đầu tiên đang bật). */
    public function activeGameId(): ?string
    {
        foreach ($this->games() as $gameId => $module) {
            if ($this->gameEnabled($gameId)) {
                return $gameId;
            }
        }
        return null;
    }

    /** Cấu hình chung dạng số nguyên (đọc Setting, thiếu thì mặc định đã chốt). */
    public function sharedConfig(): array
    {
        $out = [];
        foreach (self::SHARED_DEFAULTS as $key => $default) {
            $out[$key] = $key === 'minigame_enabled'
                ? ((string) Setting::get($key, $default) === '1')
                : (int) Setting::get($key, $default);
        }
        return $out;
    }

    /**
     * Cấu hình đầy đủ của 1 phiên game = cấu hình chung + mặc định của mô-đun,
     * khóa riêng của game được Setting ghi đè (giữ nguyên kiểu số/chuỗi của mặc định).
     */
    public function gameConfig(string $gameId): array
    {
        $config = $this->sharedConfig();
        $module = $this->module($gameId);
        if ($module) {
            foreach ($module->defaultConfig() as $key => $default) {
                $raw = Setting::get($key, null);
                if ($raw === null || $raw === '') {
                    $config[$key] = $default;
                } elseif (is_float($default)) {
                    $config[$key] = (float) $raw;
                } elseif (is_int($default)) {
                    $config[$key] = (int) $raw;
                } else {
                    $config[$key] = $raw;
                }
            }
        }
        return $config;
    }

    // ---------- Số liệu ngày ----------

    /** Lượt đã cấp hôm nay — tính MỌI trạng thái (lượt trừ ngay lúc cấp, chống lăn seed). */
    public function playsUsedToday(Customer $customer, string $gameId): int
    {
        return MinigameSession::where('customer_id', $customer->id)
            ->where('game_id', $gameId)
            ->whereDate('created_at', today())
            ->count();
    }

    /** Điểm game đã nhận hôm nay (mọi game) — căn cứ trần ngày của tài khoản. */
    public function earnedToday(Customer $customer): int
    {
        return (int) MinigameSession::where('customer_id', $customer->id)
            ->where('status', 'submitted')
            ->whereDate('submitted_at', today())
            ->sum('reward_points');
    }

    /** Điểm game đã phát toàn hệ hôm nay — căn cứ trần phát hành toàn hệ. */
    public function globalEarnedToday(): int
    {
        return (int) MinigameSession::where('status', 'submitted')
            ->whereDate('submitted_at', today())
            ->sum('reward_points');
    }

    /** Nhiệm vụ ngày đã xong chưa: có phiên submitted hôm nay đạt mốc nhiệm vụ (theo cấu hình chung hiện tại). */
    public function missionDoneToday(Customer $customer, array $shared): bool
    {
        return MinigameSession::where('customer_id', $customer->id)
            ->where('status', 'submitted')
            ->whereDate('submitted_at', today())
            ->where('verified_score', '>=', (int) $shared['minigame_mission_score'])
            ->exists();
    }

    // ---------- API khách ----------

    public function state(?Customer $customer): array
    {
        $shared = $this->sharedConfig();
        $enabled = $this->enabled();
        $gameId = $this->activeGameId();
        $module = $gameId ? $this->module($gameId) : null;
        $gameConfig = $gameId ? $this->gameConfig($gameId) : [];

        $state = [
            'enabled' => $enabled && $gameId !== null,
            'authenticated' => $customer !== null,
            'game_id' => $gameId,
            'daily_plays' => (int) $shared['minigame_daily_plays'],
            'daily_cap_points' => (int) $shared['minigame_daily_cap_points'],
            'tiers' => [
                ['score' => (int) $shared['minigame_t1_score'], 'points' => (int) $shared['minigame_t1_points']],
                ['score' => (int) $shared['minigame_t2_score'], 'points' => (int) $shared['minigame_t2_points']],
                ['score' => (int) $shared['minigame_t3_score'], 'points' => (int) $shared['minigame_t3_points']],
            ],
            'mission' => [
                'score' => (int) $shared['minigame_mission_score'],
                'points' => (int) $shared['minigame_mission_points'],
                'done' => false,
            ],
            'game' => $module ? $module->displayConfig($gameConfig) : null,
            'plays_left_today' => 0,
            'earned_today' => 0,
            'casual_best' => null,
        ];
        if ($customer && $gameId) {
            $state['plays_left_today'] = max(0, (int) $shared['minigame_daily_plays'] - $this->playsUsedToday($customer, $gameId));
            $state['earned_today'] = $this->earnedToday($customer);
            $state['mission']['done'] = $this->missionDoneToday($customer, $shared);
            $best = MinigamePersonalBest::where('customer_id', $customer->id)
                ->where('game_id', $gameId)->where('mode', 'casual')->first();
            if ($best) {
                $state['casual_best'] = [
                    'score' => (int) $best->best_score,
                    'duration_ms' => (int) $best->best_duration_ms,
                    'plays_count' => (int) $best->plays_count,
                ];
            }
        }
        return $state;
    }

    /** Cấp phiên có thưởng (spec 5.2) — lượt trừ ngay tại lúc cấp. */
    public function issueSession(Customer $customer, string $gameId): MinigameSession
    {
        if (!$this->enabled()) {
            abort(422, 'Minigame đang tạm nghỉ.');
        }
        $module = $this->module($gameId);
        if (!$module || !$this->gameEnabled($gameId)) {
            abort(422, 'Game đang tạm nghỉ.');
        }
        return DB::transaction(function () use ($customer, $gameId) {
            $shared = $this->sharedConfig();
            if ($this->playsUsedToday($customer, $gameId) >= (int) $shared['minigame_daily_plays']) {
                abort(422, 'Bạn đã hết lượt chơi có thưởng hôm nay.');
            }
            // Chống mở nhiều phiên song song: hủy phiên issued còn dang dở trước đó
            MinigameSession::where('customer_id', $customer->id)
                ->where('game_id', $gameId)
                ->where('status', 'issued')
                ->update(['status' => 'void']);

            $config = $this->gameConfig($gameId);
            // Chạm trần ngày (của khách hoặc toàn hệ) vẫn cấp phiên nhưng đánh dấu
            // snapshot để kết quả cộng 0 và client báo trước
            $config['reward_blocked'] = $this->earnedToday($customer) >= (int) $shared['minigame_daily_cap_points']
                || $this->globalEarnedToday() >= (int) $shared['minigame_global_cap_points'];

            $now = now();
            return MinigameSession::create([
                'game_id' => $gameId,
                'customer_id' => $customer->id,
                'seed' => random_int(0, 2147483647),
                'config_snapshot' => $config,
                'status' => 'issued',
                'issued_at' => $now,
                'expires_at' => $now->copy()->addSeconds((int) $shared['minigame_session_ttl_seconds']),
            ]);
        });
    }

    /** Nộp kết quả phiên có thưởng (spec 5.3) — server tự tính điểm + thưởng. */
    public function submit(Customer $customer, int $sessionId, int $durationMs, array $counters, ?int $claimedScore): array
    {
        $result = DB::transaction(function () use ($customer, $sessionId, $durationMs, $counters, $claimedScore) {
            $session = MinigameSession::lockForUpdate()->find($sessionId);
            if (!$session || $session->customer_id !== $customer->id) {
                abort(422, 'Phiên chơi không hợp lệ.');
            }
            if ($session->status !== 'issued') {
                abort(422, 'Phiên đã được nộp hoặc không còn hiệu lực.');
            }
            if (now()->gt($session->expires_at)) {
                // Đánh dấu hết hạn rồi CHỐT giao dịch mới báo lỗi (abort trong
                // transaction sẽ rollback cả dòng đánh dấu này)
                $session->update(['status' => 'expired']);
                return ['__expired' => true];
            }
            $lockedCustomer = Customer::lockForUpdate()->find($customer->id);
            $module = $this->module($session->game_id);
            if (!$module) {
                abort(422, 'Game không còn được hỗ trợ.');
            }
            $config = (array) $session->config_snapshot;
            $schedule = $module->generateSchedule((int) $session->seed, $config);
            $spawn = $module->spawnCounts((int) $session->seed, $config);

            // Bộ đếm: khóa lạ / âm / vượt số đã rơi theo lịch → từ chối
            $clean = ['misses' => 0];
            foreach ($spawn as $type => $max) {
                $clean[$type] = 0;
            }
            foreach ($counters as $key => $value) {
                if (!array_key_exists($key, $clean) || !is_numeric($value) || (int) $value < 0) {
                    abort(422, 'Dữ kiện kết quả không hợp lệ.');
                }
                $clean[$key] = (int) $value;
            }
            foreach ($spawn as $type => $max) {
                if (($clean[$type] ?? 0) > $max) {
                    abort(422, 'Số lượng hứng vượt quá lịch rơi của phiên.');
                }
            }
            $verified = $module->scoreFromCounters($clean, $config);
            if ($verified > $module->maxScore((int) $session->seed, $config)) {
                abort(422, 'Điểm vượt quá mức tối đa của phiên.');
            }
            if ($err = $module->validateCounters($schedule, $clean, $durationMs, $config)) {
                abort(422, $err);
            }

            // Thưởng mốc cao nhất đạt được + nhiệm vụ ngày (theo snapshot)
            $tierPoints = 0;
            foreach ([3, 2, 1] as $i) {
                if ($verified >= (int) ($config["minigame_t{$i}_score"] ?? PHP_INT_MAX)) {
                    $tierPoints = (int) ($config["minigame_t{$i}_points"] ?? 0);
                    break;
                }
            }
            $missionAwarded = false;
            $rawReward = $tierPoints;
            if ($verified >= (int) ($config['minigame_mission_score'] ?? PHP_INT_MAX)
                && !$this->missionDoneToday($lockedCustomer, $config)) {
                $rawReward += (int) ($config['minigame_mission_points'] ?? 0);
                $missionAwarded = true;
            }
            // Áp mọi trần trong cùng giao dịch
            $earnedToday = $this->earnedToday($lockedCustomer);
            $reward = min(
                $rawReward,
                (int) ($config['minigame_daily_cap_points'] ?? 0) - $earnedToday,
                (int) ($config['minigame_global_cap_points'] ?? 0) - $this->globalEarnedToday()
            );
            $reward = max(0, $reward);
            if (!empty($config['reward_blocked'])) {
                $reward = 0;
            }

            $flags = $this->anomalyFlags($module, $schedule, $spawn, $clean, $claimedScore, $verified, $durationMs, $config, $lockedCustomer, $session);

            $lotId = null;
            if ($reward > 0) {
                $lot = $this->loyalty->createLot($lockedCustomer, $reward, 'minigame');
                $lockedCustomer->points = (int) $lockedCustomer->points + $reward;
                $lockedCustomer->save();
                PointTransaction::create([
                    'customer_id' => $lockedCustomer->id,
                    'point_lot_id' => $lot->id,
                    'change' => $reward,
                    'type' => 'earn',
                    'note' => "Thưởng minigame {$session->game_id} · phiên #{$session->id}",
                ]);
                $lotId = $lot->id;
            }

            $session->update([
                'status' => 'submitted',
                'submitted_at' => now(),
                'duration_ms' => $durationMs,
                'counters' => $clean,
                'claimed_score' => $claimedScore,
                'verified_score' => $verified,
                'reward_points' => $reward,
                'point_lot_id' => $lotId,
                'anomaly_flags' => $flags ?: null,
            ]);

            return [
                'verified_score' => $verified,
                'reward_points' => $reward,
                'mission_awarded' => $missionAwarded && $reward > 0,
                'earned_today' => $earnedToday + $reward,
                'plays_left' => max(0, (int) ($config['minigame_daily_plays'] ?? 0) - $this->playsUsedToday($lockedCustomer, $session->game_id)),
            ];
        });
        if (!empty($result['__expired'])) {
            abort(422, 'Phiên đã quá hạn nộp kết quả.');
        }
        return $result;
    }

    /** Cờ bất thường (spec mục 10) — chỉ để Admin xem xét, không tự phạt. */
    private function anomalyFlags(GameModule $module, array $schedule, array $spawn, array $counters, ?int $claimedScore, int $verified, int $durationMs, array $config, Customer $customer, MinigameSession $session): array
    {
        $flags = [];
        $penalty = $module->penaltyTypes();
        $goodSpawn = 0;
        $perfect = (int) ($counters['misses'] ?? 0) === 0;
        foreach ($spawn as $type => $max) {
            if (in_array($type, $penalty, true)) {
                continue;
            }
            $goodSpawn += $max;
            if ((int) ($counters[$type] ?? 0) !== $max) {
                $perfect = false;
            }
        }
        if ($perfect && $goodSpawn > 0) {
            $flags[] = 'perfect_catch';
            // Chuỗi phiên hoàn hảo liên tiếp (gồm phiên này)
            $streakNeed = max(2, (int) ($config['minigame_anomaly_streak'] ?? 3));
            $previous = MinigameSession::where('customer_id', $customer->id)
                ->where('game_id', $session->game_id)
                ->where('status', 'submitted')
                ->orderByDesc('id')
                ->limit($streakNeed - 1)
                ->get();
            $streak = 1;
            foreach ($previous as $prev) {
                if (in_array('perfect_catch', (array) $prev->anomaly_flags, true)) {
                    $streak++;
                } else {
                    break;
                }
            }
            if ($streak >= $streakNeed) {
                $flags[] = 'streak_perfect';
            }
        }
        if ($claimedScore !== null) {
            $mismatch = $verified === 0
                ? $claimedScore > 0
                : abs($claimedScore - $verified) > 0.10 * $verified;
            if ($mismatch) {
                $flags[] = 'score_mismatch';
            }
        }
        $minDuration = $module->minDurationMs($schedule, $counters, $config);
        if ($minDuration > 0 && $durationMs <= $minDuration + 1000) {
            $flags[] = 'fast_submit';
        }
        return array_values(array_unique(array_merge($flags, $module->extraAnomalyFlags($schedule, $counters, $config))));
    }

    /** Ghi điểm cao chế độ GIẢI TRÍ (spec 5.4) — không phiên, không điểm. */
    public function recordBest(Customer $customer, string $gameId, int $score, int $durationMs): MinigamePersonalBest
    {
        $module = $this->module($gameId);
        if (!$module || !$this->gameEnabled($gameId)) {
            abort(422, 'Game đang tạm nghỉ.');
        }
        if ($score < 0 || $durationMs < 0
            || $score > $module->maxScoreForDuration($durationMs, $this->gameConfig($gameId))) {
            abort(422, 'Điểm không hợp lệ.');
        }
        return DB::transaction(function () use ($customer, $gameId, $score, $durationMs) {
            $best = MinigamePersonalBest::lockForUpdate()
                ->where('customer_id', $customer->id)
                ->where('game_id', $gameId)
                ->where('mode', 'casual')
                ->first();
            if (!$best) {
                $best = new MinigamePersonalBest([
                    'customer_id' => $customer->id, 'game_id' => $gameId, 'mode' => 'casual',
                ]);
            }
            $best->plays_count = (int) $best->plays_count + 1;
            if ($score > (int) $best->best_score) {
                $best->best_score = $score;
                $best->best_duration_ms = $durationMs;
            }
            $best->save();
            return $best;
        });
    }

    /** Thu hồi điểm 1 phiên (spec 5.6) — trừ đúng lô của phiên, tối đa phần còn lại. */
    public function revokeSession(MinigameSession $session, string $reason): int
    {
        return DB::transaction(function () use ($session, $reason) {
            $locked = MinigameSession::lockForUpdate()->find($session->id);
            if (!$locked || $locked->status !== 'submitted' || (int) $locked->reward_points <= 0) {
                abort(422, 'Phiên không ở trạng thái thu hồi được.');
            }
            $customer = Customer::lockForUpdate()->find($locked->customer_id);
            $deduct = 0;
            $lot = $locked->point_lot_id ? PointLot::lockForUpdate()->find($locked->point_lot_id) : null;
            if ($lot) {
                $deduct = min((int) $locked->reward_points, (int) $lot->points_remaining);
                if ($deduct > 0) {
                    $lot->points_remaining = (int) $lot->points_remaining - $deduct;
                    $lot->save();
                    $customer->points = (int) $customer->points - $deduct;
                    $customer->save();
                }
            }
            PointTransaction::create([
                'customer_id' => $customer->id,
                'point_lot_id' => $lot?->id,
                'change' => -$deduct,
                'type' => 'revoke',
                'note' => "Thu hồi điểm minigame {$locked->game_id} · phiên #{$locked->id}: {$reason}",
            ]);
            $locked->update(['status' => 'void']);
            return $deduct;
        });
    }
}
