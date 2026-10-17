<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Delivery\DeliveryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 60 (2026-10-17): Webhook giao hàng từ AhaMove / Lalamove.
// POST /api/webhooks/delivery/{provider} — không auth, verify chữ ký trong adapter.
class DeliveryWebhookController extends Controller
{
    public function handle(Request $request, string $provider, DeliveryService $service): JsonResponse
    {
        $adapter = $service->provider($provider);
        if (!$adapter) {
            return response()->json(['success' => false, 'message' => 'Hãng không hợp lệ'], 404);
        }
        try {
            $adapter->handleWebhook($request);
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            // abort(401)/abort(400) từ adapter — giữ nguyên status
            return response()->json(['success' => false, 'message' => $e->getMessage()], $e->getStatusCode());
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('[Delivery] webhook error', [
                'provider' => $provider, 'msg' => $e->getMessage(),
            ]);
            return response()->json(['success' => false, 'message' => 'Lỗi xử lý webhook'], 500);
        }
        return response()->json(['success' => true]);
    }
}
