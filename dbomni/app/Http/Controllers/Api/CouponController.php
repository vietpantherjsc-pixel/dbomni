<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerCoupon;
use App\Services\AutoIssueCouponService;
use App\Services\CustomerIdentityService;
use App\Services\PromotionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// SPEC-02: API ví coupon + referral + tích tem (Mini App).
// Spec KM chống mã (2026-10-21) Phần B: các endpoint quyền lợi KHÔNG nhận customer_id
// trần nữa — định danh chỉ bằng SĐT + mã thành viên (Audit BM-02: bỏ hẳn nhánh zalo_id trần).
class CouponController extends Controller
{
    /** Khách đã xác thực từ request, hoặc response 401 NOT_VERIFIED. */
    private function verifiedOrFail(Request $request): Customer|JsonResponse
    {
        $customer = CustomerIdentityService::verifiedCustomer($request->all());
        if (!$customer) {
            return response()->json([
                'success' => false,
                'reason' => 'NOT_VERIFIED',
                'message' => PromotionService::reasonText('NOT_VERIFIED'),
            ], 401);
        }
        return $customer;
    }

    /**
     * GET /api/coupons/my — ví "Ưu đãi của tôi" (3 tab).
     * Định danh: phone + member_code. status: active|expiring|used
     * Coupon đang có kèm usable_now + reason (Phần C5: không thỏa điều kiện hiện tại
     * thì hiện mờ kèm lý do thay vì biến mất).
     */
    public function myCoupons(Request $request, PromotionService $promoService): JsonResponse
    {
        $customer = $this->verifiedOrFail($request);
        if ($customer instanceof JsonResponse) {
            return $customer;
        }
        $status = $request->query('status', 'active');
        if (!in_array($status, ['active', 'expiring', 'used'], true)) {
            $status = 'active';
        }

        $q = CustomerCoupon::with('promotion')
            ->where('customer_id', $customer->id)
            ->orderByDesc('issued_at');

        if ($status === 'active') {
            $q->where('status', 'active')->where(function ($qq) {
                $qq->whereNull('expires_at')->orWhere('expires_at', '>', now());
            });
        } elseif ($status === 'expiring') {
            // Sắp hết hạn: trong 3 ngày tới
            $q->where('status', 'active')
                ->whereNotNull('expires_at')
                ->where('expires_at', '<=', now()->addDays(3))
                ->where('expires_at', '>', now());
        } else {
            $q->where(function ($qq) {
                $qq->where('status', '!=', 'active')
                    ->orWhere('expires_at', '<=', now());
            });
        }

        $coupons = $q->get()->map(function ($c) use ($promoService, $customer) {
            // Tự động đánh dấu hết hạn
            if ($c->status === 'active' && $c->expires_at && $c->expires_at->isPast()) {
                $c->update(['status' => 'expired']);
            }
            $row = [
                'id' => $c->id,
                'code' => $c->code,
                'status' => $c->status,
                'issued_at' => $c->issued_at,
                'expires_at' => $c->expires_at,
                'used_at' => $c->used_at,
                'promotion' => $c->promotion ? [
                    'code' => $c->promotion->code,
                    'name' => $c->promotion->name,
                    'type' => $c->promotion->type,
                    'value' => $c->promotion->value,
                    'max_discount_amount' => $c->promotion->max_discount_amount,
                    'min_order_amount' => $c->promotion->min_order_amount,
                ] : null,
            ];
            // Phần C5: điều kiện HIỆN TẠI (thời gian/thứ/giờ/hạng/kênh) — điều kiện cần
            // giỏ hàng (đơn tối thiểu, phạm vi món) kiểm lại ở bước validate khi chọn.
            if ($c->status === 'active' && $c->promotion) {
                $chk = $promoService->checkConditions($c->promotion, [
                    'subtotal' => (float) ($c->promotion->min_order_amount ?? 0),
                    'items' => [],
                    'customer' => $customer,
                    'channel' => 'online',
                ]);
                // items rỗng → OUT_OF_SCOPE là do chưa có giỏ, không kết luận ở ví
                if (!$chk['ok'] && $chk['reason'] === 'OUT_OF_SCOPE') {
                    $chk = ['ok' => true, 'reason' => null, 'message' => null];
                }
                $trig = $chk['ok']
                    ? $promoService->checkTrigger($c->promotion, $c, $customer)
                    : $chk;
                $row['usable_now'] = $trig['ok'];
                $row['reason'] = $trig['reason'];
                $row['reason_text'] = $trig['message'];
            }
            return $row;
        });

        return response()->json(['success' => true, 'data' => $coupons]);
    }

