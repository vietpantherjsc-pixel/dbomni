<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Cầu nối Sapo (2026-10-21): text phương thức TT trong file Sapo (đã normalize)
// → payment_method của DBOMNI (cash | transfer | grabfood | ...).
class SapoPaymentMap extends Model
{
    // Sửa lỗi 1146 (2026-10-21): migration tạo bảng số ít — khai $table tường minh,
    // không để Eloquent tự suy số nhiều (sapo_product_maps) gây "table doesn't exist".
    protected $table = 'sapo_payment_map';
    protected $guarded = [];
}
