import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({ root, plugins: [react()], cacheDir: 'node_modules/.vite-dojo-qa',
    optimizeDeps: { entries: ['dojo-circuit-qa.html'] },
    server: { host: '127.0.0.1', port: 5185, strictPort: true },
    preview: { host: '127.0.0.1', port: 5185, strictPort: true },
    build: { outDir: '.playwright-dist-dojo-qa', copyPublicDir: false, rollupOptions: { input: resolve(root, 'dojo-circuit-qa.html') } },
});
