<?php

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 57 (2026-10-14): Chi phí trả trước / CAPEX phân bổ đều theo tháng vào P&L.
class PrepaidExpense extends Model
{
    use HasFactory;

    protected $fillable = [
        'branch_id', 'name', 'category', 'total_amount', 'start_date', 'months', 'notes', 'is_active',
    ];

    protected $casts = [
        'total_amount' => 'float',
        'start_date' => 'date',
        'months' => 'integer',
        'is_active' => 'boolean',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /** Số tiền phân bổ mỗi tháng. */
    public function monthlyAmount(): float
    {
        if ($this->months <= 0) return 0.0;
        return (float) $this->total_amount / $this->months;
    }

    /**
     * Số tiền phân bổ vào khoảng [from, to] (Y-m-d).
     * Đếm số tháng giao nhau giữa [start_date, start_date + months tháng] và [from, to].
     */
    public function allocationFor(string $from, string $to): float
    {
        $monthly = $this->monthlyAmount();
        if ($monthly <= 0) return 0.0;
        $allocStart = Carbon::parse($this->start_date)->startOfMonth();
        $allocEnd = (clone $allocStart)->addMonths($this->months)->subDay()->endOfDay();
        $fromC = Carbon::parse($from)->startOfDay();
        $toC = Carbon::parse($to)->endOfDay();
        if ($toC->lt($allocStart) || $fromC->gt($allocEnd)) return 0.0;
        // Đếm tháng giao nhau
        $cursor = (clone $allocStart);
        $months = 0;
        while ($cursor->lte($allocEnd)) {
            $mStart = (clone $cursor)->startOfMonth();
            $mEnd = (clone $cursor)->endOfMonth();
            if ($mEnd->gte($fromC) && $mStart->lte($toC)) $months++;
            $cursor->addMonth();
        }
        return round($monthly * $months, 0);
    }
}
