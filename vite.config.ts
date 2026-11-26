import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// base: './' — Яндекс Игры отдают сборку из вложенной папки, поэтому все пути относительные.
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
