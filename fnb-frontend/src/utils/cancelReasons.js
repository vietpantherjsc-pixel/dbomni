// N-2 (360 đợt 2): danh mục nguyên nhân hoàn/hủy dùng chung — 6 mã cố định,
// khớp 1-1 với App\Support\CancelReasonCodes (backend). Không dùng nhóm
// shared-category 'cancel_reasons' (Admin sửa/xóa được → mất ổn định gom báo cáo).
export const CANCEL_REASON_OPTIONS = [
    { code: 'wrong_item', label: 'Sai món' },
    { code: 'out_of_stock_after_payment', label: 'Hết món sau thu tiền' },
    { code: 'too_slow', label: 'Chậm quá lâu' },
    { code: 'payment_error', label: 'Lỗi thanh toán' },
    { code: 'customer_changed_mind', label: 'Khách đổi ý' },
    { code: 'other', label: 'Khác' },
];

export const cancelReasonLabel = (code) =>
    CANCEL_REASON_OPTIONS.find((o) => o.code === code)?.label || 'Chưa phân loại';
