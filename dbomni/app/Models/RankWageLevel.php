<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 67: Lương cấp bậc của nhân viên (cộng thêm trên lương giờ, có ngày hiệu lực).
class RankWageLevel extends Model
{
    protected $fillable = ['employee_id', 'amount', 'start_date', 'end_date', 'note'];

    protected $casts = [
        'amount' => 'decimal:2',
        'start_date' => 'date',
        'end_date' => 'date',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
