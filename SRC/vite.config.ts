import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: '../pkg',
    emptyOutDir: true,
    // Vendor chunk includes AG Grid (~530KB) which is inherently large.
    // App code is 195KB. Split enables aggressive caching of vendor bundle.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // All node_modules into one vendor chunk for stable caching.
          // App code (preact/) changes often; vendor changes rarely.
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
  },
});
