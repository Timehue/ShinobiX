import { randomUUID } from 'node:crypto';
import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';

const SCOPE_RE = /^[a-z][a-z0-9-]{0,31}$/;

export type PetLifecycleLease = {
    key: string;
    token: string;
    release: () => Promise<boolean>;
};

/**
 * Briefly reserve the same per-player key used by casual, Warfront, and ranked
 * pet battles. This closes both race directions: a lifecycle mutation cannot
 * begin while a battle receipt exists, and a battle cannot seal a pet halfway
 * through a lifecycle write. Compare-and-delete prevents cleanup from erasing
 * a newer battle lease after this short sentinel expires.
 */
export async function claimPetLifecycleLease(
    store: Pick<KvLike, 'get' | 'set' | 'delIfEqual'>,
    playerName: string,
    scope: string,
    ttlSeconds = 60,
): Promise<PetLifecycleLease | null> {
    const player = safeName(playerName);
    const normalizedScope = String(scope ?? '').trim().toLowerCase();
    if (!player || !SCOPE_RE.test(normalizedScope)) throw new Error('invalid-pet-lifecycle-lease');
    const ttl = Math.max(10, Math.min(300, Math.floor(Number(ttlSeconds) || 60)));
    const key = `pet:battle-active:${player}`;
    const token = `lifecycle:${normalizedScope}:${randomUUID().replace(/-/g, '')}`;

    try {
        const placed = await store.set(key, token, { nx: true, ex: ttl });
        if (placed !== 'OK') return null;
    } catch (error) {
        // A lost acknowledgement is still ownership if the exact sentinel
        // landed. Anything else remains fail-closed and is surfaced upstream.
        if (await store.get<string>(key).catch(() => null) !== token) throw error;
    }

    let released = false;
    return {
        key,
        token,
        async release() {
            if (released) return false;
            released = true;
            return store.delIfEqual(key, token).catch(() => false);
        },
    };
}
