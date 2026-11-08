<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\MembershipTier;
use App\Models\PointTransaction;
use App\Support\ApprovalActor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

// Gói 5 (2026-10-05): Quản lý khách hàng — SĐT làm định danh, mã QR thành viên.
class CustomerController extends Controller
{
    /**
     * Lát 1b (rà soát đêm 2026-11-04): "Tổng đã mua" phía Admin phải cùng cơ số
     * TIỀN HÀNG với mọi thước đo khác (quy tắc Order::revenueAmount — đơn zalo
     * trừ phí ship thu hộ). Cột customers.total_spent tích lũy từ các lượt tích
     * điểm TRƯỚC vá phí ship còn lẫn cả ship (lệch sống: cửa sổ 60 ngày 135.000đ
     * trong khi cột hiện 155.000đ) → tính lại từ đơn tại thời điểm đọc: chỉ đơn
     * đã thanh toán và chưa hủy (đúng tập đơn đã qua tích điểm, chưa bị thu hồi).
     */
    private function spentByGoods(array $customerIds): array
    {
        if (!$customerIds) return [];
        return \App\Models\Order::whereIn('customer_id', $customerIds)
            ->where('payment_status', 'paid')
            ->where('status', '<>', 'cancelled')
            ->groupBy('customer_id')
            ->selectRaw("customer_id, SUM(total_amount - CASE WHEN online_channel = 'zalo' THEN shipping_fee ELSE 0 END) as spent")
            ->pluck('spent', 'customer_id')
            ->map(fn($v) => (float) $v)
            ->all();
    }

    public function index(Request $request): JsonResponse
    {
        $query = Customer::with('tier')->orderByDesc('id');

        if ($request->filled('search')) {
            $s = $request->query('search');
            $query->where(function ($q) use ($s) {
                $q->where('phone', 'like', "%{$s}%")
                  ->orWhere('name', 'like', "%{$s}%")
                  ->orWhere('member_code', 'like', "%{$s}%");
            });
        }

        $perPage = (int) $request->query('per_page', 20);
        $page = $query->paginate($perPage);

        // Loyalty 2.0 (spec mục 10): POS hiển thị điểm sắp hết hạn để NV nhắc
        // khách đổi coupon — tính gộp 1 query cho cả trang kết quả.
        $ids = $page->getCollection()->pluck('id')->all();
        if ($ids) {
            $warnDays = max(1, (int) \App\Models\Setting::get('points_expiry_warn_days', 30));
            $sums = \App\Models\PointLot::whereIn('customer_id', $ids)
                ->where('points_remaining', '>', 0)
                ->where('expires_at', '>', now())
                ->where('expires_at', '<=', now()->addDays($warnDays))
                ->groupBy('customer_id')
                ->selectRaw('customer_id, SUM(points_remaining) as total')
                ->pluck('total', 'customer_id');
            $page->getCollection()->each(function ($c) use ($sums) {
                $c->points_expiring_soon = (int) ($sums[$c->id] ?? 0);
            });
        }
        // Lát 1b: đè total_spent bằng cơ số tiền hàng tính từ đơn (xem spentByGoods)
        if ($ids) {
            $spent = $this->spentByGoods($ids);
            $page->getCollection()->each(function ($c) use ($spent) {
                $c->total_spent = $spent[$c->id] ?? 0.0;
            });
        }

        return response()->json(['success' => true, 'data' => $page]);
    }

    public function show(int $id): JsonResponse
    {
        $customer = Customer::with([
            'tier',
            'orders' => fn($q) => $q->limit(20),
            'pointTransactions' => fn($q) => $q->limit(30),
        ])->findOrFail($id);

        // Loyalty 2.0: kèm lô điểm còn hạn + lịch sử hạng + coupon ví đang hiệu
        // lực (để Admin xem và thu hồi khi cần) trong cùng response chi tiết.
        $data = $customer->toArray();
        $data['total_spent'] = $this->spentByGoods([$id])[$id] ?? 0.0; // Lát 1b: cơ số tiền hàng
        $data['point_lots'] = \App\Models\PointLot::where('customer_id', $id)
            ->where('points_remaining', '>', 0)
            ->orderBy('expires_at')
            ->get();
        $data['tier_logs'] = \App\Models\CustomerTierLog::with(['fromTier:id,name', 'toTier:id,name'])
            ->where('customer_id', $id)
            ->orderByDesc('id')
            ->limit(20)
            ->get();
        $data['coupons'] = \App\Models\CustomerCoupon::with('promotion:id,name,code')
            ->where('customer_id', $id)
            ->orderByDesc('id')
            ->limit(30)
            ->get();

        return response()->json(['success' => true, 'data' => $data]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'phone' => 'required|string|max:20|unique:customers,phone',
            'birthday' => 'nullable|date',
            'note' => 'nullable|string|max:255',
        ], [
            // Delta form sửa khách (2026-11-07): câu lỗi trùng SĐT tiếng Việt
            // thay cho mặc định tiếng Anh của Laravel.
            'phone.unique' => 'Số điện thoại này đã thuộc về một khách khác.',
        ]);

