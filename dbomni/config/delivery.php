<?php

// Gói 60 (2026-10-17): Cấu hình tích hợp giao hàng AhaMove / Lalamove.
// API key đọc từ .env (không bao giờ lộ ra frontend).
// Các ngưỡng vận hành đọc từ settings (trang Thiết lập) để đổi không cần sửa code.
return [
    'ahamove' => [
        'base_url' => env('AHAMOVE_BASE_URL', 'https://partner-apistg.ahamove.com/v3'),
        'api_key' => env('AHAMOVE_API_KEY', ''),
        'webhook_secret' => env('AHAMOVE_WEBHOOK_SECRET', ''),
    ],
    'lalamove' => [
        'base_url' => env('LALAMOVE_BASE_URL', 'https://rest.sandbox.lalamove.com'),
        'api_key' => env('LALAMOVE_API_KEY', ''),
        'api_secret' => env('LALAMOVE_API_SECRET', ''),
        'market' => env('LALAMOVE_MARKET', 'VN'),
        'webhook_secret' => env('LALAMOVE_WEBHOOK_SECRET', ''),
    ],
    'failover_timeout_minutes' => env('DELIVERY_FAILOVER_TIMEOUT_MINUTES', 5),
];
