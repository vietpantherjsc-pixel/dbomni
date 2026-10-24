<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

// Gói 55 p11b: đề xuất điều chỉnh kho từ chênh lệch kiểm kê.
// Chốt phiếu chỉ ghi nhận; vượt ngưỡng → sinh đề xuất pending → quản lý duyệt mới trừ/cộng kho.
class StocktakeAdjustment extends Model
{
    protected $fillable = [
        'stocktake_id', 'branch_id', 'material_id',
        'system_qty', 'counted_qty', 'diff_qty', 'diff_value',
        'status', 'requested_by_employee_id',
        'approved_by_user_id', 'approved_by_employee_id', 'approved_at', 'note',
    ];

    protected $casts = [
        'system_qty' => 'float',
        'counted_qty' => 'float',
        'diff_qty' => 'float',
        'diff_value' => 'float',
        'approved_at' => 'datetime',
    ];

    public function stocktake(): BelongsTo
    {
        return $this->belongsTo(Stocktake::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'requested_by_employee_id');
    }

    // Gói 55 p11b: sau khi chốt phiếu kiểm kê, nếu tổng giá trị chênh vượt ngưỡng
    // (settings.stocktake_diff_threshold, mặc định 200k) thì tự sinh đề xuất điều chỉnh
    // (pending) cho từng dòng có chênh lệch — quản lý duyệt mới trừ/cộng kho thật.
    // $rows: [['material_id'=>, 'system_qty'=>, 'counted_qty'=>, 'diff'=>], ...]
    // Trả về số đề xuất đã tạo.
    public static function createFromConfirmed(Stocktake $stocktake, array $rows, ?int $requestedByEmployeeId): int
    {
        $threshold = (float) Setting::get('stocktake_diff_threshold', '200000');
        if ($threshold <= 0) return 0;

        // Giá vốn bình quân từng NL tại chi nhánh (để tính giá trị chênh)
        $costs = DB::table('batches')
            ->where('branch_id', $stocktake->branch_id)
            ->where('status', 'active')
            ->where('current_quantity', '>', 0)
            ->groupBy('material_id')
            ->selectRaw('material_id, SUM(current_quantity * unit_cost) / NULLIF(SUM(current_quantity), 0) AS avg_cost')
            ->pluck('avg_cost', 'material_id');

        $diffRows = [];
        $totalValue = 0;
        foreach ($rows as $r) {
            $diff = (float) ($r['diff'] ?? 0);
            if (abs($diff) < 0.001) continue;
            $avgCost = (float) ($costs[$r['material_id']] ?? 0);
            $value = abs($diff) * $avgCost;
            $totalValue += $value;
            $diffRows[] = [
                'stocktake_id' => $stocktake->id,
                'branch_id' => $stocktake->branch_id,
                'material_id' => $r['material_id'],
                'system_qty' => (float) ($r['system_qty'] ?? 0),
                'counted_qty' => (float) ($r['counted_qty'] ?? 0),
                'diff_qty' => $diff,
                'diff_value' => round($value, 2),
                'status' => 'pending',
                'requested_by_employee_id' => $requestedByEmployeeId,
                'note' => 'Tự sinh từ phiếu kiểm kê #' . $stocktake->id . ' (chênh ' . ($diff > 0 ? '+' : '') . $diff . ')',
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        if (empty($diffRows) || $totalValue < $threshold) return 0;
        static::insert($diffRows);
        return count($diffRows);
    }
}
