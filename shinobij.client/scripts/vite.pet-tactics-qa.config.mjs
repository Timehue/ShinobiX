import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { jutsuFxFrames } from './jutsu-fx-frames.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({ root, plugins: [react(), jutsuFxFrames(root)], appType: 'mpa',
    // Scan the actual fixture instead of historical HTML reviews and release snapshots.
    optimizeDeps: { entries: [fileURLToPath(new URL('../pet-tactics-qa.html', import.meta.url))] },
    server: { middlewareMode: true, host: '127.0.0.1', hmr: false },
    build: { outDir: '../output/pet-tactics-qa-dist', emptyOutDir: true, copyPublicDir: false,
        rollupOptions: { input: fileURLToPath(new URL('../pet-tactics-qa.html', import.meta.url)) } },
});
