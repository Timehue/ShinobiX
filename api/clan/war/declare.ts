import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import {
    CLAN_WAR_HP_MAX,
    clanInActiveWar,
    clanWarCooldownKey,
    clanWarKey,
    clanWarPairId,
    CLAN_WAR_REMATCH_COOLDOWN_SEC,
    loadClanContext,
    canActAsClanLeadership,
    type ClanWar,
} from './_storage.js';

// POST /api/clan/war/declare
// Body: { toClan: string }
//
// Gates:
//   • Authed player must be Founder / Leader / Officer of their clan
//   • Their clan must not be in an active war
//   • Target clan must exist, must not be in an active war
//   • Target clan cannot be the same as actor's clan
//   • Target clan's canonical name must MATCH what the caller typed (case-
//     insensitive). The slug derivation strips spaces and punctuation
//     destructively (`"Clan A"` and `"ClanA"` both map to `clan-clana`),
//     so without this check two clans with similar names could end up at
//     war when only one of them was intended.
//   • Pair-cooldown: same two clans cannot re-war within 7 days of
//     the previous war ending
//   • Declaring player must hold ≥ CLAN_WAR_DECLARATION_COST honor seals
//     (charged off their save on success — same model as the Village War
//     declaration in api/world-state.ts). Free clan wars previously let
//     officers grief-pair every other clan into 7-day cooldowns.
//
// Server-managed: war record + HP (500/500), war crate ID, declaredBy.

// Honor-seal cost to declare. 100 is lower than the 500-seal village war
// cost — clan wars are more frequent and at a smaller scale — but enough
// to make grief-locking a clan into the 7-day cooldown carry real economic
// weight. Admin bypasses (testing).
const CLAN_WAR_DECLARATION_COST = 100;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-war-declare', 4, 60 * 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const requestedToClan = String(body?.toClan ?? '').trim();
        if (!requestedToClan) return res.status(400).json({ error: 'Missing toClan.' });

        // Pull actor's clan context. Admin may declare on behalf of any
        // clan via the `fromClan` body field (testing); regular players
        // must use their own clan.
        const ctx = await loadClanContext(identity.admin ? String(body?.fromClan ?? '') : identity.name);
        const fromClan = identity.admin ? (String(body?.fromClan ?? '') || ctx.clan) : ctx.clan;
        if (!fromClan) return res.status(400).json({ error: 'You must be in a clan to declare war.' });
        if (fromClan === requestedToClan) return res.status(400).json({ error: 'Cannot declare war on your own clan.' });

        if (!identity.admin && !canActAsClanLeadership(ctx.role)) {
            return res.status(403).json({ error: 'Only Clan Founder, Leader, or Officer can declare war.' });
        }

        // Resolve the target clan record + its village. This also acts
        // as the "does the clan exist?" check.
        //
        // Slug strips spaces and punctuation destructively. We re-read the
        // canonical `name` field from the record and verify it matches what
        // the caller typed. This blocks `"Clan-A"` from accidentally
        // declaring war on `"ClanA"` because both share `clan-clana`.
        const toClanSlug = `clan-${requestedToClan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const toClanRecord = await kv.get<{ name?: string; village?: string; members?: unknown[] }>(`save:${toClanSlug}`);
        if (!toClanRecord) return res.status(404).json({ error: 'Target clan not found.' });
        const canonicalToClan = String(toClanRecord.name ?? '').trim();
        if (!canonicalToClan) return res.status(409).json({ error: 'Target clan record is missing its canonical name.' });
        if (canonicalToClan.toLowerCase() !== requestedToClan.toLowerCase()) {
            return res.status(409).json({
                error: `Clan name "${requestedToClan}" does not match the canonical record "${canonicalToClan}".`,
            });
        }
        // Use the canonical name from here on so the war record, cooldowns,
        // and pair-id all key against the real clan identity.
        const toClan = canonicalToClan;
        const toVillage = String(toClanRecord.village ?? '');

        // Cooldown check.
        const cd = await kv.get(clanWarCooldownKey(fromClan, toClan));
        if (cd) return res.status(409).json({ error: 'These two clans were at war within the last 7 days.' });

        // Single-war-per-clan rule (each clan).
        if (await clanInActiveWar(fromClan)) return res.status(409).json({ error: `${fromClan} is already in a clan war.` });
        if (await clanInActiveWar(toClan)) return res.status(409).json({ error: `${toClan} is already in a clan war.` });

        // Honor-seal cost (non-admin). Charged off the declaring player's
        // save. Read-modify-write held under lock:save:<name> so a
        // concurrent auto-save can't undo the debit.
        if (!identity.admin) {
            const saveKey = `save:${identity.name}`;
            const debitError = await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!char) return { status: 404 as const, body: { error: 'Declaring character not found.' } };
                const balance = Number(char.honorSeals ?? 0);
                if (balance < CLAN_WAR_DECLARATION_COST) {
                    return {
                        status: 400 as const,
                        body: {
                            error: `Declaring war costs ${CLAN_WAR_DECLARATION_COST} Honor Seals. You hold ${balance}.`,
                            cost: CLAN_WAR_DECLARATION_COST,
                            balance,
                        },
                    };
                }
                const updated = {
                    ...record,
                    character: {
                        ...char,
                        honorSeals: balance - CLAN_WAR_DECLARATION_COST,
                    },
                };
                await kv.set(saveKey, updated);
                return null;
            });
            if (debitError) return res.status(debitError.status).json(debitError.body);
        }

        const sortedClans: [string, string] = [fromClan, toClan].sort((a, b) => a.localeCompare(b)) as [string, string];
        const id = clanWarPairId(fromClan, toClan);
        const key = clanWarKey(fromClan, toClan);

        const result = await withKvLock(key, async () => {
            // Re-check under the lock to avoid two simultaneous declares
            // for the same pair both succeeding.
            const existing = await kv.get<ClanWar>(key);
            if (existing && !existing.endedAt) {
                return { status: 409 as const, body: { error: 'War already exists for this clan pair.', war: existing } };
            }
            const now = Date.now();
            const war: ClanWar = {
                id,
                clans: sortedClans,
                villages: {
                    [fromClan]: ctx.village,
                    [toClan]: toVillage,
                },
                hp: {
                    [fromClan]: CLAN_WAR_HP_MAX,
                    [toClan]: CLAN_WAR_HP_MAX,
                },
                startedAt: now,
                updatedAt: now,
                declaredBy: identity.admin ? 'admin' : (ctx.name || identity.name),
                pendingChallenges: [],
                completedChallenges: [],
                warCrateId: `clan-war-crate-${id}`,
            };
            await kv.set(key, war);
            return { status: 200 as const, body: { war } };
        });
        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[clan/war/declare]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
