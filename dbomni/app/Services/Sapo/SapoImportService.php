<?php

namespace App\Services\Sapo;

use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\PriceList;
use App\Models\ProductOption;
use App\Models\SapoChannelMap;
use App\Models\SapoImportRun;
use App\Models\SapoImportSuspect;
use App\Models\SapoOptionMap;
use App\Models\SapoPaymentMap;
use App\Models\SapoProductMap;
use App\Models\Setting;
use App\Services\InventoryService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;

// =====================================================================
// Cầu nối Sapo — Phần A (2026-10-21): import hóa đơn Sapo vào DBOMNI.
// Luồng 1 hóa đơn (spec mục 2/5/6):
//   lọc kênh DBOMNI (bỏ qua 100%) → chống trùng mã hóa đơn (UNIQUE)
//   → chỉ lấy dòng "Đã thanh toán" → map kênh/PTTT/món/tùy chọn (bảng map Admin)
//   → đối chiếu tổng tiền → chốt chặn "nghi ngờ" (cùng tổng + giờ TT ± cửa sổ
//   với đơn DBOMNI sẵn có) → tạo đơn + trừ kho FIFO đúng 1 lần (không qua KDS).
// Mọi trường hợp chưa chắc chắn → ghi sapo_import_suspects chờ xử lý (Phần D),
// KHÔNG tự đoán món/tùy chọn/kênh.
// =====================================================================
class SapoImportService
{
    public function __construct(
        private SapoExcelParser $parser,
        private InventoryService $inventory,
    ) {
    }

    /** Import 1 file Excel cho 1 chi nhánh. Trả về bản ghi lần import (run). */
    public function importFile(string $path, string $filename, int $branchId, string $source = 'upload', ?int $userId = null): SapoImportRun
    {
        $run = SapoImportRun::create([
            'source' => $source,
            'filename' => $filename,
            'branch_id' => $branchId,
            'status' => 'processing',
            'created_by' => $userId,
        ]);

        try {
            $parsed = $this->parser->parse($path);
        } catch (SapoParseException $e) {
            $run->update(['status' => 'error', 'error' => $e->getMessage()]);
            return $run;
        }

        // Nhóm dòng theo Mã hóa đơn (1 hóa đơn = 1 đơn, tổng tiền lấy từ dòng đầu)
        $invoices = [];
        foreach ($parsed['rows'] as $row) {
            $code = self::strVal($row['invoice_code'] ?? null);
            if ($code === '') {
                continue;
            }
            $invoices[$code]['code'] = $code;
            $invoices[$code]['rows'][] = $row;
        }

        $ctx = $this->loadContext();
        $tally = ['created' => 0, 'duplicate' => 0, 'dbomni' => 0, 'cancelled' => 0, 'suspect' => 0];

        foreach ($invoices as $inv) {
            $res = $this->processInvoice($inv, $branchId, $ctx);
            $tally[$res['result']] = ($tally[$res['result']] ?? 0) + 1;
            if ($res['result'] === 'suspect') {
                // Import lại cùng file: kết quả mới thay thế nghi ngờ pending cũ của đúng hóa đơn này
                SapoImportSuspect::where('branch_id', $branchId)
                    ->where('sapo_invoice_code', $inv['code'])
                    ->where('status', 'pending')
                    ->delete();
                SapoImportSuspect::create([
                    'run_id' => $run->id,
                    'branch_id' => $branchId,
                    'sapo_invoice_code' => $inv['code'],
                    'reason' => $res['reason'],
                    'detail' => $res['detail'] ?? null,
                    'payload' => $inv,
                    'status' => 'pending',
                ]);
            }
        }

        if ($tally['cancelled'] > 0) {
            Log::info('Sapo import: bỏ qua ' . $tally['cancelled'] . ' hóa đơn đã hủy', ['run_id' => $run->id, 'file' => $filename]);
        }

        $run->update([
            'status' => 'done',
            'total_rows' => count($parsed['rows']),
            'invoice_count' => count($invoices),
            'created_count' => $tally['created'],
            'duplicate_count' => $tally['duplicate'],
            'dbomni_skipped_count' => $tally['dbomni'],
            'cancelled_count' => $tally['cancelled'],
            'suspect_count' => $tally['suspect'],
            'warnings' => $parsed['warnings'],
        ]);

        return $run->fresh();
    }

