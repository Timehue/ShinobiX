import type { CreatorEvent } from '../types/vn';
import { RETIRED_VN_PORTRAITS } from './vn-retired-portraits';
import { RETIRED_VN_BACKGROUNDS } from './vn-retired-backgrounds';

// Relic Dungeon entrance uploads, reviewed live 2026-09-19. Each one replaced the
// dungeon's own cinematic entrance art. Their warden, altar and rare-pet uploads
// have no built-in counterpart and are not listed.
export const RETIRED_DUNGEON_BACKDROPS: Readonly<Record<string, string>> = {
    'event:craft-dungeon-forest:backdrop': '918ef7ab677acdf7ab70bac67cc4174fea41bcb0bc26ff20754bc456bc229edb',
    'event:craft-dungeon-snow:backdrop': '817113b9f4b8fc3f636c3ae5156c609e73f4a1a3edfea7c06d55795e793f873f',
    'event:craft-dungeon-volcano:backdrop': '8563014059bebb867b72ee9f134d569f753062ac377b62044c55abba1edf61f2',
    'event:craft-dungeon-shadow:backdrop': 'f737c42e2f2bdba4c192e8a82bdbeb8f3e5ef91537b6b44a547a2239aa419e77',
    'event:craft-dungeon-central:backdrop': '8accf3db3898c9b2c6ab73be493d04d85b34f8dc43427c046709e243a7ec4176',
};

// Reviewed live exports from 2026-09-18. Portraits across the live library and
// backgrounds predate the current cast/art direction.
// Match BYTES as well as slot IDs:
// a later admin upload to the same slot must remain an explicit override.
export const RETIRED_VN_ART: Readonly<Record<string, string>> = {
    ...RETIRED_VN_PORTRAITS,
    ...RETIRED_VN_BACKGROUNDS,
    ...RETIRED_DUNGEON_BACKDROPS,
};

export function retiredVnArtHash(eventId: string, source: string): string | undefined {
    if (!source.startsWith('/api/img?')) return undefined;
    const id = new URLSearchParams(source.slice(source.indexOf('?') + 1)).get('id') ?? '';
    const alias = eventId === 'sys-pet-encounter' ? 'pet-encounter' : eventId === 'sys-ancient-chest' ? 'ancient-chest' : eventId;
    if (![eventId, alias].some(event => id.startsWith(`vn:${event}:page:`) || id === `event:${event}:bg` || id === `event:${event}:backdrop`)) return undefined;
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
            // Only proven new bytes may replace the built-in art. A failed or
            // timed-out check, or a deleted upload (404), shows the built-in
            // art; the check retries when the scene reopens.
            checks.delete(source);
            return true;
        }
    })();
    if (checks.size >= 160) checks.delete(checks.keys().next().value!);
    checks.set(source, check);
    return check;
}
