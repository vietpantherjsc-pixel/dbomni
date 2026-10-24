// Gói 37e: base URL gọi API.
// - Mặc định '/api' (tương đối): lúc dev chạy qua proxy Vite,
//   lúc production cùng host với web server (nginx route /api → Laravel).
// - Nếu API ở host khác frontend: build với biến môi trường, KHÔNG sửa code:
//   VITE_API_BASE=https://api.ten-mien.com/api npm run build
import axios from 'axios';

export const API = import.meta.env.VITE_API_BASE || '/api';

// Audit toàn diện 2026-10-21 🟠6 — SỬA GỐC họ lỗi "Unauthenticated.":
// Trước đây token được gắn vào axios.defaults bằng useEffect của AuthProvider;
// React chạy effect của component con TRƯỚC provider khi mount (F5/deep-link)
// → request đầu tiên có thể bay đi khi chưa có header → 401 oan.
// Nay dùng REQUEST INTERCEPTOR trên axios mặc định: token được đọc từ
// localStorage NGAY TẠI THỜI ĐIỂM request chạy — không phụ thuộc thứ tự mount,
// phủ mọi file dùng axios (Admin/POS/KDS). Chỉ gắn khi request chưa tự mang
// header Authorization (tôn trọng các luồng gắn tường minh như token nhân viên).
// Module này được main.jsx nạp đầu tiên nên interceptor luôn đăng ký trước render.
if (!axios.__authInterceptorInstalled) {
    axios.__authInterceptorInstalled = true;
    axios.interceptors.request.use((config) => {
        const hasAuth = !!(config.headers && (config.headers.Authorization || config.headers.authorization));
        if (!hasAuth) {
            try {
                const t = localStorage.getItem('access_token');
                if (t) {
                    config.headers = config.headers || {};
                    config.headers.Authorization = `Bearer ${t}`;
                }
            } catch { /* localStorage không khả dụng — bỏ qua */ }
        }
        return config;
    });
}
