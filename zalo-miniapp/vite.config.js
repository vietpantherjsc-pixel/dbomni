import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    polyfillModulePreload: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].module.js',
        chunkFileNames: 'assets/[name].[hash].module.js',
      },
    },
  },
  server: {
    port: 3001,
    host: true,
    // API tương đối /api → Laravel (chạy được trên điện thoại thật qua IP LAN)
    proxy: { '/api': { target: 'http://localhost:80', changeOrigin: true } },
  },
});
