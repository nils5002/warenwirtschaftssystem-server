import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const allowedHostsEnv = (process.env.VITE_ALLOWED_HOSTS || '').trim();
const previewAllowedHosts = allowedHostsEnv
  ? allowedHostsEnv.split(',').map((host) => host.trim()).filter(Boolean)
  : true;
// Proxy-Ziel (auch fuer vite preview): VITE_PROXY_TARGET (Docker-Build, externes Task Studio, manuell)
// vor VITE_DEV_API_TARGET (npm run dev:frontend -> :8010).
const devProxyTarget = process.env.VITE_PROXY_TARGET || process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/media': {
        target: devProxyTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: previewAllowedHosts,
  },
});
