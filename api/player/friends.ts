import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';

// Player-owned social lists, stored in their OWN KV keys — mirrors the
// per-player `challenges:<name>` precedent — so they never round-trip or
// clobber the ~100KB character save and are immune to the multi-tab save
// lost-update window. `following` remains the original one-way subscription;
// `friends` is a separate, explicit address-book list with no request/inbox
// handshake. Online status is NOT stored here: the client joins both lists
// against the player roster it already polls (which carries the online flag).
//
//   GET    ?playerName=<me>                         → { following, friends }
//   POST   { playerName, targetName, list? }        → add    → selected list
//   DELETE { playerName, targetName, list? }        → remove → selected list
//
// Omitting `list` keeps the legacy Following contract for existing callers.

const MAX_SOCIAL_LIST_ENTRIES = 200;
const SOCIAL_LIST_TTL_SEC = 365 * 24 * 60 * 60;

function followingKey(name: string): string {
    return `friends:${safeName(name)}`;
}

function friendListKey(name: string): string {
    return `player-friends:${safeName(name)}`;
}

function cleanList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const entry of value) {
        const displayName = String(entry ?? '').trim();
        const slug = safeName(displayName);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        clean.push(displayName);
        if (clean.length >= MAX_SOCIAL_LIST_ENTRIES) break;
    }
    return clean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const bodyObj = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const rawName = req.method === 'GET' ? req.query.playerName : bodyObj.playerName;
    const playerName = safeName(String(rawName ?? ''));
    if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

    // Act only as yourself (admins may act as anyone for support).
    const identity = await authedPlayerOrAdmin(req, playerName);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && identity.name !== playerName) {
        return res.status(403).json({ error: 'Can only manage your own social lists.' });
    }

    if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-store');
        const [following, friends] = await Promise.all([
            kv.get<unknown>(followingKey(playerName)),
            kv.get<unknown>(friendListKey(playerName)),
        ]);
        return res.status(200).json({ following: cleanList(following), friends: cleanList(friends) });
    }

    if (req.method === 'POST' || req.method === 'DELETE') {
        // Social-list spam guard, by IP, KV-backed (survives instance hops).
        if (!(await enforceRateLimitKv(req, res, 'friends-mutate', 40, 60_000))) return;

        const targetRaw = String(bodyObj.targetName ?? '').trim();
        const targetSlug = safeName(targetRaw);
        const listKind = bodyObj.list === 'friends' ? 'friends' : 'following';
        const listLabel = listKind === 'friends' ? 'friends list' : 'following list';
        if (!targetSlug) return res.status(400).json({ error: 'Invalid target name.' });
        if (targetSlug === playerName) return res.status(400).json({ error: `You can't add yourself to your ${listLabel}.` });

        if (req.method === 'POST') {
            // Only store real accounts so either list cannot be filled with
            // typos or junk names. Do this before the lock to keep its critical
            // section to a single-list read/modify/write.
            const exists = await kv.get<Record<string, unknown>>(`save:${targetSlug}`);
            if (!exists) {
                if (listKind === 'friends') return res.status(404).json({ error: 'No such player.' });
                // Preserve the original Following endpoint's idempotent no-op
                // response for old clients that submit a stale directory row.
                return res.status(200).json({ following: cleanList(await kv.get<unknown>(followingKey(playerName))) });
            }
        }

        const key = listKind === 'friends' ? friendListKey(playerName) : followingKey(playerName);

        // Lock the selected list for the read-modify-write so two concurrent
        // additions cannot both read the old list and lose one write.
        const next = await withKvLock(key, async () => {
            const list = cleanList(await kv.get<unknown>(key));
            const has = list.some((n) => safeName(n) === targetSlug);

            if (req.method === 'POST') {
                if (has) return list; // idempotent
                if (list.length >= MAX_SOCIAL_LIST_ENTRIES) return list;
                const updated = [...list, targetRaw];
                await kv.set(key, updated, { ex: SOCIAL_LIST_TTL_SEC });
                return updated;
            }
            // DELETE
            if (!has) return list;
            const updated = list.filter((n) => safeName(n) !== targetSlug);
            await kv.set(key, updated, { ex: SOCIAL_LIST_TTL_SEC });
            return updated;
        });

        if (req.method === 'POST' && listKind === 'friends' && !next.some((name) => safeName(name) === targetSlug)) {
            return res.status(409).json({ error: `Your friends list is limited to ${MAX_SOCIAL_LIST_ENTRIES} players.` });
        }
        return res.status(200).json(listKind === 'friends' ? { friends: next } : { following: next });
    }

    return res.status(405).end();
}
