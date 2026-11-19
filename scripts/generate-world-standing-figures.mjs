/** Run with node --import tsx scripts/generate-world-standing-figures.mjs <staged-models> [output-dir]. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';

const client = new URL('../shinobij.client/', import.meta.url);
const pins = new URL('src/data/sector-models/', client);
const staged = process.argv[2];
if (!staged) throw Error('Supply the directory containing the staged sector model packages.');
const output = resolve(process.argv[3] ?? fileURLToPath(new URL('public/world-figures/v1/', client)));

// Use the map's decoder so the standing figure has the same colours and alpha as its first motion frame.
globalThis.fetch = async url => new Response(await readFile(new URL(url)), { headers: { 'Content-Type': 'application/wasm' } });
let decodedPage;
globalThis.self = { location: { origin: '' }, postMessage(page) { decodedPage = page; } };
await import('../shinobij.client/src/lib/sector-pose.worker.ts');

async function readObject(directory, name) {
    if (!/^[a-f0-9]{64}\.(?:json|gz|264|webp)$/.test(name)) throw Error('Invalid sector model object name');
    const bytes = await readFile(join(directory, name));
    if (createHash('sha256').update(bytes).digest('hex') !== name.split('.')[0]) throw Error(`Invalid checksum for ${name}`);
    return bytes;
}

async function standingFrame(directory, model) {
    if (model.format !== 'sector-motion-v2') {
        const idle = model.banks[0].idle;
        const [width, height] = idle.cell;
        return sharp(await readObject(directory, basename(idle.url))).extract({ left: 0, top: 0, width, height });
    }
    const bank = JSON.parse(gunzipSync(await readObject(directory, model.styles.A[0])));
    const idle = bank.clips.idle;
    const page = bank.pages[idle.file];
    const bytes = await readObject(directory, page.file);
    await self.onmessage({ data: { ...page, bytes } });
    if (decodedPage.error) throw Error(decodedPage.error);

    const [width, height] = page.cell;
    const cell = idle.firstCell ?? 0;
    return sharp(Buffer.from(decodedPage.pixels), { raw: { width: decodedPage.width, height: decodedPage.height, channels: 4 } })
        .extract({ left: (cell % page.cols) * width, top: Math.floor(cell / page.cols) * height, width, height });
}

await mkdir(output, { recursive: true });
for (const file of (await readdir(pins)).filter(name => name.endsWith('.json'))) {
    const kind = basename(file, '.json');
    const directory = join(staged, kind);
    const pin = JSON.parse(await readFile(new URL(file, pins)));
    const model = JSON.parse(await readObject(directory, pin.manifestSha256 + '.json'));
    const frame = await standingFrame(directory, model);
    // Isolate the cell before trimming, then normalize the transparent pixels before compression.
    const cell = await frame.png().toBuffer();
    const trimmed = await sharp(cell).trim({ background: '#00000000', threshold: 6 }).webp({ lossless: true }).toBuffer();
    await sharp(trimmed).webp({ quality: 88, effort: 6 }).toFile(join(output, kind + '.webp'));
}
