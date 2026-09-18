// Inspect source proportions and transparency without altering any runtime art.
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('../tmp/vn-art-audit/sizing');
await mkdir(output, { recursive: true });
const inventory = JSON.parse(await readFile('../tmp/vn-art-audit/current.json', 'utf8'));
const assets = new Map();
for (const row of inventory.rows) for (const line of row.presentations) for (const actor of line.actors) {
    const src = actor.image.split(/[?#]/)[0];
    if (!src || assets.has(src)) continue;
    const file = path.resolve('public', src.slice(1));
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0, transparent = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const alpha = data[(y * info.width + x) * 4 + 3];
        if (alpha < 16) transparent++;
        if (alpha > 32) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    assets.set(src, { src, name: actor.name, width: info.width, height: info.height,
        bounds: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, transparent: transparent / (info.width * info.height),
        scene: { event: row.key.split('/page:')[0], page: row.pageIndex, line: line.lineIndex } });
}
const list = [...assets.values()];
await writeFile(path.join(output, 'assets.json'), JSON.stringify(list, null, 2));
for (let start = 0; start < list.length; start += 24) {
    const tiles = [];
    const slice = list.slice(start, start + 24);
    for (const [i, a] of slice.entries()) {
        const left = (i % 6) * 240, top = Math.floor(i / 6) * 345;
        tiles.push({ input: await sharp(path.resolve('public', a.src.slice(1))).resize(220, 300, { fit: 'contain', background: '#506379' }).png().toBuffer(), left: left + 10, top });
        const label = `${start + i}: ${a.name} ${a.width}x${a.height}`.replace(/[<>&]/g, '');
        tiles.push({ input: Buffer.from(`<svg width="240" height="45"><rect width="240" height="45" fill="#151b25"/><text x="4" y="18" fill="white" font-size="11">${label}</text><text x="4" y="35" fill="white" font-size="10">${path.basename(a.src).slice(0, 40)}</text></svg>`), left, top: top + 300 });
    }
    await sharp({ create: { width: 1440, height: Math.ceil(slice.length / 6) * 345, channels: 3, background: '#151b25' } }).composite(tiles).png().toFile(path.join(output, `portraits-${start}.png`));
}
console.log(JSON.stringify({ count: list.length, wide: list.filter(a => a.width / a.height > .9).map(a => ({ name:a.name, src:a.src, width:a.width, height:a.height })) }, null, 2));
