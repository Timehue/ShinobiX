import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const client = resolve(import.meta.dirname, '..');
const roots = [resolve(client, 'dist'), resolve(client, '../.tmp/gauntlet-qa-dist'), resolve(client, 'public')];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/api/perf-beacon' || pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    for (const root of roots) {
        const path = resolve(root, `.${pathname}`); if (!path.startsWith(root + sep)) continue;
        try { const bytes = await readFile(path); response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes); return; } catch { /* try the next local root */ }
    }
    response.writeHead(404).end();
}).listen(5214, '127.0.0.1', () => console.log('Local pet mode review: http://127.0.0.1:5214/showdownpreview.html'));
