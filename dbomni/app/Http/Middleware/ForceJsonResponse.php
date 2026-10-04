<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// Gói 1 (2026-10-04): Mọi request vào /api/* đều được coi là API call.
// Nếu client quên gửi Accept: application/json, Laravel sẽ tưởng là request web
// và cố redirect về route 'login' (không tồn tại) -> lỗi 500 "Route [login] not defined".
// Middleware này ép Accept để luôn trả JSON 401 gọn gàng khi chưa đăng nhập.
class ForceJsonResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->headers->set('Accept', 'application/json');

        return $next($request);
    }
}
