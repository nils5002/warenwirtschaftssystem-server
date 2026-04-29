import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const allowedHostsEnv = (process.env.VITE_ALLOWED_HOSTS || '').trim();
const previewAllowedHosts = allowedHostsEnv
  ? allowedHostsEnv.split(',').map((host) => host.trim()).filter(Boolean)
  : true;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
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
