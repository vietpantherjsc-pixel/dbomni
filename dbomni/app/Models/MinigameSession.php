<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Minigame (2026-11-01): phiên chơi CÓ THƯỞỞNG — Lớp A dùng chung theo game_id.
class MinigameSession extends Model
{
    protected $fillable = [
        'game_id', 'customer_id', 'seed', 'config_snapshot', 'status',
        'issued_at', 'expires_at', 'submitted_at', 'duration_ms', 'counters',
        'claimed_score', 'verified_score', 'reward_points', 'point_lot_id',
        'anomaly_flags',
    ];

    protected $casts = [
        'config_snapshot' => 'array',
        'counters' => 'array',
        'anomaly_flags' => 'array',
        'issued_at' => 'datetime',
        'expires_at' => 'datetime',
        'submitted_at' => 'datetime',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function pointLot(): BelongsTo
    {
        return $this->belongsTo(PointLot::class);
    }
}
