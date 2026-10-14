<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\PaymentMethod;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductAlias;
use App\Models\User;
use App\Services\InventoryService;
use App\Services\LoyaltyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;

// =====================================================================
// Gói 23 (2026-10-09): Import đơn hàng từ file Excel (trang Hóa đơn).
// Spec: demo-import-excel-v2.html — wizard 4 bước:
//   B1 upload (parse + cache) -> B2 map cột thủ công (frontend)
//   -> B3 validate -> B4 confirm tạo đơn.
// - Idempotent theo mã hóa đơn: mã đã tồn tại thì bỏ qua.
// - Mặc định KHÔNG trừ kho (đơn lịch sử); có tùy chọn trừ kho.
// - Cần: composer require phpoffice/phpspreadsheet
// =====================================================================
class OrderImportController extends Controller
{
    private const MAX_ROWS = 5000;
    private const CACHE_TTL_MINUTES = 30;

    /** @var array<string, Product|null> cache tra cứu món theo tên (trong 1 request) */
    private array $productCache = [];

    // ---------------- BƯỚC 1: upload + parse ----------------
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        try {
            $spreadsheet = IOFactory::load($request->file('file')->getRealPath());
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => 'Không đọc được file Excel: ' . $e->getMessage(),
            ], 422);
        }

        $sheet = $spreadsheet->getActiveSheet();
        // raw values (formatData=false) để tự xử lý ngày tháng Excel serial
        $all = $sheet->toArray(null, true, false, false);
        if (count($all) < 2) {
            return response()->json(['success' => false, 'message' => 'File không có dòng dữ liệu (cần ít nhất 1 dòng tiêu đề + 1 dòng dữ liệu).'], 422);
        }

        $headers = array_map(fn($h) => trim((string) $h), array_shift($all));
        $dataRows = array_values(array_filter(
            $all,
            fn($r) => count(array_filter($r, fn($c) => $c !== null && trim((string) $c) !== '')) > 0
        ));

        $total = count($dataRows);
        if ($total === 0) {
            return response()->json(['success' => false, 'message' => 'File không có dòng dữ liệu.'], 422);
        }
        if ($total > self::MAX_ROWS) {
            return response()->json(['success' => false, 'message' => 'File quá lớn (tối đa ' . self::MAX_ROWS . ' dòng dữ liệu).'], 422);
        }

        $token = 'order_import_' . (string) Str::uuid();
        Cache::put($token, [
            'rows' => $dataRows,
            'filename' => $request->file('file')->getClientOriginalName(),
        ], now()->addMinutes(self::CACHE_TTL_MINUTES));

        $headerList = [];
        foreach ($headers as $i => $h) {
            $headerList[] = ['index' => $i, 'name' => $h !== '' ? $h : ('Cột ' . ($i + 1))];
        }
        $samples = array_map(
            fn($r) => array_map(fn($c) => mb_substr(trim((string) ($c ?? '')), 0, 60), array_values($r)),
            array_slice($dataRows, 0, 3)
        );

        return response()->json(['success' => true, 'data' => [
            'token' => $token,
            'headers' => $headerList,
            'samples' => $samples,
            'total_rows' => $total,
        ]]);
    }

    // ---------------- BƯỚC 3: validate các dòng đã map ----------------
    public function validateRows(Request $request): JsonResponse
    {
        $request->validate([
            'token' => 'required|string',
            'mapping' => 'required|array',
            'create_products' => 'sometimes|boolean',
        ]);

        $cached = Cache::get($request->input('token'));
        if (!$cached) {
            return response()->json(['success' => false, 'message' => 'Phiên import đã hết hạn, vui lòng tải file lên lại.'], 422);
        }

        $mapping = $request->input('mapping'); // ["0" => "order_code", "3" => "order_date", ...]
        $mappedFields = array_values(array_filter($mapping, fn($v) => $v !== '' && $v !== null));
        foreach (['order_code', 'item_name', 'qty', 'price'] as $req) {
            if (!in_array($req, $mappedFields, true)) {
                return response()->json(['success' => false, 'message' => 'Thiếu trường bắt buộc: ' . $this->fieldLabel($req)], 422);
            }
        }

        $createProducts = $request->boolean('create_products', true);
        $this->productCache = [];
        $productMap = $this->productNameMap();

        // Gom mã đơn để check trùng 1 lần
        $codes = [];
        foreach ($cached['rows'] as $raw) {
            $d = $this->applyMapping($raw, $mapping);
            $code = trim((string) ($d['order_code'] ?? ''));
            if ($code !== '') {
                $codes[$code] = true;
            }
        }
        $existingCodes = $codes
            ? Order::whereIn('code', array_keys($codes))->pluck('code')->all()
            : [];
        $existingCodes = array_flip($existingCodes);

        $rows = [];
        $nErr = 0;
        $nWarn = 0;
        $orderCodes = [];
        foreach ($cached['rows'] as $idx => $raw) {
            $d = $this->applyMapping($raw, $mapping);
            $v = $this->validateRow($d, $idx + 2, $productMap, $existingCodes, $createProducts);
            $rows[] = $v;
            if ($v['status'] === 'error') {
                $nErr++;
            } elseif ($v['status'] === 'warning') {
                $nWarn++;
            }
            if ($v['order_code'] !== '') {
                $orderCodes[$v['order_code']] = true;
            }
        }

        // Gói 56: preview dữ liệu sẽ tự tạo (kênh + PTTT) — CHƯA tạo thật ở bước này
        $channelCandidates = []; // code => displayName
        $paymentCandidates = []; // lower => original name
        foreach ($cached['rows'] as $raw) {
            $d = $this->applyMapping($raw, $mapping);
            $chCode = $this->resolveChannel($d['service_type'] ?? '', $d['partner'] ?? '', $d['source'] ?? '');
            if ($chCode !== '' && !in_array(mb_strtolower($chCode), ['pos', 'zalo'], true) && !isset($channelCandidates[$chCode])) {
                $partnerName = trim((string) ($d['partner'] ?? ''));
                $channelCandidates[$chCode] = $partnerName !== '' ? $partnerName : $chCode;
            }
            $pay = trim((string) ($d['payment'] ?? ''));
            if ($pay !== '' && !isset($paymentCandidates[mb_strtolower($pay)])) {
                $paymentCandidates[mb_strtolower($pay)] = $pay;
            }
        }
        $newChannels = [];
        if ($channelCandidates) {
            $codes = array_keys($channelCandidates);
            $placeholders = implode(',', array_fill(0, count($codes), '?'));
            $existingPl = PriceList::whereRaw('LOWER(code) IN (' . $placeholders . ')', array_map('mb_strtolower', $codes))
                ->pluck('code')->map(fn($c) => mb_strtolower((string) $c))->all();
            foreach ($channelCandidates as $code => $displayName) {
                if (!in_array(mb_strtolower($code), $existingPl, true)) {
                    $newChannels[] = [
                        'code' => $code,
                        'name' => $displayName,
                        'commission_rate' => 25,
                        'commission_tax_included' => true,
                    ];
                }
            }
        }
        $newPaymentMethods = [];
        if ($paymentCandidates) {
            $names = array_keys($paymentCandidates);
            $placeholders = implode(',', array_fill(0, count($names), '?'));
            $existingPm = PaymentMethod::whereRaw('LOWER(name) IN (' . $placeholders . ')', $names)
                ->pluck('name')->map(fn($n) => mb_strtolower((string) $n))->all();
            foreach ($paymentCandidates as $lower => $name) {
                if (!in_array($lower, $existingPm, true)) {
                    $newPaymentMethods[] = $name;
                }
            }
        }

        return response()->json(['success' => true, 'data' => [
            'rows' => $rows,
            'summary' => [
                'total_rows' => count($rows),
                'total_orders' => count($orderCodes),
                'errors' => $nErr,
                'warnings' => $nWarn,
            ],
            'new_channels' => $newChannels,
            'new_payment_methods' => $newPaymentMethods,
        ]]);
    }

    // ---------------- BƯỚC 4: confirm tạo đơn ----------------
    public function confirm(Request $request): JsonResponse
    {
        $request->validate([
            'token' => 'required|string',
            'mapping' => 'required|array',
            'branch_id' => 'sometimes|integer|exists:branches,id',
            'skip_errors' => 'sometimes|boolean',
            'create_products' => 'sometimes|boolean',
            'deduct_stock' => 'sometimes|boolean',
            'add_points' => 'sometimes|boolean',
        ]);

        $cached = Cache::get($request->input('token'));
        if (!$cached) {
            return response()->json(['success' => false, 'message' => 'Phiên import đã hết hạn, vui lòng tải file lên lại.'], 422);
        }

        $mapping = $request->input('mapping');
        $skipErrors = $request->boolean('skip_errors', true);
        $createProducts = $request->boolean('create_products', true);
        $deductStock = $request->boolean('deduct_stock', false);
        $addPoints = $request->boolean('add_points', true);
        $branchId = (int) ($request->input('branch_id') ?: DB::table('branches')->orderBy('id')->value('id'));
        $authUserId = $request->user()->id;

        // Validate lại toàn bộ (không tin frontend)
        $this->productCache = [];
        $productMap = $this->productNameMap();
        $codes = [];
        foreach ($cached['rows'] as $raw) {
            $d = $this->applyMapping($raw, $mapping);
            $code = trim((string) ($d['order_code'] ?? ''));
            if ($code !== '') {
                $codes[$code] = true;
            }
        }
        $existingCodes = $codes
            ? array_flip(Order::whereIn('code', array_keys($codes))->pluck('code')->all())
            : [];

        $validRows = [];
        $errorRows = [];
        foreach ($cached['rows'] as $idx => $raw) {
            $d = $this->applyMapping($raw, $mapping);
            $v = $this->validateRow($d, $idx + 2, $productMap, $existingCodes, $createProducts);
            if ($v['status'] === 'error') {
                $errorRows[] = $v;
            } else {
                $validRows[] = $v;
            }
        }
        if (count($errorRows) > 0 && !$skipErrors) {
            return response()->json([
                'success' => false,
                'message' => 'Còn ' . count($errorRows) . ' dòng lỗi. Hãy sửa file hoặc bật "Bỏ qua dòng lỗi".',
                'data' => ['error_rows' => $errorRows],
            ], 422);
        }

        // Gom theo mã hóa đơn
        $groups = [];
        foreach ($validRows as $v) {
            if (isset($existingCodes[$v['order_code']])) {
                continue; // idempotent: mã đã tồn tại thì bỏ qua
            }
            $groups[$v['order_code']][] = $v;
        }

        $createdOrders = 0;
        $createdItems = 0;
        $skippedExisting = count($existingCodes) > 0
            ? Order::whereIn('code', array_keys($existingCodes))->count()
            : 0;
        $warnings = [];

        DB::transaction(function () use (
            $groups,
            $branchId,
            $authUserId,
            $createProducts,
            $deductStock,
            $addPoints,
            &$createdOrders,
            &$createdItems,
            &$warnings
        ) {
            $legacyCat = Category::firstOrCreate(
                ['name' => 'Món import'],
                ['slug' => 'mon-import', 'is_active' => true, 'sort_order' => 99]
            );

            foreach ($groups as $code => $lines) {
                // Check lại trong transaction (tránh race)
                if (Order::where('code', $code)->exists()) {
                    continue;
                }
                $first = $lines[0];
                $isCancelled = $this->isCancelledStatus($first['status_text'] ?? '');

                $customerId = null;
                $phone = preg_replace('/\D/', '', (string) ($first['phone'] ?? ''));
                if ($phone !== '') {
                    $customer = Customer::firstOrCreate(
                        ['phone' => $phone],
                        [
                            'name' => trim((string) ($first['customer'] ?? '')) !== '' ? trim((string) $first['customer']) : 'Khách import',
                            'member_code' => 'IMP' . $phone,
                        ]
                    );
                    $customerId = $customer->id;
                }

                $cashierUser = null;
                if (trim((string) ($first['cashier'] ?? '')) !== '') {
                    $cashierUser = User::where('name', 'like', '%' . trim((string) $first['cashier']) . '%')->first();
                }

                $subtotal = 0;
                foreach ($lines as $ln) {
                    $subtotal += ((float) $ln['qty']) * ((float) $ln['price']);
                }
                $fee = (float) ($first['fee'] ?? 0);
                $orderDate = $this->parseDate($first['order_date_raw'] ?? null);

                // Gói 55: tự tạo PTTT nếu chưa có trong hệ thống
                $payText = trim((string) ($first['payment'] ?? ''));
                if ($payText !== '') {
                    $this->ensurePaymentMethod($payText);
                }

                // Gói 56: xác định kênh từ cột AK/AO + snapshot phí sàn
                $channelCode = $this->resolveChannel(
                    $first['service_type'] ?? '',
                    $first['partner'] ?? '',
                    $first['source'] ?? ''
                );
                $priceList = $this->ensurePriceList($channelCode, $first['partner'] ?? '');
                $commissionRate = $priceList ? (float) $priceList->commission_rate : 0;
                $orderTotal = $subtotal + $fee;
                // Gói 56: đơn hủy không phát sinh phí sàn
                $commissionAmount = (!$isCancelled && $commissionRate > 0) ? (int) round($orderTotal * $commissionRate / 100) : 0;

                $order = Order::create([
                    'user_id' => $cashierUser?->id ?? $authUserId,
                    'branch_id' => $branchId,
                    'order_type' => $this->resolveOrderType($channelCode, $first['service_type'] ?? '', $first['source'] ?? ''),
                    'online_channel' => $channelCode,
                    'commission_rate' => $commissionRate,
                    'commission_amount' => $commissionAmount,
                    'order_number' => $code,
                    'code' => $code,
                    'customer_id' => $customerId,
                    'customer_name' => trim((string) ($first['customer'] ?? '')) !== '' ? trim((string) $first['customer']) : null,
                    'customer_phone' => $phone !== '' ? $phone : null,
                    'subtotal_amount' => $subtotal,
                    'discount_amount' => 0,
                    'shipping_fee' => $fee,
                    'total_amount' => $orderTotal,
                    'status' => $isCancelled ? 'cancelled' : 'completed',
                    'payment_method' => trim((string) ($first['payment'] ?? '')) !== '' ? trim((string) $first['payment']) : null,
                    'payment_status' => $isCancelled ? 'unpaid' : 'paid',
                    'stock_deducted' => !$deductStock,
                    'note' => trim((trim((string) ($first['note'] ?? '')) . ' [import excel]')),
                    'created_at' => $orderDate ?: now(),
                    'updated_at' => $orderDate ?: now(),
                    'completed_at' => $isCancelled ? null : ($orderDate ?: now()),
                ]);

                foreach ($lines as $ln) {
                    $product = $this->resolveProduct($ln['item_name'], $createProducts, $legacyCat);
                    $lineTotal = ((float) $ln['qty']) * ((float) $ln['price']);
                    $optTexts = self::splitOptions($ln['option'] ?? '');
                    // Gói 55: tự gán tùy chọn vào nhóm phù hợp dựa theo tên món
                    $matchedOptIds = $product ? $this->matchOptionsToGroups($product, $optTexts) : [];
                    OrderItem::create([
                        'order_id' => $order->id,
                        'product_id' => $product?->id,
                        'product_name' => $ln['item_name'],
                        'price' => (float) $ln['price'],
                        'unit_price' => (float) $ln['price'],
                        'quantity' => (float) $ln['qty'],
                        'subtotal' => $lineTotal,
                        'total_price' => $lineTotal,
                        'discount_amount' => 0,
                        'options' => $optTexts,
                        'option_ids' => $matchedOptIds,
                        'note' => null,
                        'created_at' => $order->created_at,
                        'updated_at' => $order->created_at,
                    ]);
                    $createdItems++;
                }

                // Trừ kho (mặc định TẮT cho đơn import lịch sử)
                if ($deductStock) {
                    try {
                        app(InventoryService::class)->deductStock(
                            $branchId,
                            $order->items->map(fn($it) => [
                                'product_id' => $it->product_id,
                                'product_option_id' => null,
                                'option_ids' => [],
                                'quantity' => $it->quantity,
                            ])->toArray(),
                            ['type' => 'order', 'id' => $order->id, 'note' => 'Import đơn lịch sử']
                        );
                        $order->update(['stock_deducted' => true]);
                    } catch (\Throwable $e) {
                        $warnings[] = "Đơn {$code}: tạo thành công nhưng trừ kho thất bại ({$e->getMessage()}).";
                    }
                }

                // Cộng điểm thành viên
                if ($addPoints && $customerId) {
                    try {
                        $customer = Customer::find($customerId);
                        if ($customer) {
                            $earned = app(LoyaltyService::class)->earnForOrder($customer, $order, (float) $order->total_amount);
                            $order->update(['points_earned' => $earned]);
                        }
                    } catch (\Throwable $e) {
                        $warnings[] = "Đơn {$code}: không cộng được điểm ({$e->getMessage()}).";
                    }
                }

                $createdOrders++;
            }
        });

        Cache::forget($request->input('token'));

        return response()->json(['success' => true, 'data' => [
            'created_orders' => $createdOrders,
            'created_items' => $createdItems,
            'skipped_existing' => $skippedExisting,
            'error_rows' => array_values($errorRows),
            'warnings' => $warnings,
        ]]);
    }

    // ================= helpers =================

    private function fieldLabel(string $field): string
    {
        return match ($field) {
            'order_code' => 'Mã hóa đơn',
            'item_name' => 'Tên mặt hàng',
            'qty' => 'Số lượng',
            'price' => 'Giá bán',
            'service_type' => 'Loại hình phục vụ',
            'partner' => 'Chi tiết đối tác',
            default => $field,
        };
    }

    /** Map dòng raw theo mapping ["colIndex" => "field"] */
    private function applyMapping(array $raw, array $mapping): array
    {
        $raw = array_values($raw);
        $d = [
            'order_code' => '', 'source' => '', 'service_type' => '', 'partner' => '',
            'status_text' => '', 'order_date_raw' => null,
            'item_name' => '', 'qty' => '', 'unit' => '', 'price' => '',
            'option' => '', 'payment' => '', 'customer' => '', 'phone' => '',
            'cashier' => '', 'note' => '', 'fee' => 0,
        ];
        foreach ($mapping as $idx => $field) {
            if ($field === '' || $field === null) {
                continue;
            }
            $v = $raw[(int) $idx] ?? null;
            $key = $field === 'status' ? 'status_text' : ($field === 'order_date' ? 'order_date_raw' : $field);
            if (array_key_exists($key, $d)) {
                $d[$key] = is_string($v) ? trim($v) : $v;
            }
        }
        return $d;
    }

    /** Validate 1 dòng đã map. Trả về mảng hiển thị cho frontend. */
    private function validateRow(array $d, int $rowNum, array $productMap, array $existingCodes, bool $createProducts): array
    {
        $v = [
            'n' => $rowNum,
            'order_code' => trim((string) ($d['order_code'] ?? '')),
            'item_name' => trim((string) ($d['item_name'] ?? '')),
            'qty' => $d['qty'],
            'price' => $d['price'],
            'order_date' => '',
            'order_date_raw' => $d['order_date_raw'],
            'source' => trim((string) ($d['source'] ?? '')),
            'service_type' => trim((string) ($d['service_type'] ?? '')),
            'partner' => trim((string) ($d['partner'] ?? '')),
            'status_text' => trim((string) ($d['status_text'] ?? '')),
            'option' => trim((string) ($d['option'] ?? '')),
            'payment' => trim((string) ($d['payment'] ?? '')),
            'customer' => trim((string) ($d['customer'] ?? '')),
            'phone' => trim((string) ($d['phone'] ?? '')),
            'cashier' => trim((string) ($d['cashier'] ?? '')),
            'note' => trim((string) ($d['note'] ?? '')),
            'fee' => is_numeric($d['fee']) ? (float) $d['fee'] : 0,
            'status' => 'ok',
            'message' => '',
        ];

        $err = function (string $msg) use (&$v) {
            $v['status'] = 'error';
            $v['message'] = $msg;
        };
        $warn = function (string $msg) use (&$v) {
            if ($v['status'] === 'ok') {
                $v['status'] = 'warning';
                $v['message'] = $msg;
            }
        };

        if ($v['order_code'] === '') {
            $err('Thiếu mã hóa đơn');
            return $v;
        }
        if ($v['item_name'] === '') {
            $err('Thiếu tên mặt hàng');
            return $v;
        }
        if (!is_numeric($v['qty']) || (float) $v['qty'] <= 0) {
            $err('Số lượng phải lớn hơn 0');
            return $v;
        }
        if (!is_numeric($v['price']) || (float) $v['price'] < 0) {
            $err('Giá bán không hợp lệ');
            return $v;
        }

        // Ngày tạo đơn
        $dt = $this->parseDate($d['order_date_raw']);
        if ($d['order_date_raw'] !== null && trim((string) $d['order_date_raw']) !== '' && !$dt) {
            $err('Sai định dạng ngày tạo đơn');
            return $v;
        }
        $v['order_date'] = $dt ? $dt->format('d/m/Y H:i') : '';

        // Mã đã tồn tại -> cảnh báo (confirm sẽ bỏ qua)
        if (isset($existingCodes[$v['order_code']])) {
            $warn('Mã đơn đã tồn tại — sẽ bỏ qua khi import');
        }

        // Món chưa có trong hệ thống (thử tách hậu tố kênh trước khi báo)
        $key = mb_strtolower(trim($v['item_name']));
        $baseKey = mb_strtolower($this->stripChannelSuffix($v['item_name']));
        if (!isset($productMap[$key]) && !isset($productMap[$baseKey])) {
            if ($createProducts) {
                $warn('Món chưa có — sẽ tự tạo mới vào danh mục "Món import"');
            } else {
                $err('Món chưa có trong hệ thống (tắt tùy chọn tự tạo món)');
                return $v;
            }
        }

        return $v;
    }

    /** Gói 49b: tách chuỗi tùy chọn thành mảng (ngăn cách bởi xuống dòng hoặc dấu ;). */
    private static function splitOptions(string $raw): array
    {
        $raw = trim($raw);
        if ($raw === '') return [];
        $parts = preg_split('/[\r\n]+|\s*;\s*/', $raw);
        $out = [];
        foreach ($parts as $p) {
            $p = trim($p);
            if ($p !== '') $out[] = ['name' => $p, 'price' => 0];
        }
        return $out;
    }

    /** Parse ngày từ Excel serial hoặc chuỗi d/m/Y... (kể cả "dd-mm-yyyy HH:MM:SS CH/SA") */
    private function parseDate($v): ?Carbon
    {
        if ($v === null || (is_string($v) && trim($v) === '')) {
            return null;
        }
        if (is_numeric($v)) {
            try {
                return Carbon::instance(ExcelDate::excelToDateTimeObject((float) $v));
            } catch (\Throwable $e) {
                return null;
            }
        }
        $s = trim((string) $v);
        // Gói 48: định dạng Việt "dd-mm-yyyy HH:MM:SS CH/SA" (CH=Chiều/PM, SA=Sáng/AM)
        if (preg_match('/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(CH|SA)$/i', $s, $m)) {
            $h = (int) $m[4];
            $isPM = strtoupper($m[7]) === 'CH';
            if ($isPM && $h < 12) $h += 12;
            if (!$isPM && $h == 12) $h = 0;
            try {
                return Carbon::create((int) $m[3], (int) $m[2], (int) $m[1], $h, (int) $m[5], (int) ($m[6] ?? 0));
            } catch (\Throwable $e) {
                return null;
            }
        }
        foreach (['d/m/Y H:i:s', 'd/m/Y H:i', 'd/m/Y', 'd-m-Y H:i:s', 'd-m-Y H:i', 'd-m-Y', 'Y-m-d H:i:s', 'Y-m-d'] as $f) {
            try {
                $dt = Carbon::createFromFormat($f, $s);
                if ($dt && $dt->format($f) === $s) {
                    return $dt;
                }
            } catch (\Throwable $e) {
                // thử format tiếp theo
            }
        }
        return null;
    }

    /** Map tên món (lowercase) => id */
    private function productNameMap(): array
    {
        $map = [];
        foreach (Product::pluck('name', 'id') as $id => $name) {
            $map[mb_strtolower(trim($name))] = $id;
        }
        return $map;
    }

    /** Tìm hoặc tạo món theo tên (giống logic Gói 7c) */
    private function resolveProduct(string $name, bool $create, Category $legacyCat): ?Product
    {
        $key = mb_strtolower(trim($name));
        if (array_key_exists($key, $this->productCache)) {
            return $this->productCache[$key];
        }
        $p = Product::whereRaw('LOWER(TRIM(name)) = ?', [$key])->first();
        // Gói 55: kiểm tra tên thay thế (alias) — tên cũ từ app khác/file import
        if (!$p) {
            $alias = ProductAlias::whereRaw('LOWER(TRIM(alias_name)) = ?', [$key])->first();
            if ($alias) $p = $alias->product;
        }
        // Gói 55: tách hậu tố kênh ("- CH", "- KM Giờ Vàng") để map về món gốc
        if (!$p) {
            $baseName = $this->stripChannelSuffix($name);
            if ($baseName !== trim($name)) {
                $baseKey = mb_strtolower($baseName);
                if (array_key_exists($baseKey, $this->productCache)) {
                    $p = $this->productCache[$baseKey];
                } else {
                    $p = Product::whereRaw('LOWER(TRIM(name)) = ?', [$baseKey])->first();
                    $this->productCache[$baseKey] = $p;
                }
            }
        }
        if (!$p && $create) {
            $slug = Str::slug($name) . '-import';
            $i = 1;
            while (Product::where('slug', $slug)->exists()) {
                $slug = Str::slug($name) . '-import-' . (++$i);
            }
            $p = Product::create([
                'name' => trim($name),
                'category_id' => $legacyCat->id,
                'slug' => $slug,
                'base_price' => 0,
                'is_active' => false, // ẩn khỏi menu, chỉ phục vụ báo cáo
                'sell_on_pos' => false,
                'sell_on_zalo' => false,
            ]);
        }
        $this->productCache[$key] = $p;
        return $p;
    }

    // Gói 58: tách hậu tố kênh khỏi tên món ("Cà phê sữa - CH" → "Cà phê sữa")
    // Danh sách hậu tố: thêm mới vào mảng $suffixes khi phát sinh thêm
    private function stripChannelSuffix(string $name): string
    {
        $name = trim($name);
        // Hậu tố kênh bán (không phân biệt hoa thường, linh hoạt dấu cách quanh gạch ngang)
        $suffixes = [
            'CH',
            'KM Giờ Vàng',
            'Grab', 'GrabFood',
            'Shopee', 'ShopeeFood',
            'Be', 'BeFood',
            'Zalo',
            'Online',
            'Mang Về',
            'Tại Bàn', 'Tại Quán',
            'Giao Hàng',
        ];
        foreach ($suffixes as $sfx) {
            $escaped = str_replace(' ', '\s+', preg_quote($sfx, '/'));
            $name = preg_replace('/\s*-\s*' . $escaped . '\s*$/iu', '', $name);
        }
        return trim($name);
    }

    // Gói 55: tự gán tùy chọn vào nhóm phù hợp dựa theo tên món
    // Trả về mảng option_ids đã khớp (so tên không phân biệt hoa thường)
    private function matchOptionsToGroups(Product $product, array $optTexts): array
    {
        if (empty($optTexts)) return [];
        $groups = $product->optionGroups()->with('options')->get();
        if ($groups->isEmpty()) return [];
        // Map tên tùy chọn (lowercase) → id
        $nameToId = [];
        foreach ($groups as $g) {
            foreach ($g->options as $opt) {
                $k = mb_strtolower(trim($opt->name));
                if ($k !== '' && !isset($nameToId[$k])) {
                    $nameToId[$k] = $opt->id;
                }
            }
        }
        $matched = [];
        foreach ($optTexts as $t) {
            $k = mb_strtolower(trim($t));
            if (isset($nameToId[$k])) {
                $matched[] = $nameToId[$k];
            }
        }
        return array_values(array_unique($matched));
    }

    private function isCancelledStatus(string $s): bool
    {
        $t = mb_strtolower(trim($s));
        return $t !== '' && (str_contains($t, 'hủy') || str_contains($t, 'huy') || str_contains($t, 'cancel'));
    }

    // Gói 56: chuẩn hóa text thành code kênh — bỏ dấu, bỏ ký tự đặc biệt, lowercase.
    // VD: "GrabFood" → "grabfood", "Be Food" → "befood", "Ăn tại bàn" → "antaiban".
    private function normalizeChannelCode(string $s): string
    {
        $s = trim($s);
        if ($s === '') return '';
        $s = Str::ascii($s); // bỏ dấu tiếng Việt
        $s = mb_strtolower($s);
        return (string) preg_replace('/[^a-z0-9]/', '', $s);
    }

    // Gói 56: xác định kênh từ cột AK (loại hình phục vụ) + AO (chi tiết đối tác).
    // - "Ăn tại bàn"/"mua trực tiếp" hoặc cả 2 cột trống → 'pos'
    // - Có đối tác → chuẩn hóa thành code (vd "GrabFood" → "grabfood")
    // - Fallback: logic mapChannel cũ theo cột nguồn.
    private function resolveChannel(string $serviceType, string $partner, string $source): string
    {
        $stNorm = $this->normalizeChannelCode($serviceType);
        $partnerNorm = $this->normalizeChannelCode($partner);
        $p = trim($partner);

        // Zalo luôn về kênh zalo
        if (str_contains($stNorm, 'zalo') || str_contains($partnerNorm, 'zalo')) {
            return 'zalo';
        }

        // Ăn tại bàn / mua trực tiếp, hoặc cả 2 cột đều trống → kênh tại quầy
        if (
            str_contains($stNorm, 'antaiban')
            || str_contains($stNorm, 'muatructiep')
            || ($stNorm === '' && $p === '')
        ) {
            return 'pos';
        }

        // Có đối tác cụ thể → dùng code đã chuẩn hóa
        if ($partnerNorm !== '') {
            return $partnerNorm;
        }

        // Fallback: logic cũ theo cột nguồn
        return $this->mapChannel($source);
    }

    // Gói 56: xác định loại đơn từ kênh + loại hình phục vụ.
    private function resolveOrderType(string $channel, string $serviceType, string $source): string
    {
        $stNorm = $this->normalizeChannelCode($serviceType);

        // Tại bàn ăn ở quán
        if ($channel === 'pos' && (str_contains($stNorm, 'antaiban') || str_contains($stNorm, 'muatructiep'))) {
            return 'dine_in';
        }

        // Kênh sàn (khác pos/zalo) → giao hàng
        if ($channel !== 'pos' && $channel !== 'zalo') {
            return 'delivery';
        }

        return $this->mapOrderType($source);
    }

    // Gói 56: đảm bảo bảng giá kênh tồn tại — chưa có thì tự tạo mới với
    // phí sàn mặc định 25% đã gồm VAT (Đại Vương chỉnh lại sau).
    private function ensurePriceList(string $code, string $displayName): ?PriceList
    {
        $code = trim($code);
        if ($code === '') return null;
        $pl = PriceList::whereRaw('LOWER(code) = ?', [mb_strtolower($code)])->first();
        if ($pl) return $pl;
        // Kênh nội bộ (pos/zalo) không có phí sàn → không tự tạo, trả null
        if (in_array(mb_strtolower($code), ['pos', 'zalo'], true)) {
            return null;
        }
        return PriceList::create([
            'code' => $code,
            'name' => trim($displayName) !== '' ? trim($displayName) : $code,
            'commission_rate' => 25,
            'commission_tax_included' => true,
            'commission_tax_rate' => 0,
            'is_active' => true,
        ]);
    }

    private function mapChannel(string $source): string
    {
        $t = mb_strtolower(trim($source));
        if (str_contains($t, 'grab') || str_contains($t, 'shopee') || str_contains($t, 'green')) {
            return 'grab';
        }
        if (str_contains($t, 'zalo')) {
            return 'zalo';
        }
        return 'pos';
    }

    private function mapOrderType(string $source): string
    {
        $t = mb_strtolower(trim($source));
        if (str_contains($t, 'grab') || str_contains($t, 'shopee') || str_contains($t, 'green') || str_contains($t, 'giao hàng')) {
            return 'delivery';
        }
        return 'takeaway';
    }

    // Gói 55: đảm bảo PTTT tồn tại trong hệ thống — chưa có thì tự tạo mới
    private function ensurePaymentMethod(string $name): void
    {
        $name = trim($name);
        if ($name === '') return;
        $exists = PaymentMethod::whereRaw('LOWER(name) = ?', [mb_strtolower($name)])->exists();
        if ($exists) return;
        // Đoán loại từ tên
        $t = mb_strtolower($name);
        $type = 'other';
        if (str_contains($t, 'tiền mặt') || $t === 'cash') $type = 'cash';
        elseif (str_contains($t, 'chuyển khoản') || str_contains($t, 'chuyen khoan') || $t === 'transfer') $type = 'transfer';
        elseif (str_contains($t, 'thẻ') || str_contains($t, 'the ') || str_contains($t, 'card')) $type = str_contains($t, 'tín dụng') ? 'credit_card' : 'debit_card';
        elseif (str_contains($t, 'ví') || str_contains($t, 'momo') || str_contains($t, 'zalopay') || str_contains($t, 'vnpay')) $type = 'ewallet';
        $maxOrder = (int) PaymentMethod::max('sort_order');
        PaymentMethod::create([
            'name' => $name,
            'type' => $type,
            'channels' => ['pos', 'zalo'],
            'is_active' => true,
            'sort_order' => $maxOrder + 1,
        ]);
    }
}
