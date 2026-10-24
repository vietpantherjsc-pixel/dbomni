<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Voucher;
use App\Models\VoucherUsage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

// Spec 5 — UI quản lý voucher (2026-10-21, lệnh Đại Vương qua PM):
// backend CRUD voucher MỚI TOÀN BỘ (trước đây chưa có đường tạo nào).
// Ghi (POST/PUT/DELETE): cùng middleware phân quyền KM (products.manage) ở routes.
// Đọc (GET): mở cho mọi tài khoản đã đăng nhập (như /promotions).
class VoucherController extends Controller
{
    /**
     * GET /vouchers — danh sách.
     * Query: search (mã/tên), status (active/inactive/expired/exhausted), type (fixed/percent),
     * page, per_page (mặc định 20). Kèm badge trạng thái tính ở server.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Voucher::orderByDesc('id');

        if ($request->filled('search')) {
            $s = trim($request->query('search'));
            $query->where(function ($q) use ($s) {
                $q->where('code', 'like', "%{$s}%")->orWhere('name', 'like', "%{$s}%");
            });
        }
        if ($request->filled('type')) {
            $query->where('type', $request->query('type') === 'percent' ? 'percent' : 'fixed');
        }

        $status = $request->query('status');
        $now = now();
        if ($status === 'active') {
            $query->where('is_active', true)
                ->where(function ($q) use ($now) {
                    $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now);
                })
                ->where(function ($q) use ($now) {
                    $q->whereNull('expires_at')->orWhere('expires_at', '>=', $now);
                })
                ->where(function ($q) {
                    $q->whereNull('usage_limit')->orWhereColumn('used_count', '<', 'usage_limit');
                });
        } elseif ($status === 'inactive') {
            $query->where('is_active', false);
        } elseif ($status === 'expired') {
            $query->whereNotNull('expires_at')->where('expires_at', '<', $now);
        } elseif ($status === 'exhausted') {
            $query->whereNotNull('usage_limit')->whereColumn('used_count', '>=', 'usage_limit');
        }

        $paginator = $query->paginate((int) $request->query('per_page', 20));
        $paginator->getCollection()->transform(function ($v) {
            $v->setAttribute('status_badge', $this->statusBadge($v));
            return $v;
        });

        return response()->json(['success' => true, 'data' => $paginator]);
    }

    /**
     * GET /vouchers/{id} — chi tiết 1 voucher.
     */
    public function show(int $id): JsonResponse
    {
        $v = Voucher::findOrFail($id);
        $v->setAttribute('status_badge', $this->statusBadge($v));
        return response()->json(['success' => true, 'data' => $v]);
    }

    /**
     * POST /vouchers — tạo 1 hoặc hàng loạt (quantity 1–500).
     * quantity = 1: dùng code gửi lên (tay) hoặc tự sinh 1 mã.
     * quantity > 1: bỏ qua code tay, tự sinh theo prefix; tạo trong 1 transaction.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validatePayload($request, null);

        $quantity = max(1, min(500, (int) $request->input('quantity', 1)));
        $prefix = trim((string) $request->input('prefix', ''));

        if ($quantity === 1) {
            $data['code'] = !empty($data['code'])
                ? $this->normalizeCode($data['code'])
                : $this->generateCode($prefix);
            $voucher = Voucher::create($data);
            return response()->json(['success' => true, 'data' => $voucher, 'created_count' => 1], 201);
        }

        // Tạo hàng loạt: toàn bộ trong 1 transaction, lỗi giữa chừng → rollback
        $created = DB::transaction(function () use ($data, $quantity, $prefix) {
            $out = [];
            for ($i = 0; $i < $quantity; $i++) {
                $row = $data;
                $row['code'] = $this->generateCode($prefix);
                $out[] = Voucher::create($row);
            }
            return $out;
        });

        return response()->json(['success' => true, 'data' => $created, 'created_count' => count($created)], 201);
    }

    /**
     * PUT /vouchers/{id} — sửa. KHÓA MÃ khi voucher đã có lượt dùng.
     * used_count không nhận từ client (gửi lên thì bỏ qua).
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $voucher = Voucher::findOrFail($id);
        $data = $this->validatePayload($request, $voucher);

        if (array_key_exists('code', $data)) {
            $data['code'] = trim((string) $data['code']);
            if ($data['code'] === '') {
                unset($data['code']); // không cho đặt mã rỗng khi sửa
            } elseif ($voucher->used_count > 0 && $this->normalizeCode($data['code']) !== $voucher->code) {
                return response()->json([
                    'success' => false,
                    'message' => 'Không đổi được mã của voucher đã có lượt sử dụng.',
                ], 422);
            } else {
                $data['code'] = $this->normalizeCode($data['code']);
            }
        }
        unset($data['used_count']); // chỉ đọc, không cho client ghi

        $voucher->update($data);
        return response()->json(['success' => true, 'data' => $voucher->fresh()]);
    }

    /**
     * DELETE /vouchers/{id} — voucher đã có lượt dùng: CHẶN, gợi ý tắt thay thế.
     */
    public function destroy(int $id): JsonResponse
    {
        $voucher = Voucher::findOrFail($id);
        if ($voucher->used_count > 0) {
            return response()->json([
                'success' => false,
                'message' => 'Voucher đã có lượt sử dụng, hãy tắt trạng thái thay vì xóa.',
            ], 422);
        }
        $voucher->delete();
        return response()->json(['success' => true]);
    }

