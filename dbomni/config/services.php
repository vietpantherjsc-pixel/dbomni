<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    // SPEC-01: Zalo Checkout SDK (thanh toán Mini App)
    // Gói Checkout SDK (2026-11-10): sandbox = dùng kênh hậu tố _SANDBOX khi
    // tạo method; api_base = gốc API server-server của Checkout SDK;
    // update_status_url = endpoint updateOrderStatus — CHƯA có tài liệu
    // chính thức (needs_validation), để trống = service chỉ ghi log, không gọi.
    'zalo_payment' => [
        'app_id' => env('ZALO_PAYMENT_APP_ID'),
        'private_key' => env('ZALO_PAYMENT_PRIVATE_KEY'),
        'sandbox' => env('ZALO_PAYMENT_SANDBOX', false),
        'api_base' => env('ZALO_PAYMENT_API_BASE', 'https://payment-mini.zalo.me'),
        'update_status_url' => env('ZALO_PAYMENT_UPDATE_STATUS_URL'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    // Spec P4-P5: Zalo Mini App — App Secret CHỈ trong .env (ZALO_APP_SECRET), không commit
    'zalo' => [
        'app_id' => env('ZALO_APP_ID', '222133330488026054'),
    ],

    // Spec geocode lai NDAMaps (2026-11-13): khóa API CHỈ nằm ở .env phía
    // server — client không bao giờ thấy khóa hay gọi thẳng NDAMaps.
    // enabled=false hoặc khóa rỗng = NDAMaps tắt im lặng, hệ chạy như
    // hiện tại (chỉ thang Nominatim).
    'ndamaps' => [
        'api_key' => env('NDAMAPS_API_KEY'),
        'enabled' => filter_var(env('NDAMAPS_ENABLED', true), FILTER_VALIDATE_BOOLEAN),
        'base_url' => env('NDAMAPS_BASE_URL', 'https://mapapis.ndamaps.vn/v1'),
        'daily_limit' => (int) env('NDAMAPS_DAILY_LIMIT', 1000),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
