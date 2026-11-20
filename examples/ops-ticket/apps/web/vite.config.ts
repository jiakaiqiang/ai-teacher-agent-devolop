import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 端口被占用时直接报错，而不是悄悄换端口，避免“页面开着旧端口”的困惑
    strictPort: true,
    proxy: {
      // 浏览器请求 /api/* 时，由 Vite 开发服务器转发给后端，页面和接口同源，不需要 CORS
      '/api': 'http://localhost:3000',
    },
  },
})
