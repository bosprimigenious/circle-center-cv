import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/circle-center-cv/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Use the extern-wasm build so GitHub Pages serves one ORT wasm from /ort/.
      'onnxruntime-web/wasm': path.resolve(import.meta.dirname, 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'),
    },
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision', 'onnxruntime-web'],
  },
  assetsInclude: ['**/*.wasm', '**/*.task', '**/*.onnx'],
});
