<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\CustomerSession;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

// Spec đăng nhập SĐT + mật khẩu §3: phiên hợp nhất cho cả hai đường đăng
// nhập. Token = chuỗi ngẫu nhiên ≥ 64 ký tự, server chỉ lưu bản băm SHA-256;
// hạn 180 ngày; tối đa 10 phiên hiệu lực/khách (phiên thứ 11 thu hồi phiên cũ nhất).
class CustomerSessionService
{
    public const TOKEN_LENGTH = 80;
    public const TTL_DAYS = 180;
    public const MAX_SESSIONS = 10;

    /**
     * Phát hành phiên mới, trả ['token' => plaintext (chỉ trả 1 lần),
     * 'session' => CustomerSession, 'expires_at' => Carbon].
     */
    public static function issue(Customer $customer, string $method, ?Request $request = null): array
    {
        $plain = Str::random(static::TOKEN_LENGTH);
        $expiresAt = now()->addDays(static::TTL_DAYS);

        $userAgent = $request ? (string) ($request->header('User-Agent') ?? '') : '';
        $session = CustomerSession::create([
            'customer_id' => $customer->id,
            'token_hash' => hash('sha256', $plain),
            'auth_method' => $method,
            // device_label: user_agent rút gọn để nhận diện thiết bị khi cần.
            'device_label' => $userAgent !== '' ? substr($userAgent, 0, 120) : null,
            'ip_address' => $request?->ip(),
            'user_agent' => $userAgent !== '' ? substr($userAgent, 0, 255) : null,
            'expires_at' => $expiresAt,
        ]);

        static::enforceLimit($customer);

        return ['token' => $plain, 'session' => $session, 'expires_at' => $expiresAt];
    }

    /** Thu hồi phiên cũ nhất khi vượt quá giới hạn phiên hiệu lực. */
    public static function enforceLimit(Customer $customer): void
    {
        // reorder() BẮT BUỘC trước orderBy('id'): relation sessions() đã
        // ghim sẵn orderByDesc('id'), mà orderBy của Eloquent chỉ NỐI TIẾP
        // chứ không thay thế — thiếu reorder() thì DESC vẫn là khóa chính,
        // take($excess) cắt trúng các phiên MỚI NHẤT (gồm phiên vừa sinh)
        // thay vì cũ nhất (LAUNCH đào ở §EK, 2026-11-09).
        $usable = $customer->sessions()
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->reorder()
            ->orderBy('id')
            ->get();
        $excess = $usable->count() - static::MAX_SESSIONS;
        if ($excess <= 0) return;
        $usable->take($excess)->each(fn ($s) => $s->update(['revoked_at' => now()]));
    }

    /** Thu hồi mọi phiên khác, giữ phiên hiện tại (đổi/đặt mật khẩu). */
    public static function revokeOthers(Customer $customer, ?int $keepSessionId = null): void
    {
        $q = $customer->sessions()->whereNull('revoked_at');
        if ($keepSessionId) $q->where('id', '!=', $keepSessionId);
        $q->update(['revoked_at' => now()]);
    }

    /** Thu hồi tất cả phiên của khách (đặt lại từ trạng thái chưa đăng nhập). */
    public static function revokeAll(Customer $customer): void
    {
        $customer->sessions()->whereNull('revoked_at')->update(['revoked_at' => now()]);
    }

    /**
     * Giải mã Bearer token thành khách (chưa thu hồi, chưa hết hạn).
     * Cập nhật last_used_at tối đa 1 lần/giờ.
     */
    public static function resolveFromToken(?string $plainToken): ?Customer
    {
        if (!$plainToken) return null;
        $session = CustomerSession::where('token_hash', hash('sha256', $plainToken))
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->first();
        if (!$session) return null;
        if (!$session->last_used_at || $session->last_used_at->lt(now()->subHour())) {
            $session->update(['last_used_at' => now()]);
        }
        return $session->customer;
    }

    /** Phiên hiện tại từ Bearer token của request (null khi không có/không hợp lệ). */
    public static function sessionFromRequest(Request $request): ?CustomerSession
    {
        $plain = $request->bearerToken();
        if (!$plain) return null;
        return CustomerSession::where('token_hash', hash('sha256', $plain))
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->first();
    }

    /** Khách của phiên hiện tại (null khi chưa đăng nhập bằng token). */
    public static function customerFromRequest(Request $request): ?Customer
    {
        return static::resolveFromToken($request->bearerToken());
    }
}