    /**
     * Chạy lại 1 hóa đơn từ payload đã lưu (Phần D dùng sau khi quản lý map tay).
     * $force = true: bỏ qua chốt chặn "nghi ngờ trùng" — chỉ khi quản lý đã xác nhận
     * đây là đơn mới thật (không phải đơn DBOMNI bị quên chọn kênh).
     * @return array{result: string, order_id?: int, reason?: string, detail?: string}
     */
    public function importInvoice(array $inv, int $branchId, bool $force = false): array
    {
        $ctx = $this->loadContext();
        return $this->processInvoice($inv, $branchId, $ctx, $force);
    }

    /** Nạp toàn bộ bảng map vào bộ nhớ cho 1 lần import */
    private function loadContext(): array
    {
        return [
            'products' => SapoProductMap::whereNotNull('product_id')->pluck('product_id', 'sapo_name')->all(),
            'options' => SapoOptionMap::whereNotNull('option_id')->pluck('option_id', 'sapo_option_text')->all(),
            'channels' => SapoChannelMap::pluck('channel_code', 'sapo_text')->all(),
            'payments' => SapoPaymentMap::pluck('payment_method', 'sapo_text')->all(),
            'sizes' => DB::table('sapo_size_map')->pluck('size_label', 'keyword')->all(),
            'window' => (int) Setting::get('sapo_suspect_window_minutes', 15),
            'required_groups' => [], // cache theo product_id trong lúc chạy
        ];
    }

