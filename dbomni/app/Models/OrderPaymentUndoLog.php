<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Nhật ký hoàn tác xác nhận thanh toán (spec-hoan-tac-xac-nhan mục 6):
// 1 dòng cho mỗi lượt NV bấm "Hoàn tác xác nhận" thành công trên 1 đơn —
// ghi trong cùng transaction đảo 4 trục nên không có hoàn tác nào thiếu
// nhật ký. Xem lại ngay trong chi tiết đơn Admin (không trang riêng).
class OrderPaymentUndoLog extends Model
{
    protected $fillable = [
        'order_id', 'user_id', 'employee_id', 'actor_label', 'surface', 'branch_id',
        'reason', 'reason_code', // N-2 (360 đợt 2): mã nguyên nhân hoàn tác chuẩn hóa
        'prev_payment_status', 'prev_paid_at', 'prev_pay_channel', 'prev_pay_sdk_status',
        'zalo_result',
    ];

    protected $casts = [
        'prev_paid_at' => 'datetime',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
