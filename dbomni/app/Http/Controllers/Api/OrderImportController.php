<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
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

        return response()->json(['success' => true, 'data' => [
            'rows' => $rows,
            'summary' => [
                'total_rows' => count($rows),
                'total_orders' => count($orderCodes),
                'errors' => $nErr,
                'warnings' => $nWarn,
            ],
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

                $order = Order::create([
                    'user_id' => $cashierUser?->id ?? $authUserId,
                    'branch_id' => $branchId,
                    'order_type' => $this->mapOrderType($first['source'] ?? ''),
                    'online_channel' => $this->mapChannel($first['source'] ?? ''),
                    'order_number' => $code,
                    'code' => $code,
                    'customer_id' => $customerId,
                    'customer_name' => trim((string) ($first['customer'] ?? '')) !== '' ? trim((string) $first['customer']) : null,
                    'customer_phone' => $phone !== '' ? $phone : null,
                    'subtotal_amount' => $subtotal,
                    'discount_amount' => 0,
                    'shipping_fee' => $fee,
                    'total_amount' => $subtotal + $fee,
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
                        'options' => $ln['option'] !== '' ? [['name' => $ln['option'], 'price' => 0]] : [],
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
                            ])->toArray()
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
            default => $field,
        };
    }

    /** Map dòng raw theo mapping ["colIndex" => "field"] */
    private function applyMapping(array $raw, array $mapping): array
    {
        $raw = array_values($raw);
        $d = [
            'order_code' => '', 'source' => '', 'status_text' => '', 'order_date_raw' => null,
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

        // Món chưa có trong hệ thống
        $key = mb_strtolower($v['item_name']);
        if (!isset($productMap[$key])) {
            if ($createProducts) {
                $warn('Món chưa có — sẽ tự tạo mới vào danh mục "Món import"');
            } else {
                $err('Món chưa có trong hệ thống (tắt tùy chọn tự tạo món)');
                return $v;
            }
        }

        return $v;
    }

    /** Parse ngày từ Excel serial hoặc chuỗi d/m/Y... */
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

    private function isCancelledStatus(string $s): bool
    {
        $t = mb_strtolower(trim($s));
        return $t !== '' && (str_contains($t, 'hủy') || str_contains($t, 'huy') || str_contains($t, 'cancel'));
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
}
