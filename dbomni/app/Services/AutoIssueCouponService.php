<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\CustomerCoupon;
use App\Models\Order;
use App\Models\Promotion;
use App\Models\Referral;
use App\Models\Stamp;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

// SPEC-02: Engine tự động cấp coupon theo sự kiện.
// Mọi tham số đọc từ promotions.auto_config (Admin chỉnh), KHÔNG hardcode số trong service.
class AutoIssueCouponService
{
    /**
     * Cấp coupon cho khách từ 1 promotion (kiểm tra trùng + hiệu lực).
     */
    public function issue(Customer $customer, Promotion $promo, string $trigger): ?CustomerCoupon
    {
        // Kiểm tra promotion còn hiệu lực
        if (!$promo->is_active) return null;
        $now = now();
        if ($promo->starts_at && $now->lt($promo->starts_at)) return null;
        if ($promo->expires_at && $now->gt($promo->expires_at)) return null;

        $cfg = $promo->auto_config ?? [];

        // Giới hạn số lần cấp/khách (mặc định 1).
        // Loyalty 2.0: trigger 'points_exchange' NGOẠI LỆ — trần lượt đổi do
        // point_exchange_items (daily_limit/per_customer_limit) quản ở tầng đổi
        // điểm; nếu để trần mặc định 1 ở đây, khách đổi điểm lần 2 cùng mẫu
        // coupon sẽ bị chặn oan dù còn điểm và chưa chạm trần món đổi.
        $maxPerCustomer = (int) ($cfg['max_per_customer'] ?? 1);
        $issuedCount = CustomerCoupon::where('customer_id', $customer->id)
            ->where('promotion_id', $promo->id)
            ->count();
        if ($trigger !== 'points_exchange' && $issuedCount >= $maxPerCustomer) return null;

        // Tính HSD từ auto_config (số ngày hiệu lực, mặc định 7)
        $validDays = (int) ($cfg['valid_days'] ?? 7);
        $expiresAt = $now->copy()->addDays($validDays);

        $coupon = CustomerCoupon::create([
            'customer_id' => $customer->id,
            'promotion_id' => $promo->id,
            // Luật bỏ gạch mở rộng (2026-10-21 ~23:09): mã coupon tự sinh nối liền,
            // không chèn '-' giữa mã chương trình (Admin đặt, giữ nguyên) và hậu tố ngẫu nhiên.
            'code' => strtoupper($promo->code . Str::random(6)),
            'status' => 'active',
            'issued_at' => $now,
            'expires_at' => $expiresAt,
            'issue_trigger' => $trigger,
        ]);

        Log::info('[Coupon] Auto-issue', [
            'customer' => $customer->id,
            'promo' => $promo->code,
            'trigger' => $trigger,
            'coupon' => $coupon->code,
        ]);

        return $coupon;
    }

    /**
     * Tìm promotion theo mã CP-xx còn active.
     */
    public function findPromo(string $code): ?Promotion
    {
        return Promotion::where('code', $code)->where('is_active', true)->first();
    }

    /**
     * CP-01: Cấp khi SĐT đặt đơn lần đầu (định nghĩa lại từ "đăng nhập lần đầu"
     * vì hệ thống phone-based, chưa có login Mini App).
     */
    public function onFirstOrder(Customer $customer): void
    {
        $promo = $this->findPromo('CP-01');
        if (!$promo) return;
        // Chỉ cấp nếu đây là đơn đầu tiên
        $orderCount = Order::where('customer_id', $customer->id)->count();
        if ($orderCount > 1) return;
        $this->issue($customer, $promo, 'first_order');
    }

    /**
     * CP-02: Bạn đặt đơn đầu thành công → cả 2 bên nhận coupon.
     * Đơn đầu của bạn phải >= min_order (mặc định 50.000đ, chỉnh trong Admin).
     */
    public function onReferralFirstOrder(Order $order): void
    {
        $promo = $this->findPromo('CP-02');
        if (!$promo || !$order->customer_id) return;

        $customer = $order->customer;
        if (!$customer || empty($customer->referred_by)) return;

        $referrer = Customer::where('member_code', $customer->referred_by)->first();
        if (!$referrer || $referrer->id === $customer->id) return;

        // Đơn đầu phải đạt mức tối thiểu
        $cfg = $promo->auto_config ?? [];
        $minOrder = (float) ($cfg['referral_min_order'] ?? 50000);
        if ((float) $order->total_amount < $minOrder) return;

        // Tạo referral record
        $referral = Referral::firstOrCreate(
            ['referrer_id' => $referrer->id, 'referred_id' => $customer->id],
            ['code' => $customer->referred_by, 'status' => 'pending']
        );
        if ($referral->status === 'completed') return; // đã xử lý

        $referral->update(['status' => 'completed', 'completed_at' => now()]);

        // Cấp cho cả 2 bên
        $this->issue($referrer, $promo, 'referral');
        $this->issue($customer, $promo, 'referral');
    }