    /**
     * Xử lý 1 hóa đơn.
     * @return array{result: 'created'|'duplicate'|'dbomni'|'cancelled'|'suspect', order_id?: int, reason?: string, detail?: string}
     */
    private function processInvoice(array $inv, int $branchId, array &$ctx, bool $force = false): array
    {
        $rows = $inv['rows'] ?? [];
        if (!$rows) {
            return ['result' => 'suspect', 'reason' => 'unknown_status', 'detail' => 'Hóa đơn không có dòng dữ liệu.'];
        }
        $first = $rows[0];
        $code = (string) ($inv['code'] ?? self::strVal($first['invoice_code'] ?? null));

        // 1) Lọc kênh DBOMNI — bỏ qua 100% (đơn gốc đã có trong DBOMNI, đã trừ kho lúc bán)
        $channelCode = $this->resolveChannel($first, $ctx);
        if ($channelCode === 'dbomni') {
            return ['result' => 'dbomni'];
        }

        // 2) Chỉ import dòng "Đã thanh toán"; hóa đơn toàn "Đã hủy" → bỏ qua + log ở tầng run
        $paidRows = [];
        $statuses = [];
        foreach ($rows as $r) {
            $st = SapoText::normalize(self::strVal($r['status'] ?? null));
            $statuses[$st] = true;
            if ($st === 'da thanh toan') {
                $paidRows[] = $r;
            }
        }
        if (!$paidRows) {
            if (isset($statuses['da huy']) && count($statuses) === 1) {
                return ['result' => 'cancelled'];
            }
            return ['result' => 'suspect', 'reason' => 'unknown_status',
                'detail' => 'Trạng thái đơn lạ: ' . implode(', ', array_keys($statuses))];
        }

        // 3) Kênh lạ (không có trong bảng map) → nghi ngờ, không tự đoán
        if ($channelCode === null) {
            return ['result' => 'suspect', 'reason' => 'unknown_channel',
                'detail' => 'Chưa map kênh: Nguồn đơn="' . self::strVal($first['source'] ?? null)
                    . '", Đối tác giao hàng="' . self::strVal($first['partner'] ?? null) . '"'];
        }

        // 4) Chống trùng lớp 1: mã hóa đơn đã có → bỏ qua
        if (Order::where('sapo_invoice_code', $code)->exists()) {
            return ['result' => 'duplicate'];
        }

        // 5) Phương thức thanh toán qua bảng map
        if (!array_key_exists('payment_text', $first)) {
            return ['result' => 'suspect', 'reason' => 'missing_payment',
                'detail' => 'File thiếu cột Phương thức TT — cần bổ sung map PTTT rồi chạy lại.'];
        }
        $payText = self::strVal($first['payment_text'] ?? null);
        $paymentMethod = $this->resolvePayment($payText, $ctx);
        if ($paymentMethod === null) {
            return ['result' => 'suspect', 'reason' => 'unknown_payment',
                'detail' => 'Chưa map phương thức thanh toán: "' . $payText . '"'];
        }

        // 6) Đối chiếu tổng tiền: (1) + (3) − (4) + (5), cộng VAT (2) khi giá chưa gồm thuế.
        //    Chấp nhận nếu 1 trong 2 cách khớp (sai số ≤ 1đ) — cấu hình giá của quán là "Đã bao gồm thuế".
        $total = self::money($first['total_payment'] ?? null);
        if (array_key_exists('goods_total', $first) && $first['goods_total'] !== null) {
            $base = self::money($first['goods_total']) + self::money($first['service_fee'] ?? null)
                - self::money($first['discount_total'] ?? null) + self::money($first['shipping_fee'] ?? null);
            $withVat = $base + self::money($first['vat'] ?? null);
            if (abs($base - $total) > 1 && abs($withVat - $total) > 1) {
                return ['result' => 'suspect', 'reason' => 'total_mismatch',
                    'detail' => 'Tổng tiền không khớp công thức Sapo: tiền hàng ' . number_format(self::money($first['goods_total']))
                        . ', VAT ' . number_format(self::money($first['vat'] ?? null))
                        . ', phí DV ' . number_format(self::money($first['service_fee'] ?? null))
                        . ', giảm ' . number_format(self::money($first['discount_total'] ?? null))
                        . ', phí GH ' . number_format(self::money($first['shipping_fee'] ?? null))
                        . ' → kỳ vọng ' . number_format($base) . ' (hoặc ' . number_format($withVat) . '), file ghi ' . number_format($total)];
            }
        }

        // 7) Map món + tùy chọn từng dòng; chưa map → nghi ngờ (không tự đoán)
        $items = [];
        $deductLines = [];
        foreach ($paidRows as $r) {
            $pname = trim(self::strVal($r['product_name'] ?? null));
            $productId = $ctx['products'][$pname] ?? null;
            if (!$productId) {
                return ['result' => 'suspect', 'reason' => 'unknown_product',
                    'detail' => 'Tên món chưa map: "' . $pname . '"'];
            }

            $optionIds = [];
            $optionNames = [];
            $optText = self::strVal($r['option_text'] ?? null);
            if ($optText !== '') {
                foreach (explode(',', $optText) as $seg) {
                    $seg = trim($seg);
                    if ($seg === '') {
                        continue;
                    }
                    $oid = $ctx['options'][$seg] ?? $this->resolveSizeOption($seg, (int) $productId, $ctx);
                    if (!$oid) {
                        return ['result' => 'suspect', 'reason' => 'unknown_option',
                            'detail' => 'Text lựa chọn chưa map: "' . $seg . '" (món "' . $pname . '")'];
                    }
                    $optionIds[] = (int) $oid;
                }
            }
            $optionIds = array_values(array_unique($optionIds));

            // Món có nhóm tùy chọn BẮT BUỘC (VD: Size) mà không map được tùy chọn nào thuộc nhóm → nghi ngờ
            $missingGroup = $this->missingRequiredGroup((int) $productId, $optionIds, $ctx);
            if ($missingGroup !== null) {
                return ['result' => 'suspect', 'reason' => 'missing_required_option',
                    'detail' => 'Món "' . $pname . '" bắt buộc nhóm "' . $missingGroup . '" nhưng file không có lựa chọn khớp.'];
            }

            if ($optionIds) {
                $optionNames = ProductOption::whereIn('id', $optionIds)->pluck('name')->all();
            }

            $qty = max(1, (int) self::num($r['quantity'] ?? 1));
            $price = self::money($r['price'] ?? null);
            $lineTotal = array_key_exists('line_amount', $r) && $r['line_amount'] !== null
                ? self::money($r['line_amount']) : $price * $qty;
            $items[] = [
                'product_id' => (int) $productId,
                'product_name' => $pname,
                'price' => $price,
                'quantity' => $qty,
                'subtotal' => $lineTotal,
                'discount_amount' => self::money($r['discount_line'] ?? null),
                'option_ids' => $optionIds,
                'option_names' => $optionNames,
            ];
            $deductLines[] = [
                'product_id' => (int) $productId,
                'option_ids' => $optionIds,
                'quantity' => $qty,
            ];
        }

        $paidAt = self::dateVal($first['paid_src'] ?? null) ?? self::dateVal($first['created_src'] ?? null) ?? now();
        $createdSrc = self::dateVal($first['created_src'] ?? null);

        // 8) Chốt chặn: đơn kênh khác khớp đáng ngờ với đơn DBOMNI sẵn có
        //    (cùng tổng tiền + giờ thanh toán trong cửa sổ cấu hình) → nghi ngờ, không tự tạo.
        //    $force (quản lý xác nhận ở Phần D) bỏ qua chốt chặn này.
        if (!$force && $ctx['window'] > 0) {
            $dupe = Order::where('branch_id', $branchId)
                ->whereNull('sapo_invoice_code')
                ->where('status', '!=', 'cancelled')
                ->where('total_amount', $total)
                ->whereBetween('created_at', [
                    $paidAt->copy()->subMinutes($ctx['window']),
                    $paidAt->copy()->addMinutes($ctx['window']),
                ])
                ->first(['id', 'code', 'created_at']);
            if ($dupe) {
                return ['result' => 'suspect', 'reason' => 'possible_duplicate',
                    'detail' => 'Khớp đáng ngờ với đơn DBOMNI ' . ($dupe->code ?? ('#' . $dupe->id))
                        . ' (cùng tổng ' . number_format($total) . 'đ, giờ TT trong ±' . $ctx['window']
                        . ' phút) — có thể thu ngân quên chọn kênh DBOMNI khi nhập tay lên Sapo.'];
            }
        }

        // 9) Tạo đơn + trừ kho FIFO 1 lần trong 1 transaction (lỗi kho → rollback, vào nghi ngờ)
        try {
            $orderId = DB::transaction(function () use ($first, $code, $channelCode, $paymentMethod, $items, $deductLines, $branchId, $total, $paidAt, $createdSrc) {
                $customerId = null;
                $phone = preg_replace('/\s+/', '', self::strVal($first['customer_phone'] ?? null)) ?? '';
                if (strlen($phone) >= 9) {
                    $customer = Customer::firstOrCreate(
                        ['phone' => $phone],
                        ['name' => trim(self::strVal($first['customer_name'] ?? null)) ?: 'Khách lẻ', 'member_code' => 'IMP' . $phone]
                    );
                    $customerId = $customer->id;
                }

                $priceList = PriceList::whereRaw('LOWER(code) = ?', [mb_strtolower($channelCode)])->first();
                $commissionRate = $priceList ? (float) $priceList->commission_rate : 0;
                $orderCode = Order::nextCode();

                $noteParts = ['Sapo HĐ ' . $code];
                if (self::strVal($first['cashier_name'] ?? null) !== '') {
                    $noteParts[] = 'Thu ngân: ' . self::strVal($first['cashier_name']);
                }
                if (self::strVal($first['table_name'] ?? null) !== '') {
                    $noteParts[] = 'Bàn: ' . self::strVal($first['table_name']);
                }
                if (self::strVal($first['area'] ?? null) !== '') {
                    $noteParts[] = 'Khu vực: ' . self::strVal($first['area']);
                }
                if (self::strVal($first['customer_note'] ?? null) !== '') {
                    $noteParts[] = 'KH: ' . self::strVal($first['customer_note']);
                }

                $order = Order::create([
                    'user_id' => null,
                    'branch_id' => $branchId,
                    'order_type' => $this->mapOrderType($first, $channelCode, $priceList),
                    'online_channel' => $channelCode,
                    'commission_rate' => $commissionRate,
                    'commission_amount' => $commissionRate > 0 ? (int) round($total * $commissionRate / 100) : 0,
                    'order_number' => $orderCode,
                    'code' => $orderCode,
                    'customer_id' => $customerId,
                    'customer_name' => trim(self::strVal($first['customer_name'] ?? null)) ?: null,
                    'customer_phone' => $phone !== '' ? $phone : null,
                    'delivery_address' => trim(self::strVal($first['address'] ?? null)) ?: null,
                    'subtotal_amount' => array_key_exists('goods_total', $first) && $first['goods_total'] !== null
                        ? self::money($first['goods_total']) : collect($items)->sum('subtotal'),
                    'discount_amount' => self::money($first['discount_total'] ?? null),
                    'shipping_fee' => self::money($first['shipping_fee'] ?? null),
                    'total_amount' => $total,
                    'status' => 'completed',
                    'payment_method' => $paymentMethod,
                    'payment_status' => 'paid',
                    'stock_deducted' => false,
                    'source' => 'sapo',
                    'sapo_invoice_code' => $code,
                    'sapo_created_at' => $createdSrc,
                    'paid_at' => $paidAt,
                    'completed_at' => $paidAt,
                    'note' => implode(' · ', $noteParts),
                    'created_at' => $paidAt,
                    'updated_at' => $paidAt,
                ]);

                foreach ($items as $it) {
                    OrderItem::create([
                        'order_id' => $order->id,
                        'product_id' => $it['product_id'],
                        'product_name' => $it['product_name'],
                        'price' => $it['price'],
                        'unit_price' => $it['price'],
                        'quantity' => $it['quantity'],
                        'subtotal' => $it['subtotal'],
                        'total_price' => $it['subtotal'],
                        'discount_amount' => $it['discount_amount'],
                        'options' => array_map(fn($n) => ['name' => $n, 'price' => 0], $it['option_names']),
                        'option_ids' => $it['option_ids'],
                        'created_at' => $paidAt,
                        'updated_at' => $paidAt,
                    ]);
                }

                // Trừ kho FIFO theo BOM (món + tùy chọn đã map) — đơn Sapo KHÔNG qua KDS
                $this->inventory->deductStock($branchId, $deductLines, ['type' => 'order', 'id' => $order->id]);
                $order->update(['stock_deducted' => true]);

                return $order->id;
            });
        } catch (\Throwable $e) {
            if (str_contains($e->getMessage(), 'không đủ tồn kho')) {
                return ['result' => 'suspect', 'reason' => 'insufficient_stock', 'detail' => $e->getMessage()];
            }
            Log::error('Sapo import: lỗi tạo đơn', ['invoice' => $code, 'error' => $e->getMessage()]);
            return ['result' => 'suspect', 'reason' => 'processing_error', 'detail' => $e->getMessage()];
        }

        return ['result' => 'created', 'order_id' => $orderId];
    }

