<?php

namespace App\Services;

use App\Models\Customer;

// Spec KM điều kiện chống mã (2026-10-21) — Phần B: định danh khách cho các endpoint
// quyền lợi (ví coupon, điểm, hạng). KHÔNG tin customer_id trần từ client nữa.
// Audit 2026-10-23 BM-02: BỎ nhánh zalo_id trần — zalo_id là định danh công khai,
// không phải bằng chứng sở hữu; client gửi zalo_id của người khác là xem/tiều được
// điểm + ví của họ.
//
// Spec đăng nhập SĐT + mật khẩu §3 (2026-11-05): thứ tự xác thực mới —
// (1) token phiên (Bearer, bảng customer_sessions) trước; (2) cặp SĐT +
// member_code CHỈ còn là đường chuyển đổi dự phòng, và chỉ hiệu lực khi tài
// khoản thỏa CẢ 3: password_hash đang trống · member_code KHÔNG mang tiền tố
// IMP · cặp khớp. Tài khoản đã đặt mật khẩu hoặc thuộc nhóm IMP: cặp bị từ
// chối ở MỌI endpoint quyền lợi (trả như không xác thực như trước).
class CustomerIdentityService
{
    /**
     * Cặp SĐT + member_code còn được dùng làm chứng thực cho tài khoản này không.
     */
    public static function pairUsable(Customer $customer): bool
    {
        if (!empty($customer->password_hash)) return false;
        if (is_string($customer->member_code) && str_starts_with($customer->member_code, 'IMP')) return false;
        return true;
    }

    /**
     * Tìm khách ĐÃ XÁC THỰC từ thông tin định danh client gửi.
     * Trả null khi không khớp — caller tự quyết định chặn hay cho qua như khách vãng lai.
     * Token phiên (header Authorization: Bearer) được xét TRƯỚC cặp SĐT + mã.
     */
    public static function verifiedCustomer(array $params): ?Customer
    {
        // (1) Token phiên hợp nhất — dùng chung cho cả Zalo lẫn mật khẩu.
        $tokenCustomer = CustomerSessionService::resolveFromToken(request()->bearerToken());
        if ($tokenCustomer) return $tokenCustomer;

        // (2) Cặp SĐT + member_code — chỉ còn là đường chuyển đổi dự phòng.
        $phone = trim((string) ($params['phone'] ?? ''));
        $memberCode = trim((string) ($params['member_code'] ?? ''));
        if ($phone !== '' && $memberCode !== '') {
            $customer = Customer::where('phone', $phone)
                ->where('member_code', $memberCode)
                ->first();
            if ($customer && static::pairUsable($customer)) return $customer;
        }
        return null;
    }

    /**
     * Khách $customer có phải người đã xác thực theo thông tin định danh không
     * (dùng trong store(): khách tra theo SĐT gõ tay, quyền lợi chỉ cấp khi khớp định danh).
     * Token phiên của đúng khách này cũng được chấp nhận.
     */
    public static function matches(Customer $customer, array $params): bool
    {
        // Audit 2026-10-23 BM-02: bỏ nhánh zalo_id trần (cùng lý do verifiedCustomer).
        // Spec mật khẩu §3: phiên token của đúng khách = đã xác thực.
        $tokenCustomer = CustomerSessionService::resolveFromToken(request()->bearerToken());
        if ($tokenCustomer && (int) $tokenCustomer->id === (int) $customer->id) return true;

        $memberCode = trim((string) ($params['member_code'] ?? ''));
        if ($memberCode !== '' && (string) $customer->member_code === $memberCode) {
            return static::pairUsable($customer);
        }
        return false;
    }
}