    /**
     * GET /api/coupons/stamps — tiến trình tích tem CP-03.
     */
    public function myStamps(Request $request, AutoIssueCouponService $service): JsonResponse
    {
        $customer = $this->verifiedOrFail($request);
        if ($customer instanceof JsonResponse) {
            return $customer;
        }

        $cfg = $service->stampConfig();
        $count = $service->stampCount($customer);

        return response()->json(['success' => true, 'data' => [
            'stamps' => $count,
            'stamps_required' => $cfg['stamps_required'],
            'remaining' => max(0, $cfg['stamps_required'] - $count),
            'max_gift_value' => $cfg['max_gift_value'],
            'merch_tiers' => $cfg['merch_tiers'],
        ]]);
    }

    /**
     * GET /api/coupons/referral — thông tin mời bạn.
     */
    public function myReferral(Request $request): JsonResponse
    {
        $customer = $this->verifiedOrFail($request);
        if ($customer instanceof JsonResponse) {
            return $customer;
        }

        // Tạo referral_code nếu chưa có
        if (empty($customer->referral_code)) {
            $customer->referral_code = strtoupper(\Illuminate\Support\Str::random(8));
            $customer->save();
        }

        $referrals = \App\Models\Referral::with('referred:id,full_name,created_at')
            ->where('referrer_id', $customer->id)
            ->orderByDesc('created_at')
            ->get();

        $completedCount = $referrals->where('status', 'completed')->count();

        return response()->json(['success' => true, 'data' => [
            'referral_code' => $customer->referral_code,
            'total_invited' => $referrals->count(),
            'completed' => $completedCount,
            'referrals' => $referrals->map(fn ($r) => [
                'name' => $r->referred->full_name ?? 'Bạn mới',
                'status' => $r->status,
                'completed_at' => $r->completed_at,
            ]),
        ]]);
    }

    /**
     * POST /api/coupons/validate — kiểm tra coupon dùng được cho đơn này không.
     * Spec Phần A: kiểm ĐỦ điều kiện chương trình qua PromotionService::checkConditions
     * (cửa sổ hiệu lực, thứ, khung giờ, kênh, hạng, đơn tối thiểu, phạm vi) + kiểm lại
     * trigger lúc dùng + tính giảm THEO PHẠM VI bằng discountFor (khớp đường promotion_id).
     * Mọi từ chối kèm reason code (bảng C4/C5).
     */
    public function validateCoupon(Request $request, PromotionService $promoService): JsonResponse
    {
        $v = $request->validate([
            'coupon_id' => 'required|exists:customer_coupons,id',
            'subtotal' => 'required|numeric|min:0',
            'items' => 'nullable|array',
            'shipping_fee' => 'nullable|numeric|min:0',
            'channel' => 'nullable|in:online,pos',
        ]);

        $customer = $this->verifiedOrFail($request);
        if ($customer instanceof JsonResponse) {
            return $customer;
        }

        $fail = fn(string $reason, ?\App\Models\Promotion $promo, int $status) => response()->json([
            'success' => false,
            'reason' => $reason,
            'message' => PromotionService::reasonText($reason, $promo),
        ], $status);

        $coupon = CustomerCoupon::with('promotion')->findOrFail($v['coupon_id']);

        // Quy tắc bắt buộc #2: đúng chủ sở hữu (theo khách ĐÃ XÁC THỰC)
        if ((int) $coupon->customer_id !== (int) $customer->id) {
            return $fail('NOT_OWNER', $coupon->promotion, 403);
        }

        if (!$coupon->isUsable()) {
            return $fail('COUPON_UNUSABLE', $coupon->promotion, 422);
        }

        $promo = $coupon->promotion;
        if (!$promo) {
            return $fail('INACTIVE', null, 422);
        }

        $channel = $v['channel'] ?? 'online';
        $items = $v['items'] ?? [];
        $chk = $promoService->checkConditions($promo, [
            'subtotal' => (float) $v['subtotal'],
            'items' => $items,
            'customer' => $customer,
            'channel' => $channel,
        ]);
        if (!$chk['ok']) {
            return $fail($chk['reason'], $promo, 422);
        }

        $trig = $promoService->checkTrigger($promo, $coupon, $customer);
        if (!$trig['ok']) {
            return $fail($trig['reason'], $promo, 422);
        }

        $calc = $promoService->discountFor($promo, (float) $v['subtotal'], $items, (float) ($v['shipping_fee'] ?? 0));
        if ($calc['unsupported']) {
            return $fail('UNSUPPORTED_TYPE', $promo, 422);
        }

        return response()->json(['success' => true, 'data' => [
            'coupon_id' => $coupon->id,
            'code' => $coupon->code,
            'discount' => (int) round($calc['discount']),
            'is_shipping' => $calc['is_shipping'],
            'gift_product_id' => $calc['gift_product_id'],
            'gift_product_name' => $calc['gift_product_name'],
            'promotion' => [
                'name' => $promo->name,
                'type' => $promo->type,
                'value' => $promo->value,
                'max_discount_amount' => $promo->max_discount_amount,
            ],
        ]]);
    }
}
