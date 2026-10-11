import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    host: true,
    // API tương đối /api → Laravel (chạy được trên điện thoại thật qua IP LAN)
    proxy: { '/api': { target: 'http://localhost:80', changeOrigin: true } },
  },
});
