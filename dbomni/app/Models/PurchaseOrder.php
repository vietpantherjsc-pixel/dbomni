<?php

namespace App\Models;

use App\Helpers\CodeGenerator;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Spec Phiếu đặt hàng NCC (Đại Vương CHỐT 2026-11-08): phiếu đặt hàng tới
// NCC — không qua duyệt, không động tồn kho/tiền. Trạng thái:
// draft → ordered → received; draft/ordered → cancelled.
class PurchaseOrder extends Model
{
    protected $guarded = [];

    protected $casts = [
        'order_date' => 'date',
        'ordered_at' => 'datetime',
        'received_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(PurchaseOrderItem::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function createdByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function createdByEmployee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'created_by_employee_id');
    }

    public function inboundReceipts(): HasMany
    {
        return $this->hasMany(InboundReceipt::class, 'purchase_order_id');
    }

    public static function nextCode(): string
    {
        // Chép khuôn InboundReceipt::nextCode: đếm phiếu tạo trong ngày +
        // lockForUpdate trong transaction → DDH<YYYYMMDD><4 số>, không gạch.
        $count = static::whereDate('created_at', now()->toDateString())->lockForUpdate()->count();
        return CodeGenerator::generate('purchase_order', $count + 1, true);
    }

    /**
     * Cơ chế đóng/mở phiếu đặt (§5.3) — điểm đồng bộ DUY NHẤT, gọi từ mọi
     * thao tác làm thay đổi tập phiếu nhập liên kết đã xác nhận (tạo-confirmed
     * · duyệt-confirmed · hủy phiếu nhập). Idempotent:
     * - còn ≥1 phiếu nhập liên kết ở trạng thái confirmed → received
     *   (received_at lấy theo mốc cập nhật của phiếu xác nhận sớm nhất);
     * - không còn phiếu confirmed nào mà phiếu đang received → quay lại ordered.
     * Không bao giờ đụng phiếu draft/cancelled.
     */
    public function syncReceivedState(): void
    {
        if (!in_array($this->status, ['ordered', 'received'], true)) {
            return;
        }
        $firstConfirmed = $this->inboundReceipts()
            ->where('status', 'confirmed')
            ->orderBy('id')
            ->first();
        if ($firstConfirmed) {
            if ($this->status !== 'received') {
                $this->update([
                    'status' => 'received',
                    'received_at' => $firstConfirmed->updated_at ?? now(),
                ]);
            }
        } elseif ($this->status === 'received') {
            $this->update(['status' => 'ordered', 'received_at' => null]);
        }
    }
}
