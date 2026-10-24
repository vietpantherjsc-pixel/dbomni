<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Shift;
use App\Models\ShiftExpense;
use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ShiftController extends Controller
{
    // Audit 2026-10-23 B-8: NV chỉ thao tác/xem ca thuộc CN phân công.
    protected function denyShiftBranch(Request $request, $branchId): ?\Illuminate\Http\JsonResponse
    {
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && !in_array((int) $branchId, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Chi nhánh không thuộc phạm vi của bạn.'], 403);
        }
        return null;
    }

    // Lấy thông tin ca đang mở hiện tại
    public function currentShift(Request $request)
    {
        $branchId = $request->query('branch_id', 1);
        if ($deny = $this->denyShiftBranch($request, $branchId)) return $deny;
        $shift = Shift::with('expenses')
            ->where('branch_id', $branchId)
            ->where('status', 'open')
            ->latest()
            ->first();

        if (!$shift) {
            return response()->json([
                'success' => true,
                'is_open' => false,
                'data' => null,
            ]);
        }

        // Tự động tính toán doanh số tức thời trong ca
        // Gói 55 p11ac: chỉ tính đơn ĐÃ THU TIỀN (loại đơn held/chưa thanh toán)
        $cashSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
            ->where('payment_status', 'paid')
            ->where('payment_method', 'cash')
            ->sum('total_amount');

        $transferSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
            ->where('payment_status', 'paid')
            ->where('payment_method', 'transfer')
            ->sum('total_amount');

        $cashOut = $shift->expenses()->sum('amount');
        $expectedCash = $shift->opening_cash + $cashSales - $cashOut;

        $shift->update([
            'cash_sales' => $cashSales,
            'transfer_sales' => $transferSales,
            'cash_out' => $cashOut,
            'expected_cash' => $expectedCash,
        ]);

        return response()->json([
            'success' => true,
            'is_open' => true,
            'data' => $shift,
            // Gói 55 p11b: cảnh báo ca treo >24h để POS hiện banner đỏ
            'stale_warning' => $this->staleShiftWarning($shift),
        ]);
    }

    // Mở ca làm việc mới
    public function openShift(Request $request)
    {
        $request->validate([
            'cashier_name' => 'required|string',
            'opening_cash' => 'required|numeric|min:0',
            'branch_id' => 'nullable|integer',
        ]);

        $branchId = $request->branch_id ?? 1;
        if ($deny = $this->denyShiftBranch($request, $branchId)) return $deny;

        // Nếu ca trước chưa đóng thì không cho mở ca mới
        $existing = Shift::where('branch_id', $branchId)->where('status', 'open')->first();
        if ($existing) {
            // Gói 55 p11b: ca treo qua ngày (khác ngày mở) → quản lý/admin được tự động chốt
            // ca cũ rồi mở ca mới; NV thường thì báo phải nhờ quản lý.
            $isStale = $existing->opened_at && $existing->opened_at->toDateString() < now()->toDateString();
            $actor = $request->user();
            $isManager = $actor instanceof \App\Models\User
                || ($actor instanceof \App\Models\Employee && $actor->role && $actor->role->hasPermission('finance.manage'));
            if ($isStale && $isManager) {
                $this->autoCloseStaleShift($existing, $actor);
            } else {
                return response()->json([
                    'success' => false,
                    'message' => $isStale
                        ? 'Còn ca treo từ ngày ' . $existing->opened_at->format('d/m/Y') . ' chưa chốt. Vui lòng nhờ quản lý xử lý.'
                        : 'Hiện tại đã có ca đang mở! Vui lòng chốt ca cũ trước.',
                    'stale_shift_id' => $isStale ? $existing->id : null,
                ], 422);
            }
        }

        $shift = Shift::create([
            'branch_id' => $branchId,
            'cashier_name' => $request->cashier_name,
            // Gói 55 p11ae: lưu danh tính người mở ca để kiểm tra chủ ca sau này
            'opened_by_name' => self::actorDisplayName($request->user()),
            'opened_at' => now(),
            'opening_cash' => $request->opening_cash,
            'expected_cash' => $request->opening_cash,
            'status' => 'open',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Mở ca thành công!',
            'data' => $shift
        ]);
    }

    // Tạo phiếu chi tiền mặt đột xuất trong ca
    public function addExpense(Request $request, $id)
    {
        $request->validate([
            'amount' => 'required|numeric|min:1000',
            'reason' => 'required|string',
        ]);

        $shift = Shift::where('id', $id)->where('status', 'open')->firstOrFail();

        // Gói 55 p11ae: chỉ chủ ca hoặc quản lý (finance.manage) được thêm chi.
        // performed_by ghi NGƯỜI GỌI thực tế, không ghi chủ ca (chống xóa dấu vết).
        if (!self::canManageShift($request->user(), $shift)) {
            return response()->json(['success' => false, 'message' => 'Chỉ chủ ca hoặc quản lý mới được thêm phiếu chi.'], 403);
        }

        $expense = ShiftExpense::create([
            'shift_id' => $shift->id,
            'amount' => $request->amount,
            'reason' => $request->reason,
            'performed_by' => self::actorDisplayName($request->user()),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Ghi nhận phiếu chi thành công',
            'data' => $expense
        ]);
    }

    // Chốt ca / Bàn giao két tiền
    public function closeShift(Request $request, $id)
    {
        $request->validate([
            'closing_cash_actual' => 'required|numeric|min:0',
            'note' => 'nullable|string',
        ]);

        $shift = Shift::with('expenses')->where('id', $id)->where('status', 'open')->firstOrFail();

        // Gói 55 p11ae: chỉ chủ ca hoặc quản lý (finance.manage) được chốt ca.
        if (!self::canManageShift($request->user(), $shift)) {
            return response()->json(['success' => false, 'message' => 'Chỉ chủ ca hoặc quản lý mới được chốt ca.'], 403);
        }

        // Gói 55 p11ac: chỉ tính đơn ĐÃ THU TIỀN (loại đơn held/chưa thanh toán)
        $cashSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
            ->where('payment_status', 'paid')
            ->where('payment_method', 'cash')
            ->sum('total_amount');

        $transferSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
            ->where('payment_status', 'paid')
            ->where('payment_method', 'transfer')
            ->sum('total_amount');

        $cashOut = $shift->expenses()->sum('amount');
        $expectedCash = $shift->opening_cash + $cashSales - $cashOut;
        $actual = $request->closing_cash_actual;
        $difference = $actual - $expectedCash;

        $shift->update([
            'closed_at' => now(),
            'cash_sales' => $cashSales,
            'transfer_sales' => $transferSales,
            'cash_out' => $cashOut,
            'expected_cash' => $expectedCash,
            'closing_cash_actual' => $actual,
            'difference' => $difference,
            'status' => 'closed',
            'note' => $request->note,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Chốt ca thành công!',
            'data' => $shift
        ]);
    }

    // Gói 55 p11b: tự động chốt ca treo qua ngày (quên đóng ca).
    // Tính toán đầy đủ như chốt ca thường, ghi chú rõ ràng để truy vết.
    private function autoCloseStaleShift(Shift $shift, $actor): void
    {
        $cashSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
            ->where('payment_status', 'paid')
            ->where('payment_method', 'cash')
            ->sum('total_amount');
        $transferSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
            ->where('payment_status', 'paid')
            ->where('payment_method', 'transfer')
            ->sum('total_amount');
        $cashOut = $shift->expenses()->sum('amount');
        $expectedCash = $shift->opening_cash + $cashSales - $cashOut;

        $oldNote = trim((string) $shift->note);
        $autoNote = 'Tự động chốt do quên đóng ca (người xử lý: ' . self::actorDisplayName($actor) . ').';
        $shift->update([
            'closed_at' => now(),
            'cash_sales' => $cashSales,
            'transfer_sales' => $transferSales,
            'cash_out' => $cashOut,
            'expected_cash' => $expectedCash,
            'closing_cash_actual' => $expectedCash, // không có số đếm thực tế → lấy số hệ thống
            'difference' => 0,
            'status' => 'closed',
            'note' => $oldNote !== '' ? $oldNote . ' | ' . $autoNote : $autoNote,
        ]);
    }

    // Gói 55 p11b: thông tin ca treo để frontend hiện banner đỏ cảnh báo.
    // Gọi trong currentShift: nếu ca open đã quá 24h thì kèm cảnh báo.
    private function staleShiftWarning(Shift $shift): ?array
    {
        if ($shift->opened_at && $shift->opened_at->lt(now()->subHours(24))) {
            return [
                'shift_id' => $shift->id,
                'opened_at' => $shift->opened_at,
                'hours_open' => (int) $shift->opened_at->diffInHours(now()),
                'message' => 'Ca đang mở đã quá 24h (' . $shift->opened_at->format('d/m/Y H:i') . '). Vui lòng chốt ca!',
            ];
        }
        return null;
    }

    // Gói 55 p11ae: tên hiển thị của người gọi (Employee dùng full_name, User dùng name)
    private static function actorDisplayName($actor): string
    {
        if (!$actor) return '';
        return trim((string) ($actor->full_name ?? $actor->name ?? $actor->username ?? ''));
    }

    // Gói 55 p11ae: chỉ chủ ca (người mở ca) hoặc quản lý (finance.manage) được thêm chi/chốt ca.
    // Ca cũ (chưa có opened_by_name) fallback so với cashier_name để không gãy.
    private static function canManageShift($actor, Shift $shift): bool
    {
        if ($actor instanceof \App\Models\User) return true; // admin bypass, giống CheckPermission
        if ($actor instanceof \App\Models\Employee) {
            $role = $actor->role;
            if ($role && $role->hasPermission('finance.manage')) return true; // quản lý
            $me = self::actorDisplayName($actor);
            if ($me !== '') {
                $opener = trim((string) ($shift->opened_by_name ?: $shift->cashier_name));
                if ($opener !== '' && $me === $opener) return true; // chủ ca
            }
        }
        return false;
    }
}