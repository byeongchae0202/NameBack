import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@fluentui/') || id.includes('/node_modules/@griffel/')) {
            return 'fluentui-vendor';
          }
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    allowedHosts: true,
    strictPort: false,
    port: 5173,
  },
});