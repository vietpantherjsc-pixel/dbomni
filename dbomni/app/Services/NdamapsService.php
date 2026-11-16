<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

// Gói geocode lai NDAMaps (spec-tich-hop-geocode-lai-ndamaps, Đại Vương
// chốt 2026-11-13): mọi lời gọi NDAMaps của hệ đi qua đúng 1 lớp này —
// khóa chỉ đọc từ config/services.php (đổ từ .env phía server), client
// không bao giờ thấy khóa hay gọi thẳng mapapis.ndamaps.vn.
//
// Cổng chuyển dự phòng (spec mục 4) bắt MỌI tín hiệu hỏng ở cả 3 đường
// (autocomplete · place · forward): lỗi mạng/timeout · HTTP ≠ 200 ·
// HTTP 200 nhưng thân báo lỗi (trường `status` ≠ OK ở định dạng Google,
// trường `errors` khác rỗng ở định dạng OSM) · 200 sạch nhưng 0 ứng viên
// dùng được sau kỷ luật · tín hiệu hạn mức (401/403/429) → mở cầu dao
// theo ngày. Mọi lần chuyển đều ghi log (đường · tín hiệu · bộ đếm ngày)
// — KHÔNG ghi khóa API, KHÔNG ghi nguyên văn địa chỉ khách.
//
// Bộ đếm ngày + cầu dao (spec mục 5.2): đếm mọi lượt gọi NDAMaps thật,
// khóa theo ngày giờ Việt Nam trong bảng settings (sống qua restart);
// tăng TRƯỚC mỗi lượt gọi; chạm NDAMAPS_DAILY_LIMIT hoặc gặp tín hiệu
// hạn mức → cầu dao mở tới hết ngày, mọi lượt sau đi thẳng đường dự
// phòng, không phát sinh lời gọi nào nữa.
class NdamapsService
{
    private const SUGGEST_TIMEOUT = 3; // giây — gợi ý (autocomplete + place)
    private const FORWARD_TIMEOUT = 8; // giây — cứu cánh forward
    private const SUGGEST_RADIUS_KM = 5; // bán kính đã đo: 12/12 bản ghi đúng có mặt
    private const PLACE_MAX_DISTANCE_KM = 30; // cổng dị thường dữ liệu (spec §2.2)
    private const FORWARD_SIZE = 5; // số ứng viên cứu cánh

    // Chuẩn hóa tên tỉnh/thành để so khớp: bỏ dấu tiếng Việt, thường hóa,
    // bỏ ký tự lạ và tiền tố "Thành phố"/"Tỉnh"/"TP" — cùng bộ chuẩn hóa
    // thang Nominatim đang dùng (OnlineOrderController::normProvinceName
    // ủy quyền về đây để khỏi 2 bản lệch nhau).
    public static function normalizeProvince(?string $name): string
    {
        $s = Str::ascii(mb_strtolower(trim((string) $name)));
        $s = preg_replace('/[^a-z0-9 ]+/', ' ', $s);
        $s = preg_replace('/\s+/', ' ', trim((string) $s));
        $s = preg_replace('/^(thanh pho|tinh|tp)\s+/', '', (string) $s);
        return trim((string) $s);
    }

    private function baseUrl(): string
    {
        return rtrim((string) config('services.ndamaps.base_url', 'https://mapapis.ndamaps.vn/v1'), '/');
    }

    private function apiKey(): string
    {
        return (string) config('services.ndamaps.api_key', '');
    }

    private function dailyLimit(): int
    {
        return max(1, (int) config('services.ndamaps.daily_limit', 1000));
    }

    public function enabled(): bool
    {
        return (bool) config('services.ndamaps.enabled', true) && $this->apiKey() !== '';
    }

    private function today(): string
    {
        return now('Asia/Ho_Chi_Minh')->format('Y-m-d');
    }

    private function callsKey(): string
    {
        return 'ndamaps_calls_' . $this->today();
    }

    private function breakerKey(): string
    {
        return 'ndamaps_breaker_' . $this->today();
    }

    private function callsToday(): int
    {
        return (int) Setting::get($this->callsKey(), '0');
    }

    private function breakerOpen(): bool
    {
        return Setting::get($this->breakerKey()) !== null;
    }

    private function openBreaker(string $reason): void
    {
        Setting::set($this->breakerKey(), $reason);
        Log::info('ndamaps.breaker_open', ['reason' => $reason, 'calls_today' => $this->callsToday()]);
    }

