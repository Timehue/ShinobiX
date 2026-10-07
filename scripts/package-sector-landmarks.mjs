import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
const out = 'output/connected-world';
const sources = JSON.parse(await fs.readFile(out + '/atlas-sources.json', 'utf8'));
const artifacts = {};
for (const [region, entry] of Object.entries(sources)) {
    const meta = await sharp(entry.source).metadata();
    if (!meta.hasAlpha || meta.width !== meta.height) throw new Error('Invalid transparent atlas ' + region);
    const half = Math.floor(meta.width / 2);
    for (const [kind, x, y] of [['shrine', 0, 0], ['stronghold', half, 0], ['rift', 0, half]]) {
        const output = path.resolve(out, `sector-${region}-${kind}.webp`);
        await sharp(entry.source).extract({ left: x, top: y, width: half, height: half })
            .resize(512, 512).webp({ quality: 84, effort: 6 }).toFile(output);
        const bytes = await fs.readFile(output), packaged = await sharp(bytes).metadata();
        if (!packaged.hasAlpha || bytes.length > 192 * 1024) throw new Error('Invalid sprite package ' + region + ':' + kind);
        artifacts[region + ':' + kind] = { ...entry, output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
}
await fs.writeFile(out + '/landmark-provenance.json', JSON.stringify(artifacts, null, 2));
console.log('Packaged ' + Object.keys(artifacts).length + ' transparent regional landmarks. No publication yet.');
