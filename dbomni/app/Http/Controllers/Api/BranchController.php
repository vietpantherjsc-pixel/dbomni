<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use Illuminate\Http\JsonResponse;

// Gói 1 (2026-10-04): Endpoint tra cứu chi nhánh cho các dropdown (POS, nhập kho...).
class BranchController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => Branch::orderBy('name')->get(),
        ]);
    }
}
