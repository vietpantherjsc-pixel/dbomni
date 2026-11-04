<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Minigame (2026-11-01, spec spec-minigame-hung-tran-chau mục 3): 2 bảng mới —
// phiên CÓ THƯỞNG và điểm cao cá nhân chế độ giải trí. Lớp phiên/điểm dùng
// chung theo game_id; không sửa bảng cũ nào. Migration thuần TẠO bảng mới +
// FK mới (customers, point_lots — không bảng nào khóa ngược lại 2 bảng này)
// nên không có rủi ro đỡ FK kiểu 000083.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('minigame_sessions', function (Blueprint $table) {
            $table->id();
            $table->string('game_id', 40);
            $table->foreignId('customer_id')->constrained('customers');
            $table->unsignedInteger('seed');
            $table->json('config_snapshot');
            $table->string('status', 12)->default('issued'); // issued | submitted | expired | void
            $table->timestamp('issued_at');
            $table->timestamp('expires_at');
            $table->timestamp('submitted_at')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->json('counters')->nullable();
            $table->integer('claimed_score')->nullable();
            $table->integer('verified_score')->nullable();
            $table->unsignedInteger('reward_points')->default(0);
            $table->foreignId('point_lot_id')->nullable()->constrained('point_lots');
            $table->json('anomaly_flags')->nullable();
            $table->timestamps();
            $table->index(['customer_id', 'created_at']);
            $table->index(['game_id', 'status']);
            $table->index(['status', 'expires_at']);
        });

        Schema::create('minigame_personal_bests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers');
            $table->string('game_id', 40);
            $table->string('mode', 12)->default('casual');
            $table->integer('best_score')->default(0);
            $table->unsignedInteger('best_duration_ms')->default(0);
            $table->unsignedInteger('plays_count')->default(0);
            $table->timestamps();
            $table->unique(['customer_id', 'game_id', 'mode']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('minigame_personal_bests');
        Schema::dropIfExists('minigame_sessions');
    }
};
