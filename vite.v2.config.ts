import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web-v2',
  plugins: [react()],
  cacheDir: process.env.VITE_CACHE_DIR ?? '/tmp/theater-v2-vite',
  server: {
    port: 5173, strictPort: true,
    // Docker Desktop bind mounts do not reliably forward Windows file events.
    watch: { usePolling: true, interval: 500 },
    fs: { allow: ['..'] },
    proxy: { '/api/v2': { target: process.env.API_PROXY_TARGET ?? 'http://api:3000', changeOrigin: true, ws: true } },
  },
  build: { outDir: process.env.WEB_V2_OUT_DIR ?? 'dist', emptyOutDir: true },
});
