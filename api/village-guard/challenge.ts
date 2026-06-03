import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { stripNonCombatFields } from '../pvp/session.js';
import { kickPlayer } from '../_realtime/notify.js';

type GuardEntry = { name: string; village: string; level: number; lastSeen: number; defenseBonusPercent?: number };

const CHALLENGE_TTL = 120; // seconds — survives two heartbeat cycles

// Match the public projection in api/player/challenge.ts. The challenges:*
// key prefix is anon-readable via Supabase Realtime, so the attacker's
// full character would leak (ryo, jutsu, equipment, stats) without this.
const CHALLENGER_PUBLIC_FIELDS = new Set<string>([
    'name', 'level', 'village', 'specialty',
    'avatarImage', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'rankedRating',
    'clan',
    // Keep parity with api/player/challenge.ts — pet-challenge accept
    // handlers read challenge.challenger.pets to find the matching pet.
    'pets',
]);
function projectChallengerCharacter(c: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!c) return {};
    const out: Record<string, unknown> = {};
    for (const k of CHALLENGER_PUBLIC_FIELDS) if (k in c) out[k] = c[k];
    return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Require auth + rate-limit per identity (1 challenge per 3s, max 30 / 5 min).
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    const authedName = identity.admin ? null : identity.name;
    if (!enforceRateLimit(req, res, 'village-guard-challenge', 30, 5 * 60_000, authedName)) return;
    if (!enforceRateLimit(req, res, 'village-guard-challenge-burst', 1, 3_000, authedName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { attackerCharacter, village, battleId, guardName } = body as { attackerCharacter?: Record<string, unknown>; village?: string; battleId?: string; guardName?: string };
        if (!village) return res.status(400).json({ error: 'Missing village.' });

        // The attacker name in the body must match the authed identity (admins exempt).
        if (!identity.admin && attackerCharacter) {
            const attackerName = safeName(String(attackerCharacter.name ?? ''));
            if (attackerName && attackerName !== identity.name) {
                return res.status(403).json({ error: 'Cannot attack as another player.' });
            }
        }

        // Find all active guards for this village
        const keys = await kv.keys('guard:*');
        const guards = (await kv.mget<GuardEntry[]>(...keys))
            .filter((g): g is GuardEntry => !!g && g.village === village);

        if (guards.length === 0) {
            return res.status(200).json({ noGuard: true });
        }

        // Use the requested guard when the client already picked one for a shared PvP session.
        const requestedGuard = guardName ? guards.find(g => safeName(g.name) === safeName(guardName)) : undefined;
        const guard = requestedGuard ?? guards[Math.floor(Math.random() * guards.length)];

        // Fetch guard's full character from their persistent save
        const guardSave = await kv.get<Record<string, unknown>>(`save:${safeName(guard.name)}`);
        const guardCharacter = (guardSave?.character as Record<string, unknown>) ?? null;

        if (!guardCharacter) {
            // Guard's save is missing — fall back to AI. Cap the defense
            // bonus at 100% so a stale guard entry with an absurd value
            // (admin edit, corrupted state) can't make raids unwinnable.
            const cappedBonus = Math.max(0, Math.min(100, Number(guard.defenseBonusPercent ?? 0) || 0));
            return res.status(200).json({ pvp: false, guardName: guard.name, guardLevel: guard.level, defenseBonusPercent: cappedBonus });
        }

        // Send a sectorAttack-style DuelChallenge to the guard.
        // Their heartbeat will pick it up in pendingChallenges and the auto-routing
        // effect will immediately route them to the arena as the defender.
        if (attackerCharacter && battleId) {
            const challenge = {
                id: `guard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                fromName: (attackerCharacter.name as string) ?? 'Raider',
                toName: guard.name,
                // Strip the attacker's character to the inbox-public projection
                // before it lands on the challenges:* key (anon-readable via
                // Supabase Realtime). Without this strip the raider's ryo /
                // jutsu / equipment / stats leak to any anon WS subscriber.
                challenger: projectChallengerCharacter(attackerCharacter),
                createdAt: Date.now(),
                mode: 'standard',
                sectorAttack: true,
                ...(battleId ? { battleId } : {}),
            };

            const challengeKey = `challenges:${safeName(guard.name)}`;
            // Lock the guard's inbox during the read-append-write so a
            // concurrent /api/player/challenge POST can't be overwritten.
            await withKvLock(challengeKey, async () => {
                const existing = await kv.get<unknown[]>(challengeKey) ?? [];
                await kv.set(challengeKey, [...existing, challenge].slice(-20), { ex: CHALLENGE_TTL });
            });

            // Instant delivery: nudge the guard to run an immediate heartbeat —
            // same one-shot "poll now" kick the player attack/challenge paths use.
            // The Supabase Realtime challenges:* subscription also pushes this, but
            // the kick removes any reliance on that being configured, which matters
            // now the queued-guard heartbeat is 20s while the socket is connected.
            kickPlayer(guard.name, 'challenge');
        }

        // Project the guard down to the combat-safe field set before returning
        // it to the ATTACKER. Previously the guard's full private save (ryo,
        // bank, inventory, daily ledgers, mission journals, pets, lifetime
        // counters) was handed to whoever attacked them — a free pre-battle
        // scouting + economic-intel leak. The PvP session endpoint re-hydrates
        // the guard from their authoritative save anyway, so the attacker only
        // needs the combat/display fields this projection keeps.
        const safeGuardCharacter = stripNonCombatFields(guardCharacter);
        return res.status(200).json({ pvp: true, guardCharacter: safeGuardCharacter, guardName: guard.name });
    } catch (err) {
        console.error('[village-guard/challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
