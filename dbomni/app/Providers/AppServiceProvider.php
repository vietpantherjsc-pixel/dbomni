<?php

namespace App\Providers;

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
        $router->aliasMiddleware('staff_hub_token', \App\Http\Middleware\StaffHubToken::class);
        // CC-R1: chặn NV đã tắt dùng token cũ
        $router->aliasMiddleware('employee.active', \App\Http\Middleware\EnsureEmployeeActive::class);
    }
}
