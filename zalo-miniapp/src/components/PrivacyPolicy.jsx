import React from 'react';

// Spec P4-P5 (khắc phục kiểm duyệt Zalo): popup "Chính sách — Điều khoản Mini App Daybreak Đặt món".
// KHÔNG link ngoài. Đủ 5 nội dung: đơn vị chủ quản, dữ liệu thu thập, mục đích,
// thời gian lưu trữ, cách rút lại đồng ý + liên hệ.
export default function PrivacyPolicy({ open, onClose }) {
    if (!open) return null;
    return (
        <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{ background: '#fff', borderRadius: '16px 16px 0 0', maxHeight: '85vh', width: '100%', maxWidth: 560, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
                <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: '#24305E' }}>Chính sách — Điều khoản Mini App Daybreak Đặt món</div>
                    <button onClick={onClose} style={{ border: 'none', background: '#f3f4f6', borderRadius: 20, width: 32, height: 32, fontSize: 16, cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ padding: '16px 20px 28px', overflowY: 'auto', fontSize: 13.5, lineHeight: 1.65, color: '#333' }}>
                    <h4 style={{ margin: '0 0 6px', color: '#24305E' }}>1. Đơn vị chủ quản</h4>
                    <p style={{ margin: '0 0 12px' }}>Daybreak Tea &amp; Coffee — hệ thống cửa hàng trà &amp; cà phê. Mọi thông tin liên hệ hiển thị tại trang chủ ứng dụng theo từng chi nhánh.</p>

                    <h4 style={{ margin: '0 0 6px', color: '#24305E' }}>2. Dữ liệu chúng tôi thu thập</h4>
                    <p style={{ margin: '0 0 12px' }}>Khi bạn sử dụng ứng dụng, chúng tôi có thể thu thập: số điện thoại, tên, địa chỉ giao hàng, vị trí hiện tại (chỉ khi bạn cho phép, để tính phí giao hàng), lịch sử đơn hàng, điểm tích lũy và thông tin thiết bị cơ bản.</p>

                    <h4 style={{ margin: '0 0 6px', color: '#24305E' }}>3. Mục đích sử dụng</h4>
                    <p style={{ margin: '0 0 12px' }}>Dữ liệu được dùng để: xử lý đơn đặt món, giao hàng, quản lý tài khoản thành viên, tích điểm &amp; đổi ưu đãi, gửi thông báo về đơn hàng và chương trình khuyến mại (nếu bạn đồng ý).</p>

                    <h4 style={{ margin: '0 0 6px', color: '#24305E' }}>4. Thời gian lưu trữ</h4>
                    <p style={{ margin: '0 0 12px' }}>Dữ liệu được lưu trữ trong suốt thời gian bạn sử dụng dịch vụ và tối đa 24 tháng sau lần tương tác cuối cùng, trừ khi pháp luật yêu cầu lưu lâu hơn (ví dụ dữ liệu hóa đơn).</p>

                    <h4 style={{ margin: '0 0 6px', color: '#24305E' }}>5. Rút lại đồng ý &amp; liên hệ</h4>
                    <p style={{ margin: '0 0 12px' }}>Bạn có thể rút lại sự đồng ý xử lý dữ liệu bất cứ lúc nào bằng cách liên hệ trực tiếp cửa hàng qua số điện thoại hiển thị tại trang chủ, hoặc yêu cầu xóa tài khoản thành viên. Việc rút lại đồng ý không ảnh hưởng đến tính hợp pháp của việc xử lý trước đó. Bạn vẫn có thể xem thực đơn và đặt món mà không cần đăng nhập thành viên.</p>

                    <p style={{ margin: '12px 0 0', fontSize: 12, color: '#888' }}>Cập nhật lần cuối: tháng 10/2026. Daybreak có thể cập nhật chính sách này; phiên bản mới nhất luôn hiển thị tại đây.</p>
                </div>
            </div>
        </div>
    );
}
