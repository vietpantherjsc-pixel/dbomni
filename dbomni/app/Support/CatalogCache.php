<?php

namespace App\Support;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

// Spec bộ nhớ đệm thực đơn (Đại Vương chốt 2026-11-05 ~14:22).
// Chỉ đệm 5 payload hiển thị ở trang chủ Mini App (display-menus,
// shop-info, branches, sale-products, top-products). Đường tạo đơn /
// checkout KHÔNG BAO GIỜ đọc đệm này — tiền chốt luôn tính từ DB.
//
// Cơ chế: một bộ đếm phiên bản catalog toàn cục (catalog_version, lưu
// trong chính Redis). Mọi khóa đều chứa phiên bản → một lần bump() là
// toàn bộ đệm cũ vô hiệu ngay, không phải dò từng khóa để xóa. TTL chỉ
// là lưới an toàn (300s; top-products 120s, không theo phiên bản vì
// nguồn là đơn hàng đổi liên tục).
//
// Redis chết → mọi thao tác đệm tự rơi về tính trực tiếp từ DB, KHÔNG
// bao giờ trả lỗi cho khách vì tầng đệm (log cảnh báo giới hạn 60s/lần
// mỗi worker để không ngập log).
class CatalogCache
{
    public const TTL = 300;               // Lưới an toàn cho khóa theo phiên bản
    public const TOP_TTL = 120;           // Top bán chạy: chỉ sống bằng TTL
    public const STALE_TTL = 3600;        // Bản sao cũ dự phòng khi tranh khóa
    public const LOCK_SECONDS = 10;       // Khóa dựng đệm giữ tối đa
    public const LOCK_WAIT_SECONDS = 2;   // Chờ khóa tối đa khi đệm lạnh hẳn

    public const HIT = 'HIT';
    public const MISS = 'MISS';
    public const STALE = 'STALE';
    public const BYPASS = 'BYPASS';

    private const VERSION_KEY = 'catalog_version';

    /** Mốc log cảnh báo Redis chết gần nhất (mỗi worker) — giới hạn tần suất. */
    private static ?int $lastDownLogAt = null;

    // ---- Bộ đếm phiên bản ----

    /** Phiên bản catalog hiện tại (0 khi Redis chưa từng có bump / không nối được). */
    public static function version(): int
    {
        try {
            $v = self::store()->get(self::VERSION_KEY, 0);
            self::$lastDownLogAt = null;
            return (int) ($v ?? 0);
        } catch (\Throwable $e) {
            self::logRedisDown($e);
            return 0;
        }
    }

    /**
     * Tăng phiên bản catalog — gắn ở cuối mọi thao tác ghi thành công
     * chạm tới dữ liệu cấu thành 5 payload. Thừa một lần tăng thì vô
     * hại (chỉ mất đệm sớm); Redis chết thì lặng lẽ bỏ qua (không có
     * đệm nào để vô hiệu, đường đọc cũng đang rơi về trực tiếp).
     */
    public static function bump(): void
    {
        try {
            self::store()->increment(self::VERSION_KEY);
            self::$lastDownLogAt = null;
        } catch (\Throwable $e) {
            self::logRedisDown($e);
        }
    }

    // ---- Khóa đệm (spec mục 2.2) ----

    public static function displayMenusKey(bool $isOnline, bool $unique, int $branchId): string
    {
        return 'cat:v' . self::version() . ':display-menus:'
            . ($isOnline ? 'online' : 'pos') . ':' . ($unique ? '1' : '0')
            . ':branch:' . $branchId;
    }

    public static function shopInfoKey(int $branchId): string
    {
        return 'cat:v' . self::version() . ':shop-info:branch:' . $branchId;
    }

    public static function branchesKey(): string
    {
        return 'cat:v' . self::version() . ':branches';
    }

    public static function saleProductsKey(): string
    {
        return 'cat:v' . self::version() . ':sale-products';
    }

    /** Top bán chạy KHÔNG theo phiên bản — chỉ sống bằng TTL. */
    public static function topProductsKey(int $branchId): string
    {
        return 'top:branch:' . $branchId;
    }

    // ---- Đọc / dựng đệm (spec mục 4) ----

