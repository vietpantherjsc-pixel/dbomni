<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 1 (2026-10-04): Mở rộng fillable khớp với các cột OrderController đang dùng.
class Order extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'branch_id',
        'order_type',
        'online_channel', // Gói 6: pos | zalo
        'table_id',
        'shift_id',
        'order_number',
        'code',
        'client_key', // Gói 55 p11ac: idempotency key chống tạo trùng đơn
        'customer_id', // Gói 5
        'customer_name',
        'customer_phone',
        'zalo_user_id', // Gói 6
        'delivery_address', // Gói 6
        'distance_km', // Gói 6
        'shipping_fee', // Gói 6
        'shipping_discount', // Gói 10c: KM giảm phí ship
        'shipping_promotion_id', // Gói 10c
        'scheduled_at', // Gói 6: hẹn giờ lấy
        'subtotal_amount',
        'discount_amount',
        'voucher_code',
        'promotion_id', // Gói 5
        'promotion_discount', // Gói 5
        'points_earned', // Gói 5
        'points_redeemed', // Gói 5
        'total_amount',
        'status',
        'payment_method',
        // SPEC-01: thanh toán Zalo Mini App
        'pay_channel', 'pay_trans_id', 'pay_notified_at', 'pay_needs_review',
        'customer_notified_at', // Spec QR 2026-10-21: khách bấm "Tôi đã chuyển khoản"
        'payment_status',
        'stock_deducted',
        'note',
        'cancel_reason',
        'cancelled_at',
        'cancelled_by', // Gói 55 p11ag: người hủy (tên NV/admin hoặc customer:SĐT)
        'cancelled_by_type', // Gói 55 p11ag: user|employee|customer
        'completed_at', // Gói 12a
        'claim_token', // Gói 11: token QR tích điểm
        'claim_expires_at', // Gói 11: hạn token QR tích điểm
        'need_vat_invoice', // Gói 48: yêu cầu xuất VAT
        'vat_tax_code', // Gói 48: MST
        'vat_company_name', // Gói 48: tên công ty
        'vat_company_address', // Gói 48: địa chỉ công ty
        'vat_email', // Gói 48: email nhận hóa đơn
        'delivery_note', // Gói 48: ghi chú giao hàng
        'province', // Gói 48: tỉnh/thành
        'ward', // Gói 48: phường/xã
        'referred_by', // Gói 9: mã giới thiệu affiliate
        'commission_rate', // Gói 56: % phí sàn snapshot lúc tạo/chốt đơn
        'commission_amount', // Gói 56: tiền phí sàn snapshot
        // Gói 61b: gộp 2 dòng ready_at trùng (Gói 56) thành 1
        'ready_at', // Gói 56: lúc bếp bấm sẵn sàng — tính thời gian pha chế
        // Gói 60: tích hợp giao hàng AhaMove/Lalamove
        'delivery_provider', 'delivery_order_id', 'delivery_tracking_url',
        'delivery_status', 'delivery_package', 'delivery_fee',
        'delivery_fee_charged', 'delivery_quoted_fee', 'delivery_cod_amount',
        'delivery_cod_fee', 'delivery_failover_from', 'delivery_failover_at',
        'delivery_driver_name', 'delivery_driver_phone', 'delivery_driver_plate',
        'delivery_searching_since',
        // Gói 61b: tọa độ điểm giao + cờ hàng trả về
        'delivery_dropoff_lat', 'delivery_dropoff_lng', 'delivery_returned',
        // Cầu nối Sapo (2026-10-21): định danh đơn import từ Sapo
        'sapo_invoice_code', 'sapo_created_at', 'paid_at', 'source',
    ];

    protected $casts = [
        'subtotal_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'promotion_discount' => 'decimal:2',
        'shipping_fee' => 'decimal:2',
        'shipping_discount' => 'decimal:2', // Gói 10c
        'distance_km' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'cancelled_at' => 'datetime',
        'completed_at' => 'datetime', // Gói 12a: mốc hoàn thành để giới hạn tra cứu Mini App 24h
        'ready_at' => 'datetime', // Gói 56: lúc bếp bấm sẵn sàng — tính thời gian pha chế
        'claim_expires_at' => 'datetime', // Gói 13: fix crash QR claim (isPast() trên string)
        'scheduled_at' => 'datetime',
        'stock_deducted' => 'boolean',
        'pay_notified_at' => 'datetime', // SPEC-01: mốc nhận notify từ Zalo
        'customer_notified_at' => 'datetime', // Spec QR 2026-10-21
        'pay_needs_review' => 'boolean', // SPEC-01
        // Gói 60: giao hàng
        'delivery_fee' => 'decimal:2',
        'delivery_fee_charged' => 'decimal:2',
        'delivery_quoted_fee' => 'decimal:2',
        'delivery_cod_amount' => 'decimal:2',
        'delivery_cod_fee' => 'decimal:2',
        'delivery_failover_at' => 'datetime',
        'delivery_searching_since' => 'datetime',
        // Gói 61b
        'delivery_dropoff_lat' => 'decimal:8',
        'delivery_dropoff_lng' => 'decimal:8',
        'delivery_returned' => 'boolean',
        // Cầu nối Sapo (2026-10-21)
        'sapo_created_at' => 'datetime',
        'paid_at' => 'datetime',
    ];

    /**
     * Doanh thu ghi nhận của đơn (tiền hàng) — chính sách phí ship THU HỘ
     * (Phương án B, Đại Vương chốt 2026-10-30): đơn Mini App
     * (online_channel = 'zalo') có shipping_fee là tiền quán thu hộ hãng
     * giao hàng, KHÔNG phải doanh thu, KHÔNG tính điểm/tổng chi tiêu.
     * shipping_fee đã lưu là phí khách thực trả (sau KM phí ship) nên trừ
     * thẳng khỏi total_amount. Kênh khác (POS/sàn) giữ nguyên total_amount:
     * POS không có phí ship; đơn sàn theo quy tắc riêng của báo cáo kênh.
     */
    public function revenueAmount(): float
    {
        $total = (float) $this->total_amount;
        if ($this->online_channel === 'zalo') {
            return max(0, $total - (float) $this->shipping_fee);
        }
        return $total;
    }

    // Một đơn hàng có nhiều chi tiết mặt hàng
    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    // Một đơn hàng được tạo bởi một nhân viên
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    // Gói 5/6: khách hàng thành viên của đơn
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    // Gói 5: khuyến mại đã áp dụng
    public function promotion(): BelongsTo
    {
        return $this->belongsTo(Promotion::class);
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    // Gói 3b: bàn phục vụ của đơn (nullable)
    public function table(): BelongsTo
    {
        return $this->belongsTo(Table::class, 'table_id');
    }

    /**
     * Sổ #92 — C1 (2026-11-05): cấp seq nguyên tử theo ngày từ bảng
     * order_code_counters (migration 000095). Một câu upsert duy nhất:
     * ngày chưa có dòng thì gieo seq = số đơn đã phát hành trong ngày + 1;
     * đã có dòng thì seq = max(seq hiện tại, số đã phát hành) + 1 — nên bộ
     * đếm tự lành kể cả khi deploy giữa ngày hay dòng đếm bị tạo trước rỗng.
     * Seq vừa cấp được đọc lại bằng SELECT trên chính dòng ngày trong cùng
     * transaction (dòng đã bị upsert khóa tới khi commit nên không cửa sổ
     * đua; KHÔNG đọc qua PDO lastInsertId — ở nhánh INSERT, id tự tăng của
     * dòng mới đè mất biểu thức LAST_INSERT_ID(expr), bằng chứng sống #92).
     * Bảng chưa tồn tại (chưa chạy migration) thì rơi về cách đếm cũ để
     * không gãy đường tạo đơn.
     */
    protected static function nextSeq(): int
    {
        $today = now()->toDateString();
        $issued = static::whereDate('created_at', $today)->count();
        if (!\Illuminate\Support\Facades\Schema::hasTable('order_code_counters')) {
            return $issued + 1;
        }
        \Illuminate\Support\Facades\DB::statement(
            'INSERT INTO order_code_counters (day, seq, created_at, updated_at) VALUES (?, LAST_INSERT_ID(?), NOW(), NOW())'
            . ' ON DUPLICATE KEY UPDATE seq = LAST_INSERT_ID(GREATEST(seq, ?) + 1), updated_at = NOW()',
            [$today, $issued + 1, $issued]
        );
        $seq = (int) (\Illuminate\Support\Facades\DB::table('order_code_counters')->where('day', $today)->value('seq') ?? 0);

        return $seq > 0 ? $seq : $issued + 1;
    }

    /**
     * Sinh mã đơn theo quy tắc cấu hình trong Thiết lập (CodeGenerator 'invoice'):
     * PREFIXYYYYMMDDSOTHUTU — nối liền không dấu gạch (luật 2026-10-21 ~22:59).
     * Đếm đơn trong ngày + retry khi trùng (an toàn song song ở mức cơ bản).
     * Dùng chung cho POS (OrderController) + Mini App (OnlineOrderController) — thay 2 chỗ hardcode HD-/ZL-.
     */
    public static function nextCode(): string
    {
        $seq = static::nextSeq();
        // Đai phụ giữ nguyên: trùng mã đã cấp (kể cả mã hậu tố ngẫu nhiên cũ)
        // thì bước sang số kế tiếp; hết 5 lần thì hậu tố ngẫu nhiên như cũ.
        for ($i = 0; $i < 5; $i++) {
            $code = \App\Helpers\CodeGenerator::generate('invoice', $seq + $i, true);
            if (!static::where('code', $code)->exists()) {
                return $code;
            }
        }
        // Hết 5 lần vẫn trùng (xác suất cực thấp) — thêm hậu tố ngẫu nhiên để chắc chắn
        // duy nhất; nối liền KHÔNG dấu gạch như mọi mã khác (luật 2026-10-21 ~22:59)
        return \App\Helpers\CodeGenerator::generate('invoice', $seq, true) . strtoupper(\Illuminate\Support\Str::random(3));
    }
}
