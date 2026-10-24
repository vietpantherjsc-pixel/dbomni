<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Promotion;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

// Gói 5 (2026-10-05): Đánh giá khuyến mại đủ điều kiện và tính mức giảm.
// Logic theo spec Sapo: thời gian (ngày bắt đầu/kết thúc, thứ trong tuần, khung giờ),
// phạm vi (hóa đơn/danh mục/mặt hàng), đối tượng (tất cả/hạng thành viên), kênh bán.
class PromotionService
{
    // Spec kênh bán hàng (2026-10-19): map mã kênh gọi vào (pos/zalo/online/...) sang ID price_lists.
    // Public static để OnlineOrderController/CouponController dùng chung khi kiểm tra coupon theo kênh.
    public static function resolveChannelId(string $channel): ?int
    {
        static $map = ['pos' => 'nha_hang', 'zalo' => 'online'];
        static $logged = [];
        $lc = mb_strtolower(trim($channel));
        if (isset($map[$lc])) {
            if (!isset($logged[$lc])) {
                $logged[$lc] = true;
                \Illuminate\Support\Facades\Log::warning("[deprecated] PromotionService: mã kênh cũ '{$channel}' được map sang '{$map[$lc]}' — hãy dùng mã chuẩn.");
            }
            $channel = $map[$lc];
        }
        return \App\Models\PriceList::whereRaw('LOWER(code) = ?', [mb_strtolower($channel)])->value('id');
    }

    // Kiểm tra KM có áp dụng cho kênh không. channels null/rỗng = mọi kênh.
    // Dữ liệu mới: mảng ID; dữ liệu cũ (chưa migrate): mảng code chuỗi — vẫn so sánh chuỗi.
    public static function channelAllowed($channels, string $channel, ?int $channelId): bool
    {
        if (empty($channels)) {
            return true;
        }
        $channels = (array) $channels;
        $ids = array_filter(array_map('intval', $channels));
        if ($ids) {
            return $channelId !== null && in_array($channelId, $ids, true);
        }
        return in_array($channel, $channels, true);
    }

