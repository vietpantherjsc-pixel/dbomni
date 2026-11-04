<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Minigame (2026-11-01): điểm cao cá nhân theo (khách, game, chế độ) — đợt này
// chỉ dùng mode 'casual' (giải trí). Không bảng xếp hạng.
class MinigamePersonalBest extends Model
{
    protected $fillable = [
        'customer_id', 'game_id', 'mode', 'best_score', 'best_duration_ms', 'plays_count',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
