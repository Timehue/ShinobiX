import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('..', import.meta.url)), plugins: [react()], appType: 'mpa',
    server: { middlewareMode: true, host: '127.0.0.1', hmr: false },
    build: { outDir: '../output/pet-tactics-qa-dist', emptyOutDir: true, copyPublicDir: false,
        rollupOptions: { input: fileURLToPath(new URL('../pet-tactics-qa.html', import.meta.url)) } },
});
