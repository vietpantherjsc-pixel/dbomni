<?php

namespace App\Http\Middleware;

use App\Models\Setting;
use Closure;
use Illuminate\Http\Request;

// Gói 59 (2026-10-15): bảo vệ hub nhân viên bằng mã QR.
// - QR chứa ?t={token}; token khớp setting staff_hub_token mới cho qua.
// - Áp dụng cho các API employee của hub (frontend gắn token vào mọi request).
// - Token sai/thiếu → 403 (không lộ lý do chi tiết).
class StaffHubToken
{
    public function handle(Request $request, Closure $next)
    {
        $token = (string) $request->query('t', '');
        $expected = (string) Setting::get('staff_hub_token', '');
        if ($token === '' || $expected === '' || !hash_equals($expected, $token)) {
            return response()->json(['success' => false, 'message' => 'Mã truy cập không hợp lệ. Vui lòng quét lại mã QR tại quầy.'], 403);
        }
        return $next($request);
    }
}
