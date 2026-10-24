<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Cầu nối Sapo (2026-10-21): alias tên cột Excel cho từng trường nội bộ.
// Import map cột theo TÊN (đã normalize bỏ dấu) — Sapo thêm/dời cột không làm lệch dữ liệu.
class SapoColumnAlias extends Model
{
    protected $guarded = [];
}
