<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\CustomerIdentityService;
use App\Services\MinigameService;
use App\Support\MediaFilename;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Minigame (2026-11-01) — API khách Mini App. Định danh theo mẫu hiện hữu:
// phone + member_code qua CustomerIdentityService (như points/*).
// Controller mỏng: mọi luật ở MinigameService (Lớp A) + mô-đun game (Lớp B).
class MinigameController extends Controller
{
    public function __construct(private MinigameService $service)
    {
    }

    // GET /minigame/state — trạng thái cho thẻ Tài khoản + trang game (chỉ đọc)
    public function state(Request $request): JsonResponse
    {
        $customer = CustomerIdentityService::verifiedCustomer($request->all());
        return response()->json(['success' => true, 'data' => $this->service->state($customer)]);
    }

    // POST /minigame/session — cấp phiên có thưởng
    public function session(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'nullable|string',
            'member_code' => 'nullable|string',
            'game_id' => 'required|string|max:40',
        ]);
        $customer = CustomerIdentityService::verifiedCustomer($v);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Cần đăng nhập thành viên để chơi có thưởng.'], 422);
        }
        $session = $this->service->issueSession($customer, $v['game_id']);
        return response()->json([
            'success' => true,
            'data' => [
                'session_id' => $session->id,
                'seed' => (int) $session->seed,
                'expires_at' => $session->expires_at->toIso8601String(),
                'config' => $session->config_snapshot,
            ],
        ]);
    }

    // POST /minigame/submit — nộp kết quả phiên có thưởng (server tự tính thưởng)
    public function submit(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'nullable|string',
            'member_code' => 'nullable|string',
            'session_id' => 'required|integer',
            'duration_ms' => 'required|integer|min:0',
            'counters' => 'required|array',
            'claimed_score' => 'nullable|integer',
        ]);
        $customer = CustomerIdentityService::verifiedCustomer($v);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Cần đăng nhập thành viên để nộp kết quả.'], 422);
        }
        $result = $this->service->submit(
            $customer,
            (int) $v['session_id'],
            (int) $v['duration_ms'],
            (array) $v['counters'],
            isset($v['claimed_score']) ? (int) $v['claimed_score'] : null
        );
        return response()->json(['success' => true, 'data' => $result]);
    }

    // POST /minigame/best — ghi điểm cao chế độ giải trí (không điểm thưởng)
    public function best(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'nullable|string',
            'member_code' => 'nullable|string',
            'game_id' => 'required|string|max:40',
            'score' => 'required|integer|min:0',
            'duration_ms' => 'required|integer|min:0',
        ]);
        $customer = CustomerIdentityService::verifiedCustomer($v);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Cần đăng nhập thành viên để lưu kỷ lục.'], 422);
        }
        $best = $this->service->recordBest($customer, $v['game_id'], (int) $v['score'], (int) $v['duration_ms']);
        return response()->json([
            'success' => true,
            'data' => [
                'best_score' => (int) $best->best_score,
                'best_duration_ms' => (int) $best->best_duration_ms,
                'plays_count' => (int) $best->plays_count,
            ],
        ]);
    }

    // POST /minigame/share-card — tải ảnh thẻ kết quả PNG (base64) lấy URL công khai
    public function shareCard(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'nullable|string',
            'member_code' => 'nullable|string',
            'image' => 'required|string|max:1000000', // base64 của PNG ≤ 700KB
        ]);
        $customer = CustomerIdentityService::verifiedCustomer($v);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Cần đăng nhập thành viên để chia sẻ.'], 422);
        }
        $raw = (string) $v['image'];
        if (str_contains($raw, ',')) {
            $raw = substr($raw, strpos($raw, ',') + 1); // bỏ tiền tố data:image/png;base64,
        }
        $binary = base64_decode($raw, true);
        if ($binary === false || strlen($binary) > 700 * 1024
            || !str_starts_with($binary, "\x89PNG")
            || @getimagesizefromstring($binary) === false) {
            return response()->json(['success' => false, 'message' => 'Ảnh thẻ kết quả không hợp lệ.'], 422);
        }
        $dir = public_path('images/minigame-shares');
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        // Giới hạn 10 ảnh/khách/ngày (đếm theo file đã lưu trong ngày)
        $prefix = "share_{$customer->id}_" . now()->format('Ymd') . '_';
        $todayCount = count(glob($dir . '/' . $prefix . '*.png') ?: []);
        if ($todayCount >= 10) {
            return response()->json(['success' => false, 'message' => 'Bạn đã chia sẻ nhiều lần hôm nay — thử lại ngày mai nhé.'], 422);
        }
        // Tên do server sinh (đã ASCII); vẫn qua MediaFilename::unique theo rule chung 2026-11-04.
        $filename = MediaFilename::unique($dir, $prefix . bin2hex(random_bytes(4)) . '.png');
        file_put_contents($dir . '/' . $filename, $binary);
        return response()->json([
            'success' => true,
            'data' => ['url' => $request->getSchemeAndHttpHost() . '/images/minigame-shares/' . $filename],
        ]);
    }
}
