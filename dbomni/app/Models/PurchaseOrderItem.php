<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Dòng của phiếu đặt hàng NCC: số lượng theo đơn vị đã chọn (unit_name là
// snapshot chữ — đơn vị cơ sở hoặc 1 đơn vị trong material_units). Không có
// giá ở phiếu đặt (giá chỉ nhập ở bước nhập kho).
class PurchaseOrderItem extends Model
{
    protected $guarded = [];

    protected $casts = [
        'quantity' => 'float',
    ];

    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class);
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }
}
