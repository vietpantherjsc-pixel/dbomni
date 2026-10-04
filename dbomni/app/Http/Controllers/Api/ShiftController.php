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
    // Lấy thông tin ca đang mở hiện tại
    public function currentShift(Request $request)
    {
        $branchId = $request->query('branch_id', 1);
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
        $cashSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
            ->where('payment_method', 'cash')
            ->sum('total_amount');

        $transferSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
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

        // Nếu ca trước chưa đóng thì không cho mở ca mới
        $existing = Shift::where('branch_id', $branchId)->where('status', 'open')->first();
        if ($existing) {
            return response()->json([
                'success' => false,
                'message' => 'Hiện tại đã có ca đang mở! Vui lòng chốt ca cũ trước.'
            ], 422);
        }

        $shift = Shift::create([
            'branch_id' => $branchId,
            'cashier_name' => $request->cashier_name,
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

        $expense = ShiftExpense::create([
            'shift_id' => $shift->id,
            'amount' => $request->amount,
            'reason' => $request->reason,
            'performed_by' => $shift->cashier_name,
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

        $cashSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
            ->where('payment_method', 'cash')
            ->sum('total_amount');

        $transferSales = Order::where('shift_id', $shift->id)
            ->where('status', '!=', 'cancelled')
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
}