import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin /api in dev means the service worker sees the same URL shape
    // it will see in production, so offline behaviour is testable locally.
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the rarely-changing vendor code out of the app chunk: the
        // service worker caches by URL, so an app-only edit should not force
        // every offline user to re-download all of MUI.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@mui/x-charts') || id.includes('d3-')) return 'charts';
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui';
          // `scheduler` and `use-sync-external-store` are React internals —
          // leaving them in `vendor` makes vendor and react import each other.
          if (
            /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|use-sync-external-store)\//.test(
              id,
            )
          ) {
            return 'react';
          }
          return 'vendor';
        },
      },
    },
  },
});
