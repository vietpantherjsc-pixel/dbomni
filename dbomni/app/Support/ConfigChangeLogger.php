<?php

namespace App\Support;

use App\Models\ConfigChangeLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

// Chương trình chỉ số 360 — Đợt 2, N-5: ghi nhật ký đổi cấu hình.
// Chỉ ghi khi giá trị thật sự đổi (so sánh dạng chuỗi); an toàn khi bảng
// chưa có (migration 000122 chưa chạy) thì bỏ qua, không làm gãy thao tác.
class ConfigChangeLogger
{
    /** [id, type, name] của người đang thao tác (User admin hoặc Employee). */
    public static function actor(Request $request): array
    {
        $u = $request->user();
        if (!$u) {
            return [null, null, null];
        }
        return [(int) $u->id, $u instanceof \App\Models\Employee ? 'employee' : 'user', $u->name ?? null];
    }

    public static function log(
        string $family,
        string $entityType,
        ?int $entityId,
        ?string $label,
        string $field,
        $old,
        $new,
        ?int $changedBy = null,
        ?string $changedByType = null,
        ?string $changedByName = null
    ): void {
        if ((string) $old === (string) $new) {
            return;
        }
        if (!Schema::hasTable('config_change_logs')) {
            return;
        }
        ConfigChangeLog::create([
            'family' => $family,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'label' => $label,
            'field' => $field,
            'old_value' => $old === null ? null : (string) $old,
            'new_value' => $new === null ? null : (string) $new,
            'changed_by' => $changedBy,
            'changed_by_type' => $changedByType,
            'changed_by_name' => $changedByName,
            'changed_at' => now(),
        ]);
    }

    /** Ghi hàng loạt các trường của 1 thực thể — chỉ trường có trong $values. */
    public static function logFields(
        string $family,
        string $entityType,
        ?int $entityId,
        ?string $label,
        array $oldValues,
        array $values,
        ?int $changedBy = null,
        ?string $changedByType = null,
        ?string $changedByName = null
    ): void {
        foreach ($values as $field => $new) {
            self::log($family, $entityType, $entityId, $label, (string) $field, $oldValues[$field] ?? null, $new, $changedBy, $changedByType, $changedByName);
        }
    }
}