    /**
     * GET /vouchers/{id}/usages — lượt dùng từ voucher_usages:
     * khách (tên + SĐT), mã đơn, thời điểm; mới nhất trước, phân trang.
     */
    public function usages(Request $request, int $id): JsonResponse
    {
        Voucher::findOrFail($id);
        $query = VoucherUsage::with(['customer:id,name,phone', 'order:id,code'])
            ->where('voucher_id', $id)
            ->orderByDesc('used_at');
        $paginator = $query->paginate((int) $request->query('per_page', 20));
        $paginator->getCollection()->transform(function ($u) {
            return [
                'id' => $u->id,
                'customer_name' => $u->customer?->name,
                'customer_phone' => $u->customer?->phone,
                'order_code' => $u->order?->code,
                'used_at' => $u->used_at,
            ];
        });
        return response()->json(['success' => true, 'data' => $paginator]);
    }

    // ================= phụ trợ =================

    private function rules(?Voucher $voucher = null): array
    {
        $codeRule = ['nullable', 'string', 'max:50', 'regex:/^[A-Za-z0-9\-_]+$/'];
        if (!$voucher) {
            $codeRule[] = Rule::unique('vouchers', 'code');
        } else {
            // PUT: validate unique nhưng loại trừ chính nó (mã chỉ đổi khi chưa có lượt dùng)
            $codeRule[] = Rule::unique('vouchers', 'code')->ignore($voucher->id);
        }

        return [
            'name' => 'required|string|max:100',
            'code' => $codeRule,
            'prefix' => 'nullable|string|max:20|regex:/^[A-Za-z0-9\-_]*$/',
            'quantity' => 'nullable|integer|min:1|max:500',
            'type' => 'required|in:fixed,percent',
            'value' => 'required|numeric|gt:0',
            'max_discount_amount' => 'nullable|numeric|min:0',
            'min_order_amount' => 'nullable|numeric|min:0',
            'usage_limit' => 'nullable|integer|min:1',
            'per_customer_limit' => 'nullable|integer|min:1',
            'starts_at' => 'nullable|date',
            'expires_at' => 'nullable|date|after:starts_at',
            'is_active' => 'nullable|boolean',
            // Mô hình cộng dồn 2026-10-21 ~22:45: phía voucher chỉ còn 1 cờ — cộng dồn
            // với KM. (Cờ coupon+coupon đã bỏ hẳn: tối đa tuyệt đối 1 coupon/đơn.)
            'stack_with_promotion' => 'nullable|boolean',
            'used_count' => 'nullable|integer', // không dùng — chặn ở update()
        ];
    }

    private function validatePayload(Request $request, ?Voucher $voucher): array
    {
        $data = $request->validate($this->rules($voucher), [
            'code.regex' => 'Mã voucher chỉ gồm chữ không dấu, số, dấu gạch ngang (-) và gạch dưới (_).',
            'code.unique' => 'Mã voucher này đã tồn tại.',
            'value.gt' => 'Giá trị giảm phải lớn hơn 0.',
            'expires_at.after' => 'Ngày kết thúc phải sau ngày bắt đầu.',
        ]);

        // Ràng buộc theo loại giảm
        if (($data['type'] ?? null) === 'percent' && (float) ($data['value'] ?? 0) > 100) {
            abort(response()->json([
                'success' => false,
                'message' => 'Giá trị phần trăm không được vượt quá 100.',
            ], 422));
        }

        // Các trường không nằm trong validate (prefix/quantity) không cho qua
        return collect($data)->except(['prefix', 'quantity', 'used_count'])->toArray();
    }

    /** Chuẩn hóa mã: IN HOA, cắt khoảng trắng. */
    private function normalizeCode(string $code): string
    {
        return strtoupper(trim($code));
    }

    /**
     * Sinh mã 8 ký tự (A–Z, 0–9, bỏ ký tự dễ nhầm 0/O/1/I), gắn prefix nếu có.
     * Kiểm tra unique, trùng thì sinh lại (tối đa 10 lần/mã).
     */
    private function generateCode(string $prefix): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $n = strlen($alphabet);
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $body = '';
            for ($i = 0; $i < 8; $i++) {
                $body .= $alphabet[random_int(0, $n - 1)];
            }
            $code = $prefix !== '' ? $prefix . $body : $body;
            if (!Voucher::where('code', $code)->exists()) {
                return $code;
            }
        }
        abort(response()->json([
            'success' => false,
            'message' => 'Không sinh được mã duy nhất sau nhiều lần thử. Vui lòng thử lại.',
        ], 422));
    }

    /**
     * Badge trạng thái tính ở server cho danh sách:
     * active (Đang chạy) | inactive (Đã tắt) | upcoming (Chưa bắt đầu) |
     * expiring (Sắp hết hạn ≤3 ngày) | expired (Hết hạn) | exhausted (Hết lượt).
     */
    private function statusBadge(Voucher $v): string
    {
        if (!$v->is_active) {
            return 'inactive';
        }
        if ($v->usage_limit !== null && $v->used_count >= $v->usage_limit) {
            return 'exhausted';
        }
        $now = now();
        if ($v->expires_at && $v->expires_at->lt($now)) {
            return 'expired';
        }
        if ($v->starts_at && $v->starts_at->gt($now)) {
            return 'upcoming';
        }
        if ($v->expires_at && $v->expires_at->diffInHours($now) <= 72) {
            return 'expiring';
        }
        return 'active';
    }
}
