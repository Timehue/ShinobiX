/** Run with node --import tsx scripts/generate-world-standing-figures.mjs <staged-models> [output-dir] [--with-cinderhold] [--check]. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';

const client = new URL('../shinobij.client/', import.meta.url);
const pins = new URL('src/data/sector-models/', client);
const args = process.argv.slice(2);
const check = args.includes('--check');
const withCinderhold = args.includes('--with-cinderhold');
const [staged, destination] = args.filter(arg => arg !== '--check' && arg !== '--with-cinderhold');
if (!staged) throw Error('Supply the directory containing the staged sector model packages.');
const output = resolve(destination ?? fileURLToPath(new URL('public/world-figures/v1/', client)));
const strides = destination ? join(output, 'strides') : fileURLToPath(new URL('art/sector-model-strides/', client));

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

// A browser-native stride is available while the full directional animation streams.
// Position each sampled frame at the same ground origin used by the model renderer.
async function strideSheet(directory, model, id) {
    const width = 96, height = 104, phases = 8;
    const sheetWidth = width * phases, sheetHeight = height * 16;
    const sheet = Buffer.alloc(sheetWidth * sheetHeight * 4);
    for (const [facing, file] of model.styles.A.entries()) {
        const bank = JSON.parse(gunzipSync(await readObject(directory, file)));
        for (const [gaitIndex, gait] of ['walk', 'run'].entries()) {
            const clip = bank.clips[gait], page = bank.pages[clip.file];
            await self.onmessage({ data: { ...page, bytes: await readObject(directory, page.file) } });
            if (decodedPage.error) throw Error(decodedPage.error);
            const source = Buffer.from(decodedPage.pixels);
            const [w, h] = page.cell;
            for (let phase = 0; phase < phases; phase++) {
                const frame = Math.floor(phase * clip.count / phases), cell = (clip.firstCell ?? 0) + frame;
                const [ox, oy] = clip.origins[frame];
                const left = Math.round(48 + ox), top = Math.round(80 + oy);
                if (left < 0 || top < 0 || left + w > width || top + h > height) throw Error('Stride outside frame: ' + id);
                const destX = phase * width + left, destY = (facing * 2 + gaitIndex) * height + top;
                for (let row = 0; row < h; row++) {
                    const start = ((Math.floor(cell / page.cols) * h + row) * decodedPage.width + cell % page.cols * w) * 4;
                    source.copy(sheet, ((destY + row) * sheetWidth + destX) * 4, start, start + w * 4);
                }
            }
        }
    }
    const bytes = await sharp(sheet, { raw: { width: sheetWidth, height: sheetHeight, channels: 4 } })
        .webp({ quality: 88, effort: 4 }).toBuffer();
    const path = join(strides, id + '.webp');
    if (check) {
        const shipped = await readFile(path);
        const actual = await sharp(shipped).raw().toBuffer();
        if (!actual.equals(await sharp(bytes).raw().toBuffer())) throw Error('Incorrect resident stride: ' + id);
        return createHash('sha256').update(shipped).digest('hex').slice(0, 20);
    }
    await writeFile(path, bytes);
    return createHash('sha256').update(bytes).digest('hex').slice(0, 20);
}

if (!check) await mkdir(output, { recursive: true });
async function generate(kind, directory, version) {
    const model = JSON.parse(await readObject(directory, version + '.json'));
    const frame = await standingFrame(directory, model);
    // Isolate the cell before trimming, then normalize the transparent pixels before compression.
    const cell = await frame.png().toBuffer();
    const trimmed = await sharp(cell).trim({ background: '#00000000', threshold: 6 }).webp({ lossless: true }).toBuffer();
    const figure = await sharp(trimmed).webp({ quality: 88, effort: 6 }).toBuffer();
    const figurePath = join(output, kind + '.webp');
    if (check) {
        const shipped = await readFile(figurePath);
        if (shipped.equals(figure)) return;
        const pixels = bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const [actual, expected] = await Promise.all([pixels(shipped), pixels(figure)]);
        if (actual.info.width !== expected.info.width || actual.info.height !== expected.info.height ||
            !actual.data.equals(expected.data)) throw Error(`Standing figure differs from the pinned idle pose: ${kind}`);
    } else {
        await writeFile(figurePath, figure);
    }
}

for (const file of (await readdir(pins)).filter(name => name.endsWith('.json'))) {
    const kind = basename(file, '.json');
    const pin = JSON.parse(await readFile(new URL(file, pins)));
    await generate(kind, join(staged, kind), pin.manifestSha256);
}
if (withCinderhold) {
    const residents = JSON.parse(await readFile(new URL('../shared/cinderhold-world-models.json', client)));
    const versions = {};
    if (!check) await mkdir(strides, { recursive: true });
    for (const { id, assetId, version } of residents) {
        const directory = join(staged, 'players', assetId);
        await generate('cinderhold-' + id, directory, version);
        versions[id] = await strideSheet(directory, JSON.parse(await readObject(directory, version + '.json')), id);
    }
    if (!destination) {
        const index = new URL('src/data/cinderhold-standing-ids.json', client);
        const ids = JSON.stringify(versions, Object.keys(versions).sort()) + '\n';
        if (check) {
            if ((await readFile(index, 'utf8')).trimEnd() !== ids.trimEnd()) throw Error('Stale Cinderhold standing figure index');
        } else {
            await writeFile(index, ids);
        }
    }
}
