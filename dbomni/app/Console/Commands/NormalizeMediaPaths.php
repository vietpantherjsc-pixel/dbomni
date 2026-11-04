<?php

namespace App\Console\Commands;

use App\Support\MediaFilename;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

// Chuẩn hóa đường dẫn ảnh cũ (Đại Vương lệnh 2026-11-04): quét các cột lưu đường dẫn
// ảnh trong DB, đổi tên file trên đĩa + cập nhật đường dẫn về dạng ASCII sạch theo
// đúng rule App\Support\MediaFilename (cùng rule với upload mới).
// - Mặc định DRY-RUN: chỉ in báo cáo (bản ghi nào, file nào -> tên mới), không đụng gì.
// - Chạy thật: thêm --apply. Idempotent: tên đã sạch thì bỏ qua, chạy lại không đổi nữa.
// - Chỉ xử lý đường dẫn trỏ vào thư mục public của hệ thống (/covers/, /images/...).
// - URL tuyệt đối host NGOÀI: bỏ qua. URL tuyệt đối host NỘI BỘ (localhost/127.0.0.1/::1
//   + host của APP_URL) trỏ vào thư mục của hệ thống: chuẩn hóa thành ĐƯỜNG DẪN TƯƠNG
//   ĐỐI (bỏ scheme+host) + khử dấu tên file — liệt kê riêng 1 mục.
// - Bản ghi trỏ file không còn trên đĩa: chỉ báo, không sửa (áp cho MỌI nhánh,
//   kể cả nhánh host nội bộ chỉ cần bỏ host).
class NormalizeMediaPaths extends Command
{
    protected $signature = 'media:normalize-paths {--apply : Chạy thật: đổi tên file trên đĩa + cập nhật DB (mặc định chỉ dry-run báo cáo)}';
    protected $description = 'Chuẩn hóa đường dẫn ảnh có dấu/khoảng trắng + URL localhost trong DB và trên đĩa về dạng sạch (dry-run mặc định)';

    /** Các cột lưu đường dẫn ảnh: [bảng, cột]. settings xử lý riêng theo khóa. */
    private array $targets = [
        ['products', 'image_url'],
        ['rd_products', 'image_url'],
        ['promotions', 'banner_url'],
        ['branches', 'cover_url'],
        ['employees', 'avatar'],
    ];

    private array $settingKeys = ['shop_cover_url', 'brand_logo'];

    private array $publicDirs = ['covers', 'images/products', 'images/brand', 'images/minigame-shares'];

    private array $localHosts = ['localhost', '127.0.0.1', '::1'];

    /** Nhóm host nội bộ: localhost/127.0.0.1/::1 + host của APP_URL (tên miền chính thức). */
    private function internalHosts(): array
    {
        static $hosts = null;
        if ($hosts === null) {
            $hosts = $this->localHosts;
            $appHost = parse_url((string) config('app.url'), PHP_URL_HOST);
            if (is_string($appHost) && $appHost !== '') {
                $hosts[] = strtolower(trim($appHost, '[]'));
            }
            $hosts = array_values(array_unique($hosts));
        }
        return $hosts;
    }

    private array $stats = ['scan' => 0, 'ok' => 0, 'fix' => 0, 'localhost' => 0, 'external' => 0, 'missing' => 0];
    private array $fixLines = [];
    private array $localLines = [];
    private array $missingLines = [];

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $this->info($apply ? 'CHẠY THẬT: đổi tên file + cập nhật DB.' : 'DRY-RUN: chỉ báo cáo, không thay đổi gì. (Thêm --apply để chạy thật.)');

        foreach ($this->targets as [$table, $column]) {
            if (!DB::getSchemaBuilder()->hasTable($table) || !DB::getSchemaBuilder()->hasColumn($table, $column)) {
                continue;
            }
            $rows = DB::table($table)->select('id', $column)->whereNotNull($column)->where($column, '!=', '')->get();
            foreach ($rows as $row) {
                $this->process($apply, $table . '#' . $row->id, (string) $row->{$column},
                    fn (string $new) => DB::table($table)->where('id', $row->id)->update([$column => $new]));
            }
        }

        if (DB::getSchemaBuilder()->hasTable('settings')) {
            $rows = DB::table('settings')->whereIn('key', $this->settingKeys)
                ->whereNotNull('value')->where('value', '!=', '')->get();
            foreach ($rows as $row) {
                $this->process($apply, 'settings:' . $row->key, (string) $row->value,
                    fn (string $new) => DB::table('settings')->where('key', $row->key)->update(['value' => $new]));
            }
        }