    private function logFallback(string $route, string $signal): void
    {
        Log::info('ndamaps.fallback', ['route' => $route, 'signal' => $signal, 'calls_today' => $this->callsToday()]);
    }

    // Có được gọi NDAMaps cho lượt này không. Hết ngày thì khóa đếm/cầu
    // dao của ngày cũ hết hiệu lực tự nhiên (khóa mang ngày trong tên).
    private function canCall(): bool
    {
        if (!$this->enabled()) return false;
        if ($this->breakerOpen()) return false;
        if ($this->callsToday() >= $this->dailyLimit()) {
            $this->openBreaker('daily_limit');
            return false;
        }
        return true;
    }

    // Một lượt gọi HTTP tới NDAMaps kèm đủ 5 lớp tín hiệu của cổng dự
    // phòng. Trả body đã giải mã khi sạch, null khi gặp bất kỳ tín hiệu
    // hỏng nào (caller tự chuyển đường dự phòng trong cùng request).
    // Bộ đếm tăng TRƯỚC mỗi lượt gọi thật.
    private function call(string $route, string $path, array $params, int $timeoutSec): ?array
    {
        if (!$this->canCall()) return null;
        Setting::set($this->callsKey(), (string) ($this->callsToday() + 1));
        try {
            $resp = Http::withoutRedirecting()
                ->timeout($timeoutSec)
                ->acceptJson()
                ->get($this->baseUrl() . $path, array_merge($params, ['apikey' => $this->apiKey()]));
        } catch (\Throwable $e) {
            $this->logFallback($route, 'network');
            return null;
        }
        $status = $resp->status();
        if ($status !== 200) {
            if (in_array($status, [401, 403, 429], true)) {
                $this->openBreaker('http_' . $status);
            }
            $this->logFallback($route, 'http_' . $status);
            return null;
        }
        $body = $resp->json();
        if (!is_array($body)) {
            $this->logFallback($route, 'body_invalid');
            return null;
        }
        // Định dạng Google mang trường `status`; OSM/GeoJSON không có
        // trường này — chỉ kiểm khi nó xuất hiện. Chỉ nhìn HTTP 200 là
        // không đủ (spec mục 4 điểm 3).
        if (isset($body['status']) && $body['status'] !== 'OK') {
            $this->logFallback($route, 'body_status');
            return null;
        }
        if (!empty($body['errors'])) {
            $this->logFallback($route, 'body_errors');
            return null;
        }
        return $body;
    }

