<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Gói 59c-fix (2026-10-15): đăng ký alias middleware trực tiếp qua Router
        // (dự phòng khi bootstrap/app.php không có hiệu lực trên một số môi trường).
        $router = $this->app['router'];
        $router->aliasMiddleware('permission', \App\Http\Middleware\CheckPermission::class);
        // Audit 2026-10-23 A3-5/BM-04: phân biệt bề mặt token theo abilities Sanctum
        $router->aliasMiddleware('ability', \Laravel\Sanctum\Http\Middleware\CheckAnyAbility::class);
        $router->aliasMiddleware('staff_hub_token', \App\Http\Middleware\StaffHubToken::class);
        // CC-R1: chặn NV đã tắt dùng token cũ
        $router->aliasMiddleware('employee.active', \App\Http\Middleware\EnsureEmployeeActive::class);

        // Audit bổ sung F17 (2026-10-21): RATE LIMITER ĐẶT TÊN cho nhóm online.
        // (1) 'order-action': hành động trên MỘT đơn (báo đã CK / hủy đơn) — khóa
        // theo MÃ ĐƠN (dự phòng IP) thay vì khóa IP trần: khách chung NAT nhà mạng /
        // wifi quán không còn giành chung 1 ngân sách, bấm báo CK không dính 429 oan.
        RateLimiter::for('order-action', function (Request $request) {
            $code = (string) ($request->route('code') ?? '');
            return Limit::perMinute(10)->by($code !== '' ? 'order:' . $code : 'ip:' . $request->ip());
        });
        // (2) 'online-read': đường ĐỌC của Mini App (poll trạng thái mỗi 5s ở màn chờ
        // CK/theo dõi đơn, tải thực đơn/cấu hình) — ngân sách rộng RIÊNG theo IP,
        // tách khỏi ngân sách gắt của đường GHI (tạo đơn/geocode giữ mức gắt riêng).
        RateLimiter::for('online-read', function (Request $request) {
            return Limit::perMinute(300)->by('ip:' . $request->ip());
        });
    }
}
