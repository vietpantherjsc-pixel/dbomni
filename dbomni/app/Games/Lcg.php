<?php

namespace App\Games;

// PRNG dùng chung cho mọi mô-đun game (spec mục 2.1 — khóa cứng để lịch sinh
// ở PHP và JS giống hệt nhau): LCG 32-bit
//   state_0 = seed; state_{n+1} = (state_n * 1664525 + 1013904223) mod 2^32
//   giá trị dùng = state_{n+1} / 2^32 ∈ [0,1)
// PHP chạy số nguyên 64-bit nên phép nhân không tràn; & 0xFFFFFFFF sau mỗi bước.
final class Lcg
{
    private int $state;

    public function __construct(int $seed)
    {
        $this->state = $seed & 0xFFFFFFFF;
    }

    public function nextFloat(): float
    {
        $this->state = ($this->state * 1664525 + 1013904223) & 0xFFFFFFFF;
        return $this->state / 4294967296.0;
    }

    public function state(): int
    {
        return $this->state;
    }
}
