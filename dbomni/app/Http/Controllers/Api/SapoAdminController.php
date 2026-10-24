<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\OptionGroup;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\SapoBranchMap;
use App\Models\SapoChannelMap;
use App\Models\SapoColumnAlias;
use App\Models\SapoImportSuspect;
use App\Models\SapoOptionMap;
use App\Models\SapoPaymentMap;
use App\Models\SapoSizeMap;
use App\Models\SapoProductMap;
use App\Models\Setting;
use App\Services\Sapo\SapoExcelParser;
use App\Services\Sapo\SapoText;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

// =====================================================================
// Cầu nối Sapo — Phần B (2026-10-21): API Admin cho map + cấu hình.
// - Map tên món / tùy chọn: thêm-sửa-xóa (không hardcode trong code).
// - /unmapped: tên chưa map rút từ hàng đợi nghi ngờ của lần import gần nhất.
// - /config: cửa sổ "nghi ngờ" + pattern nhận diện mail Sapo (Phần C dùng).
// - /meta: danh sách trường cột, kênh, chi nhánh, PTTT cho các dropdown UI.
// =====================================================================
class SapoAdminController extends Controller
{
    /** Nhãn tiếng Việt các trường cột Excel (đồng bộ SapoExcelParser::REQUIRED/FIELD_ORDER) */
    public const FIELD_LABELS = [
        'invoice_code' => 'Mã hóa đơn', 'source' => 'Nguồn đơn', 'partner' => 'Đối tác giao hàng',
        'status' => 'Trạng thái đơn hàng', 'created_src' => 'Thời gian tạo đơn',
        'paid_src' => 'Thời gian thanh toán', 'price_config' => 'Cấu hình giá mặt hàng',
        'product_code' => 'Mã mặt hàng', 'product_name' => 'Tên mặt hàng, combo',
        'category_name' => 'Danh mục', 'quantity' => 'Số lượng', 'unit' => 'Đơn vị',
        'price' => 'Giá bán', 'option_text' => 'Tên lựa chọn', 'option_price' => 'Giá lựa chọn thêm',
        'discount_pct' => '% Giảm giá', 'discount_line' => 'Tổng giảm giá (dòng)',
        'line_amount' => 'Tiền hàng', 'goods_total' => 'Tổng tiền hàng (1)',
        'vat' => 'Thuế VAT (2)', 'service_fee' => 'Phí dịch vụ (3)',
        'discount_total' => 'Tổng giảm giá (4)', 'shipping_fee' => 'Phí GH thu khách (5)',
        'total_payment' => 'Tổng tiền thanh toán', 'payment_text' => 'Phương thức TT',
        'tip' => 'Tiền Tip', 'customer_name' => 'Khách hàng', 'customer_phone' => 'Số điện thoại',
        'member_card' => 'Thẻ thành viên', 'address' => 'Địa chỉ giao hàng',
        'customer_note' => 'Ghi chú khách hàng', 'service_type' => 'Loại hình phục vụ',
        'area' => 'Khu vực', 'table_name' => 'Bàn', 'cashier_name' => 'Thu ngân',
    ];

    public const PAYMENT_METHODS = ['cash', 'transfer', 'grabfood', 'shopeefood', 'greenfood', 'befood', 'delivery_k', 'capichi', 'oneu'];

    private const TABLES = ['products', 'options', 'channels', 'payments', 'anchors', 'aliases', 'sizes'];

    // ---------------- meta ----------------

    public function meta(): JsonResponse
    {
        $required = array_keys(SapoExcelParser::REQUIRED);
        $fields = [];
        foreach (self::FIELD_LABELS as $field => $label) {
            $fields[] = ['field' => $field, 'label' => $label, 'required' => in_array($field, $required, true)];
        }
        return response()->json(['success' => true, 'data' => [
            'fields' => $fields,
            'channels' => PriceList::orderBy('name')->get(['code', 'name'])->all(),
            'branches' => Branch::orderBy('name')->get(['id', 'name'])->all(),
            'payment_methods' => self::PAYMENT_METHODS,
        ]]);
    }

    // ---------------- unmapped ----------------

