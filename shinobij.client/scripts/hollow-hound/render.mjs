import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const client = path.resolve(import.meta.dirname, '../..');
process.chdir(client);
const output = path.resolve(client, process.argv[2] ?? '../.ci-evidence/hollow-hound-frames');
await mkdir(output, { recursive: true });
process.env.VITE_SKIP_HTTPS = '1';
const server = await createServer({ root: client, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
try {
    const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage();
        await page.goto(server.resolvedUrls.local[0] + 'scripts/hollow-hound/index.html');
        await page.waitForFunction(() => typeof window.bake === 'function');
        const { data, ...meta } = await page.evaluate(() => window.bake(1, 'idle', 24));
        const png = Buffer.from(data, 'base64');
        const sha = bytes => createHash('sha256').update(bytes).digest('hex');
        const sources = {};
        for (const file of ['pet-models/roster/mythic-4.glb', 'hollow-gate/hollow-hound-idle.webp']) {
            sources[file] = sha(await readFile(path.join(client, 'public', file)));
        }
        await writeFile(path.join(output, 'encounter-idle.png'), png);
        await writeFile(path.join(output, 'encounter-idle.json'), JSON.stringify({ sources, sha256: sha(png), ...meta }));
    } finally { await browser.close(); }
} finally { await server.close(); }
