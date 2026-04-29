import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/kratos': {
        target: process.env.KRATOS_PUBLIC_URL || 'http://localhost:4433',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/kratos/, ''),
      },
      '/api': {
        target: process.env.JINBE_URL || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = process.env.DEV_KRATOS_SESSION;
            if (token) {
              proxyReq.setHeader('Cookie', `ory_kratos_session=${token}`);
              proxyReq.setHeader('X-Session-Token', token);
            } else {
              proxyReq.setHeader('X-User-Email', process.env.DEV_USER_EMAIL || 'admin@w6d.io');
              proxyReq.setHeader('X-User-Id', process.env.DEV_USER_ID || 'f4a86592-d10d-41df-a700-718282bf5719');
              proxyReq.setHeader('X-User-Name', process.env.DEV_USER_NAME || 'W6D Admin');
            }
          });
        },
      },
    },
  },
})
