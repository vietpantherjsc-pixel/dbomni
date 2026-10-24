<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;

abstract class Controller
{
    // Audit 2026-10-23 BM-06 (mở rộng nếp Gói SEC2): message lỗi trả về client.
    // - QueryException: TUYỆT ĐỐI không lộ (chứa SQL/cấu trúc DB) -> ghi log
    //   phía server, client nhận thông báo chung.
    // - Exception nghiệp vụ chủ đích (thiếu tồn kho, không đủ điểm...): giữ
    //   nguyên message để giao diện hiển thị đúng lý do.
    protected function clientErrorMessage(\Throwable $e): string
    {
        if ($e instanceof QueryException) {
            Log::error('DB error: ' . $e->getMessage(), ['exception' => $e]);
            return 'Có lỗi xảy ra. Vui lòng thử lại.';
        }
        return $e->getMessage();
    }
}