    /**
     * @param array $params [
     *   'subtotal' => float (tổng tiền hàng trước giảm),
     *   'items' => [['product_id'=>int,'category_id'=>int|null,'quantity'=>int,'line_total'=>float,'unit_price'=>float]],
     *   'customer_id' => int|null,
     *   'channel' => 'pos'|'online',
     *   'shipping_fee' => float (Gói 10c: phí ship hiện tại, để tính KM shipping),
     *   'at' => Carbon|null (mặc định now)
     * ]
     * @return array danh sách KM đủ điều kiện kèm discount đã tính
     */
    public function eligiblePromotions(array $params): array
    {
        $now = $params['at'] ?? Carbon::now();
        $subtotal = (float) ($params['subtotal'] ?? 0);
        $items = $params['items'] ?? [];
        $channel = $params['channel'] ?? 'pos';
        $shippingFee = (float) ($params['shipping_fee'] ?? 0);
        // Spec kênh bán hàng (2026-10-19): channels lưu mảng ID price_lists — resolve mã kênh gọi vào sang ID 1 lần
        $channelId = $this->resolveChannelId($channel);

        $customer = null;
        if (!empty($params['customer_id'])) {
            $customer = Customer::find($params['customer_id']);
        }

        $promotions = Promotion::where('is_active', true)
            ->where(function ($q) use ($now) {
                $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now);
            })
            ->where(function ($q) use ($now) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>=', $now);
            })
            ->get();

        $result = [];
        foreach ($promotions as $promo) {
            // Spec KM chống mã (2026-10-21) Phần A: điều kiện dùng CHUNG 1 hàm cho cả 3
            // đường (promotion_id / voucher / coupon ví) — xem checkConditions().
            $chk = $this->checkConditions($promo, [
                'subtotal' => $subtotal,
                'items' => $items,
                'customer' => $customer,
                'channel' => $channel,
                'shipping_fee' => $shippingFee,
                'at' => $now,
            ]);
            if (!$chk['ok']) {
                continue;
            }

            // Gói 10c: KM phí ship — cần có phí ship > 0; value=0 => miễn phí hoàn toàn
            if ($promo->type === 'shipping') {
                if ($shippingFee <= 0) {
                    continue;
                }
                $shipDiscount = (float) $promo->value <= 0
                    ? $shippingFee
                    : min((float) $promo->value, $shippingFee);
                if ($shipDiscount <= 0) {
                    continue;
                }
                $result[] = [
                    'id' => $promo->id,
                    'name' => $promo->name,
                    'type' => $promo->type,
                    'is_shipping' => true,
                    'discount' => round($shipDiscount, 0),
                    'gift_product_id' => null,
                    'gift_quantity' => 1,
                    'gift_product_name' => null,
                ];
                continue;
            }

            // Gói 10: resolve món thuộc thực đơn cho scope='menu'
            $menuProductIds = $promo->scope === 'menu'
                ? $this->menuProductIds($promo->scope_ids ?? [])
                : [];

            $calc = $this->calculateDiscount($promo, $subtotal, $items, $menuProductIds);
            if ($calc['discount'] <= 0 && $promo->type !== 'gift') {
                continue;
            }

            $result[] = [
                'id' => $promo->id,
                'name' => $promo->name,
                'type' => $promo->type,
                'is_shipping' => false,
                'discount' => round($calc['discount'], 0),
                'gift_product_id' => $promo->gift_product_id,
                'gift_quantity' => $promo->gift_quantity,
                'gift_product_name' => $calc['gift_product_name'],
            ];
        }

        // Sắp xếp giảm nhiều nhất lên trước
        usort($result, fn($a, $b) => $b['discount'] <=> $a['discount']);

        return $result;
    }

    /**
     * Tính số tiền giảm của 1 KM trên đơn hàng.
     */
    public function calculateDiscount(Promotion $promo, float $subtotal, array $items, array $menuProductIds = []): array
    {
        $eligibleTotal = $subtotal;
        if ($promo->scope !== 'order') {
            $eligibleTotal = 0;
            foreach ($items as $it) {
                if ($this->itemInScope($promo, $it, $menuProductIds)) {
                    $eligibleTotal += (float) ($it['line_total'] ?? 0);
                }
            }
        }

        $discount = 0;
        $giftName = null;

        switch ($promo->type) {
            case 'percent':
                $discount = $eligibleTotal * (float) $promo->value / 100;
                if ($promo->max_discount_amount) {
                    $discount = min($discount, (float) $promo->max_discount_amount);
                }
                break;
            case 'fixed':
                $discount = min((float) $promo->value, $eligibleTotal);
                break;
            case 'fixed_price':
                // Đồng giá: mỗi dòng đủ điều kiện giảm về giá value (nếu giá gốc cao hơn)
                foreach ($items as $it) {
                    if ($this->itemInScope($promo, $it, $menuProductIds)
                        && (float) ($it['unit_price'] ?? 0) > (float) $promo->value) {
                        $discount += ((float) $it['unit_price'] - (float) $promo->value) * (int) ($it['quantity'] ?? 1);
                    }
                }
                break;
            case 'gift':
                $giftName = $promo->giftProduct?->name;
                $discount = 0;
                break;
        }

        return ['discount' => max(0, $discount), 'gift_product_name' => $giftName];
    }

    // Gói 10: kiểm tra 1 dòng món có thuộc phạm vi KM không (order/category/product/menu)
    private function itemInScope(Promotion $promo, array $item, array $menuProductIds = []): bool
    {
        return match ($promo->scope) {
            'order' => true,
            'category' => in_array($item['category_id'] ?? null, $promo->scope_ids ?? []),
            'product' => in_array($item['product_id'] ?? null, $promo->scope_ids ?? []),
            'menu' => in_array($item['product_id'] ?? null, $menuProductIds),
            default => false,
        };
    }

    // Gói 10: danh sách product_id thuộc các thực đơn
    private function menuProductIds(array $menuIds): array
    {
        if (empty($menuIds)) return [];
        return DB::table('menu_product')
            ->whereIn('menu_id', $menuIds)
            ->distinct()->pluck('product_id')->all();
    }

    // ================================================================
    // Spec KM điều kiện chống mã (2026-10-21)
    // ================================================================

    /**
     * Thông báo khách theo reason code (bảng C4 của spec).
     */
    public static function reasonText(string $reason, ?Promotion $promo = null): string
    {
        switch ($reason) {
            case 'NOT_STARTED':
                return 'Mã này áp dụng từ ngày ' . ($promo?->starts_at ? $promo->starts_at->format('d/m/Y') : '') . '.';
            case 'EXPIRED_WINDOW':
                return 'Mã này đã hết thời gian áp dụng.';
            case 'WRONG_DAY_TIME':
                $parts = [];
                if ($promo && !empty($promo->days_of_week)) {
                    $names = [0 => 'Chủ nhật', 1 => 'Thứ 2', 2 => 'Thứ 3', 3 => 'Thứ 4', 4 => 'Thứ 5', 5 => 'Thứ 6', 6 => 'Thứ 7'];
                    $parts[] = 'vào ' . implode(', ', array_map(fn($d) => $names[(int) $d] ?? '', $promo->days_of_week));
                }
                if ($promo && $promo->time_from && $promo->time_to) {
                    $parts[] = 'khung giờ ' . substr((string) $promo->time_from, 0, 5) . '–' . substr((string) $promo->time_to, 0, 5);
                }
                return 'Mã chỉ áp dụng ' . ($parts ? implode(' ', $parts) : 'vào thời gian quy định') . '.';
            case 'WRONG_CHANNEL':
                return 'Mã không áp dụng cho kênh này.';
            case 'TIER_ONLY':
                $tiers = '';
                if ($promo && !empty($promo->tier_ids)) {
                    $tiers = \App\Models\MembershipTier::whereIn('id', $promo->tier_ids)->pluck('name')->implode(', ');
                }
                return 'Ưu đãi này dành cho thành viên' . ($tiers ? ' hạng ' . $tiers : '') . '.';
            case 'MIN_ORDER':
                return 'Đơn cần tối thiểu ' . number_format((float) ($promo->min_order_amount ?? 0), 0) . 'đ để dùng mã này.';
            case 'OUT_OF_SCOPE':
                $names = '';
                if ($promo) {
                    $ids = $promo->scope_ids ?? [];
                    if ($promo->scope === 'product') {
                        $names = \App\Models\Product::whereIn('id', $ids)->pluck('name')->implode(', ');
                    } elseif ($promo->scope === 'category') {
                        $names = \App\Models\Category::whereIn('id', $ids)->pluck('name')->implode(', ');
                    } elseif ($promo->scope === 'menu') {
                        $names = \App\Models\Menu::whereIn('id', $ids)->pluck('name')->implode(', ');
                    }
                }
                return 'Mã chỉ áp dụng cho ' . ($names ?: 'một số món nhất định') . '.';
            case 'INACTIVE':
                return 'Ưu đãi không còn hiệu lực.';
            case 'UNSUPPORTED_TYPE':
                return 'Mã này chưa áp dụng được tại đây, mã vẫn giữ trong ví của bạn.';
            case 'TRIGGER_FIRST_ORDER':
                return 'Mã này chỉ dùng cho đơn đầu tiên của bạn.';
            case 'TRIGGER_BIRTHDAY':
                return 'Mã này chỉ dùng trong tháng sinh nhật của bạn.';
            case 'TRIGGER_REFERRAL':
                return 'Mã này chưa đủ điều kiện giới thiệu để sử dụng.';
            case 'TRIGGER_NEXT_ORDER':
                return 'Mã này chỉ dùng từ đơn tiếp theo của bạn.';
            case 'NOT_VERIFIED':
                return 'Nhập mã thành viên để dùng điểm và coupon trong ví.';
            case 'NOT_OWNER':
                return 'Coupon không thuộc về bạn.';
            case 'COUPON_UNUSABLE':
                return 'Coupon đã hết hạn hoặc đã dùng.';
            default:
                return 'Mã không áp dụng được cho đơn này.';
        }
    }

    /**
     * Kiểm điều kiện của 1 Promotion trong ngữ cảnh đơn — HÀM DÙNG CHUNG cho cả 3 đường
     * (promotion_id, voucher, coupon ví) theo spec Phần A.
     *
     * @param array $ctx [subtotal, items, customer (Customer|null), channel, shipping_fee, at (Carbon|null)]
     * @return array ['ok' => bool, 'reason' => ?string, 'message' => ?string]
     */
    public function checkConditions(Promotion $promo, array $ctx): array
    {
        $fail = fn(string $reason) => [
            'ok' => false,
            'reason' => $reason,
            'message' => self::reasonText($reason, $promo),
        ];

        $now = $ctx['at'] ?? Carbon::now();
        $subtotal = (float) ($ctx['subtotal'] ?? 0);
        $items = $ctx['items'] ?? [];
        $customer = $ctx['customer'] ?? null;
        $channel = $ctx['channel'] ?? 'online';

        if (!$promo->is_active) {
            return $fail('INACTIVE');
        }
        if ($promo->starts_at && $now->lt($promo->starts_at)) {
            return $fail('NOT_STARTED');
        }
        if ($promo->expires_at && $now->gt($promo->expires_at)) {
            return $fail('EXPIRED_WINDOW');
        }
        // Thứ trong tuần (0=CN..6=T7)
        if (!empty($promo->days_of_week) && !in_array($now->dayOfWeek, $promo->days_of_week)) {
            return $fail('WRONG_DAY_TIME');
        }
        // Khung giờ (hỗ trợ window qua đêm như Gói 13)
        if ($promo->time_from && $promo->time_to) {
            $t = $now->format('H:i:s');
            $from = $promo->time_from;
            $to = $promo->time_to;
            $inWindow = $to < $from
                ? ($t >= $from || $t <= $to)
                : ($t >= $from && $t <= $to);
            if (!$inWindow) {
                return $fail('WRONG_DAY_TIME');
            }
        }
        // Kênh bán
        if (!self::channelAllowed($promo->channels, $channel, self::resolveChannelId($channel))) {
            return $fail('WRONG_CHANNEL');
        }
        // Đối tượng: hạng thành viên
        if ($promo->target === 'tier') {
            if (!$customer || empty($promo->tier_ids) || !in_array($customer->membership_tier_id, $promo->tier_ids)) {
                return $fail('TIER_ONLY');
            }
        }
        // Đơn tối thiểu (trên tiền hàng, chưa gồm phí ship)
        if ($subtotal < (float) $promo->min_order_amount) {
            return $fail('MIN_ORDER');
        }
        // Phạm vi: KM theo món/danh mục/thực đơn mà giỏ không có món nào thuộc phạm vi
        if ($promo->scope !== 'order' && $promo->type !== 'shipping') {
            $menuProductIds = $promo->scope === 'menu' ? $this->menuProductIds($promo->scope_ids ?? []) : [];
            $any = false;
            foreach ($items as $it) {
                if ($this->itemInScope($promo, $it, $menuProductIds)) {
                    $any = true;
                    break;
                }
            }
            if (!$any) {
                return $fail('OUT_OF_SCOPE');
            }
        }

        return ['ok' => true, 'reason' => null, 'message' => null];
    }

    /**
     * Tính giảm cho 1 Promotion trong ngữ cảnh đơn — dùng chung cho đường coupon ví
     * (validate + store) để khớp hệt đường promotion_id: theo scope, gồm cả
     * shipping (trên phí ship) và gift/bogo (tặng món theo cấu hình gift_product_id).
     *
     * @return array ['discount' => float, 'is_shipping' => bool,
     *                'gift_product_id' => ?int, 'gift_quantity' => int, 'gift_product_name' => ?string,
     *                'unsupported' => bool]
     */
    public function discountFor(Promotion $promo, float $subtotal, array $items, float $shippingFee = 0): array
    {
        $out = [
            'discount' => 0,
            'is_shipping' => false,
            'gift_product_id' => null,
            'gift_quantity' => (int) ($promo->gift_quantity ?? 1),
            'gift_product_name' => null,
            'unsupported' => false,
        ];
        if ($promo->type === 'shipping') {
            $out['is_shipping'] = true;
            if ($shippingFee > 0) {
                $out['discount'] = (float) $promo->value <= 0
                    ? $shippingFee
                    : min((float) $promo->value, $shippingFee);
            }
            return $out;
        }
        if ($promo->type === 'gift' || $promo->type === 'bogo') {
            // BOGO tính như tặng món theo cấu hình; chưa cấu hình món tặng → không hỗ trợ
            if ($promo->gift_product_id) {
                $out['gift_product_id'] = (int) $promo->gift_product_id;
                $out['gift_product_name'] = $promo->giftProduct?->name;
            } else {
                $out['unsupported'] = true;
            }
            return $out;
        }
        $menuProductIds = $promo->scope === 'menu' ? $this->menuProductIds($promo->scope_ids ?? []) : [];
        $calc = $this->calculateDiscount($promo, $subtotal, $items, $menuProductIds);
        $out['discount'] = (float) $calc['discount'];
        return $out;
    }

    /**
     * Kiểm lại điều kiện trigger của coupon ví TẠI THỜI ĐIỂM DÙNG (spec A2.4) —
     * trước đây chỉ kiểm lúc phát hành (AutoIssueCouponService).
     *
     * @return array ['ok' => bool, 'reason' => ?string, 'message' => ?string]
     */
    public function checkTrigger(Promotion $promo, ?\App\Models\CustomerCoupon $coupon, ?Customer $customer): array
    {
        $ok = ['ok' => true, 'reason' => null, 'message' => null];
        $trigger = $coupon?->issue_trigger;
        if (!$trigger || !$customer) {
            return $ok;
        }
        $fail = fn(string $reason) => [
            'ok' => false,
            'reason' => $reason,
            'message' => self::reasonText($reason, $promo),
        ];
        switch ($trigger) {
            case 'first_order':
                $hasCompleted = \App\Models\Order::where('customer_id', $customer->id)
                    ->where('status', 'completed')->exists();
                return $hasCompleted ? $fail('TRIGGER_FIRST_ORDER') : $ok;
            case 'birthday':
                $inMonth = $customer->birthday && (int) Carbon::parse($customer->birthday)->format('m') === (int) now()->format('m');
                return $inMonth ? $ok : $fail('TRIGGER_BIRTHDAY');
            case 'referral':
                $hasReferral = \App\Models\Referral::where('status', 'completed')
                    ->where(function ($q) use ($customer) {
                        $q->where('referrer_id', $customer->id)->orWhere('referred_id', $customer->id);
                    })->exists();
                return $hasReferral ? $ok : $fail('TRIGGER_REFERRAL');
            case 'next_order':
                $hasCompleted = \App\Models\Order::where('customer_id', $customer->id)
                    ->where('status', 'completed')->exists();
                return $hasCompleted ? $ok : $fail('TRIGGER_NEXT_ORDER');
            default:
                // stamp / inactive / manual...: điều kiện đã chốt lúc phát hành, không kiểm lại
                return $ok;
        }
    }
}
