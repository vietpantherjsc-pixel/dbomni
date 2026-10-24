<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Helpers\CodeGenerator;
use App\Models\Employee;
use App\Models\User;

// Gói 43: phiếu chuyển kho nguyên liệu giữa các chi nhánh.
class StockTransfer extends Model
{
    // Audit 2026-10-23 BM-13: fillable tường minh thay $guarded = []
    protected $fillable = [
        'code', 'from_branch_id', 'to_branch_id', 'status', 'note', 'total_cost',
        'requested_by', 'confirmed_by', 'confirmed_by_employee_id', 'confirmed_at',
        'cancelled_by', 'cancelled_by_employee_id', 'cancelled_at',
    ];

    protected $casts = [
        'confirmed_at' => 'datetime',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(StockTransferItem::class);
    }

    public function fromBranch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'from_branch_id');
    }

    public function toBranch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'to_branch_id');
    }

    // Gói "Chờ duyệt trên Hub" (2026-10-21): người tạo phiếu.
    // TESTER fix: cột created_by_* theo migration 000030; requested_by là FK
    // users (người chốt tạo phiếu nhập tay), KHÔNG phải Employee.
    public function createdByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function createdByEmployee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'created_by_employee_id');
    }

    public static function nextCode(): string
    {
        // Gói 55 p11w: lockForUpdate để tránh 2 request song song sinh trùng mã
        // (hàm này luôn được gọi bên trong DB::transaction)
        // Gói 55 p11ab: prefix + số chữ số đọc từ Thiết lập
        $count = static::whereDate('created_at', now()->toDateString())->lockForUpdate()->count();
        return CodeGenerator::generate('transfer', $count + 1, true);
    }
}
