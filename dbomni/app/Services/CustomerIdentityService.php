<?php

namespace App\Services;

use App\Models\Customer;

// Spec KM điều kiện chống mã (2026-10-21) — Phần B: định danh khách cho các endpoint
// quyền lợi (ví coupon, điểm, hạng). KHÔNG tin customer_id trần từ client nữa.
// Audit 2026-10-23 BM-02: BỎ nhánh zalo_id trần — zalo_id là định danh công khai,
// không phải bằng chứng sở hữu; client gửi zalo_id của người khác là xem/tiều được
// điểm + ví của họ. Nay khách CHỈ được coi là ĐÃ XÁC THỰC khi khớp cặp
// SĐT + mã thành viên (cùng cơ chế endpoint tra khách /customer). Liên kết Zalo
// vẫn có giá trị ở /zalo/auth (đã xác thực phone_token phía server — BM-01) để
// TRẢ member_code cho đúng chủ; các endpoint quyền lợi luôn đòi member_code.
class CustomerIdentityService
{
    /**
     * Tìm khách ĐÃ XÁC THỰC từ thông tin định danh client gửi.
     * Trả null khi không khớp — caller tự quyết định chặn hay cho qua như khách vãng lai.
     */
    public static function verifiedCustomer(array $params): ?Customer
    {
        $phone = trim((string) ($params['phone'] ?? ''));
        $memberCode = trim((string) ($params['member_code'] ?? ''));
        if ($phone !== '' && $memberCode !== '') {
            return Customer::where('phone', $phone)
                ->where('member_code', $memberCode)
                ->first();
        }
        return null;
    }

    /**
     * Khách $customer có phải người đã xác thực theo thông tin định danh không
     * (dùng trong store(): khách tra theo SĐT gõ tay, quyền lợi chỉ cấp khi khớp định danh).
     */
    public static function matches(Customer $customer, array $params): bool
    {
        // Audit 2026-10-23 BM-02: bỏ nhánh zalo_id trần (cùng lý do verifiedCustomer).
        $memberCode = trim((string) ($params['member_code'] ?? ''));
        if ($memberCode !== '' && (string) $customer->member_code === $memberCode) {
            return true;
        }
        return false;
    }
}
