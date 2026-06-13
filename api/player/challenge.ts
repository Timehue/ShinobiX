import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { onlineStore } from '../_realtime/online-store.js';
import { challengeBlock } from '../_realtime/presence-gating.js';
import { kickPlayer } from '../_realtime/notify.js';

const CHALLENGE_TTL = 180; // seconds (3 min) — challenge auto-cancels if unanswered

// Public projection for the challenger character stored alongside a
// challenges:<name> entry. The challenges:* prefix is anon-readable via
// Supabase Realtime (see supabase-schema.sql), so the FULL challenger
// character — including ryo, jutsu, equipment, stats — would otherwise
// be world-readable to any anon WS subscriber. Strip down to the bare
// minimum the recipient's inbox needs to render: name, level, village,
// avatar, cosmetic title, ranked rating.
const CHALLENGER_PUBLIC_FIELDS = new Set<string>([
    'name', 'level', 'village', 'specialty',
    'avatarImage', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'rankedRating',
    'clan',
    // Pet-challenge accept handlers (App.tsx :9090, :9107, :17624,
    // :17635, :36432) read challenge.challenger.pets to find the
    // matching pet by id at accept time. Stripping it broke every
    // pet challenge (TypeError on .find).
    'pets',
]);
// The challenges:* prefix is anon-readable via Supabase Realtime, so any inline
// base64 (data:) image kept here is BOTH world-readable to any anon WS
// subscriber AND a large recurring payload on the wire (a live challenge with a
// full avatar + pet sprites measured ~450KB). Hosted-URL image refs are fine
// (small, already public) — only inline `data:` blobs are stripped. Pets keep
// their combat stats (the accept handler matches by id and needs them) but lose
// inline sprite blobs. The recipient resolves avatars/pet art by name from the
// shared-image cache, same as presence does.
function isInlineImage(v: unknown): boolean {
    return typeof v === 'string' && v.startsWith('data:');
}
function stripPetInlineImages(pets: unknown): unknown {
    if (!Array.isArray(pets)) return pets;
    return pets.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const pet = p as Record<string, unknown>;
        if (!isInlineImage(pet.image) && !isInlineImage(pet.bodyImage)) return pet;
        const out = { ...pet };
        if (isInlineImage(out.image)) delete out.image;
        if (isInlineImage(out.bodyImage)) delete out.bodyImage;
        return out;
    });
}
function projectChallengerCharacter(c: unknown): unknown {
    if (!c || typeof c !== 'object') return c;
    const src = c as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of CHALLENGER_PUBLIC_FIELDS) if (k in src) out[k] = src[k];
    if (isInlineImage(out.avatarImage)) delete out.avatarImage;
    if ('pets' in out) out.pets = stripPetInlineImages(out.pets);
    return out;
}
function projectChallenge(c: unknown): unknown {
    if (!c || typeof c !== 'object') return c;
    const rec = c as Record<string, unknown>;
    const out: Record<string, unknown> = { ...rec };
    if ('challenger' in rec) out.challenger = projectChallengerCharacter(rec.challenger);
    return out;
}

function challengeKey(name: string) {
    return `challenges:${safeName(name)}`;
}

function outgoingKey(name: string) {
    return `challenge-outgoing:${safeName(name)}`;
}

function challengeId(challenge: unknown) {
    return challenge && typeof challenge === 'object' && 'id' in challenge
        ? String((challenge as { id?: unknown }).id ?? '')
        : '';
}

function challengeFromName(challenge: unknown) {
    return challenge && typeof challenge === 'object' && 'fromName' in challenge
        ? String((challenge as { fromName?: unknown }).fromName ?? '').trim()
        : '';
}

// Server-clamp clanWarPoints to the mode's legal value. Without this,
// a malicious challenger could set clanWarPoints: 9999 on the body and
// the client's `addClanWarPoints` call after a win would credit the
// inflated value to the clan leaderboard.
//
// Keep in sync with the client's challengePlayer() call sites
// (App.tsx ~33901-33903):
//   clanWar1v1 → +50
//   clanWar2v2 → +100
//   clanWarPet → +25
//   anything else → 0
const CLAN_WAR_POINTS_BY_MODE: Record<string, number> = {
    clanWar1v1: 50,
    clanWar2v2: 100,
    clanWarPet: 25,
};

