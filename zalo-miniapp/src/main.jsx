import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { hydrateStorage } from './utils/storage';

// Gói vá khởi tạo Mini App (2026-11-07, V1): KHÔNG chặn render chờ
// hydrateStorage() xong nữa — hydrate được tối đa ~2 giây; quá hạn thì
// render luôn để bridge Zalo/native storage treo không giết được app.
// Hydrate về sau vẫn nạp vào cache như thường, các lần đọc storage kế
// tiếp tự thấy dữ liệu. Điểm gắn là 'app' theo tài liệu Zalo (khớp
// index.html + bản local của Đại Vương).
const boot = () => {
    ReactDOM.createRoot(document.getElementById('app')).render(<App />);
};
Promise.race([
    hydrateStorage(),
    new Promise((resolve) => setTimeout(resolve, 2000)),
]).finally(boot);
