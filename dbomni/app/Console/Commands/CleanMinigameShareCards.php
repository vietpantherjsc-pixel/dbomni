<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

// Minigame (2026-11-01): dọn ảnh thẻ chia sẻ kết quả quá 30 ngày trong
// public/images/minigame-shares. Đăng ký lịch trong routes/console.php;
// chạy tay được khi Task Scheduler tắt.
class CleanMinigameShareCards extends Command
{
    protected $signature = 'minigame:clean-share-cards';
    protected $description = 'Minigame: xóa ảnh thẻ chia sẻ kết quả quá 30 ngày';

    public function handle(): int
    {
        $dir = public_path('images/minigame-shares');
        if (!is_dir($dir)) {
            $this->info('Chưa có thư mục ảnh chia sẻ.');
            return self::SUCCESS;
        }
        $cutoff = now()->subDays(30)->timestamp;
        $deleted = 0;
        foreach (glob($dir . '/share_*.png') ?: [] as $file) {
            if (is_file($file) && filemtime($file) < $cutoff) {
                @unlink($file);
                $deleted++;
            }
        }
        $this->info("Đã xóa {$deleted} ảnh chia sẻ quá 30 ngày.");
        return self::SUCCESS;
    }
}
