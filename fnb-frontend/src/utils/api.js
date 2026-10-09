// Gói 37e: base URL gọi API.
// - Mặc định '/api' (tương đối): lúc dev chạy qua proxy Vite,
//   lúc production cùng host với web server (nginx route /api → Laravel).
// - Nếu API ở host khác frontend: build với biến môi trường, KHÔNG sửa code:
//   VITE_API_BASE=https://api.ten-mien.com/api npm run build
export const API = import.meta.env.VITE_API_BASE || '/api';
