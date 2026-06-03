import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { stampPlayerIp } from '../_player-ips.js';
import { recordClientIp, clientIpFrom, recordClientFingerprint, clientFpFrom } from '../admin/moderation.js';
import { onlineStore } from '../_realtime/online-store.js';

// Presence now lives in the in-memory online store (api/_realtime/online-store.ts)
// instead of `presence:<name>` DB keys — no per-second DB read/write. The live
// roster comes from onlineStore.list(); writes from onlineStore.upsert().

// Max time the client can claim to be traveling (10 min). Caps an exploited
// travelingUntil that would make a player permanently unreachable.
const MAX_TRAVEL_WINDOW_MS = 10 * 60_000;

function normalizeSector(value: unknown, fallback = 40) {
    const sector = Number(value);
    if (!Number.isFinite(sector)) return fallback;
    return Math.max(0, Math.floor(sector));
}

// Server-side defense-in-depth: project the incoming character down to the
// display fields the presence row is actually read for (by roster.ts, plus
// `pets` for Pet Arena challenges) BEFORE storing it. The current client
// already slims this (see presenceCharacter() in App.tsx), but an old or
// hostile client could still POST the full multi-MB blob (avatar data URL,
// inventory, jutsu, mission logs, …). Slimming here keeps the presence row —
// and the roster `mget` that reads every row back — small regardless of what
// the client sends. Gameplay/PvP paths never read this character (they read
// sector/inBattle/travelingUntil/pendingAttacker, and combat hydrates from
// save:<name>), so trimming it cannot affect battle or PvP behavior.
const PRESENCE_CHAR_KEEP = new Set<string>([
    'name', 'level', 'village', 'specialty', 'rank', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'professionXp', 'rankedRating', 'petRankedRating',
    'clan', 'clanFounder', 'hp', 'maxHp',
]);
const PRESENCE_PET_KEEP = new Set<string>([
    'id', 'name', 'image', 'rarity', 'level', 'element', 'trait', 'species',
    'hp', 'attack', 'defense', 'speed', 'jutsus', 'xp', 'unlockedForPve', 'expedition',
]);
function slimPresenceCharacter(input: unknown): Record<string, unknown> | null {
    if (!input || typeof input !== 'object') return null;
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of PRESENCE_CHAR_KEEP) if (k in src) out[k] = src[k];
    if (Array.isArray(src.pets)) {
        out.pets = src.pets.map((p) => {
            if (!p || typeof p !== 'object') return p;
            const ps = p as Record<string, unknown>;
            const pet: Record<string, unknown> = {};
            for (const f of PRESENCE_PET_KEEP) if (f in ps) pet[f] = ps[f];
            return pet;
        });
    }
    return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // 90/min per player heartbeat. The client beats once per second on the
    // exploring/combat screens (= 60/min), so the cap must sit above 60 with
    // headroom for clock jitter, retries, and the occasional double-fire on a
    // remount; 90 gives ~1.5x margin without opening the abuse window wide.
    // KV-backed so the window is authoritative across all Vercel lambda
    // instances — the previous in-process limiter let a player triggering
    // parallel invocations (cold-start fan-out) blow past the cap on individual
    // instances, which let the IP/fingerprint capture in this handler be hammered.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.name === 'string' ? bodyPeek.name : undefined;
    if (!(await enforceRateLimitKv(req, res, 'heartbeat', 90, 60_000, peekName))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, sector, character, travelingUntil, inBattle } = body as {
            name?: string;
            sector?: number;
            character?: unknown;
            travelingUntil?: number;
            inBattle?: boolean;
        };
        if (!name) return res.status(400).json({ error: 'Missing name.' });

        // Require that the heartbeat is from the named player (or admin).
        // Stops attackers from spoofing presence: setting inBattle=true to be
        // untouchable, faking travelingUntil, teleporting others, etc.
        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== name.toLowerCase().trim()) {
            return res.status(403).json({ error: 'Cannot heartbeat as another player.' });
        }

        // Fire-and-forget IP + browser-fingerprint capture so the admin
        // Moderation tab can link sock-puppet accounts even when the user
        // hops VPNs (the IP changes, the fingerprint doesn't). Never block
        // the heartbeat on these — best-effort only.
        if (!identity.admin) {
            void recordClientIp(identity.name, clientIpFrom(req));
            const fp = clientFpFrom(req);
            if (fp) void recordClientFingerprint(identity.name, fp);
        }

        const challengeKey = `challenges:${name.toLowerCase().trim()}`;
        const resetSignalKey = `reset-signal:${name.toLowerCase().trim()}`;

        // Presence (own record, for the sector fallback) comes from memory now.
        // Challenges + reset-signal stay DB-backed (polled until the WS push layer).
        const existing = onlineStore.get(name);
        const [pendingChallenges, resetSignal] = await Promise.all([
            kv.get<unknown[]>(challengeKey),
            kv.get(resetSignalKey),
        ]);

        if (resetSignal) {
            return res.status(200).json({ forceReload: true });
        }

        const entrySector = normalizeSector(sector, normalizeSector(existing?.sector, 40));
        const now = Date.now();

        // Cap client-supplied travelingUntil so an exploit can't make a player
        // permanently untouchable (e.g. client sends year 9999 epoch).
        const safeTravelUntil = travelingUntil
            ? Math.min(travelingUntil, now + MAX_TRAVEL_WINDOW_MS)
            : undefined;

        // Slim the incoming character to display fields before storing (defense
        // in depth — see slimPresenceCharacter). Fall back to the already-slim
        // stored character if this beat sent none.
        const slimChar = slimPresenceCharacter(character) ?? existing?.character ?? null;

        // Presence write → PROCESS MEMORY (no per-second DB write). upsert
        // preserves any pendingAttacker queued by attack.ts; we deliver it to this
        // client and clear it (one-shot), matching the old behavior where the
        // heartbeat read pendingAttacker then rewrote the row with null. Also
        // stamp the request IP for anti-alt overlap checks (player-ip:{name}:{ip},
        // 7-day TTL, idempotent).
        const stored = onlineStore.upsert({
            name,
            sector: entrySector,
            character: slimChar as Record<string, unknown> | null,
            travelingUntil: (safeTravelUntil && safeTravelUntil > now) ? safeTravelUntil : undefined,
            inBattle: inBattle === true ? true : undefined,
        });
        const pendingAttacker = stored.pendingAttacker ?? null;
        onlineStore.clearPendingAttacker(name);

        await Promise.all([
            pendingChallenges?.length ? kv.del(challengeKey) : Promise.resolve(),
            stampPlayerIp(req, name),
        ]);

        // The in-memory store IS the live roster — no DB scan, no cache layer.
        const allEntries = onlineStore.list();

        const toRecord = (p: typeof allEntries[number]) => {
            const ch = p.character as Record<string, unknown> | null;
            return {
                name: p.displayName, sector: p.sector,
                // Avatar image intentionally omitted — the client resolves avatars
                // from its name-keyed cache (sharedImages['avatar:<name>'], hydrated
                // from /api/images?cat=avatar). Sending the base64 blob on every ~1s
                // presence response was by far the largest egress cost.
                character: { avatarImage: '' },
                level: ch?.level ?? 1,
                village: ch?.village ?? '',
                specialty: ch?.specialty ?? 'Ninjutsu',
                currentSector: p.sector,
                lastSeenAt: p.lastSeenAt,
                travelingUntil: p.travelingUntil ?? 0,
                inBattle: p.inBattle ?? false,
            };
        };

        const sectorMates = allEntries
            .filter(p => normalizeSector(p.sector) === entrySector)
            .map(toRecord);

        const allPlayers = allEntries.map(toRecord);

        return res.status(200).json({
            sectorMates,
            allPlayers,
            pendingAttacker,
            pendingChallenges: pendingChallenges ?? [],
        });
    } catch (err) {
        console.error('[heartbeat]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