    /**
     * Lấy payload từ đệm, hoặc dựng bằng $compute() khi chưa có.
     *
     * @return array [0 => array $data (mảng `data` đúng hình dạng response),
     *                1 => string trạng thái HIT|MISS|STALE|BYPASS]
     *
     * Luật tranh khóa: request giữ khóa mới tính lại + ghi đệm (kèm bản
     * sao stale:); request còn lại ăn bản stale: ngay nếu có, không có
     * thì chờ khóa tối đa ~2s rồi đọc lại; quá hạn thì tính trực tiếp
     * không qua đệm. Không request nào lỗi vì tranh khóa.
     */
    public static function remember(string $key, int $ttl, callable $compute): array
    {
        $store = self::store();

        try {
            $cached = $store->get($key);
            if ($cached !== null) {
                self::$lastDownLogAt = null;
                return [$cached, self::HIT];
            }
        } catch (\Throwable $e) {
            self::logRedisDown($e);
            return [$compute(), self::BYPASS];
        }

        // Đệm lạnh / bị vô hiệu: giành quyền dựng. Chỉ thao tác Redis nằm
        // trong try/catch — $compute() KHÔNG được bọc (lỗi DB thật phải
        // nổi lên nguyên vẹn, không bị ghi nhầm thành "Redis chết" và
        // không bị tính 2 lần).
        try {
            $lock = $store->lock('lock:' . $key, self::LOCK_SECONDS);
            $acquired = $lock->acquire();
        } catch (\Throwable $e) {
            self::logRedisDown($e);
            return [$compute(), self::BYPASS];
        }
        if ($acquired) {
            try {
                try {
                    $cached = $store->get($key);
                } catch (\Throwable $e) {
                    self::logRedisDown($e);
                    return [$compute(), self::BYPASS];
                }
                if ($cached !== null) {
                    return [$cached, self::HIT];
                }
                $data = $compute();
                try {
                    $store->put($key, $data, $ttl);
                    $store->put('stale:' . $key, $data, self::STALE_TTL);
                    self::$lastDownLogAt = null;
                    $status = self::MISS;
                } catch (\Throwable $e) {
                    // Redis chết giữa chừng: dữ liệu vừa tính vẫn đúng, chỉ
                    // không ghi được đệm → trả BYPASS cho trung thực.
                    self::logRedisDown($e);
                    $status = self::BYPASS;
                }
                return [$data, $status];
            } finally {
                $lock->release();
            }
        }

        // Khóa đang có người giữ: đọc lại khóa chính trước (có thể builder
        // vừa ghi xong), rồi mới ăn bản sao cũ dự phòng.
        try {
            $cached = $store->get($key);
            if ($cached !== null) {
                return [$cached, self::HIT];
            }
            $stale = $store->get('stale:' . $key);
            if ($stale !== null) {
                return [$stale, self::STALE];
            }
        } catch (\Throwable $e) {
            self::logRedisDown($e);
            return [$compute(), self::BYPASS];
        }

        // Đệm lạnh hẳn (không có bản cũ): chờ builder tối đa ~2s.
        // (Cùng luật bọc lỗi như nhánh acquire ở trên: $compute() đứng
        // ngoài mọi try/catch của Redis.)
        try {
            $lock = $store->lock('lock:' . $key, self::LOCK_SECONDS);
            try {
                $acquired = $lock->block(self::LOCK_WAIT_SECONDS);
            } catch (LockTimeoutException) {
                return [$compute(), self::BYPASS];
            }
        } catch (\Throwable $e) {
            self::logRedisDown($e);
            return [$compute(), self::BYPASS];
        }
        if ($acquired) {
            try {
                try {
                    $cached = $store->get($key);
                } catch (\Throwable $e) {
                    self::logRedisDown($e);
                    return [$compute(), self::BYPASS];
                }
                if ($cached !== null) {
                    return [$cached, self::HIT];
                }
                $data = $compute();
                try {
                    $store->put($key, $data, $ttl);
                    $store->put('stale:' . $key, $data, self::STALE_TTL);
                    self::$lastDownLogAt = null;
                    $status = self::MISS;
                } catch (\Throwable $e) {
                    self::logRedisDown($e);
                    $status = self::BYPASS;
                }
                return [$data, $status];
            } finally {
                $lock->release();
            }
        }

        // Quá thời gian chờ mà vẫn chưa có đệm: tính trực tiếp, không ghi đệm.
        return [$compute(), self::BYPASS];
    }

    // ---- Nội bộ ----

    private static function store(): \Illuminate\Contracts\Cache\Repository
    {
        // Store riêng cho catalog — KHÔNG đổi CACHE_STORE toàn cục
        // (đang là database): throttle/lock giữ nguyên hành vi.
        return Cache::store('redis');
    }

    private static function logRedisDown(\Throwable $e): void
    {
        $now = time();
        if (self::$lastDownLogAt !== null && ($now - self::$lastDownLogAt) < 60) {
            return;
        }
        self::$lastDownLogAt = $now;
        Log::warning('[CatalogCache] Redis không dùng được — rơi về tính trực tiếp.', [
            'error' => $e->getMessage(),
        ]);
    }
}
