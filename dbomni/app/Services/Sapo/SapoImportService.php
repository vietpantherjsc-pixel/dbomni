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
        $missingRecipeOrders = 0;

        foreach ($invoices as $inv) {
            $res = $this->processInvoice($inv, $branchId, $ctx);
            $tally[$res['result']] = ($tally[$res['result']] ?? 0) + 1;
            if ($res['result'] === 'suspect') {
                // Import lại cùng file: kết quả mới thay thế nghi ngờ pending cũ của đúng hóa đơn này.
                // NGOẠI LỆ (vá 2026-10-28 theo phán PM/TESTER): cảnh báo missing_recipe KHÔNG bị
                // thay-xóa — nó là vết của 1 đơn ĐÃ import thành công, chỉ đóng qua
                // resolve/bỏ qua; xóa thầm ở đây là đúng bệnh "mất dấu vết âm thầm".
                SapoImportSuspect::where('branch_id', $branchId)
                    ->where('sapo_invoice_code', $inv['code'])
                    ->where('status', 'pending')
                    ->where('reason', '!=', 'missing_recipe')
                    ->delete();
                SapoImportSuspect::create([
                    'run_id' => $run->id,
                    'branch_id' => $branchId,
                    'sapo_invoice_code' => $inv['code'],
                    'reason' => $res['reason'],
                    'detail' => $res['detail'] ?? null,
                    'payload' => $inv,
                    'status' => 'pending',
                    // Vá L2-3: suspect hủy-sau-import trỏ sẵn vào đơn DBOMNI tương ứng
                    'resolved_order_id' => $res['resolved_order_id'] ?? null,
                ]);
            }
            // Vá L2-2: đơn tạo thành công nhưng có món chưa có định lượng cơ bản
            // → để lại 1 cảnh báo truy vết (đơn và kho phần còn lại vẫn đúng).
            if ($res['result'] === 'created' && !empty($res['order_id'])) {
                if ($this->createMissingRecipeWarning((int) $res['order_id'], (int) $run->id, $branchId, $inv['code'])) {
                    $missingRecipeOrders++;
                }
            }
        }

        if ($tally['cancelled'] > 0) {
            Log::info('Sapo import: bỏ qua ' . $tally['cancelled'] . ' hóa đơn đã hủy', ['run_id' => $run->id, 'file' => $filename]);
        }

        $runWarnings = $parsed['warnings'];
        if ($missingRecipeOrders > 0) {
            $runWarnings[] = 'Cảnh báo định lượng: ' . $missingRecipeOrders . ' đơn có món chưa định lượng (xem tab Nghi ngờ — cảnh báo "missing_recipe").';
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
            'warnings' => $runWarnings,
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

    /**
     * Vá L2-2 (2026-10-28): sau khi tạo đơn thành công, kiểm tra từng dòng món —
     * món nào không có dòng recipes CƠ BẢN (product_option_id IS NULL) thì phần
     * kho của món đó trong đơn chưa được trừ (trước đây âm thầm trừ 0). Tạo 1
     * suspect 'missing_recipe' gắn đúng đơn (resolved_order_id) để vận hành bổ
     * sung định lượng rồi đánh dấu đã xử lý. Trả true nếu có sinh cảnh báo.
     * Không đi qua nhánh thay-xóa suspect của importFile: đơn đã tạo xong và
     * kết quả hóa đơn vẫn tính là created.
     */
    private function createMissingRecipeWarning(int $orderId, int $runId, int $branchId, string $invoiceCode): bool
    {
        $order = Order::with('items')->find($orderId);
        if (!$order) {
            return false;
        }
        $missing = [];
        foreach ($order->items as $item) {
            $hasBase = DB::table('recipes')
                ->where('product_id', $item->product_id)
                ->whereNull('product_option_id')
                ->exists();
            if (!$hasBase) {
                $pid = (int) $item->product_id;
                if (isset($missing[$pid])) {
                    $missing[$pid]['quantity'] += (int) $item->quantity;
                } else {
                    $missing[$pid] = [
                        'product_id' => $pid,
                        'product_name' => (string) $item->product_name,
                        'quantity' => (int) $item->quantity,
                    ];
                }
            }
        }
        if (!$missing) {
            return false;
        }
        $missing = array_values($missing);
        $list = collect($missing)->map(fn($m) => $m['product_name'] . ' ×' . $m['quantity'])->implode('; ');
        SapoImportSuspect::create([
            'run_id' => $runId,
            'branch_id' => $branchId,
            'sapo_invoice_code' => $invoiceCode,
            'reason' => 'missing_recipe',
            'detail' => 'Đơn ' . ($order->code ?? ('#' . $order->id)) . ' đã import nhưng các món sau chưa có định lượng cơ bản nên chưa trừ kho: '
                . $list . '. Bổ sung định lượng cho món tại trang Định lượng, rồi đánh dấu đã xử lý. Kho của đơn này chưa được trừ cho các món trên.',
            'payload' => ['order_id' => $order->id, 'order_code' => $order->code, 'items' => $missing],
            'status' => 'pending',
            'resolved_order_id' => $order->id,
        ]);
        return true;
    }

    /** Nạp toàn bộ bảng map vào bộ nhớ cho 1 lần import */
    private function loadContext(): array
    {
        // Tầng 2 — map NGOẠI LỆ món (2026-10-30, phương án 3 tầng đã chốt):
        // sapo_name => [product_id, gift_product_id]; gift có giá trị = combo.
        $productMaps = [];
        foreach (SapoProductMap::whereNotNull('product_id')->get(['sapo_name', 'product_id', 'gift_product_id']) as $m) {
            $productMaps[$m->sapo_name] = [
                'product_id' => (int) $m->product_id,
                'gift_product_id' => $m->gift_product_id ? (int) $m->gift_product_id : null,
            ];
        }
        // Tầng 1 — danh mục đang sống: tên => [product_id...] (giữ mảng để phát
        // hiện trùng tên mập mờ); tên món ngừng bán để gợi ý trong chi tiết nghi ngờ.
        $activeByName = [];
        $inactiveNames = [];
        foreach (DB::table('products')->get(['id', 'name', 'is_active']) as $p) {
            if ($p->is_active) {
                $activeByName[$p->name][] = (int) $p->id;
            } else {
                $inactiveNames[$p->name] = true;
            }
        }
        return [
            'product_maps' => $productMaps,
            'active_by_name' => $activeByName,
            'inactive_names' => $inactiveNames,
            'options' => SapoOptionMap::whereNotNull('option_id')->pluck('option_id', 'sapo_option_text')->all(),
            // Map GHI CHÚ (2026-10-28): dòng sapo_option_map có option_id = NULL —
            // đoạn text chỉ hiện trên dòng món để nhân viên thấy, không trừ kho.
            'note_options' => array_fill_keys(
                SapoOptionMap::whereNull('option_id')->pluck('sapo_option_text')->all(),
                true
            ),
            // Tầng 0: hậu tố kênh bán — đọc CÙNG danh mục dùng chung
            // import_suffixes với luồng import Excel (1 nguồn sự thật duy nhất,
            // không chép lại danh sách; danh mục trống thì không bóc).
            'suffixes' => \App\Models\SharedCategory::activeCodes('import_suffixes'),
            'channels' => SapoChannelMap::pluck('channel_code', 'sapo_text')->all(),
            'payments' => SapoPaymentMap::pluck('payment_method', 'sapo_text')->all(),
            'sizes' => DB::table('sapo_size_map')->pluck('size_label', 'keyword')->all(),
            'window' => (int) Setting::get('sapo_suspect_window_minutes', 15),
            'required_groups' => [], // cache theo product_id trong lúc chạy
            'product_options' => [], // cache cấu trúc nhóm/tùy chọn theo product_id
        ];
    }

    /** Tầng 0: bóc hậu tố kênh bán ở CUỐI tên (cùng luật với OrderImportController::stripChannelSuffix, đọc cùng danh mục dùng chung) */
    private function stripSuffix(string $name, array $ctx): string
    {
        $name = trim($name);
        foreach ($ctx['suffixes'] as $sfx) {
            $escaped = str_replace(' ', '\\s+', preg_quote((string) $sfx, '/'));
            $name = preg_replace('/\\s*-\\s*' . $escaped . '\\s*$/iu', '', $name) ?? $name;
        }
        return trim($name);
    }

    /**
     * Cấu trúc nhóm + tùy chọn của 1 món (cache trong ctx):
     * [group_id => ['name' =>, 'options' => [option_id => option_name]]]
     */
    private function productOptionGroups(int $productId, array &$ctx): array
    {
        if (isset($ctx['product_options'][$productId])) {
            return $ctx['product_options'][$productId];
        }
        $rows = DB::table('product_option_group as pog')
            ->join('option_groups as og', 'og.id', '=', 'pog.option_group_id')
            ->leftJoin('product_options as po', 'po.option_group_id', '=', 'og.id')
            ->where('pog.product_id', $productId)
            ->get(['og.id as gid', 'og.name as gname', 'po.id as oid', 'po.name as oname']);
        $groups = [];
        foreach ($rows as $r) {
            $groups[(int) $r->gid]['name'] = (string) $r->gname;
            if ($r->oid) {
                $groups[(int) $r->gid]['options'][(int) $r->oid] = (string) $r->oname;
            }
        }
        return $ctx['product_options'][$productId] = $groups;
    }

    /**
     * Phân giải 1 đoạn text lựa chọn TRONG PHẠM VI 1 món (thứ tự đã chốt):
     * (1) map ngoại lệ → (2) tự khớp tên tùy chọn thuộc các nhóm của chính món
     * (trùng tên ở 2 nhóm khác nhau = mập mờ) → (3) fallback size.
     * Trả: ['kind' => 'option', 'option_id' =>, 'group_id' =>, 'group_name' =>]
     *   | ['kind' => 'ambiguous', 'detail' =>] | ['kind' => 'none']
     */
    private function matchSegmentForProduct(string $seg, int $productId, array &$ctx): array
    {
        $groups = $this->productOptionGroups($productId, $ctx);
        // (1) Map ngoại lệ: chỉ tính khi tùy chọn map thuộc 1 nhóm của món này
        if (isset($ctx['options'][$seg])) {
            $oid = (int) $ctx['options'][$seg];
            foreach ($groups as $gid => $g) {
                if (isset($g['options'][$oid])) {
                    return ['kind' => 'option', 'option_id' => $oid, 'group_id' => (int) $gid, 'group_name' => $g['name']];
                }
            }
            // Map trỏ sang tùy chọn không thuộc món này → không dùng (đi tiếp các tầng sau)
        }
        // (2) Tự khớp chính xác tên tùy chọn trong các nhóm của món
        $hits = [];
        foreach ($groups as $gid => $g) {
            foreach (($g['options'] ?? []) as $oid => $oname) {
                if ($oname === $seg) {
                    $hits[] = ['option_id' => (int) $oid, 'group_id' => (int) $gid, 'group_name' => $g['name']];
                }
            }
        }
        if (count($hits) === 1) {
            return ['kind' => 'option'] + $hits[0];
        }
        if (count($hits) > 1) {
            return ['kind' => 'ambiguous',
                'detail' => 'Text lựa chọn "' . $seg . '" khớp tùy chọn ở ' . count($hits) . ' nhóm khác nhau của cùng món — không tự đoán.'];
        }
        // (3) Fallback size theo sapo_size_map (giữ nguyên cơ chế cũ)
        $oid = $this->resolveSizeOption($seg, $productId, $ctx);
        if ($oid) {
            $opt = ProductOption::with('group:id,name')->find($oid);
            return ['kind' => 'option', 'option_id' => (int) $oid,
                'group_id' => (int) ($opt->option_group_id ?? 0), 'group_name' => (string) ($opt->group->name ?? '')];
        }
        return ['kind' => 'none'];
    }

    /**
     * Khớp 1 tên món Sapo (thứ tự đã chốt): map ngoại lệ theo tên gốc → map
     * ngoại lệ theo tên đã bóc hậu tố → tự khớp chính xác danh mục ĐANG BÁN.
     * Trả: ['kind' => 'single', 'product_id' =>]
     *   | ['kind' => 'combo', 'product_id' => (chính), 'gift_product_id' =>]
     *   | ['kind' => 'suspect', 'detail' =>]
     */
    private function resolveProduct(string $pname, array $ctx): array
    {
        $stripped = $this->stripSuffix($pname, $ctx);
        foreach (array_unique([$pname, $stripped]) as $key) {
            if (isset($ctx['product_maps'][$key])) {
                $map = $ctx['product_maps'][$key];
                if ($map['gift_product_id']) {
                    return ['kind' => 'combo', 'product_id' => $map['product_id'], 'gift_product_id' => $map['gift_product_id']];
                }
                return ['kind' => 'single', 'product_id' => $map['product_id']];
            }
        }
        // Tầng 1: khớp EXACT tên gốc trước, bóc hậu tố sau (luật đã chốt từ phân
        // tích file thật — có món legacy tên thật chứa " - CH" ở cuối).
        foreach (array_unique([$pname, $stripped]) as $key) {
            $ids = $ctx['active_by_name'][$key] ?? [];
            if (count($ids) === 1) {
                return ['kind' => 'single', 'product_id' => $ids[0]];
            }
            if (count($ids) > 1) {
                return ['kind' => 'suspect',
                    'detail' => 'Tên món "' . $pname . '" trùng hệt ' . count($ids) . ' món đang bán trong danh mục — mập mờ, không tự chọn. Xử lý bằng cách đổi tên phân biệt hoặc thêm 1 dòng map ngoại lệ.'];
            }
        }
        $detail = 'Tên món chưa khớp: "' . $pname . '"';
        if (isset($ctx['inactive_names'][$pname]) || isset($ctx['inactive_names'][$stripped])) {
            $detail .= ' Gợi ý: có món trùng tên đã NGỪNG BÁN — cân nhắc bán lại món đó hoặc thêm dòng map ngoại lệ trỏ sang món thay thế.';
        }
        return ['kind' => 'suspect', 'detail' => $detail];
    }

    /**
     * Bung 1 dòng combo Mua 1 Tặng 1 thành 2 dòng đơn (spec A4 đã chốt):
     * - Món chính mang toàn bộ tiền dòng combo; món tặng giá 0.
     * - Mảnh thuộc nhóm có ở CẢ 2 thành phần (Đường/Đá/Độ ngọt…) → áp cả 2 dòng.
     * - Topping → chỉ món chính (trừ kho theo số lượng combo ở dòng chính).
     * - Size: 2 mảnh gán theo thứ tự cho [chính, tặng]; đúng 1 mảnh → áp cả 2
     *   (giả định Đại Vương đã xác nhận khi chốt); số mảnh khác 0/1/2 → nghi ngờ.
     * - Nhóm chỉ có ở 1 thành phần → áp thành phần đó. Mảnh lạ/mập mờ → nghi ngờ
     *   TOÀN hóa đơn (không tạo nửa đơn).
     * - LƯU VẾT (bổ sung PM 2026-10-30): cả 2 dòng đều ghi note "Combo Sapo:
     *   <tên combo gốc> (món chính/món tặng)" vào cột note sẵn có của dòng đơn
     *   để báo cáo đếm lại được số combo đã bán — không thêm bảng/cột.
     */
    private function buildComboLines(array $resolved, array $segments, array &$ctx, string $comboName, int $qty, float $price, float $lineTotal, float $lineDiscount): array
    {
        $mainId = (int) $resolved['product_id'];
        $giftId = (int) $resolved['gift_product_id'];
        $names = DB::table('products')->whereIn('id', [$mainId, $giftId])->pluck('name', 'id')->all();

        $mainOpts = [];  // option_id => true
        $giftOpts = [];
        $mainNotes = [];
        $giftNotes = [];
        $sizePieces = []; // [['seg' =>, 'main' => match|null, 'gift' => match|null]]

        foreach ($segments as $seg) {
            if (isset($ctx['note_options'][$seg])) {
                $mainNotes[] = $seg;
                $giftNotes[] = $seg;
                continue;
            }
            $mm = $this->matchSegmentForProduct($seg, $mainId, $ctx);
            $mg = $this->matchSegmentForProduct($seg, $giftId, $ctx);
            foreach (['chính' => $mm, 'tặng' => $mg] as $which => $m) {
                if ($m['kind'] === 'ambiguous') {
                    return ['kind' => 'suspect', 'reason' => 'unknown_option',
                        'detail' => $m['detail'] . ' (combo "' . $comboName . '", phía món ' . $which . ')'];
                }
            }
            $mMain = $mm['kind'] === 'option' ? $mm : null;
            $mGift = $mg['kind'] === 'option' ? $mg : null;
            if (!$mMain && !$mGift) {
                return ['kind' => 'suspect', 'reason' => 'unknown_option',
                    'detail' => 'Text lựa chọn chưa khớp: "' . $seg . '" (combo "' . $comboName . '")'];
            }
            $groupName = SapoText::normalize(($mMain ?? $mGift)['group_name'] ?? '');
            $isSize = str_contains($groupName, 'size');
            $isTopping = str_contains($groupName, 'topping');
            if ($isSize) {
                // Mảnh size trong file thật thường chứa tên thành phần ("<Món> -
                // Size <X>"): ghi nhận chủ mảnh theo tên để phân phối đúng kể cả
                // khi thứ tự mảnh bị xáo trộn (mục nghiệm thu A7-8); không chứa
                // tên nào/cả hai → owner = null, quay về luật thứ tự xuất hiện.
                $inMain = isset($names[$mainId]) && $names[$mainId] !== '' && str_contains($seg, $names[$mainId]);
                $inGift = isset($names[$giftId]) && $names[$giftId] !== '' && str_contains($seg, $names[$giftId]);
                $owner = ($inMain xor $inGift) ? ($inMain ? 'main' : 'gift') : null;
                $sizePieces[] = ['seg' => $seg, 'main' => $mMain, 'gift' => $mGift, 'owner' => $owner];
                continue;
            }
            if ($isTopping) {
                if ($mMain) {
                    $mainOpts[(int) $mMain['option_id']] = true;
                }
                continue;
            }
            if ($mMain && $mGift) {
                $mainOpts[(int) $mMain['option_id']] = true;
                $giftOpts[(int) $mGift['option_id']] = true;
            } elseif ($mMain) {
                $mainOpts[(int) $mMain['option_id']] = true;
            } else {
                $giftOpts[(int) $mGift['option_id']] = true;
            }
        }

        // Phân phối mảnh size theo số lượng mảnh (luật đã chốt)
        if (count($sizePieces) === 1) {
            $p = $sizePieces[0];
            if (!$p['main'] || !$p['gift']) {
                return ['kind' => 'suspect', 'reason' => 'unknown_option',
                    'detail' => 'Combo "' . $comboName . '" chỉ có 1 mảnh size "' . $p['seg'] . '" nhưng mảnh này không khớp được cho cả 2 thành phần — không tự đoán.'];
            }
            $mainOpts[(int) $p['main']['option_id']] = true;
            $giftOpts[(int) $p['gift']['option_id']] = true;
        } elseif (count($sizePieces) === 2) {
            // Gán [chính, tặng]: ưu tiên mảnh ghi rõ tên thành phần (owner);
            // 2 mảnh cùng owner hoặc không mảnh nào có owner → thứ tự xuất hiện
            // như spec A4. 1 mảnh có owner → mảnh còn lại về thành phần còn lại.
            [$a, $b] = $sizePieces;
            $pMain = $a;
            $pGift = $b;
            if ($a['owner'] === 'gift' && $b['owner'] !== 'gift') {
                $pMain = $b;
                $pGift = $a;
            } elseif ($a['owner'] === null && $b['owner'] === 'main') {
                $pMain = $b;
                $pGift = $a;
            }
            if (!$pMain['main'] || !$pGift['gift']) {
                return ['kind' => 'suspect', 'reason' => 'unknown_option',
                    'detail' => 'Combo "' . $comboName . '": mảnh size không khớp đúng thành phần (mảnh "' . $pMain['seg'] . '" cho món chính, mảnh "' . $pGift['seg'] . '" cho món tặng) — không tự đoán.'];
            }
            $mainOpts[(int) $pMain['main']['option_id']] = true;
            $giftOpts[(int) $pGift['gift']['option_id']] = true;
        } elseif (count($sizePieces) > 2) {
            return ['kind' => 'suspect', 'reason' => 'unknown_option',
                'detail' => 'Combo "' . $comboName . '" có ' . count($sizePieces) . ' mảnh size — chỉ xử lý được 1 hoặc 2 mảnh cho 2 thành phần.'];
        }

        // Kiểm tra nhóm bắt buộc cho TỪNG thành phần sau phân phối
        foreach ([['chính', $mainId, array_keys($mainOpts)], ['tặng', $giftId, array_keys($giftOpts)]] as [$which, $pid, $oids]) {
            $missing = $this->missingRequiredGroup($pid, $oids, $ctx);
            if ($missing !== null) {
                return ['kind' => 'suspect', 'reason' => 'missing_required_option',
                    'detail' => 'Combo "' . $comboName . '": món ' . $which . ' bắt buộc nhóm "' . $missing . '" nhưng file không có lựa chọn khớp.'];
            }
        }

        $mkNames = function (array $optSet, array $notes): array {
            $ids = array_keys($optSet);
            $n = $ids ? ProductOption::whereIn('id', $ids)->pluck('name')->all() : [];
            return array_merge($n, $notes);
        };
        $mainIds = array_keys($mainOpts);
        $giftIds = array_keys($giftOpts);
        $trace = 'Combo Sapo: ' . $comboName;
        return ['kind' => 'ok', 'lines' => [
            [
                'item' => [
                    'product_id' => $mainId,
                    'product_name' => $names[$mainId] ?? $comboName,
                    'price' => $price,
                    'quantity' => $qty,
                    'subtotal' => $lineTotal,
                    'discount_amount' => $lineDiscount,
                    'option_ids' => $mainIds,
                    'option_names' => $mkNames($mainOpts, $mainNotes),
                    'note' => $trace . ' (món chính)',
                ],
                'deduct' => ['product_id' => $mainId, 'option_ids' => $mainIds, 'quantity' => $qty],
            ],
            [
                'item' => [
                    'product_id' => $giftId,
                    'product_name' => $names[$giftId] ?? $comboName,
                    'price' => 0,
                    'quantity' => $qty,
                    'subtotal' => 0,
                    'discount_amount' => 0,
                    'option_ids' => $giftIds,
                    'option_names' => $mkNames($giftOpts, $giftNotes),
                    'note' => $trace . ' (món tặng)',
                ],
                'deduct' => ['product_id' => $giftId, 'option_ids' => $giftIds, 'quantity' => $qty],
            ],
        ]];
    }

    /**
     * Xử lý 1 hóa đơn.
     * @return array{result: 'created'|'duplicate'|'dbomni'|'cancelled'|'suspect', order_id?: int, reason?: string, detail?: string, resolved_order_id?: int}
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
                // Vá L2-3 (2026-10-28): hủy SAU khi đã import — hóa đơn đã có đơn
                // DBOMNI chưa hủy → vào hàng nghi ngờ chờ xử lý tay, TUYỆT ĐỐI
                // không tự hủy đơn / hoàn kho ở đây. Chưa có đơn, hoặc đơn đã
                // hủy rồi, hoặc nhân viên đã xử lý suspect của hóa đơn này →
                // kết quả cancelled như thường, không sinh suspect mới.
                $existing = Order::where('sapo_invoice_code', $code)
                    ->first(['id', 'code', 'status', 'total_amount', 'created_at']);
                if ($existing && $existing->status !== 'cancelled') {
                    $handled = SapoImportSuspect::where('branch_id', $branchId)
                        ->where('sapo_invoice_code', $code)
                        ->where('reason', 'cancelled_after_import')
                        ->whereIn('status', ['resolved', 'discarded'])
                        ->exists();
                    if (!$handled) {
                        return ['result' => 'suspect', 'reason' => 'cancelled_after_import',
                            'resolved_order_id' => (int) $existing->id,
                            'detail' => 'Hóa đơn Sapo ' . $code . ' đã bị hủy trên Sapo SAU khi import thành đơn DBOMNI '
                                . ($existing->code ?? ('#' . $existing->id))
                                . ' (tổng ' . number_format((float) $existing->total_amount) . 'đ, đơn tạo lúc '
                                . ($existing->created_at ? $existing->created_at->format('d/m/Y H:i') : '—')
                                . '). Hệ thống không tự hủy đơn/không tự hoàn kho — nhân viên đối chiếu rồi xử lý tay trên đơn.'];
                    }
                }
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

        // 7) Khớp món + tùy chọn từng dòng theo 3 tầng (2026-10-30, phương án
        //    đầy đủ đã chốt): bóc hậu tố → map ngoại lệ (thắng tự khớp) → tự
        //    khớp danh mục đang bán; combo Mua 1 Tặng 1 bung 2 dòng. Không
        //    khớp/mập mờ → nghi ngờ, không tự đoán (luật an toàn giữ nguyên).
        $items = [];
        $deductLines = [];
        foreach ($paidRows as $r) {
            $pname = trim(self::strVal($r['product_name'] ?? null));
            $resolved = $this->resolveProduct($pname, $ctx);
            if ($resolved['kind'] === 'suspect') {
                return ['result' => 'suspect', 'reason' => 'unknown_product', 'detail' => $resolved['detail']];
            }
            $segments = [];
            $optText = self::strVal($r['option_text'] ?? null);
            if ($optText !== '') {
                foreach (explode(',', $optText) as $seg) {
                    $seg = trim($seg);
                    if ($seg !== '') {
                        $segments[] = $seg;
                    }
                }
            }
            $qty = max(1, (int) self::num($r['quantity'] ?? 1));
            $price = self::money($r['price'] ?? null);
            $lineTotal = array_key_exists('line_amount', $r) && $r['line_amount'] !== null
                ? self::money($r['line_amount']) : $price * $qty;
            $lineDiscount = self::money($r['discount_line'] ?? null);

            if ($resolved['kind'] === 'combo') {
                $built = $this->buildComboLines($resolved, $segments, $ctx, $pname, $qty, $price, $lineTotal, $lineDiscount);
                if ($built['kind'] === 'suspect') {
                    return ['result' => 'suspect', 'reason' => $built['reason'], 'detail' => $built['detail']];
                }
                foreach ($built['lines'] as $line) {
                    $items[] = $line['item'];
                    $deductLines[] = $line['deduct'];
                }
                continue;
            }

            // Dòng đơn: phân giải từng mảnh trong phạm vi món
            $productId = (int) $resolved['product_id'];
            $optionIds = [];
            $optionNames = [];
            $noteNames = [];
            foreach ($segments as $seg) {
                $m = $this->matchSegmentForProduct($seg, $productId, $ctx);
                if ($m['kind'] === 'option') {
                    $optionIds[] = (int) $m['option_id'];
                    continue;
                }
                if ($m['kind'] === 'ambiguous') {
                    return ['result' => 'suspect', 'reason' => 'unknown_option', 'detail' => $m['detail'] . ' (món "' . $pname . '")'];
                }
                if (isset($ctx['note_options'][$seg])) {
                    $noteNames[] = $seg;
                    continue;
                }
                return ['result' => 'suspect', 'reason' => 'unknown_option',
                    'detail' => 'Text lựa chọn chưa khớp: "' . $seg . '" (món "' . $pname . '")'];
            }
            $optionIds = array_values(array_unique($optionIds));

            // Nhóm tùy chọn BẮT BUỘC mà không mảnh nào khớp thuộc nhóm → nghi ngờ
            // (đoạn ghi chú không tính — chỉ optionIds thật mới đếm)
            $missingGroup = $this->missingRequiredGroup($productId, $optionIds, $ctx);
            if ($missingGroup !== null) {
                return ['result' => 'suspect', 'reason' => 'missing_required_option',
                    'detail' => 'Món "' . $pname . '" bắt buộc nhóm "' . $missingGroup . '" nhưng file không có lựa chọn khớp.'];
            }

            if ($optionIds) {
                $optionNames = ProductOption::whereIn('id', $optionIds)->pluck('name')->all();
            }
            $optionNames = array_merge($optionNames, $noteNames);

            $items[] = [
                'product_id' => $productId,
                'product_name' => $pname,
                'price' => $price,
                'quantity' => $qty,
                'subtotal' => $lineTotal,
                'discount_amount' => $lineDiscount,
                'option_ids' => $optionIds,
                'option_names' => $optionNames,
                'note' => null,
            ];
            $deductLines[] = [
                'product_id' => $productId,
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
                        'note' => $it['note'] ?? null, // dòng combo: vết tên combo gốc (2026-10-30)
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