        $customer = DB::transaction(function () use ($validated) {
            $tier = MembershipTier::where('is_default', true)->first()
                ?? MembershipTier::orderBy('sort_order')->first();

            return Customer::create([
                'member_code' => $this->generateMemberCode(),
                'name' => $validated['name'],
                'phone' => $validated['phone'],
                'birthday' => $validated['birthday'] ?? null,
                'membership_tier_id' => $tier?->id,
                'note' => $validated['note'] ?? null,
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => 'Đã thêm khách hàng',
            'data' => $customer->load('tier'),
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $customer = Customer::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:150',
            'phone' => 'sometimes|string|max:20|unique:customers,phone,' . $id, // Gói 55 p11ad: SĐT không trùng
            'birthday' => 'nullable|date',
            'note' => 'nullable|string|max:255',
            'membership_tier_id' => 'nullable|exists:membership_tiers,id',
            // Spec mật khẩu §7.3: Admin sửa được email (đúng định dạng, tối
            // đa 150 ký tự, KHÔNG unique; để trống = xóa). Sửa ở Admin KHÔNG
            // ghi email_added_at (cột đó chỉ ghi hành vi tự nguyện của khách).
            'email' => 'nullable|email|max:150',
        ], [
            // Delta form sửa khách (2026-11-07): câu lỗi trùng SĐT tiếng Việt
            // thay cho mặc định tiếng Anh của Laravel.
            'phone.unique' => 'Số điện thoại này đã thuộc về một khách khác.',
        ]);
        if (array_key_exists('email', $validated)) {
            $validated['email'] = ($validated['email'] ?? null) !== null && trim((string) $validated['email']) !== ''
                ? trim((string) $validated['email'])
                : null;
        }
        // Loyalty 2.0 (spec 3.3): Admin gán tay hạng → hạng được bảo vệ khỏi
        // cron tụt hạng trong 1 cửa sổ đầy đủ + ghi log reason=manual.
        $tierChanged = array_key_exists('membership_tier_id', $validated)
            && (int) ($validated['membership_tier_id'] ?? 0) !== (int) ($customer->membership_tier_id ?? 0)
            && !empty($validated['membership_tier_id']);
        if ($tierChanged) {
            $windowDays = max(1, (int) \App\Models\Setting::get('tier_window_days', 60));
            $validated['tier_manual_until'] = now()->addDays($windowDays);
            $validated['tier_warning_at'] = null;
            $validated['tier_projected_id'] = null;
        }
        $fromTierId = $customer->membership_tier_id;
        $customer->update($validated);
        if ($tierChanged) {
            \App\Models\CustomerTierLog::create([
                'customer_id' => $customer->id,
                'from_tier_id' => $fromTierId,
                'to_tier_id' => $validated['membership_tier_id'],
                'reason' => 'manual',
                'window_spent' => app(\App\Services\LoyaltyService::class)->windowSpent($customer),
            ]);
        }
        return response()->json(['success' => true, 'data' => $customer->load('tier')]);
    }

    // Spec mật khẩu §5.3: Admin mở cửa sổ hỗ trợ đặt mật khẩu tại quầy
    // (15 phút) — nhân viên chỉ mở cửa, khách tự đặt trên máy của mình.
    // Actor ghi đúng cột User/Employee (mẫu ApprovalActor, không auth()->id() trần).
    public function openPasswordSetupWindow(Request $request, int $id): JsonResponse
    {
        $customer = Customer::findOrFail($id);
        [$userId, $employeeId] = ApprovalActor::ids($request->user());
        $customer->update([
            'password_setup_until' => now()->addMinutes(15),
            'password_setup_by_user_id' => $userId,
            'password_setup_by_employee_id' => $employeeId,
        ]);
        Log::info('[MatKhauKhach] Admin mo cua so dat mat khau tai quay', ['customer_id' => $id, 'user_id' => $userId, 'employee_id' => $employeeId]);
        return response()->json(['success' => true, 'data' => [
            'customer_id' => $customer->id,
            'password_setup_until' => $customer->password_setup_until?->toIso8601String(),
        ]]);
    }

    // Spec mật khẩu §5.3: Admin đóng cửa sổ hỗ trợ trước hạn.
    public function closePasswordSetupWindow(Request $request, int $id): JsonResponse
    {
        $customer = Customer::findOrFail($id);
        $customer->update([
            'password_setup_until' => null,
            'password_setup_by_user_id' => null,
            'password_setup_by_employee_id' => null,
        ]);
        return response()->json(['success' => true]);
    }

    // Spec mật khẩu §7.4: Admin cấp lại mã thành viên (mã là định danh công
    // khai — nút này phục vụ in thẻ mới, KHÔNG phải thao tác bảo mật đăng
    // nhập). Mã cũ chết ngay tại thời điểm lưu; mã cũ không được lưu lại.
    // Phiên token của khách KHÔNG bị thu hồi.
    public function regenerateMemberCode(Request $request, int $id): JsonResponse
    {
        $customer = Customer::findOrFail($id);
        [$userId, $employeeId] = ApprovalActor::ids($request->user());
        $newCode = $this->generateMemberCode();
        $customer->update([
            'member_code' => $newCode,
            'member_code_rotated_at' => now(),
            'member_code_rotated_by_user_id' => $userId,
            'member_code_rotated_by_employee_id' => $employeeId,
        ]);
        Log::info('[MatKhauKhach] Admin cap lai ma thanh vien', ['customer_id' => $id, 'user_id' => $userId, 'employee_id' => $employeeId]);
        return response()->json(['success' => true, 'data' => [
            'customer_id' => $customer->id,
            'member_code' => $newCode,
        ]]);
    }

    // Điều chỉnh điểm thủ công (cộng/trừ) — ghi lịch sử
    public function adjustPoints(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'change' => 'required|integer|not_in:0',
            'note' => 'nullable|string|max:255',
        ]);