        if ($this->localLines) {
            $this->info('== URL host nội bộ (localhost / APP_URL) -> đường dẫn tương đối ==');
            foreach ($this->localLines as $l) {
                $this->line('  ' . $l);
            }
        }
        if ($this->fixLines) {
            $this->info('== Chuẩn hóa tên file có dấu ==');
            foreach ($this->fixLines as $l) {
                $this->line('  ' . $l);
            }
        }
        foreach ($this->missingLines as $l) {
            $this->warn('  ' . $l);
        }

        // Quét file mồ côi có dấu trong các thư mục public (chỉ báo cáo, không tự đổi tên)
        $orphans = [];
        foreach ($this->publicDirs as $rel) {
            $dir = public_path($rel);
            if (!is_dir($dir)) {
                continue;
            }
            foreach (glob($dir . '/*') ?: [] as $file) {
                if (!is_file($file)) {
                    continue;
                }
                $name = basename($file);
                if (MediaFilename::clean($name) !== $name) {
                    $orphans[] = $rel . '/' . $name . '  ->  ' . $rel . '/' . MediaFilename::clean($name);
                }
            }
        }
        if ($orphans) {
            $this->warn('File trên đĩa có dấu nhưng không thấy trong các cột đã quét (chỉ báo, không tự xử lý):');
            foreach ($orphans as $o) {
                $this->line('  [file] ' . $o);
            }
        }

        $s = $this->stats;
        $this->info("Tổng kết: đã quét {$s['scan']} · đã sạch {$s['ok']} · " .
            ($apply ? "đã chuẩn hóa tên {$s['fix']}" : "cần chuẩn hóa tên {$s['fix']}") .
            " · URL host nội bộ -> tương đối {$s['localhost']} · URL ngoài (bỏ qua) {$s['external']} · trỏ file không còn trên đĩa (chỉ báo) {$s['missing']}");
        return self::SUCCESS;
    }

    private function process(bool $apply, string $ref, string $value, callable $save): void
    {
        $this->stats['scan']++;
        $parts = parse_url($value);
        $path = is_array($parts) ? ($parts['path'] ?? '') : '';
        if ($path === '' || (!str_starts_with($path, '/covers/') && !str_starts_with($path, '/images/'))) {
            $this->stats['external']++;
            return;
        }
        // URL tuyệt đối: chỉ nhận host nội bộ (đổi sang tương đối); host ngoài bỏ qua.
        $isInternalAbsolute = false;
        if (!empty($parts['host'])) {
            $host = strtolower(trim((string) $parts['host'], '[]'));
            if (in_array($host, $this->internalHosts(), true)) {
                $isInternalAbsolute = true;
            } else {
                $this->stats['external']++;
                return;
            }
        }

        $basename = rawurldecode(basename($path));
        $clean = MediaFilename::clean($basename);
        $nameChanged = $clean !== $basename;
        if (!$nameChanged && !$isInternalAbsolute) {
            $this->stats['ok']++;
            return;
        }

        // Chốt chung mọi nhánh (kể cả host nội bộ chỉ cần bỏ host): file không còn
        // trên đĩa thì chỉ cảnh báo, KHÔNG viết lại giá trị.
        $dir = public_path(dirname(ltrim($path, '/')));
        $oldFile = $dir . '/' . $basename;
        if (!is_file($oldFile)) {
            $this->stats['missing']++;
            $this->missingLines[] = "[thiếu file] {$ref}: {$value} (không thấy file trên đĩa — không sửa)";
            return;
        }

        $newName = $nameChanged ? MediaFilename::unique($dir, $clean) : $basename;
        $newPath = dirname($path) . '/' . $newName;
        $newValue = $isInternalAbsolute ? $newPath : preg_replace('/' . preg_quote(basename($path), '/') . '$/', $newName, $value);
        if (!is_string($newValue) || $newValue === $value) {
            $this->stats['external']++;
            return;
        }

        if ($isInternalAbsolute) {
            $this->stats['localhost']++;
            $this->localLines[] = "[{$ref}] {$value}  ->  {$newValue}";
        } else {
            $this->stats['fix']++;
            $this->fixLines[] = "[{$ref}] {$value}  ->  {$newValue}";
        }
        if ($apply) {
            if ($nameChanged) {
                rename($oldFile, $dir . '/' . $newName);
            }
            $save($newValue);
        }
    }
}
