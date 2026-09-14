import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createReadStream, existsSync, statSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));

// Focused source harness: avoid scanning every legacy workbench and game mode
// before measuring the current eight-pet scene. Assets remain the shipped files.
export default defineConfig({
    root,
    plugins: [react(), {
        name: 'warfront-preview-shipped-assets',
        configurePreviewServer(server) {
            server.middlewares.use((req, res, next) => {
                const relative = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
                const path = resolve(root, 'public', relative);
                if (!path.startsWith(resolve(root, 'public') + '/') && !path.startsWith(resolve(root, 'public') + '\\')) return next();
                if (!existsSync(path) || !statSync(path).isFile()) return next();
                const mime = path.endsWith('.webp') ? 'image/webp' : path.endsWith('.png') ? 'image/png' : path.endsWith('.json') ? 'application/json' : path.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream';
                res.setHeader('Content-Type', mime);
                createReadStream(path).pipe(res);
            });
        },
    }],
    optimizeDeps: { entries: ['src/petvfx-rite.tsx'] },
    server: { host: '127.0.0.1', port: 5179, strictPort: true },
    build: { outDir: '.tmp/warfront-qa-dist', copyPublicDir: false, rollupOptions: { input: resolve(root, 'petvfx.html') } },
});
