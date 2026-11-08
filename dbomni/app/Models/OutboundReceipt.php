<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Helpers\CodeGenerator;

// Gói 55 p11z: phiếu xuất kho — chốt trừ kho theo FIFO.
class OutboundReceipt extends Model
{
    protected $guarded = [];

    protected $casts = [
        'total_quantity' => 'decimal:2',
    ];

    public const REASONS = [
        'damaged' => 'Hủy hàng',
        'internal_use' => 'Dùng nội bộ',
        'sale' => 'Xuất bán',
        'other' => 'Khác',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(OutboundReceiptItem::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    // Gói chặn tự duyệt (2026-11-06): cặp người tạo tường minh — created_by là
    // phía User, created_by_employee_id là phía NV (migration 000100).
    // employee_id ở trên giữ nghĩa phụ trách/gán việc, KHÔNG phải người tạo.
    public function createdByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function createdByEmployee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'created_by_employee_id');
    }

    public function getReasonLabelAttribute(): string
    {
        return self::REASONS[$this->reason] ?? $this->reason;
    }

    public static function nextCode(): string
    {
        // Chống trùng khi 2 request song song — luôn gọi bên trong DB::transaction
        // Gói 55 p11ab: prefix + số chữ số đọc từ Thiết lập
        // Đồng bộ mã có ngày (Đại Vương lệnh 2026-11-06): đếm THEO NGÀY + cờ
        // withDate như PN/CK/PT/PC — trước đây đếm toàn cục, mã XK thiếu đoạn
        // YYYYMMDD. Mã cũ đã sinh giữ nguyên, tra cứu theo chuỗi đầy đủ.
        $count = static::whereDate('created_at', now()->toDateString())->lockForUpdate()->count();
        return CodeGenerator::generate('outbound', $count + 1, true);
    }
}
