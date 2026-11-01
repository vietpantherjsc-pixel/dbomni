<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Gói 4 (2026-10-28, spec vá 3 kẽ hở import Sapo — Mục 4): seed 1 dòng map
// GHI CHÚ cho text "Đá Chung (Vị trí < 2km)" trong sapo_option_map.
// Ngữ nghĩa đã chốt: dòng map có option_id = NULL là "ghi chú — không trừ
// kho" (đoạn text chỉ hiện trên dòng món, không vào option_ids, không gây
// nghi ngờ unknown_option). Idempotent: đã có dòng với đúng text này (dù
// map kiểu gì) thì không đụng. Các biến thể text khác Admin tự thêm ở tab
// Map tùy chọn — không hardcode danh sách trong code.
return new class extends Migration
{
    private const NOTE_TEXT = 'Đá Chung (Vị trí < 2km)';

    public function up(): void
    {
        $exists = DB::table('sapo_option_map')
            ->where('sapo_option_text', self::NOTE_TEXT)
            ->exists();
        if (!$exists) {
            DB::table('sapo_option_map')->insert([
                'sapo_option_text' => self::NOTE_TEXT,
                'option_id' => null,
                'note' => 'Ghi chú — không trừ kho (seed gói 4, 2026-10-28)',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        // Chỉ xóa đúng dòng seed còn nguyên trạng ghi chú (Admin đã sửa thì giữ)
        DB::table('sapo_option_map')
            ->where('sapo_option_text', self::NOTE_TEXT)
            ->whereNull('option_id')
            ->where('note', 'Ghi chú — không trừ kho (seed gói 4, 2026-10-28)')
            ->delete();
    }
};