    /** Kênh: ưu tiên Đối tác giao hàng (cụ thể hơn), sau đó Nguồn đơn. 'dbomni' = kênh DBOMNI. */
    private function resolveChannel(array $first, array $ctx): ?string
    {
        foreach (['partner', 'source'] as $field) {
            $text = SapoText::normalize(self::strVal($first[$field] ?? null));
            if ($text === '') {
                continue;
            }
            if ($text === 'dbomni') {
                return 'dbomni';
            }
            if (isset($ctx['channels'][$text])) {
                return $ctx['channels'][$text];
            }
        }
        return null;
    }

    /** PTTT: khớp exact trước, sau đó khớp "chứa" theo key dài nhất (VD key "vietqr pro" ⊂ "techcombank vietqr pro") */
    private function resolvePayment(string $payText, array $ctx): ?string
    {
        $key = SapoText::normalize($payText);
        if ($key === '') {
            return null;
        }
        if (isset($ctx['payments'][$key])) {
            return $ctx['payments'][$key];
        }
        $keys = array_keys($ctx['payments']);
        usort($keys, fn($a, $b) => mb_strlen($b) <=> mb_strlen($a));
        foreach ($keys as $k) {
            if (mb_strlen($k) >= 4 && str_contains($key, $k)) {
                return $ctx['payments'][$k];
            }
        }
        return null;
    }

