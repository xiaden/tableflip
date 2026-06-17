import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: '../pkg',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
  },
});
