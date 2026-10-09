import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    // Gói 37e: cho phép điện thoại trong cùng WiFi truy cập (quét QR chấm công),
    // proxy /api → Laravel để trang nhân viên gọi API được từ IP LAN.
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:80',
        changeOrigin: true,
      },
    },
  }
})