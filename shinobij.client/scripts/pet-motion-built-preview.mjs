import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '../dist');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
http.createServer(async (request, response) => {
    try {
        const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
        if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
        const data = await readFile(path);
        response.writeHead(200, {'Content-Type':types[extname(path)] ?? 'application/octet-stream', 'Cache-Control':'no-store'}).end(data);
    } catch { response.writeHead(404).end(); }
}).listen(5200, '127.0.0.1', () => console.log('Local built combat preview: http://127.0.0.1:5200/showdownpreview.html'));
