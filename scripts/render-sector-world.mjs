import fs from 'node:fs/promises';
import sharp from 'sharp';
import { shrineForSector } from '../shared/shrines.ts';
const out = 'output/connected-world';
const layouts = JSON.parse(await fs.readFile(out + '/layouts.json', 'utf8'));
const landmarks = JSON.parse(await fs.readFile(out + '/landmark-provenance.json', 'utf8'));
const ids = process.argv.slice(2).map(Number);
const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const results = [];
for (const layout of Object.values(layouts).filter(l => !ids.length || ids.includes(l.sector))) {
    const floor = out + '/s' + layout.artKey + '-candidate.webp';
    try { await fs.access(floor); } catch { continue; }
    const layers = [], labels = [];
    const region = layout.biome === 'volcano' ? 'lavafront' : layout.region;
    for (const [kind, site] of Object.entries(layout.sites)) {
        if (kind === 'rift') continue; // Quest-only overlay, absent from an ordinary sector.
        const size = Math.round(site.width / 100 * 1024);
        const art = kind === 'cairn' ? 'shinobij.client/public/landmarks/signal-cairn-v1.webp' : landmarks[region + ':' + kind].output;
        if (!layout.bakedLandmarks) layers.push({ input: await sharp(art).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(),
            left: Math.round(site.left / 100 * 1024 - size / 2), top: Math.round(site.top / 100 * 1024 - size) });
        labels.push({ x: site.left / 100 * 1024, y: site.top / 100 * 1024 + 3, text: ({ stronghold: 'Stronghold', shrine: shrineForSector(layout.sector)?.name ?? 'Shrine', cairn: 'Signal Cairn' })[kind] });
    }
    if (layout.village) labels.push({ x: 512, y: 338, text: layout.village.name }, { x: 555, y: 701, text: 'Enter village' });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">' + labels.map(l => {
        const width = l.text.length * 7.1 + 16;
        return `<rect x="${l.x - width / 2}" y="${l.y}" width="${width}" height="22" rx="5" fill="#141d20" fill-opacity=".82"/><text x="${l.x}" y="${l.y + 15}" font-size="13" font-family="Arial" text-anchor="middle" fill="#eee6cc">${escape(l.text)}</text>`;
    }).join('') + '</svg>';
    layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
    const preview = out + '/sector-' + layout.sector + '-preview.png';
    await sharp(floor).composite(layers).png().toFile(preview);
    const actualLandmarks = Object.keys(layout.sites).filter(kind => kind !== 'rift');
    results.push({ sector: layout.sector, name: layout.name, preview,
        description: layout.village ? `${layout.village.name} occupies the sector center. Roads meet its entrance and adjoining sectors.`
            : actualLandmarks.length ? `Actual landmarks: ${actualLandmarks.join(', ')}. Each approach meets its destination.`
                : 'Natural terrain without permanent landmarks. The roads continue through the actual adjoining sector exits.' });
}
await fs.writeFile(out + '/preview.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected sector world</title><style>body{margin:0;background:#11181d;color:#e9e4d4;font:14px system-ui}main{max-width:1500px;margin:auto;padding:24px}h1{font-size:24px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}a{color:#b9d8c7}section{margin:0 auto 32px;max-width:900px}h2{font-size:17px}img{display:block;width:100%;height:auto;border-radius:8px}p{color:#b5beb9}</style><main><h1>Connected sector world — artwork review</h1><p>Biome-specific terrain, clear landmark approaches, small labels and coherent water bodies. Preview artwork; gameplay validation is tracked separately.</p><nav>${results.map(r => `<a href="#sector-${r.sector}">${r.sector} · ${escape(r.name)}</a>`).join('')}</nav>${results.map(r => `<section id="sector-${r.sector}"><h2>${r.sector} · ${escape(r.name)}</h2><img src="sector-${r.sector}-preview.png" alt="${escape(r.name)} with landmarks"><p>${escape(r.description)}</p></section>`).join('')}</main></html>`);
console.log('Rendered ' + results.length + ' candidate maps with exact landmark coordinates.');
