<?php

namespace App\Services\Sapo;

use App\Models\SapoColumnAlias;
use PhpOffice\PhpSpreadsheet\IOFactory;

// =====================================================================
// Cầu nối Sapo — Phần A (2026-10-21): parse file Excel Sapo theo TÊN CỘT.
// - Tự dò dòng header trong 25 dòng đầu (dòng chứa ≥ 3 tên cột đã biết).
// - Map cột theo tên đã normalize (bảng sapo_column_aliases, Admin sửa ở Phần B);
//   KHÔNG đọc theo vị trí — Sapo thêm/dời cột không làm lệch dữ liệu.
// - Cột bắt buộc thiếu → ném SapoParseException nêu rõ tên cột thiếu, dừng import.
// - Cột tùy chọn thiếu → import tiếp + warning. Cột lạ → bỏ qua im lặng.
// =====================================================================
class SapoParseException extends \Exception
{
}

class SapoExcelParser
{
    /** Trường bắt buộc → nhãn hiển thị khi báo lỗi thiếu cột */
    public const REQUIRED = [
        'invoice_code'  => 'Mã hóa đơn',
        'product_name'  => 'Tên mặt hàng, combo',
        'quantity'      => 'Số lượng',
        'status'        => 'Trạng thái đơn hàng',
        'paid_src'      => 'Thời gian thanh toán',
        'total_payment' => 'Tổng tiền thanh toán',
    ];

    /** Thứ tự ưu tiên giành cột: trường có hậu tố (1)(2)... xét trước trường generic */
    private const FIELD_ORDER = [
        'invoice_code', 'product_name', 'quantity', 'status', 'paid_src', 'total_payment',
        'goods_total', 'vat', 'service_fee', 'discount_total', 'shipping_fee',
        'source', 'partner', 'created_src', 'price_config', 'product_code', 'category_name',
        'unit', 'price', 'option_text', 'option_price', 'discount_pct', 'discount_line',
        'line_amount', 'payment_text', 'tip', 'customer_name', 'customer_phone',
        'member_card', 'address', 'customer_note', 'service_type', 'area', 'table_name',
        'cashier_name',
    ];

    /** Alias mặc định (khớp seed migration 000071) — chỉ dùng khi bảng alias chưa có dữ liệu */
    private const DEFAULT_ALIASES = [
        'invoice_code'   => ['ma hoa don'],
        'source'         => ['nguon don'],
        'partner'        => ['doi tac giao hang'],
        'status'         => ['trang thai don hang'],
        'created_src'    => ['thoi gian tao don'],
        'paid_src'       => ['thoi gian thanh toan'],
        'price_config'   => ['cau hinh gia mat hang'],
        'product_code'   => ['ma mat hang'],
        'product_name'   => ['ten mat hang combo', 'ten mat hang'],
        'category_name'  => ['danh muc'],
        'quantity'       => ['so luong'],
        'unit'           => ['don vi'],
        'price'          => ['gia ban'],
        'option_text'    => ['ten lua chon', 'lua chon'],
        'option_price'   => ['gia lua chon them'],
        'discount_pct'   => ['giam gia', 'phan tram giam gia'],
        'discount_line'  => ['tong giam gia'],
        'line_amount'    => ['tien hang'],
        'goods_total'    => ['tong tien hang 1', 'tong tien hang'],
        'vat'            => ['thue vat 2', 'thue vat'],
        'service_fee'    => ['phi dich vu 3', 'phi dich vu'],
        'discount_total' => ['tong giam gia 4'],
        'shipping_fee'   => ['phi gh thu khach 5', 'phi gh thu khach', 'phi giao hang thu khach 5'],
        'total_payment'  => ['tong tien thanh toan 1 2 3 4 5', 'tong tien thanh toan'],
        'payment_text'   => ['phuong thuc tt', 'phuong thuc thanh toan'],
        'tip'            => ['tien tip'],
        'customer_name'  => ['khach hang'],
        'customer_phone' => ['so dien thoai'],
        'member_card'    => ['the thanh vien'],
        'address'        => ['dia chi giao hang'],
        'customer_note'  => ['ghi chu khach hang'],
        'service_type'   => ['loai hinh phuc vu'],
        'area'           => ['khu vuc'],
        'table_name'     => ['ban'],
        'cashier_name'   => ['thu ngan'],
    ];

    /** @return array<string, string[]> field => [alias đã normalize...] (DB ghi đè/bổ sung mặc định) */
    public function aliases(): array
    {
        $aliases = self::DEFAULT_ALIASES;
        try {
            foreach (SapoColumnAlias::all() as $row) {
                $alias = SapoText::normalize($row->alias);
                if ($alias !== '' && !in_array($alias, $aliases[$row->field] ?? [], true)) {
                    $aliases[$row->field][] = $alias;
                }
            }
        } catch (\Throwable $e) {
            // Bảng chưa migrate → dùng mặc định
        }
        return $aliases;
    }

