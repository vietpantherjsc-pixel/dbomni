<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    // Gói 55 p11ae: bỏ '*' (trước đây mọi website đều gọi được API). Chỉ giữ localhost dev.
    // Khi deploy production, thêm domain thật của frontend/Mini App vào đây.
    // Đợt fix 2026-11-04: 2 origin Zalo của Mini App (LAUNCH đã khai trên VPS từ
    // trước — nay đưa vào repo để khép sổ delta; kiểm sống CORS Zalo đạt 8/8).
    'allowed_origins' => ['http://localhost:5174', 'http://localhost:3000', 'https://h5.zdn.vn', 'https://zma.daybreak.vn'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false,

];
