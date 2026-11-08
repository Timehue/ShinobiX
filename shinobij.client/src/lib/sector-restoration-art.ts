import { RUIN_RESTORATION_BOUNDS } from '../../../shared/sector-ruin-restoration-bounds';
import { nextRestoredRuinStamp, restoredRuinFeed, restoredRuinFeedAt, restoredRuinFeedRevision } from './sector-banner-state';
import { serverNow } from './server-clock';

/** Restored ruins are painted INTO the sector floor, under players and NPCs, so
 * cleared ground never hides someone walking across it. Every sector's state comes
 * from the public world snapshot; the sector you stand in uses its fresher counter
 * view. In its last day a restoration shows its weathered painting. The floor canvas
 * is cached; a revision bump makes the world renderer rebuild it. */
export const RUIN_WEATHERING_MS = 24 * 60 * 60 * 1000;
type Phase = 'restored' | 'weathered';
const local = new Map<number, { at: number; entries: ReadonlyMap<string, number> }>();
const images = new Map<string, HTMLImageElement>(), decoded = new WeakSet<HTMLImageElement>();
let revision = 0, drawnKey = '', feedSeen = -1, checkedAt = 0, localChanged = false;
let drawn = new Map<number, { id: string; phase: Phase }[]>();

function recompute() {
    const now = serverNow(), bySector = new Map<number, Map<string, number>>();
    for (const row of restoredRuinFeed()) if (RUIN_RESTORATION_BOUNDS[row.id]) {
        const sector = bySector.get(row.sector) ?? new Map<string, number>(); sector.set(row.id, row.intactUntil); bySector.set(row.sector, sector);
    }
    // The sector you stand in follows whichever source is newer: its counter view or the world feed.
    for (const [sector, view] of local) if (view.at >= restoredRuinFeedAt()) bySector.set(sector, new Map(view.entries));
    const next = new Map<number, { id: string; phase: Phase }[]>();
    for (const [sector, entries] of bySector) {
        const list = [...entries].filter(([, until]) => until > now).map(([id, until]) => ({ id, phase: (until - now <= RUIN_WEATHERING_MS ? 'weathered' : 'restored') as Phase }));
        if (list.length) next.set(sector, list.sort((a, b) => a.id.localeCompare(b.id)));
    }
    const key = JSON.stringify([...next].sort((a, b) => a[0] - b[0]));
    if (key !== drawnKey) { drawnKey = key; drawn = next; revision++; }
}
/** The renderer polls this every frame: fold in feed changes, local reports and phase changes. */
export function sectorRestorationRevision() {
    const wall = Date.now();
    if (localChanged || feedSeen !== restoredRuinFeedRevision() || wall - checkedAt >= 5_000) {
        localChanged = false; feedSeen = restoredRuinFeedRevision(); checkedAt = wall; recompute();
    }
    return revision;
}
/** The sector you stand in reports its restored ruins (id → standing-until) from its counter view. */
export function setSectorRestorations(sector: number, entries: readonly { id: string; intactUntil: number }[]) {
    local.set(sector, { at: nextRestoredRuinStamp(), entries: new Map(entries.filter(entry => RUIN_RESTORATION_BOUNDS[entry.id]).map(entry => [entry.id, entry.intactUntil])) });
    localChanged = true;
}
/** Leaving a sector hands it back to the world snapshot. */
export function clearSectorRestorations(sector: number) { if (local.delete(sector)) localChanged = true; }
export function sectorRestorationPhases(sector: number): readonly { id: string; phase: Phase }[] { sectorRestorationRevision(); return drawn.get(sector) ?? []; }

function image(id: string, phase: Phase) {
    const key = `${phase}-${id}`;
    let found = images.get(key);
    if (!found && typeof Image !== 'undefined') {
        const created = new Image();
        // Decode before the floor uses it, so a walking frame never decodes the art itself.
        const ready = () => { decoded.add(created); revision++; };
        created.onload = () => { if (typeof created.decode === 'function') created.decode().then(ready, ready); else ready(); };
        // A failed load is forgotten and retried after a pause, never cached as broken.
        created.onerror = () => { images.delete(key); setTimeout(() => { revision++; }, 30_000); };
        created.src = `/sector-buildings/${key}-v1.webp`;
        images.set(key, found = created);
    }
    return found;
}
/** Paint every standing restoration of a sector onto its floor canvas (`size` px square). */
export function drawSectorRestorations(context: CanvasRenderingContext2D, sector: number, size: number) {
    const scale = size / 1024;
    const ready = (art: HTMLImageElement | undefined): art is HTMLImageElement => !!art && decoded.has(art) && art.naturalWidth > 0;
    for (const { id, phase } of drawn.get(sector) ?? []) {
        // Until the weathered painting has decoded, keep showing the restored one rather than the ruin.
        const wanted = image(id, phase), art = ready(wanted) ? wanted : phase === 'weathered' ? image(id, 'restored') : undefined, box = RUIN_RESTORATION_BOUNDS[id];
        if (!ready(art) || !box) continue;
        context.drawImage(art, box[0] * scale, box[1] * scale, box[2] * scale, box[3] * scale);
    }
}
