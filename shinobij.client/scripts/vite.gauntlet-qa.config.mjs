import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({ root, plugins: [react()], build: {
    outDir: '../.tmp/gauntlet-qa-dist', copyPublicDir: false,
    rollupOptions: { input: resolve(root, 'gauntlet-qa.html') },
} });
