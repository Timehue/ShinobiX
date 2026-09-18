import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { artAuditCatalog } from '../src/features/cinematic-vn/art-audit-catalog';
import { resolveVnPresentation } from '../src/lib/vn-presentation';
import { defaultVnScene } from '../src/lib/vn';

const out = path.resolve('../tmp/vn-art-recheck');
await mkdir(path.join(out, 'assets'), { recursive: true });
const response = await fetch('https://shinobijourney.com/api/images?cat=event&ids=1&ver=1');
if (!response.ok) throw new Error(`Manifest: ${response.status}`);
const manifest = await response.json();
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
const catalog = await artAuditCatalog();
const events = new Map(catalog.map(entry => [entry.event.id, entry.event]));
for (const entry of catalog) if (entry.key === entry.event.id) events.set(entry.event.id, entry.event);
const old = JSON.parse(await readFile('../docs/art-audit/live-identity-audit.json', 'utf8'));
const prior = new Map<string, { sha256: string }>(old.rows.map((row: { id: string; sha256: string }) => [row.id, row]));
const rows = (manifest.ids as string[]).sort().map(id => {
    const match = /^vn:(.*):page:(\d+)(?::(left|right|actor:.*|choice:.*))?$/.exec(id);
    const eventMatch = /^event:(.*):(bg|avatar|backdrop|tilescene|pet|warden)$/.exec(id);
    const storageEventId = match?.[1] ?? eventMatch?.[1] ?? '';
    const eventId = storageEventId === 'pet-encounter' ? 'sys-pet-encounter' : storageEventId === 'ancient-chest' ? 'sys-ancient-chest' : storageEventId;
    const event = events.get(eventId), pageIndex = match ? Number(match[2]) : 0;
    const page = event?.vnPages?.[pageIndex];
    const role = match ? match[3] ? 'portrait' : 'background'
        : eventMatch?.[2] === 'bg' ? 'background' : eventMatch?.[2] === 'avatar' ? 'avatar'
        : eventMatch ? `dungeon-${eventMatch[2]}` : 'unknown';
    const expected = page && role === 'background' ? resolveVnPresentation({ event: event!, page, pageIndex, lineIndex: 0, speaker: page.speaker, speakingSide: null, pageImage: page.image || event!.image || defaultVnScene(eventId, event!.biome) }).backgroundImage : '';
    return { id, eventId, storageEventId, pageIndex, role, scene: page?.scene, title: page?.title, expected, known: Boolean(page), sha256: '', previousSha256: prior.get(id)?.sha256, width: 0, height: 0, bytes: 0, error: '' };
});
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < rows.length) {
        const row = rows[next++];
        try {
            const response = await fetch(`https://shinobijourney.com/api/img?id=${encodeURIComponent(row.id)}&v=${encodeURIComponent(manifest.version)}`, { signal: AbortSignal.timeout(25000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            row.sha256 = createHash('sha256').update(bytes).digest('hex');
            row.bytes = bytes.length;
            await writeFile(path.join(out, 'assets', `${row.sha256}.webp`), bytes);
            const meta = await sharp(bytes).metadata();
            row.width = meta.width!; row.height = meta.height!;
        } catch (error) { row.error = String(error); }
    }
}));
await writeFile(path.join(out, 'audit.json'), JSON.stringify({ capturedAt: new Date().toISOString(), catalogVariants: catalog.length, rows }, null, 2));
const groups = [...new Map(rows.filter(row => row.role === 'background').map(row => [row.sha256, row])).values()];
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
for (let start = 0; start < groups.length; start += 12) {
    const layers: sharp.OverlayOptions[] = [];
    for (const [offset, row] of groups.slice(start, start + 12).entries()) {
        const x = offset % 3 * 520, y = Math.floor(offset / 3) * 230;
        for (const [file, left] of [[path.join(out, 'assets', `${row.sha256}.webp`), x], [path.resolve('public', row.expected.split(/[?#]/)[0].slice(1)), x + 260]] as const) {
            try { layers.push({ input: await sharp(file).resize(255, 155, { fit: 'contain', background: '#14232d' }).png().toBuffer(), left, top: y + 50 }); } catch { /* Missing expectations remain visible in JSON. */ }
        }
        const text = `<svg width="520" height="230"><g fill="white" font-family="Arial" font-size="12"><text x="4" y="16">#${start + offset} ${escape(row.eventId)} p${row.pageIndex}</text><text x="4" y="33">${escape((row.scene ?? '').slice(0, 75))}</text><text x="4" y="222">LIVE ${row.width}×${row.height}</text><text x="264" y="222">CURRENT</text></g></svg>`;
        layers.push({ input: Buffer.from(text), left: x, top: y });
    }
    await sharp({ create: { width: 1560, height: 920, channels: 3, background: '#08121c' } }).composite(layers).png().toFile(path.join(out, `backgrounds-${start / 12}.png`));
}
console.log(JSON.stringify({ slots: rows.length, backgrounds: rows.filter(r => r.role === 'background').length, uniqueBackgrounds: groups.length, changed: rows.filter(r => r.previousSha256 && r.previousSha256 !== r.sha256), unknown: rows.filter(r => !r.known || r.role === 'unknown'), errors: rows.filter(r => r.error) }, null, 2));
