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
            // Thứ trong tuần (0=CN..6=T7)
            if (!empty($promo->days_of_week) && !in_array($now->dayOfWeek, $promo->days_of_week)) {
                continue;
            }
            // Khung giờ vàng
            // Gói 13: hỗ trợ window qua đêm (vd 22:00–02:00): nếu to < from thì điều kiện OR
            if ($promo->time_from && $promo->time_to) {
                $t = $now->format('H:i:s');
                $from = $promo->time_from;
                $to = $promo->time_to;
                $inWindow = $to < $from
                    ? ($t >= $from || $t <= $to)
                    : ($t >= $from && $t <= $to);
                if (!$inWindow) {
                    continue;
                }
            }
            // Kênh bán
            if (!empty($promo->channels) && !in_array($channel, $promo->channels)) {
                continue;
            }
            // Đối tượng: hạng thành viên
            if ($promo->target === 'tier') {
                if (!$customer || empty($promo->tier_ids) || !in_array($customer->membership_tier_id, $promo->tier_ids)) {
                    continue;
                }
            }
            // Đơn tối thiểu (tính trên tiền hàng, chưa gồm phí ship)
            if ($subtotal < (float) $promo->min_order_amount) {
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
}
