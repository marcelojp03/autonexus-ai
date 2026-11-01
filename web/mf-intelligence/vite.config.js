import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Integrated build is served by the Shell from /mfs/intelligence/ (CU23).
export default defineConfig(({ mode }) => ({
  base: mode === 'integrated' ? '/mfs/intelligence/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' || mode === 'integrated' ? 'production' : 'development'),
  },
  server: { host: '127.0.0.1', port: 4205, strictPort: true },
  preview: { host: '127.0.0.1', port: 4205, strictPort: true },
  build: {
    outDir: mode === 'integrated' ? 'dist/integrated' : 'dist/standalone',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: mode === 'integrated'
      ? {
          // The public lifecycle exports must survive entry tree shaking.
          preserveEntrySignatures: 'strict',
          input: fileURLToPath(new URL('./src/spa.jsx', import.meta.url)),
          output: { entryFileNames: 'main.js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
        }
      : {},
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: false,
  },
}));
