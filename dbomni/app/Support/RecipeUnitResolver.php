<?php

namespace App\Support;

use App\Models\Material;
use Illuminate\Validation\ValidationException;

// Spec định mức chọn đơn vị quy đổi (Đại Vương chốt chuyển hẳn 2026-11-05
// ~15:01; BA khóa Q1–Q3 15:37). SERVER là nơi quy đổi duy nhất (spec 2.1):
// client chỉ gửi số HIỂN THỊ + đơn vị đã chọn (+ bộ ba orig_* chống trôi),
// server quyết giữ nguyên hay quy đổi theo hệ số HIỆN HÀNH trong DB.
//
// Nghĩa hệ số trong DB (material_units.conversion_rate): 1 đơn vị hiển thị
// = conversion_rate đơn vị cơ sở (VD Cà Phê Bột: Gram = 0,001 Kg).
// MaterialController đảo ngược khi nạp/lưu qua API nên hệ số API-facing là
// nghịch đảo — NHƯNG ở đây tra thẳng cột DB nên dùng đúng nghĩa trên.
class RecipeUnitResolver
{
    /**
     * Quy đổi 1 dòng định mức về số lưu (đơn vị cơ sở) + bản chụp hiển thị.
     *
     * @param array $line display_qty, display_unit_name, orig_quantity,
     *                    orig_display_unit_name, orig_display_factor
     * @return array ['quantity' => float, 'display_unit_name' => ?string,
     *                'display_factor' => ?float]
     */
    public static function resolve(array $line, Material $material): array
    {
        return self::resolveDisplay(
            $line['display_qty'] ?? null,
            $line['display_unit_name'] ?? null,
            $line['orig_quantity'] ?? null,
            $line['orig_display_unit_name'] ?? null,
            $line['orig_display_factor'] ?? null,
            $material
        );
    }

    /**
     * Quy đổi ô sản lượng mẻ của BTP (spec mục 3): cùng luật 1.5, vật liệu
     * tra đơn vị là CHÍNH bán thành phẩm.
     *
     * @return array ['batch_output_qty' => float, 'batch_display_unit_name' => ?string,
     *                'batch_display_factor' => ?float]
     */
    public static function resolveBatch(array $payload, Material $btpMaterial): array
    {
        $r = self::resolveDisplay(
            $payload['batch_display_qty'] ?? null,
            $payload['batch_display_unit_name'] ?? null,
            $payload['orig_batch_output_qty'] ?? null,
            $payload['orig_batch_display_unit_name'] ?? null,
            $payload['orig_batch_display_factor'] ?? null,
            $btpMaterial
        );
        return [
            'batch_output_qty' => $r['quantity'],
            'batch_display_unit_name' => $r['display_unit_name'],
            'batch_display_factor' => $r['display_factor'],
        ];
    }

    /**
     * Dòng payload có dùng đường hiển thị mới không (có gửi display_qty).
     * Không có → hiểu như nhập theo cơ sở như hiện tại (tương thích ngược).
     */
    public static function usesDisplay(array $line): bool
    {
        return array_key_exists('display_qty', $line)
            && $line['display_qty'] !== null && $line['display_qty'] !== '';
    }

    /**
     * Số hiển thị khi đọc/mở sửa (spec 1.3): số cơ sở ÷ hệ số chụp,
     * làm tròn 6 số lẻ. Hệ số chụp NULL/không hợp lệ = cơ sở (hệ số 1).
     */
    public static function displayQty($quantity, $displayFactor): float
    {
        $f = $displayFactor === null || (float) $displayFactor <= 0 ? 1.0 : (float) $displayFactor;
        return round((float) ($quantity ?? 0) / $f, 6);
    }

    /**
     * Danh sách đơn vị chọn được cho 1 nguyên liệu: cơ sở trước (hệ số 1),
     * rồi từng đơn vị trong material_units (hệ số = conversion_rate trong DB).
     * Dùng cho payload đọc của các trình sửa (optionRecipes, RD meta).
     */
    public static function unitsFor(Material $material): array
    {
        $units = [['unit_name' => (string) $material->unit, 'factor' => 1.0]];
        foreach ($material->units as $u) {
            $units[] = ['unit_name' => (string) $u->unit_name, 'factor' => (float) $u->conversion_rate];
        }
        return $units;
    }

    // Lõi chung cho resolve() + resolveBatch(): $qty/$unit là số + đơn vị
    // hiển thị client gửi; $orig* là bản đã nạp khi mở form.
    private static function resolveDisplay($displayQty, $displayUnitName, $origQty, $origUnitName, $origFactor, Material $material): array
    {
        $displayQty = (float) $displayQty;
        if ($displayQty <= 0) {
            throw ValidationException::withMessages(['display_qty' => 'Số lượng hiển thị phải lớn hơn 0.']);
        }

        // Chuẩn hóa đơn vị: tên cơ sở (hoặc trống) = nhập theo cơ sở → NULL.
        $clientUnit = self::normalizeUnit($displayUnitName, $material);

        // Nhánh (a) — giao thức chống trôi (spec 1.5): dòng không đổi thì giữ
        // nguyên số cơ sở + bản chụp cũ, KHÔNG tra hệ số hiện hành. Kiểm
        // TRƯỚC khi tra đơn vị: đơn vị hiển thị có thể đã bị xóa khỏi danh
        // mục sau khi form mở — dòng không sửa vẫn giữ nguyên.
        if ($origQty !== null && $origQty !== '') {
            $origUnit = self::normalizeUnit($origUnitName, $material);
            $origFactorVal = $origFactor === null || $origFactor === '' ? 1.0 : (float) $origFactor;
            $expected = round((float) $origQty / $origFactorVal, 6);
            if ($clientUnit === $origUnit && abs(round($displayQty, 6) - $expected) < 0.0000005) {
                return [
                    'quantity' => (float) $origQty,
                    'display_unit_name' => $origUnit,
                    'display_factor' => $origFactor === null || $origFactor === '' ? null : (float) $origFactor,
                ];
            }
        }

        // Nhánh (b) — quy đổi theo hệ số HIỆN HÀNH + chụp mới.
        $factor = 1.0;
        if ($clientUnit !== null) {
            $unit = $material->units()->where('unit_name', $clientUnit)->first();
            if (!$unit) {
                throw ValidationException::withMessages(['display_unit_name' => 'Đơn vị không thuộc nguyên liệu này.']);
            }
            $factor = (float) $unit->conversion_rate;
            if ($factor <= 0) {
                throw ValidationException::withMessages(['display_unit_name' => 'Hệ số quy đổi phải lớn hơn 0.']);
            }
        }

        return [
            // Lưu: số cơ sở = làm tròn (số hiển thị × hệ số, 4 số lẻ).
            'quantity' => round($displayQty * $factor, 4),
            'display_unit_name' => $clientUnit,
            'display_factor' => $clientUnit === null ? null : $factor,
        ];
    }

    // Tên đơn vị → NULL nếu là đơn vị cơ sở của nguyên liệu (hoặc trống).
    private static function normalizeUnit($unitName, Material $material): ?string
    {
        $name = $unitName === null ? '' : trim((string) $unitName);
        if ($name === '' || $name === (string) $material->unit) {
            return null;
        }
        return $name;
    }
}