    /** Tên món / text lựa chọn chưa map — rút từ hàng đợi nghi ngờ đang pending */
    public function unmapped(): JsonResponse
    {
        $products = [];
        $options = [];
        $mappedProducts = SapoProductMap::whereNotNull('product_id')->pluck('sapo_name')->all();
        $mappedOptions = SapoOptionMap::whereNotNull('option_id')->pluck('sapo_option_text')->all();

        $suspects = SapoImportSuspect::where('status', 'pending')
            ->whereIn('reason', ['unknown_product', 'unknown_option'])
            ->orderByDesc('id')
            ->limit(2000)
            ->get(['reason', 'sapo_invoice_code', 'payload']);

        foreach ($suspects as $s) {
            $payload = is_string($s->payload) ? json_decode($s->payload, true) : $s->payload;
            $rows = $payload['rows'] ?? [];
            foreach ($rows as $r) {
                if ($s->reason === 'unknown_product') {
                    $name = trim((string) ($r['product_name'] ?? ''));
                    if ($name !== '' && !in_array($name, $mappedProducts, true)) {
                        $products[$name][$s->sapo_invoice_code] = true;
                    }
                } else {
                    foreach (explode(',', (string) ($r['option_text'] ?? '')) as $seg) {
                        $seg = trim($seg);
                        if ($seg !== '' && !in_array($seg, $mappedOptions, true)) {
                            $options[$seg][$s->sapo_invoice_code] = true;
                        }
                    }
                }
            }
        }

        $fmt = fn($arr) => array_values(array_map(
            fn($k, $v) => ['name' => $k, 'invoices' => count($v)],
            array_keys($arr), array_values($arr)
        ));
        return response()->json(['success' => true, 'data' => [
            'products' => $fmt($products),
            'options' => $fmt($options),
        ]]);
    }

    // ---------------- catalogs cho dropdown chọn ----------------

    public function productsCatalog(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        $query = Product::where('is_active', true)->select('id', 'name', 'sku');
        if ($q !== '') {
            $query->where(fn($w) => $w->where('name', 'like', '%' . $q . '%')->orWhere('sku', 'like', '%' . $q . '%'));
        }
        return response()->json(['success' => true, 'data' => $query->orderBy('name')->limit(50)->get()]);
    }

    public function optionsCatalog(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        $groups = OptionGroup::with(['options' => fn($o) => $o->select('id', 'option_group_id', 'name')])
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get(['id', 'name']);
        $out = [];
        foreach ($groups as $g) {
            foreach ($g->options as $o) {
                $label = $o->name . ' — ' . $g->name; // hiển thị rõ tùy chọn thuộc nhóm nào
                if ($q === '' || str_contains(mb_strtolower($label), mb_strtolower($q))) {
                    $out[] = ['id' => $o->id, 'name' => $o->name, 'group_id' => $g->id, 'group_name' => $g->name, 'label' => $label];
                }
                if (count($out) >= 100) {
                    break 2;
                }
            }
        }
        return response()->json(['success' => true, 'data' => $out]);
    }

    // ---------------- CRUD bảng map ----------------

    public function mapIndex(Request $request, string $table): JsonResponse
    {
        $this->assertTable($table);
        $q = trim((string) $request->query('q', ''));
        $query = $this->mapModel($table)->newQuery();
        $searchCols = [
            'products' => ['sapo_name'],
            'options' => ['sapo_option_text'],
            'channels' => ['sapo_text', 'channel_code'],
            'payments' => ['sapo_text', 'payment_method'],
            'anchors' => ['anchor_text'],
            'aliases' => ['alias', 'field'],
            'sizes' => ['keyword', 'size_label'],
        ];
        if ($q !== '') {
            $cols = $searchCols[$table];
            $query->where(function ($w) use ($cols, $q) {
                foreach ($cols as $i => $col) {
                    $i === 0 ? $w->where($col, 'like', "%{$q}%") : $w->orWhere($col, 'like', "%{$q}%");
                }
            });
        }
        $with = [];
        if ($table === 'products') {
            $with = ['product:id,name'];
        } elseif ($table === 'options') {
            $with = ['option:id,name,option_group_id', 'option.group:id,name'];
        } elseif ($table === 'anchors') {
            $with = ['branch:id,name'];
        }
        return response()->json(['success' => true, 'data' => $query->with($with)->orderByDesc('id')->limit(200)->get()]);
    }

