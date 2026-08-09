import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const applicationEntry = fileURLToPath(new URL('./src/main.js', import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: applicationEntry,
      output: {
        entryFileNames: 'taa-platform.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
