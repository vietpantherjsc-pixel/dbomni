<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Đợt tối ưu import Sapo (2026-10-30): xóa dòng SEED ghi chú "Đá Chung (Vị
// trí < 2km)" do migration 000087 tạo. Sự thật đã chốt: đây là TÙY CHỌN THẬT
// thuộc nhóm Đá — từ nay mảnh này tự khớp tùy chọn thật trong nhóm Đá của món
// ở tầng 1 thay vì đi đường ghi chú. Kỷ luật như down() của chính 000087: chỉ
// xóa khi dòng còn ĐÚNG nguyên trạng seed (option_id NULL + đúng dòng note
// của seed); Admin đã sửa dòng này thì không đụng.
return new class extends Migration
{
    private const NOTE_TEXT = 'Đá Chung (Vị trí < 2km)';
    private const SEED_NOTE = 'Ghi chú — không trừ kho (seed gói 4, 2026-10-28)';

    public function up(): void
    {
        DB::table('sapo_option_map')
            ->where('sapo_option_text', self::NOTE_TEXT)
            ->whereNull('option_id')
            ->where('note', self::SEED_NOTE)
            ->delete();
    }

    public function down(): void
    {
        // Khôi phục đúng dòng seed của 000087 (chỉ khi chưa tồn tại)
        $exists = DB::table('sapo_option_map')
            ->where('sapo_option_text', self::NOTE_TEXT)
            ->exists();
        if (!$exists) {
            DB::table('sapo_option_map')->insert([
                'sapo_option_text' => self::NOTE_TEXT,
                'option_id' => null,
                'note' => self::SEED_NOTE,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
};
