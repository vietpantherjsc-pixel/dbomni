<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PaymentMethod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 52: CRUD phương thức thanh toán
class PaymentMethodController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = PaymentMethod::orderBy('sort_order')->orderBy('id');
        if ($request->has('active')) {
            $q->where('is_active', (bool) $request->query('active'));
        }
        if ($channel = $request->query('channel')) {
            $items = $q->get()->filter(fn($m) => $m->forChannel($channel))->values();
        } else {
            $items = $q->get();
        }
        return response()->json(['success' => true, 'data' => $items]);
    }

    // Gói SEC2: endpoint public cho POS/Mini App — LUÔN chỉ trả PTTT đang bật,
    // không tin tham số 'active' của client
    public function publicActive(Request $request): JsonResponse
    {
        $q = PaymentMethod::where('is_active', true)->orderBy('sort_order')->orderBy('id');
        if ($channel = $request->query('channel')) {
            $items = $q->get()->filter(fn($m) => $m->forChannel($channel))->values();
        } else {
            $items = $q->get();
        }
        return response()->json(['success' => true, 'data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'name' => 'required|string|max:100',
            'type' => 'required|in:transfer,cash,debit_card,credit_card,ewallet,other',
            'channels' => 'nullable|array',
            'channels.*' => 'in:pos,zalo',
            'is_active' => 'boolean',
            'sort_order' => 'integer|min:0',
        ]);
        $m = PaymentMethod::create($v);
        return response()->json(['success' => true, 'data' => $m], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $m = PaymentMethod::findOrFail($id);
        $v = $request->validate([
            'name' => 'sometimes|string|max:100',
            'type' => 'sometimes|in:transfer,cash,debit_card,credit_card,ewallet,other',
            'channels' => 'nullable|array',
            'channels.*' => 'in:pos,zalo',
            'is_active' => 'boolean',
            'sort_order' => 'integer|min:0',
        ]);
        $m->update($v);
        return response()->json(['success' => true, 'data' => $m]);
    }

    public function destroy(int $id): JsonResponse
    {
        PaymentMethod::findOrFail($id)->delete();
        return response()->json(['success' => true]);
    }
}
