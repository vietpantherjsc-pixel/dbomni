<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// SPEC-02: Referral.
class Referral extends Model
{
    protected $fillable = [
        'referrer_id', 'referred_id', 'code', 'status', 'completed_at',
    ];

    protected $casts = [
        'completed_at' => 'datetime',
    ];

    public function referrer()
    {
        return $this->belongsTo(Customer::class, 'referrer_id');
    }

    public function referred()
    {
        return $this->belongsTo(Customer::class, 'referred_id');
    }
}