    private static function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
        return 2 * 6371 * asin(sqrt($a));
    }

    // Đường A — gợi ý khi khách gõ (CHÍNH): autocomplete khoanh vùng 5km
    // quanh chi nhánh + admin_v2 (tên phường theo sáp nhập 2025). Đáp
    // NDAMaps không mang tọa độ — chỉ place_id + nhãn; tọa độ lấy ở
    // bước place khi khách chọn. Trả null khi gặp bất kỳ tín hiệu hỏng
    // nào hoặc không có chi nhánh để khoanh (caller chạy Nominatim).
    // Item trả về: {place_id, label, short} — short = số nhà + đường.
    public function autocomplete(string $q, float $lat, float $lng, ?string $session): ?array
    {
        if (!$lat || !$lng) return null;
        $params = [
            'text' => $q,
            'boundary.circle.lat' => $lat,
            'boundary.circle.lon' => $lng,
            'boundary.circle.radius' => self::SUGGEST_RADIUS_KM,
            'admin_v2' => 'true',
        ];
        if ($session) $params['sessiontoken'] = $session;
        $body = $this->call('suggest', '/autocomplete', $params, self::SUGGEST_TIMEOUT);
        if ($body === null) return null;
        $features = $body['features'] ?? [];
        if (!is_array($features) || !$features) {
            $this->logFallback('suggest', 'empty');
            return null;
        }
        $items = [];
        foreach ($features as $f) {
            $p = $f['properties'] ?? [];
            if (empty($p['id']) || empty($p['label'])) continue;
            $short = trim(trim((string) ($p['housenumber'] ?? '')) . ' ' . trim((string) ($p['street'] ?? '')));
            if ($short === '') $short = trim(explode(',', (string) $p['label'])[0]);
            $items[] = ['place_id' => (string) $p['id'], 'label' => (string) $p['label'], 'short' => $short];
        }
        if (!$items) {
            $this->logFallback('suggest', 'empty');
            return null;
        }
        return $items;
    }

    // Đường A — bước place (CHÍNH): lấy tọa độ bản ghi khi khách chọn
    // gợi ý. Kỷ luật trước khi trả cho client: tỉnh trong bản ghi phải
    // khớp tỉnh khách đã chọn (đúng bộ chuẩn hóa thang) + điểm cách chi
    // nhánh ≤ 30km. Không dùng được (lệch tỉnh / quá xa / place lỗi) →
    // null: client chỉ điền chữ như chọn gợi ý Nominatim, điểm chốt do
    // đường B quyết ở bước tính phí.
    public function place(string $placeId, ?string $session, string $province, float $branchLat, float $branchLng): ?array
    {
        $params = ['ids' => $placeId, 'admin_v2' => 'true'];
        if ($session) $params['sessiontoken'] = $session;
        $body = $this->call('place', '/place', $params, self::SUGGEST_TIMEOUT);
        if ($body === null) return null;
        $features = $body['features'] ?? [];
        if (!is_array($features) || !$features) {
            $this->logFallback('place', 'empty');
            return null;
        }
        $f = $features[0];
        $coords = $f['geometry']['coordinates'] ?? null;
        $p = $f['properties'] ?? [];
        if (!is_array($coords) || count($coords) < 2 || empty($p['label'])) {
            $this->logFallback('place', 'empty');
            return null;
        }
        $target = self::normalizeProvince($province);
        if ($target !== '' && self::normalizeProvince((string) ($p['region'] ?? '')) !== $target) {
            $this->logFallback('place', 'province_mismatch');
            return null;
        }
        $lat = (float) $coords[1];
        $lng = (float) $coords[0];
        if ($branchLat && $branchLng && self::haversineKm($branchLat, $branchLng, $lat, $lng) > self::PLACE_MAX_DISTANCE_KM) {
            $this->logFallback('place', 'too_far');
            return null;
        }
        return ['lat' => $lat, 'lng' => $lng, 'label' => (string) $p['label']];
    }

    // Đường B — cứu cánh (CHỈ khi thang Nominatim rỗng hẳn): forward
    // định dạng OSM size=5 + kỷ luật lọc tỉnh qua properties.region +
    // chọn gần chi nhánh nhất (cùng luật khoanh vùng của thang). 0 ứng
    // viên sau lọc = cứu cánh rỗng → null, caller giữ 422 hiện hành.
    public function forwardRescue(string $text, string $province, float $branchLat, float $branchLng): ?array
    {
        $body = $this->call('forward', '/geocode/forward', [
            'text' => $text,
            'size' => self::FORWARD_SIZE,
            'admin_v2' => 'true',
        ], self::FORWARD_TIMEOUT);
        if ($body === null) return null;
        $features = $body['features'] ?? [];
        if (!is_array($features) || !$features) {
            $this->logFallback('forward', 'empty');
            return null;
        }
        $candidates = [];
        foreach ($features as $f) {
            $coords = $f['geometry']['coordinates'] ?? null;
            $p = $f['properties'] ?? [];
            if (!is_array($coords) || count($coords) < 2 || empty($p['label'])) continue;
            $candidates[] = [
                'lat' => (float) $coords[1],
                'lng' => (float) $coords[0],
                'label' => (string) $p['label'],
                'province' => (string) ($p['region'] ?? ''),
            ];
        }
        $target = self::normalizeProvince($province);
        if ($target !== '') {
            $candidates = array_values(array_filter($candidates, function ($c) use ($target) {
                return self::normalizeProvince($c['province']) === $target;
            }));
        }
        if (!$candidates) {
            $this->logFallback('forward', 'empty');
            return null;
        }
        if (!$branchLat || !$branchLng) {
            $best = $candidates[0];
            return ['lat' => $best['lat'], 'lng' => $best['lng'], 'label' => $best['label']];
        }
        $best = null;
        $bestKm = null;
        foreach ($candidates as $c) {
            $km = self::haversineKm($branchLat, $branchLng, $c['lat'], $c['lng']);
            if ($bestKm === null || $km < $bestKm) {
                $bestKm = $km;
                $best = $c;
            }
        }
        return ['lat' => $best['lat'], 'lng' => $best['lng'], 'label' => $best['label']];
    }
}