    /** Fallback size: đoạn text chứa keyword size (bảng sapo_size_map) → tìm tùy chọn size của đúng món đó */
    private function resolveSizeOption(string $segment, int $productId, array $ctx): ?int
    {
        $norm = SapoText::normalize($segment);
        $label = null;
        foreach ($ctx['sizes'] as $keyword => $lbl) {
            if ($keyword !== '' && str_contains($norm, SapoText::normalize((string) $keyword))) {
                $label = (string) $lbl;
                break;
            }
        }
        if ($label === null) {
            return null;
        }
        $want = ['size ' . SapoText::normalize($label), SapoText::normalize($label)];
        $options = ProductOption::whereHas('group', function ($q) use ($productId) {
            $q->whereHas('products', fn($p) => $p->where('products.id', $productId));
        })->get();
        $found = [];
        foreach ($options as $opt) {
            $groupName = SapoText::normalize($opt->group->name ?? '');
            if (!str_contains($groupName, 'size')) {
                continue;
            }
            if (in_array(SapoText::normalize($opt->name), $want, true)) {
                $found[] = (int) $opt->id;
            }
        }
        return count($found) === 1 ? $found[0] : null;
    }

    /** Tên nhóm tùy chọn BẮT BUỘC của món mà chưa có tùy chọn nào được map thuộc nhóm — null nếu đủ */
    private function missingRequiredGroup(int $productId, array $optionIds, array &$ctx): ?string
    {
        if (!isset($ctx['required_groups'][$productId])) {
            $groups = DB::table('product_option_group as pog')
                ->join('option_groups as og', 'og.id', '=', 'pog.option_group_id')
                ->where('pog.product_id', $productId)
                ->where('og.is_required', true)
                ->pluck('og.name', 'og.id')
                ->all();
            $ctx['required_groups'][$productId] = $groups;
        }
        $required = $ctx['required_groups'][$productId];
        if (!$required) {
            return null;
        }
        $chosenGroups = $optionIds
            ? ProductOption::whereIn('id', $optionIds)->pluck('option_group_id')->all()
            : [];
        foreach ($required as $gid => $gname) {
            if (!in_array($gid, $chosenGroups)) {
                return (string) $gname;
            }
        }
        return null;
    }