    public function mapStore(Request $request, string $table): JsonResponse
    {
        $this->assertTable($table);
        $data = $this->validateMap($request, $table);
        $model = $this->mapModel($table);

        $uniqueKeys = [
            'products' => ['sapo_name' => $data['sapo_name']],
            'options' => ['sapo_option_text' => $data['sapo_option_text']],
            'channels' => ['sapo_text' => $data['sapo_text']],
            'payments' => ['sapo_text' => $data['sapo_text']],
            'anchors' => ['anchor_text' => $data['anchor_text']],
            'aliases' => ['field' => $data['field'], 'alias' => $data['alias']],
            'sizes' => ['keyword' => $data['keyword']],
        ];
        $row = $model::updateOrCreate($uniqueKeys[$table], $data);
        return response()->json(['success' => true, 'message' => 'Đã lưu.', 'data' => $row]);
    }

    public function mapDestroy(string $table, int $id): JsonResponse
    {
        $this->assertTable($table);
        $this->mapModel($table)::where('id', $id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa.']);
    }

    private function assertTable(string $table): void
    {
        abort_unless(in_array($table, self::TABLES, true), 404);
    }

    private function mapModel(string $table): string
    {
        return [
            'products' => SapoProductMap::class,
            'options' => SapoOptionMap::class,
            'channels' => SapoChannelMap::class,
            'payments' => SapoPaymentMap::class,
            'anchors' => SapoBranchMap::class,
            'aliases' => SapoColumnAlias::class,
            'sizes' => SapoSizeMap::class,
        ][$table];
    }

    private function validateMap(Request $request, string $table): array
    {
        return match ($table) {
            'products' => $request->validate([
                'sapo_name' => 'required|string|max:255',
                'product_id' => 'required|integer|exists:products,id',
                'note' => 'nullable|string|max:255',
            ]),
            'options' => $request->validate([
                'sapo_option_text' => 'required|string|max:255',
                'option_id' => 'required|integer|exists:product_options,id',
                'note' => 'nullable|string|max:255',
            ]),
            'channels' => $request->validate([
                'sapo_text' => 'required|string|max:120',
                'channel_code' => ['required', 'string', 'max:50', Rule::in(array_merge(
                    PriceList::pluck('code')->all(), ['dbomni']
                ))],
                'note' => 'nullable|string|max:255',
            ]) + ['sapo_text' => SapoText::normalize($request->input('sapo_text'))],
            'payments' => $request->validate([
                'sapo_text' => 'required|string|max:120',
                'payment_method' => ['required', 'string', Rule::in(self::PAYMENT_METHODS)],
                'note' => 'nullable|string|max:255',
            ]) + ['sapo_text' => SapoText::normalize($request->input('sapo_text'))],
            'anchors' => $request->validate([
                'anchor_text' => 'required|string|max:255',
                'branch_id' => 'required|integer|exists:branches,id',
                'note' => 'nullable|string|max:255',
            ]) + ['anchor_text' => SapoText::normalize($request->input('anchor_text'))],
            'aliases' => $request->validate([
                'field' => ['required', 'string', Rule::in(array_keys(self::FIELD_LABELS))],
                'alias' => 'required|string|max:190',
            ]) + ['alias' => SapoText::normalize($request->input('alias'))],
            'sizes' => $request->validate([
                'keyword' => 'required|string|max:60',
                'size_label' => 'required|string|max:20',
            ]) + [
                'keyword' => SapoText::normalize($request->input('keyword')),
                'size_label' => mb_strtoupper(trim((string) $request->input('size_label'))),
            ],
        };
    }

    // ---------------- config ----------------

    public function config(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => [
            'suspect_window_minutes' => (int) Setting::get('sapo_suspect_window_minutes', 15),
            'mail_sender_pattern' => (string) Setting::get('sapo_mail_sender_pattern', 'sapo'),
            'mail_subject_pattern' => (string) Setting::get('sapo_mail_subject_pattern', 'xuất file'),
        ]]);
    }

    public function updateConfig(Request $request): JsonResponse
    {
        $data = $request->validate([
            'suspect_window_minutes' => 'required|integer|min:0|max:180',
            'mail_sender_pattern' => 'required|string|max:120',
            'mail_subject_pattern' => 'required|string|max:120',
        ]);
        Setting::set('sapo_suspect_window_minutes', (string) $data['suspect_window_minutes']);
        Setting::set('sapo_mail_sender_pattern', $data['mail_sender_pattern']);
        Setting::set('sapo_mail_subject_pattern', $data['mail_subject_pattern']);
        return response()->json(['success' => true, 'message' => 'Đã lưu cấu hình.']);
    }
}
