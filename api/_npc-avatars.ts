/**
 * Cinderhold's portraits in the shared avatar bucket (2026-11-11).
 *
 * Online, a player's portrait is found by name: presence rows carry no image
 * (api/_realtime/presence-input.ts), so every viewer resolves
 * `sharedImages['avatar:<name>']`, the row the player's own creator publishes
 * (shinobij.client/src/features/character-creator/starterAvatarPublish.ts).
 * An NPC has no creator, so its online figure, roster row and directory entry
 * fell back to initials while its offline profile showed the portrait from its
 * save. This publishes the same row for each NPC, from whatever `avatarImage`
 * its save holds, so both read alike.
 *
 * The row is written only when it differs from the save's portrait, so a
 * rebuild that keeps the portrait writes nothing, and a new portrait replaces
 * the old one on the next rebuild. A site path (a portrait that ships with the
 * client) is stored as a link to it on our own canonical host. /api/img
 * redirects an avatar id only to an https link on a host in
 * safeImageRedirectHosts() (api/img.ts isSafeImageRedirect: the canonical host,
 * its www twin and the R2 public host), so such a link is served, while an
 * https portrait on any other host is stored but not followed. An inline image
 * is stored as it is. The ids this module published are remembered with what
 * it wrote, so a renamed NPC's old row is removed, but only while it still
 * holds exactly what was published there.
 *
 * Every NPC duel win rebuilds that NPC (api/_npc-village-seed.ts reseedNpc),
 * and with it this pass. A hash of the whole wanted (id → value) set is kept
 * beside the index, so a pass whose portraits are all unchanged is one small
 * read: no lock, and none of the (possibly large) avatar rows read. The hash
 * lapses daily, so a row lost some other way is put back within a day.
 */
import { createHash } from 'node:crypto';
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { canonicalOrigin } from './_canonical-domain.js';
import { bumpImageVersion } from './_image-version.js';
import { copyImageToR2, forgetImageLists, perImageKey } from './images.js';
import { deleteImage, r2ReadEnabled, r2WriteEnabled } from './_r2.js';
import { NPC_VILLAGE_ROSTER } from '../shared/npc-village-roster.js';

/** id → the value this module last wrote there. */
export const NPC_AVATAR_INDEX_KEY = 'npc-village:avatars';
/** A hash of the wanted (id → value) set the last complete pass published. */
export const NPC_AVATAR_HASH_KEY = 'npc-village:avatars:hash';
const HASH_TTL_SEC = 24 * 60 * 60;