    /**
     * CP-03: Tích tem sau mỗi đơn thành công (1 tem/đơn có >= min_cups cốc).
     * Đủ stamps_required tem → tặng coupon đổi quà.
     */
    public function onOrderStamp(Customer $customer, Order $order): void
    {
        $promo = $this->findPromo('CP-03');
        if (!$promo) return;

        $cfg = $promo->auto_config ?? [];
        $minCups = (int) ($cfg['min_cups_per_order'] ?? 1);
        $stampsRequired = (int) ($cfg['stamps_required'] ?? 5);

        // Đếm số cốc trong đơn (product có category là đồ uống — đơn giản: đếm items)
        $cupCount = $order->items->sum('quantity');
        if ($cupCount < $minCups) return;

        Stamp::create([
            'customer_id' => $customer->id,
            'order_id' => $order->id,
        ]);

        // Kiểm tra đủ tem → cấp coupon đổi quà
        // SPEC-02: cửa sổ ngày đọc từ auto_config (mặc định 30)
        $windowDays = (int) ($cfg['window_days'] ?? 30);
        $stampCount = Stamp::where('customer_id', $customer->id)
            ->where('stamped_at', '>=', now()->subDays($windowDays))
            ->count();

        if ($stampCount >= $stampsRequired && $stampCount % $stampsRequired === 0) {
            $this->issue($customer, $promo, 'stamp');
        }
    }

    /**
     * CP-06: Cron đêm — 14 ngày không có đơn → cấp coupon "Nhớ bạn" (72h).
     */
    public function checkInactiveCustomers(): int
    {
        $promo = $this->findPromo('CP-06');
        if (!$promo) return 0;

        $cfg = $promo->auto_config ?? [];
        $inactiveDays = (int) ($cfg['inactive_days'] ?? 14);

        $cutoff = now()->subDays($inactiveDays);
        $count = 0;

        // Khách có đơn gần nhất trước cutoff (hoặc chưa có đơn nào nhưng đã tạo TK đủ lâu)
        $customers = Customer::whereDoesntHave('orders', function ($q) use ($cutoff) {
            $q->where('created_at', '>=', $cutoff);
        })->where('created_at', '<', $cutoff)->get();

        foreach ($customers as $customer) {
            if ($this->issue($customer, $promo, 'inactive')) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * CP-07: Cron đêm — đầu tháng sinh nhật → cấp coupon.
     */
    public function checkBirthdays(): int
    {
        $promo = $this->findPromo('CP-07');
        if (!$promo) return 0;

        $count = 0;
        $customers = Customer::whereNotNull('birthday')
            ->whereMonth('birthday', now()->month)
            ->get();

        foreach ($customers as $customer) {
            // Chỉ cấp 1 lần/năm
            $issuedThisYear = CustomerCoupon::where('customer_id', $customer->id)
                ->where('promotion_id', $promo->id)
                ->whereYear('issued_at', now()->year)
                ->exists();
            if (!$issuedThisYear && $this->issue($customer, $promo, 'birthday')) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * CP-10: Cấp sau mỗi đơn Mini App thành công (15%, 7 ngày).
     */
    public function onNextOrderCoupon(Customer $customer, Order $order): void
    {
        $promo = $this->findPromo('CP-10');
        if (!$promo) return;

        // Chỉ cho đơn online (Mini App)
        if ($order->online_channel !== 'zalo') return;

        $this->issue($customer, $promo, 'next_order');
    }

    /**
     * Lấy số tem hiện tại của khách (cửa sổ ngày từ config, mặc định 30).
     */
    public function stampCount(Customer $customer): int
    {
        $promo = $this->findPromo('stamp');
        $windowDays = 30;
        if ($promo) {
            $cfg = $promo->auto_config ?? [];
            $windowDays = (int) ($cfg['window_days'] ?? 30);
        }
        return Stamp::where('customer_id', $customer->id)
            ->where('stamped_at', '>=', now()->subDays($windowDays))
            ->count();
    }

    /**
     * Lấy cấu hình tem (số tem cần, giá trị cốc tối đa) từ CP-03.
     */
    public function stampConfig(): array
    {
        $promo = Promotion::where('code', 'CP-03')->first();
        $cfg = $promo?->auto_config ?? [];
        return [
            'stamps_required' => (int) ($cfg['stamps_required'] ?? 5),
            'max_gift_value' => (float) ($cfg['max_gift_value'] ?? 45000),
            'merch_tiers' => $cfg['merch_tiers'] ?? [],
        ];
    }
}
