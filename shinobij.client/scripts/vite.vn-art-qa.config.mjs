import { mergeConfig } from 'vite';
import { readFileSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import base from './vite.world-map-qa.config.mjs';

const audit = JSON.parse(readFileSync(new URL('../../docs/art-audit/live-art-recheck.json', import.meta.url), 'utf8'));
const hashes = new Map(audit.rows.filter(row => row.fixture).map(row => [row.id, row.sha256]));

// Serve archived public exports from the test server, allowing normal browser
// asset caching during the exhaustive sweep. No production API requests/writes.
export default mergeConfig(base, { plugins: [{
    name: 'vn-reviewed-art-fixtures',
    configureServer(server) {
        server.middlewares.use('/api/img', (req, res) => {
            const id = new URL(req.url, 'http://fixture.local').searchParams.get('id');
            const hash = hashes.get(id);
            if (!hash) { res.statusCode = 404; res.end(); return; }
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            createReadStream(fileURLToPath(new URL(`../e2e/fixtures/vn-identity-audit/${hash}.webp`, import.meta.url))).pipe(res);
        });
    },
}] });
