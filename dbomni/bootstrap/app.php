<?php

use Illuminate\Auth\AuthenticationException;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Gói 1: ép mọi request /api/* trả JSON (kể cả khi client quên header Accept).
        $middleware->api(append: [
            \App\Http\Middleware\ForceJsonResponse::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // Gói 1 (2026-10-04): Chặn triệt để lỗi "Route [login] not defined".
        // Handler mặc định khi gặp AuthenticationException mà request không expectsJson
        // sẽ redirect()->guest($e->redirectTo() ?? route('login')) -> nổ ở route('login').
        // Với API, luôn trả 401 JSON gọn gàng thay vì redirect.
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['message' => 'Unauthenticated.'], 401);
            }
        });
    })->create();

// Gói 1 (2026-10-04): Bản Laravel này, Authenticate::redirectTo() KHÔNG kiểm tra
// expectsJson() mà gọi thẳng callback mặc định route('login') (không tồn tại)
// -> lỗi 500 "Route [login] not defined" khi request API chưa đăng nhập.
// Ghi đè callback để luôn trả null -> ném AuthenticationException -> 401 JSON gọn.
// (Đây là backend thuần cho SPA/Zalo Mini App nên không cần redirect web.)
// PHẢI đăng ký trong $app->booted(): framework đặt lại callback mặc định của nó
// trong lúc app boot (request đầu tiên), tức SAU khi file này chạy xong.
// Đăng ký trực tiếp ở đây sẽ bị ghi đè.
$app->booted(function () {
    Authenticate::redirectUsing(fn (Request $request) => null);
});

return $app;
