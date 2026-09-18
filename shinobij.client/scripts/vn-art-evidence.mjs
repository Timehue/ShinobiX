// Build a traceable index of real renderer captures, never synthetic mockups.
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root = path.resolve('../tmp/vn-art-audit');
const manifest = JSON.parse(await readFile('../docs/art-audit/production.json', 'utf8'));
const reports = [];
for (const folder of await readdir(root, { withFileTypes: true })) {
    if (!folder.isDirectory() || folder.name === 'before' || folder.name === 'baseline') continue;
    const filename = path.join(root, folder.name, 'report.json');
    try {
        const rows = JSON.parse(await readFile(filename, 'utf8'));
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
            const file = path.join(root, folder.name, row.name + '.png');
            const info = await stat(file);
            const assets = [...(row.images ?? []).map(i => i.src), ...(row.background?.match(/https?:[^"')]+/g) ?? [])].map(url => new URL(url, 'http://localhost').pathname);
            reports.push({ ...row, assets, capture: path.relative(path.resolve('..'), file).replaceAll('\\', '/'), modified: info.mtimeMs });
        }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
reports.sort((a, b) => b.modified - a.modified);
const assets = manifest.assets.map(asset => {
    const matches = reports.filter(r => r.assets.includes(asset.asset));
    return { key: asset.key, asset: asset.asset, desktop: matches.find(r => r.name.endsWith('-1440'))?.capture, phone: matches.find(r => r.name.endsWith('-390'))?.capture, runtimeErrors: matches.flatMap(r => r.errors), generated: true, integrated: true, captures: matches.map(r => r.capture) };
});
await writeFile(path.join(root, 'runtime-evidence.json'), JSON.stringify({ assets, captureCount: reports.length }, null, 2));
await mkdir(path.join(root, 'final-runtime-review'), { recursive: true });
for (let at = 0; at < assets.length; at += 6) {
    const group = assets.slice(at, at + 6);
    const tiles = [];
    for (const [index, asset] of group.entries()) {
        if (!asset.desktop) throw new Error(`No desktop capture for ${asset.key}`);
        const buffer = await sharp(path.resolve('..', asset.desktop)).resize(600, 375, { fit: 'contain' }).png().toBuffer();
        const top = Math.floor(index / 2) * 401, left = index % 2 * 600;
        tiles.push({ input: buffer, top, left });
        tiles.push({ input: Buffer.from(`<svg width="600" height="26"><rect width="600" height="26" fill="#111"/><text x="8" y="18" fill="white" font-size="15">${at + index + 1}. ${asset.key}</text></svg>`), left, top: top + 375 });
    }
    await sharp({ create: { width: 1200, height: Math.ceil(group.length / 2) * 401, channels: 3, background: '#111' } }).composite(tiles).png().toFile(path.join(root, 'final-runtime-review', `${at}.png`));
}
console.log({ produced: assets.length, captures: reports.length, missingDesktop: assets.filter(a => !a.desktop).map(a => a.key), missingPhone: assets.filter(a => !a.phone).map(a => a.key), errors: assets.flatMap(a => a.runtimeErrors).length });
