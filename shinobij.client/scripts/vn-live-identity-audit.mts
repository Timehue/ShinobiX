import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { artAuditCatalog } from '../src/features/cinematic-vn/art-audit-catalog';
import { overlayVnImages } from '../src/lib/story-trigger';
import { resolveCinematicActorImage, resolveVnPresentation } from '../src/lib/vn-presentation';
import { defaultVnPortrait, defaultVnScene, resolveVnActorBaseImage, resolveVnAuthoredActorImage } from '../src/lib/vn';
import type { CreatorEvent } from '../src/types/vn';

const out = path.resolve('../tmp/vn-identity-audit');
await mkdir(path.join(out, 'assets'), { recursive: true });
const manifest = JSON.parse(await readFile(path.join(out, 'live-manifest.json'), 'utf8'));
const catalog = await artAuditCatalog();
const events = new Map<string, CreatorEvent>();
for (const entry of catalog) if (!events.has(entry.event.id) || entry.key === entry.event.id) events.set(entry.event.id, entry.event);
const ids: string[] = manifest.ids.filter((id: string) => /^vn:.*:page:\d+:(left|right)$/.test(id) || /^event:.*:avatar$/.test(id));
const images = Object.fromEntries(ids.map(id => [id, `/api/img?id=${encodeURIComponent(id)}`]));
function cast(event: CreatorEvent, index: number) {
    const page = event.vnPages![index];
    const swapped = page.rightName?.trim().toLowerCase() === 'player';
    const leftName = swapped ? 'Player' : page.leftName || 'Player';
    const rightName = swapped ? page.leftName || page.speaker || event.vnSpeaker || 'Narrator' : page.rightName || page.speaker || event.vnSpeaker || 'Narrator';
    const leftAuthored = swapped ? '' : resolveVnAuthoredActorImage(event.id, leftName, page.leftImage);
    const rightAuthored = resolveVnAuthoredActorImage(event.id, rightName, swapped ? page.leftImage || page.rightImage : page.rightImage);
    const presentation = resolveVnPresentation({ event, page, pageIndex: index, lineIndex: 0, speaker: page.speaker, speakingSide: null, pageImage: page.image || event.image || defaultVnScene(event.id, event.biome) });
    return [
        { name: leftName, image: resolveCinematicActorImage(event.id, leftName, leftName === 'Player' ? '' : defaultVnPortrait(leftName), presentation.leftActorPose, leftAuthored) },
        { name: rightName, image: resolveCinematicActorImage(event.id, rightName, resolveVnActorBaseImage(event.id, rightName, rightAuthored, event.avatarImage), presentation.rightActorPose, rightAuthored) },
    ];
}
const rows = ids.sort().map((id, index) => {
    const match = /^vn:(.*):page:(\d+):(left|right)$/.exec(id);
    const eventId = match?.[1] ?? id.slice(6, -7);
    const pageIndex = match ? Number(match[2]) : 0;
    const event = events.get(eventId);
    const page = event?.vnPages?.[pageIndex];
    const base = page ? cast(event!, pageIndex) : [];
    const overlaid = page ? cast(overlayVnImages(event!, eventId, images), pageIndex) : [];
    const side = overlaid.findIndex(actor => actor.image === images[id]);
    return { index, id, eventId, pageIndex, title: page?.title, speaker: page?.speaker, scene: page?.scene,
        active: side >= 0, actor: side >= 0 ? base[side].name : null, expected: side >= 0 ? base[side].image : null,
        cast: base, missingEvent: !event, missingPage: Boolean(event && !page), sha256: '', width: 0, height: 0, file: '', error: '' };
});
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < rows.length) {
        const row = rows[next++];
        try {
            const response = await fetch(`https://shinobijourney.com/api/img?id=${encodeURIComponent(row.id)}`, { signal: AbortSignal.timeout(20000) });
            if (!response.ok) throw new Error(String(response.status));
            const bytes = Buffer.from(await response.arrayBuffer());
            row.sha256 = createHash('sha256').update(bytes).digest('hex');
            row.file = path.join('assets', `${row.sha256}.webp`).replaceAll('\\', '/');
            await writeFile(path.join(out, row.file), bytes);
            const metadata = await sharp(bytes).metadata();
            row.width = metadata.width!;
            row.height = metadata.height!;
        } catch (error) { row.error = String(error); }
    }
}));
await writeFile(path.join(out, 'audit.json'), JSON.stringify({ date: '2026-09-18', catalogVariants: catalog.length, catalogEvents: events.size, rows }, null, 2));
const escape = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cellWidth = 336, cellHeight = 264;
for (let start = 0; start < rows.length; start += 16) {
    const group = rows.slice(start, start + 16);
    const layers: sharp.OverlayOptions[] = [];
    for (const [offset, row] of group.entries()) {
        const x = offset % 4 * cellWidth, y = Math.floor(offset / 4) * cellHeight;
        if (row.file) layers.push({ input: await sharp(path.join(out, row.file)).resize(156, 184, { fit: 'contain', background: '#16212b' }).png().toBuffer(), left: x + 5, top: y + 48 });
        const expected = row.expected?.split(/[?#]/)[0];
        if (expected?.startsWith('/')) layers.push({ input: await sharp(path.resolve('public', expected.slice(1))).resize(156, 184, { fit: 'contain', background: '#16212b' }).png().toBuffer(), left: x + 173, top: y + 48 });
        const label = `<svg width="${cellWidth}" height="${cellHeight}"><g font-family="Arial" font-size="12" fill="#e4edf4"><text x="5" y="15">#${row.index} ${escape(row.actor ?? (row.missingEvent ? 'UNKNOWN EVENT' : 'NOT RENDERED'))}</text><text x="5" y="31">${escape(row.eventId.replace('story-', '').slice(0, 43))} p${row.pageIndex}</text><text x="5" y="247">LIVE</text><text x="173" y="247">CURRENT CAST</text></g></svg>`;
        layers.push({ input: Buffer.from(label), left: x, top: y });
    }
    await sharp({ create: { width: cellWidth * 4, height: cellHeight * 4, channels: 3, background: '#091219' } }).composite(layers).png().toFile(path.join(out, `sheet-${Math.floor(start / 16)}.png`));
}
console.log(JSON.stringify({ portraits: rows.length, active: rows.filter(r => r.active).length, narrators: rows.filter(r => r.actor === 'Narrator').length,
    unknown: rows.filter(r => r.missingEvent).map(r => r.id), errors: rows.filter(r => r.error).map(r => ({ id: r.id, error: r.error })) }, null, 2));