    /** Loại hình phục vụ Sapo → order_type DBOMNI (spec mục 3) */
    private function mapOrderType(array $first, string $channelCode, ?PriceList $priceList): string
    {
        $t = SapoText::normalize(self::strVal($first['service_type'] ?? null));
        if (str_contains($t, 'tai ban')) {
            return 'dine_in';
        }
        if (str_contains($t, 'giao hang')) {
            return 'delivery';
        }
        if (str_contains($t, 'mang di') || str_contains($t, 'mang ve')) {
            return 'takeaway';
        }
        // "Kênh bán hàng" → theo kênh: đối tác = giao hàng, còn lại = mang đi
        $isPartner = $priceList ? ($priceList->category ?? null) === 'partner' : in_array($channelCode, ['grabfood', 'shopeefood', 'greenfood', 'befood', 'delivery_k', 'capichi', 'oneu'], true);
        return $isPartner ? 'delivery' : 'takeaway';
    }

    // ---------- Chuẩn hóa giá trị ô Excel ----------

    public static function strVal($v): string
    {
        if ($v === null) {
            return '';
        }
        if (is_float($v) && floor($v) === $v && abs($v) < 1e15) {
            return (string) (int) $v; // mã hóa đơn dạng 500014829.0 → "500014829"
        }
        return trim((string) $v);
    }

    public static function num($v): float
    {
        if ($v === null || $v === '') {
            return 0.0;
        }
        if (is_numeric($v)) {
            return (float) $v;
        }
        $s = str_replace(' ', '', (string) $v);
        if (preg_match('/^\d{1,3}(\.\d{3})+(,\d+)?$/', $s)) {
            $s = str_replace('.', '', $s); // 49.000 kiểu VN = nghìn
        }
        $s = str_replace(',', '.', $s);
        return is_numeric($s) ? (float) $s : 0.0;
    }

    public static function money($v): float
    {
        return round(self::num($v));
    }

    public static function dateVal($v): ?Carbon
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (is_numeric($v) && (float) $v > 20000 && (float) $v < 80000) {
            try {
                return Carbon::instance(ExcelDate::excelToDateTimeObject((float) $v));
            } catch (\Throwable $e) {
                return null;
            }
        }
        try {
            return Carbon::parse((string) $v);
        } catch (\Throwable $e) {
            return null;
        }
    }
}
