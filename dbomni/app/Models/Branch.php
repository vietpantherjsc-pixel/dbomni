<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 1 (2026-10-04): Thêm $guarded = [] để seeder/factory tạo được chi nhánh
// (mặc định Laravel chặn mass assignment khi model trống).
class Branch extends Model
{
    protected $guarded = [];

    // Sổ #98 (2026-11-05): token QR chấm công là bằng chứng có mặt tại quầy —
    // ẩn khỏi MỌI serialize để không lộ qua các payload nhúng branch (phiếu
    // thu-chi, chi tiết duyệt Hub…). AttendanceQrController đọc thuộc tính
    // trực tiếp từ model nên bề mặt QR cho quản lý không bị ảnh hưởng.
    protected $hidden = ['attendance_qr_token'];

    protected $casts = [
        'opening_hours' => 'array', // Gói 55 p2: giờ mở cửa JSON
    ];

    public function batches(): HasMany
    {
        return $this->hasMany(Batch::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(Shift::class);
    }

    // Gói 26c: nhân viên làm việc tại chi nhánh (pivot branch_employee)
    public function employees(): BelongsToMany
    {
        return $this->belongsToMany(Employee::class, 'branch_employee')->withTimestamps();
    }
}
