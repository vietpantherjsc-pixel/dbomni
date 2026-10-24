<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Cầu nối Sapo (2026-10-21): text Nguồn đơn / Đối tác giao hàng (đã normalize)
// → mã kênh price_lists. channel_code = 'dbomni' là kênh DBOMNI trên Sapo → bỏ qua khi import.
class SapoChannelMap extends Model
{
    // Sửa lỗi 1146 (2026-10-21): migration tạo bảng số ít — khai $table tường minh,
    // không để Eloquent tự suy số nhiều (sapo_product_maps) gây "table doesn't exist".
    protected $table = 'sapo_channel_map';
    protected $guarded = [];
}
