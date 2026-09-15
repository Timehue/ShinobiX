import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({ root, plugins: [react()], build: {
    outDir: '../.tmp/sunscar-modes-qa-dist', copyPublicDir: false,
    rollupOptions: { input: resolve(root, 'sunscar-modes-qa.html') },
} });
