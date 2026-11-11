<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MinigameSession;
use App\Models\Setting;
use App\Services\MinigameService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Minigame (2026-11-01) — Admin: cấu hình + số liệu vận hành + phiên bất
// thường + thu hồi điểm theo phiên (spec 5.6). Route nằm trong nhóm quyền
// customers.minigame.* như khu Loyalty (mirror CheckPermission).
class AdminMinigameController extends Controller
{
    public function __construct(private MinigameService $service)
    {
    }

    // GET /admin/minigame/config — cấu hình chung + cấu hình từng game
    public function config(): JsonResponse
    {
        $games = [];
        foreach ($this->service->games() as $gameId => $module) {
            $games[$gameId] = [
                'enabled' => $this->service->gameEnabled($gameId),
                'config' => $this->service->gameConfig($gameId),
                'defaults' => $module->defaultConfig(),
            ];
        }
        return response()->json([
            'success' => true,
            'data' => [
                'shared' => $this->service->sharedConfig(),
                'games' => $games,
            ],
        ]);
    }

    // POST /admin/minigame/config — lưu cấu hình (chỉ ghi khóa có gửi lên)
    public function updateConfig(Request $request): JsonResponse
    {
        $sharedRules = [
            'minigame_enabled' => 'nullable|boolean',
            'minigame_daily_plays' => 'nullable|integer|min:1|max:50',
            'minigame_t1_score' => 'nullable|integer|min:0|max:1000000',
            'minigame_t1_points' => 'nullable|integer|min:0|max:1000',
            'minigame_t2_score' => 'nullable|integer|min:0|max:1000000',
            'minigame_t2_points' => 'nullable|integer|min:0|max:1000',
            'minigame_t3_score' => 'nullable|integer|min:0|max:1000000',
            'minigame_t3_points' => 'nullable|integer|min:0|max:1000',
            'minigame_mission_score' => 'nullable|integer|min:0|max:1000000',
            'minigame_mission_points' => 'nullable|integer|min:0|max:1000',
            'minigame_daily_cap_points' => 'nullable|integer|min:0|max:100000',
            'minigame_global_cap_points' => 'nullable|integer|min:0|max:100000000',
            'minigame_session_ttl_seconds' => 'nullable|integer|min:30|max:3600',
            'minigame_anomaly_streak' => 'nullable|integer|min:2|max:50',
        ];
        $v = $request->validate([
            'shared' => 'nullable|array',
            'shared.*' => 'nullable',
            'games' => 'nullable|array',
        ]);
        foreach ((array) ($v['shared'] ?? []) as $key => $value) {
            if (!array_key_exists($key, $sharedRules) || $value === null) {
                continue;
            }
            $single = $request->validate(['shared.' . $key => $sharedRules[$key]]);
            $val = $single['shared'][$key];
            Setting::set($key, $key === 'minigame_enabled' ? ($val ? '1' : '0') : (string) $val);
        }
        foreach ((array) ($v['games'] ?? []) as $gameId => $gameData) {
            $module = $this->service->module((string) $gameId);
            if (!$module || !is_array($gameData)) {
                continue;
            }
            if (array_key_exists('enabled', $gameData)) {
                Setting::set("minigame_game_{$gameId}_enabled", $gameData['enabled'] ? '1' : '0');
            }
            foreach ((array) ($gameData['config'] ?? []) as $key => $value) {
                // Chỉ nhận khóa thuộc defaultConfig của chính mô-đun đó
                if (!array_key_exists($key, $module->defaultConfig()) || $value === null || !is_numeric($value)) {
                    continue;
                }
                Setting::set($key, (string) $value);
            }
        }
        return response()->json([
            'success' => true,
            'message' => 'Đã lưu cấu hình Minigame',
            'data' => $this->config()->getData(true)['data'],
        ]);
    }

    // GET /admin/minigame/stats?date=YYYY-MM-DD
    public function stats(Request $request): JsonResponse
    {
        $date = $request->query('date') ?: now()->toDateString();
        $submitted = MinigameSession::where('status', 'submitted')->whereDate('submitted_at', $date);
        return response()->json([
            'success' => true,
            'data' => [
                'date' => $date,
                'sessions_issued' => MinigameSession::whereDate('created_at', $date)->count(),
                'sessions_submitted' => (clone $submitted)->count(),
                'players' => (clone $submitted)->distinct('customer_id')->count('customer_id'),
                'points_issued' => (int) (clone $submitted)->sum('reward_points'),
                'flagged' => (clone $submitted)->whereRaw('JSON_LENGTH(anomaly_flags) > 0')->count(),
            ],
        ]);
    }

    // GET /admin/minigame/sessions?flagged=1&page=
    public function sessions(Request $request): JsonResponse
    {
        $query = MinigameSession::with(['customer:id,name,phone,member_code', 'pointLot:id,points_remaining'])
            ->orderByDesc('id');
        if ($request->boolean('flagged')) {
            $query->whereRaw('JSON_LENGTH(anomaly_flags) > 0');
        }
        if ($request->query('date')) {
            $query->whereDate('created_at', $request->query('date'));
        }
        $page = $query->paginate(20);
        $page->getCollection()->transform(fn (MinigameSession $s) => [
            'id' => $s->id,
            'game_id' => $s->game_id,
            'customer' => $s->customer ? [
                'name' => $s->customer->name,
                'phone' => $s->customer->phone,
                'member_code' => $s->customer->member_code,
            ] : null,
            'status' => $s->status,
            'claimed_score' => $s->claimed_score,
            'verified_score' => $s->verified_score,
            'reward_points' => (int) $s->reward_points,
            'duration_ms' => $s->duration_ms,
            'counters' => $s->counters,
            'anomaly_flags' => $s->anomaly_flags,
            'lot_remaining' => $s->pointLot?->points_remaining,
            'issued_at' => $s->issued_at?->format('d/m/Y H:i'),
            'submitted_at' => $s->submitted_at?->format('d/m/Y H:i'),
        ]);
        return response()->json(['success' => true, 'data' => $page]);
    }

    // POST /admin/minigame/sessions/{id}/revoke — thu hồi điểm 1 phiên (lý do bắt buộc)
    public function revoke(Request $request, int $id): JsonResponse
    {
        $v = $request->validate([
            'reason' => 'required|string|max:500',
        ]);
        $session = MinigameSession::findOrFail($id);
        $deducted = $this->service->revokeSession($session, $v['reason']);
        return response()->json([
            'success' => true,
            'message' => "Đã thu hồi {$deducted} điểm của phiên #{$id}.",
            'data' => ['deducted' => $deducted],
        ]);
    }
}