function clampClanWarPoints(challenge: unknown): unknown {
    if (!challenge || typeof challenge !== 'object') return challenge;
    const rec = challenge as Record<string, unknown>;
    const mode = String(rec.mode ?? '');
    const cap = CLAN_WAR_POINTS_BY_MODE[mode] ?? 0;
    if (typeof rec.clanWarPoints !== 'number' && rec.clanWarPoints !== undefined) {
        // Non-number — coerce to 0.
        return { ...rec, clanWarPoints: 0 };
    }
    const pts = Number(rec.clanWarPoints ?? 0);
    if (!Number.isFinite(pts) || pts <= 0) {
        // Strip any falsy or NaN value so downstream UI doesn't choke.
        if ('clanWarPoints' in rec) {
            const { clanWarPoints: _drop, ...rest } = rec;
            void _drop;
            return rest;
        }
        return rec;
    }
    if (pts > cap) {
        return { ...rec, clanWarPoints: cap };
    }
    return rec;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // All challenge operations require a logged-in player (or admin).
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        if (req.method === 'DELETE') {
            const { targetName, challengeId: id, fromName } = body as { targetName?: string; challengeId?: string; fromName?: string };
            if (!targetName && !fromName) return res.status(400).json({ error: 'Missing targetName or fromName.' });

            // Ownership gate: a DELETE clears a challenge from targetName's
            // inbox and/or fromName's outgoing slot. The caller must be a PARTY
            // to the challenge — i.e. either its recipient (targetName === me)
            // or its sender (fromName === me). This preserves both legitimate
            // flows, where one name is the caller and the other is the
            // counterparty:
            //   • sender cancels:    targetName=<recipient>, fromName=<me>
            //   • recipient resolves: targetName=<me>, fromName=<sender>
            // It blocks a pure third party (neither sender nor recipient) from
            // clearing someone else's inbox/outgoing slot. Admins bypass.
            if (!identity.admin) {
                const me = identity.name;
                const ownsTarget = targetName ? safeName(targetName) === me : false;
                const ownsFrom = fromName ? safeName(fromName) === me : false;
                if (!ownsTarget && !ownsFrom) {
                    return res.status(403).json({ error: 'Cannot delete another player\'s challenges.' });
                }
            }

            const pendingKey = targetName ? challengeKey(targetName) : '';
            // Lock the recipient's inbox during the read-filter-write so a
            // concurrent POST adding a new challenge can't be silently
            // overwritten by our DELETE (or vice versa).
            if (pendingKey) {
                await withKvLock(pendingKey, async () => {
                    const existing = await kv.get<unknown[]>(pendingKey) ?? [];
                    const updated = id ? existing.filter(challenge => challengeId(challenge) !== id) : existing;
                    if (updated.length) await kv.set(pendingKey, updated, { ex: CHALLENGE_TTL });
                    else await kv.del(pendingKey);
                });
            }
            if (fromName) await kv.del(outgoingKey(fromName));
            return res.status(200).json({ ok: true });
        }

        if (req.method !== 'POST') return res.status(405).end();

        const { targetName, challenge } = body as { targetName?: string; challenge?: unknown };
        if (!targetName || !challenge) return res.status(400).json({ error: 'Missing targetName or challenge.' });

        const record = challenge as { accepted?: boolean; declined?: boolean; battleId?: string; mode?: string };
        const fromName = challengeFromName(challenge);

        // The challenge's fromName (sender) must match the authed identity unless admin.
        if (!identity.admin && fromName && safeName(fromName) !== identity.name) {
            return res.status(403).json({ error: 'Cannot send a challenge as another player.' });
        }

        // For new challenges (not accept/decline/battle routing), gate on travel + battle state.
        if (!record.accepted && !record.declined && !record.battleId) {
            // Presence is in process memory; challengeBlock carries the
            // traveling / in-battle / engaged gates AND the Academy-Student
            // protection (sub-Genin can't be challenged). Spar and pet-battle
            // modes are exempt from the Academy gate (passed via record.mode) so
            // brand-new players can still practice-fight; ranked / clan-war keep
            // it. An OFFLINE target is NOT blocked — the challenge is queued in
            // their inbox for later.
            const block = challengeBlock(onlineStore.get(targetName), record.mode);
            if (block) return res.status(block.status).json({ error: block.error });
        }

        if (record.accepted || record.declined) {
            await kv.del(outgoingKey(targetName));
        } else if (fromName && !record.battleId) {
            const senderKey = outgoingKey(fromName);
            const existingOutgoing = await kv.get<{ targetName?: string; challengeId?: string }>(senderKey);
            // Supersede the sender's prior pending challenge instead of rejecting
            // the new one. A challenge that was never answered (recipient
            // offline) — or one the sender lost track of after a page reload —
            // used to lock the sender out for the full CHALLENGE_TTL window with
            // a "you already have a pending challenge" error and no way to clear
            // it. Clear the previous recipient's inbox copy here; the outgoing
            // slot is overwritten just below. This preserves the "one
            // outstanding challenge per sender" invariant — the new challenge
            // simply replaces the old, dead one.
            if (existingOutgoing?.targetName) {
                const prevKey = challengeKey(String(existingOutgoing.targetName));
                const prevId = existingOutgoing.challengeId ? String(existingOutgoing.challengeId) : '';
                await withKvLock(prevKey, async () => {
                    const inbox = await kv.get<unknown[]>(prevKey) ?? [];
                    const filtered = prevId ? inbox.filter(c => challengeId(c) !== prevId) : inbox;
                    if (filtered.length) await kv.set(prevKey, filtered, { ex: CHALLENGE_TTL });
                    else await kv.del(prevKey);
                });
            }
            await kv.set(senderKey, { targetName, challengeId: challengeId(challenge), createdAt: Date.now() }, { ex: CHALLENGE_TTL });
        }

        // Two server-side transforms before the challenge hits KV:
        //   1. clampClanWarPoints — keeps the win-credit path honest.
        //   2. projectChallenge   — strips the challenger's full character
        //      down to the inbox-renderable public projection. The
        //      challenges:* key prefix is anon-readable via Supabase
        //      Realtime; the full payload would otherwise leak ryo /
        //      jutsu / equipment / stats to any anon WS subscriber.
        const safeChallenge = projectChallenge(clampClanWarPoints(challenge));

        // Lock the recipient's inbox around the read-dedupe-write so two
        // simultaneous challengers can't both read the same snapshot and
        // both produce a final list that's missing the other's entry.
        const key = challengeKey(targetName);
        const cid = challengeId(challenge);
        await withKvLock(key, async () => {
            const existing = await kv.get<unknown[]>(key) ?? [];
            const deduped = cid ? existing.filter(c => challengeId(c) !== cid) : existing;
            const updated = [...deduped, safeChallenge].slice(-20);
            await kv.set(key, updated, { ex: CHALLENGE_TTL });
        });

        // Instant delivery: nudge the recipient to poll now. The HTTP heartbeat
        // remains the authoritative carrier of pendingChallenges; this just makes
        // it arrive immediately. No-op when realtime is off / they have no socket.
        kickPlayer(targetName, 'challenge');

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