function wantedHash(wanted: ReadonlyMap<string, string>): string {
    const entries = [...wanted.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

type SaveRecord = Record<string, unknown>;

/**
 * What the avatar row holds for a save's `avatarImage`, or null when there is
 * nothing to publish. An `/api/` path is never a portrait: it is the client's
 * pointer back at the shared row itself (`/api/img?id=avatar:<name>`, which an
 * admin-possessed NPC's client puts in its save, since its portrait is not a
 * preset), and publishing it would make the row redirect to itself.
 */
export function npcAvatarRowValue(avatarImage: unknown, origin = canonicalOrigin()): string | null {
    const image = typeof avatarImage === 'string' ? avatarImage.trim() : '';
    if (!image) return null;
    if (/^data:image\//i.test(image) || /^https:\/\//i.test(image)) return image;
    if (/^\/api\//i.test(image)) return null;
    if (image.startsWith('/') && !image.startsWith('//')) return `${origin}${image}`;
    return null;
}

/**
 * The ids a viewer looks a portrait up by. Most screens key it by the
 * lowercased display name (as the creator publishes it), a few by the account
 * slug, so both are written.
 */
export function npcAvatarIds(name: string, slug: string): string[] {
    return [...new Set([`avatar:${name.trim().toLowerCase()}`, `avatar:${slug}`])];
}

/**
 * Publishes ONE NPC's portrait rows from its save (an NPC duel win rebuilds
 * just that NPC: api/_npc-village-seed.ts reseedNpc). Reads only its own one or
 * two rows and writes only a row that differs. The daily pass (below) still
 * owns renames and the whole-set hash, so this never touches either.
 */
export async function publishNpcAvatar(npc: { id: string; name: string; avatar?: unknown }, save: SaveRecord | null | undefined): Promise<string[]> {
    const character = save?.character as SaveRecord | undefined;
    if (!character || typeof character !== 'object') return [];
    const value = npcAvatarRowValue(character.avatarImage) ?? npcAvatarRowValue(npc.avatar);
    if (!value) return [];
    const ids = npcAvatarIds(String(character.name ?? npc.name), npc.id);
    const stored = await kv.mget<Array<unknown>>(...ids.map(perImageKey));
    const stale = ids.filter((_, i) => stored[i] !== value);
    if (!stale.length) return [];
    return withKvLock(NPC_AVATAR_INDEX_KEY, async () => {
        const index = (await kv.get<Record<string, string>>(NPC_AVATAR_INDEX_KEY)) ?? {};
        let replaced = false;
        for (const id of stale) {
            const current = await kv.get<unknown>(perImageKey(id));
            if (current === value) continue;
            await kv.set(perImageKey(id), value);
            await copyImageToR2(id, value);
            if (typeof current === 'string' && current) replaced = true;
        }
        forgetImageLists('avatar');
        if (replaced) await bumpImageVersion('avatar');
        const nextIndex = { ...index, ...Object.fromEntries(ids.map((id) => [id, value])) };
        if (JSON.stringify(nextIndex) !== JSON.stringify(index)) await kv.set(NPC_AVATAR_INDEX_KEY, nextIndex);
        return stale;
    }, { failClosed: true });
}

/**
 * Publishes every NPC's portrait from its save. `saves` is the roster's saves
 * in roster order (null for an NPC with none yet). Returns the ids written or
 * removed.
 */
export async function publishNpcAvatars(saves: ReadonlyArray<SaveRecord | null | undefined>): Promise<string[]> {
    const wanted = new Map<string, string>();
    NPC_VILLAGE_ROSTER.forEach((npc, i) => {
        const character = saves[i]?.character as SaveRecord | undefined;
        if (!character || typeof character !== 'object') return;
        // A save that holds no publishable portrait (the pointer above) keeps
        // the roster's own portrait in the row.
        const value = npcAvatarRowValue(character.avatarImage) ?? npcAvatarRowValue(npc.avatar);
        if (!value) return;
        for (const id of npcAvatarIds(String(character.name ?? npc.name), npc.id)) wanted.set(id, value);
    });
    const hash = wantedHash(wanted);
    if (await kv.get<string>(NPC_AVATAR_HASH_KEY).catch(() => null) === hash) return [];
    return withKvLock(NPC_AVATAR_INDEX_KEY, async () => {
        const index = (await kv.get<Record<string, string>>(NPC_AVATAR_INDEX_KEY)) ?? {};
        const ids = [...new Set([...wanted.keys(), ...Object.keys(index)])];
        if (!ids.length) { await kv.set(NPC_AVATAR_HASH_KEY, hash, { ex: HASH_TTL_SEC }); return []; }
        const stored = await kv.mget<Array<unknown>>(...ids.map(perImageKey));
        const touched: string[] = [];
        let replaced = false;
        const nextIndex: Record<string, string> = {};
        for (const [i, id] of ids.entries()) {
            const current = typeof stored[i] === 'string' ? stored[i] as string : null;
            const value = wanted.get(id);
            if (value) {
                nextIndex[id] = value;
                if (current === value) continue;
                await kv.set(perImageKey(id), value);
                await copyImageToR2(id, value);
                if (current) replaced = true;
                touched.push(id);
            } else if (current !== null && current === index[id]) {
                // An id this module published that no NPC uses now (a renamed
                // NPC). Left alone once anything else was written there.
                if (r2ReadEnabled() || r2WriteEnabled()) await deleteImage(id).catch(() => false);
                await kv.del(perImageKey(id));
                replaced = true;
                touched.push(id);
            }
        }
        if (touched.length) {
            forgetImageLists('avatar');
            // Cached /api/img?id=…&v=<old> URLs could hold the old bytes.
            if (replaced) await bumpImageVersion('avatar');
        }
        if (JSON.stringify(nextIndex) !== JSON.stringify(index)) await kv.set(NPC_AVATAR_INDEX_KEY, nextIndex);
        // Last, so a pass that failed part-way is run in full again next time.
        await kv.set(NPC_AVATAR_HASH_KEY, hash, { ex: HASH_TTL_SEC });
        return touched;
    }, { failClosed: true });
}