        try {
            $customer = DB::transaction(function () use ($id, $validated) {
                $customer = Customer::lockForUpdate()->findOrFail($id);
                $change = (int) $validated['change'];
                $note = $validated['note'] ?? 'Điều chỉnh thủ công';
                $loyalty = app(\App\Services\LoyaltyService::class);
                if ($change > 0) {
                    // Loyalty 2.0: cộng tay tạo lô source_type=adjust, HSD theo cấu hình
                    $customer->points += $change;
                    $customer->save();
                    $lot = $loyalty->createLot($customer, $change, 'adjust');
                    PointTransaction::create([
                        'customer_id' => $customer->id,
                        'point_lot_id' => $lot->id,
                        'change' => $change,
                        'type' => 'adjust',
                        'note' => $note,
                    ]);
                } else {
                    // Trừ tay: vẫn chặn số dư âm như trước; trừ theo lô FIFO
                    if ($customer->points + $change < 0) {
                        throw new \Exception('Điểm không đủ để trừ.');
                    }
                    $loyalty->spendFifo($customer, abs($change), 'adjust', $note);
                }

                return $customer;
            });

            return response()->json(['success' => true, 'data' => $customer]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    /**
     * Loyalty 2.0: Admin thu hồi 1 coupon trong ví của khách. Nếu coupon do đổi
     * điểm phát (issue_trigger = points_exchange) → hoàn điểm về ĐÚNG các lô
     * đã trừ (phân bổ tra từ point_transactions của lượt đổi, giữ nguyên HSD
     * gốc từng lô — spec 6.1). Coupon đã dùng rồi thì không thu hồi.
     */
    public function revokeCoupon(Request $request, int $id, int $couponId): JsonResponse
    {
        try {
            $result = DB::transaction(function () use ($id, $couponId) {
                $customer = Customer::lockForUpdate()->findOrFail($id);
                $coupon = \App\Models\CustomerCoupon::where('customer_id', $id)
                    ->lockForUpdate()
                    ->findOrFail($couponId);
                if ($coupon->status === 'used') {
                    throw new \Exception('Coupon đã được dùng, không thu hồi được.');
                }
                if ($coupon->status === 'revoked') {
                    throw new \Exception('Coupon này đã bị thu hồi trước đó.');
                }
                $coupon->status = 'revoked';
                $coupon->save();

                $refunded = 0;
                if ($coupon->issue_trigger === 'points_exchange') {
                    // Phân bổ FIFO của lượt đổi được gắn trực tiếp coupon_id
                    // lúc phát (PointsController::exchange) → hoàn về đúng lô.
                    $rows = PointTransaction::where('coupon_id', $coupon->id)
                        ->where('type', 'exchange')
                        ->whereNotNull('point_lot_id')
                        ->get();
                    $allocation = $rows->map(fn ($r) => [
                        'lot_id' => $r->point_lot_id,
                        'points' => abs((int) $r->change),
                    ])->all();
                    if ($allocation) {
                        $itemId = $rows->first()?->point_exchange_item_id;
                        app(\App\Services\LoyaltyService::class)
                            ->refundToLots($customer, $allocation, 'Hoàn điểm do thu hồi coupon ' . $coupon->code, [
                                'point_exchange_item_id' => $itemId,
                                'coupon_id' => $coupon->id,
                            ]);
                        $refunded = array_sum(array_column($allocation, 'points'));
                    }
                }
                return ['coupon' => $coupon, 'points_refunded' => $refunded];
            });

            return response()->json([
                'success' => true,
                'message' => 'Đã thu hồi coupon.' . ($result['points_refunded'] > 0 ? " Đã hoàn {$result['points_refunded']} điểm về các lô gốc." : ''),
                'data' => $result,
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    private function generateMemberCode(): string
    {
        // Rà mã 2026-10-20: tiền tố + độ dài đọc từ Thiết lập qua CodeGenerator (type 'member').
        // Giữ hậu tố NGẪU NHIÊN (không dùng số thứ tự) vì mã thành viên = mã giới thiệu công khai,
        // số thứ tự tuần tự sẽ đoán được mã của người khác.
        $prefix = \App\Helpers\CodeGenerator::prefix('member');
        $len = max(4, \App\Helpers\CodeGenerator::digits('member'));
        do {
            $code = $prefix . strtoupper(Str::random($len));
        } while (Customer::where('member_code', $code)->exists());
        return $code;
    }
}
