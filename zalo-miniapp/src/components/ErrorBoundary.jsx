import React from 'react';

// Lưới đỡ lỗi hiển thị (2026-11-14, vá trắng màn khi back): trước đây
// app KHÔNG có error boundary — bất kỳ lỗi render nào ở một trang cũng
// gỡ trắng toàn bộ cây React, khách chỉ còn cách vuốt tải lại trang.
// Boundary này bắt lỗi render, hiện thẻ khôi phục (tải lại / về trang
// chủ) thay cho màn hình trắng chết. Đặt key theo pathname ở App.jsx
// nên chuyển trang là trạng thái lỗi tự xóa.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // Giữ lại dấu vết cho vòng chẩn đoán sau (console của webview).
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 340, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#24305E' }}>Đã xảy ra lỗi hiển thị</div>
          <div style={{ fontSize: 13.5, color: '#666', marginTop: 8, lineHeight: 1.55 }}>
            Trang vừa gặp sự cố khi hiển thị. Bạn tải lại trang để tiếp tục — đơn hàng và điểm của bạn không bị ảnh hưởng.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, width: '100%', height: 50, border: 0, borderRadius: 12, background: '#24305E', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
          >
            Tải lại trang
          </button>
          <button
            onClick={() => {
              // Về gốc app — tôn trọng basename /zapps/<id> như App.jsx.
              const m = window.location.pathname.match(/^\/zapps\/\d+/);
              window.location.href = (m ? m[0] : '') + '/';
            }}
            style={{ marginTop: 10, width: '100%', height: 48, borderRadius: 12, background: '#fff', color: '#24305E', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', border: '1.5px solid #24305E' }}
          >
            Về trang chủ
          </button>
        </div>
      </div>
    );
  }
}