    /**
     * Parse file → danh sách dòng theo trường nội bộ + meta.
     *
     * @return array{rows: array<int, array<string, mixed>>, header_row: int, warnings: string[], missing_optional: string[]}
     * @throws SapoParseException
     */
    public function parse(string $path): array
    {
        try {
            $spreadsheet = IOFactory::load($path);
        } catch (\Throwable $e) {
            throw new SapoParseException('Không đọc được file Excel: ' . $e->getMessage());
        }
        $sheet = $spreadsheet->getSheet(0);
        $all = $sheet->toArray(null, true, false, false);
        if (count($all) < 2) {
            throw new SapoParseException('File không có dữ liệu (cần dòng tiêu đề + ít nhất 1 dòng dữ liệu).');
        }

        $aliases = $this->aliases();
        $known = [];
        foreach ($aliases as $list) {
            foreach ($list as $a) {
                $known[$a] = true;
            }
        }

        // 1) Tự dò dòng header: quét 25 dòng đầu, dòng đầu tiên chứa ≥ 3 tên cột đã biết
        $headerIdx = null;
        $headerNorm = [];
        $scan = min(25, count($all));
        for ($i = 0; $i < $scan; $i++) {
            $norm = array_map(fn($c) => SapoText::normalize(is_scalar($c) ? (string) $c : ''), $all[$i]);
            $hits = 0;
            foreach ($norm as $cell) {
                if ($cell !== '' && isset($known[$cell])) {
                    $hits++;
                }
            }
            if ($hits >= 3) {
                $headerIdx = $i;
                $headerNorm = $norm;
                break;
            }
        }
        if ($headerIdx === null) {
            throw new SapoParseException('Không tìm thấy dòng tiêu đề trong 25 dòng đầu của file (không nhận diện được cột Sapo).');
        }

        // 2) Map trường → chỉ số cột (mỗi cột chỉ thuộc 1 trường, theo thứ tự ưu tiên)
        $claimed = [];
        $colOf = [];
        foreach (self::FIELD_ORDER as $field) {
            foreach ($aliases[$field] ?? [] as $alias) {
                foreach ($headerNorm as $idx => $cell) {
                    if (!isset($claimed[$idx]) && $cell === $alias) {
                        $colOf[$field] = $idx;
                        $claimed[$idx] = true;
                        break 2;
                    }
                }
            }
        }

        // 3) Cột bắt buộc thiếu → dừng import, nêu rõ tên cột
        $missingRequired = [];
        foreach (self::REQUIRED as $field => $label) {
            if (!isset($colOf[$field])) {
                $missingRequired[] = $label;
            }
        }
        if ($missingRequired) {
            throw new SapoParseException('File thiếu cột bắt buộc: ' . implode(', ', $missingRequired) . '. Đã dừng import.');
        }

        // 4) Cột tùy chọn thiếu → warning, import tiếp
        $warnings = [];
        $missingOptional = [];
        foreach (self::FIELD_ORDER as $field) {
            if (!isset(self::REQUIRED[$field]) && !isset($colOf[$field])) {
                $missingOptional[] = $field;
            }
        }
        if (in_array('payment_text', $missingOptional, true)) {
            $warnings[] = 'File thiếu cột "Phương thức TT" — các đơn sẽ vào hàng đợi nghi ngờ chờ bổ sung map PTTT.';
        }
        if (in_array('option_text', $missingOptional, true)) {
            $warnings[] = 'File thiếu cột "Tên lựa chọn" — món bắt buộc size/tùy chọn sẽ vào hàng đợi nghi ngờ.';
        }
        if (in_array('partner', $missingOptional, true)) {
            $warnings[] = 'File thiếu cột "Đối tác giao hàng" — kênh bán chỉ xét theo cột "Nguồn đơn".';
        }

        // 5) Đọc dữ liệu từ dòng sau header; bỏ dòng trống và dòng không có mã hóa đơn
        $rows = [];
        $total = count($all);
        for ($i = $headerIdx + 1; $i < $total; $i++) {
            $raw = $all[$i];
            $hasAny = false;
            foreach ($raw as $c) {
                if ($c !== null && trim((string) $c) !== '') {
                    $hasAny = true;
                    break;
                }
            }
            if (!$hasAny) {
                continue;
            }
            $row = [];
            foreach ($colOf as $field => $idx) {
                $row[$field] = $raw[$idx] ?? null;
            }
            if (trim((string) ($row['invoice_code'] ?? '')) === '') {
                continue;
            }
            $rows[] = $row;
        }
        if (!$rows) {
            throw new SapoParseException('File không có dòng dữ liệu nào có Mã hóa đơn.');
        }

        return [
            'rows' => $rows,
            'header_row' => $headerIdx + 1, // 1-based như người dùng nhìn trên Excel
            'warnings' => $warnings,
            'missing_optional' => $missingOptional,
        ];
    }
}
