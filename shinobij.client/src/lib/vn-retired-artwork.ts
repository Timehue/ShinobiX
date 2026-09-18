import type { CreatorEvent } from '../types/vn';
import { RETIRED_VN_PORTRAITS } from './vn-retired-portraits';
import { RETIRED_VN_BACKGROUNDS } from './vn-retired-backgrounds';

// Reviewed live exports from 2026-09-18. Portraits across the live library and
// backgrounds predate the current cast/art direction.
// Match BYTES as well as slot IDs:
// a later admin upload to the same slot must remain an explicit override.
export const RETIRED_VN_ART: Readonly<Record<string, string>> = {
    ...RETIRED_VN_PORTRAITS,
    ...RETIRED_VN_BACKGROUNDS,
};

export function retiredVnArtHash(eventId: string, source: string): string | undefined {
    if (!source.startsWith('/api/img?')) return undefined;
    const id = new URLSearchParams(source.slice(source.indexOf('?') + 1)).get('id') ?? '';
    const alias = eventId === 'sys-pet-encounter' ? 'pet-encounter' : eventId === 'sys-ancient-chest' ? 'ancient-chest' : eventId;
    if (![eventId, alias].some(event => id.startsWith(`vn:${event}:page:`) || id === `event:${event}:bg`)) return undefined;
    return RETIRED_VN_ART[id];
}

export function retiredVnArtSources(event: CreatorEvent): string[] {
    return [...new Set([event.image, ...(event.vnPages?.flatMap(page => [page.image, page.leftImage, page.rightImage]) ?? [])]
        .filter((source): source is string => Boolean(source && retiredVnArtHash(event.id, source))))];
}

export function omitRetiredVnArt(event: CreatorEvent, retired: ReadonlySet<string>): CreatorEvent {
    if (!retired.size) return event;
    const nextEvent = { ...event };
    if (event.image && retired.has(event.image) && retiredVnArtHash(event.id, event.image)) delete nextEvent.image;
    return { ...nextEvent, vnPages: event.vnPages?.map(page => {
        const next = { ...page };
        for (const field of ['image', 'leftImage', 'rightImage'] as const) {
            const source = page[field];
            if (source && retired.has(source) && retiredVnArtHash(event.id, source)) delete next[field];
        }
        return next;
    }) };
}

const checks = new Map<string, Promise<boolean>>();

export function isRetiredVnArt(eventId: string, source: string): Promise<boolean> {
    const expected = retiredVnArtHash(eventId, source);
    if (!expected) return Promise.resolve(false);
    const cached = checks.get(source);
    if (cached) return cached;
    const check = (async () => {
        try {
            const response = await fetch(source, { credentials: 'same-origin', signal: AbortSignal.timeout(8_000) });
            if (!response.ok) throw new Error('Artwork unavailable');
            const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
            const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            return actual === expected;
        } catch {
            // Offline/failing checks keep the authored art and can retry when
            // the reader reopens. Never remove an override on a failed fetch.
            checks.delete(source);
            return false;
        }
    })();
    if (checks.size >= 160) checks.delete(checks.keys().next().value!);
    checks.set(source, check);
    return check;
}
