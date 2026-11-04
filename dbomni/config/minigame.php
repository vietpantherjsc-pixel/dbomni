<?php

// Minigame (2026-11-01) — REGISTRY game: game_id => class mô-đun Lớp B.
// Thêm game mới = thêm 1 mô-đun + 1 dòng tại đây + khóa cấu hình
// minigame_game_{game_id}_enabled. TUYỆT ĐỐI không sửa Lớp A vì 1 game cụ thể.
// test_echo (App\Games\TestEchoGame) là mô-đun giả lập cho kiểm thử kiến
// trúc — KHÔNG đăng ký ở bản chạy thật; TESTER tự thêm dòng ở môi trường test.
return [
    'games' => [
        'hung_tran_chau' => \App\Games\HungTranChauGame::class,
    ],
];
