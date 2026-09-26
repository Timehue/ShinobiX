import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, setSafeRecordValue } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { LockContendedError, withKvLock } from '../../_lock.js';
import { parseSettlementRequestId } from '../../_settlement-receipts.js';
import { runSaveDebitSaga, saveDebitTransactionId, SaveDebitRefusal } from '../../_save-debit-saga.js';
import { economyTxKey, type EconomyTxRecord } from '../../_economy-tx.js';
import { CLAN_WAR_DECLARE_SAGA, type ClanWarDeclarePlan } from '../../_save-debit-kinds.js';
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

// War Room clan-upgrade bonus to the starting war-HP pool, +2 HP per level.
// KEEP IN SYNC with shinobij.client/src/lib/clan-upgrades.ts (WAR_ROOM_HP_PER_LEVEL).
const WAR_ROOM_HP_PER_LEVEL = 2;
function warRoomBonusHp(rec: { upgrades?: Record<string, number> } | null | undefined): number {
    const lvl = Number(rec?.upgrades?.warRoom ?? 0);
    return Number.isFinite(lvl) && lvl > 0 ? Math.floor(lvl) * WAR_ROOM_HP_PER_LEVEL : 0;
}
// Warmonger Doctrine adds a flat clan-war HP bonus to the starting pool.
// KEEP IN SYNC with shinobij.client/src/lib/clan-doctrines.ts (DOCTRINE_WAR_HP).
const DOCTRINE_WAR_HP = 100;
function doctrineWarHp(rec: { doctrine?: string } | null | undefined): number {
    return rec?.doctrine === 'warmonger' ? DOCTRINE_WAR_HP : 0;
}

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

        // A retry of a declaration that already charged is finished or
        // replayed from its journal. The checks below would refuse it: its own
        // war may already stand, and the declarer may have changed role since.
        const requestId = parseSettlementRequestId(body?.requestId);
        if (!identity.admin && requestId) {
            const journal = await kv.get<EconomyTxRecord>(economyTxKey(saveDebitTransactionId(CLAN_WAR_DECLARE_SAGA.kind, identity.name, requestId)));
            const fromClan = journal?.meta?.fromClan;
            const toClan = journal?.meta?.toClan;
            if (journal && journal.state !== 'refunded' && typeof fromClan === 'string' && typeof toClan === 'string') {
                if (toClan.toLowerCase() !== requestedToClan.toLowerCase()) {
                    return res.status(409).json({ error: 'That request id was already used for a different action.' });
                }
                const outcome = await runSaveDebitSaga<Record<string, unknown>, ClanWarDeclarePlan, Record<string, never>>({
                    definition: CLAN_WAR_DECLARE_SAGA,
                    playerName: identity.name,
                    requestId,
                    identity: { war: clanWarPairId(fromClan, toClan) },
                    sharedKey: clanWarKey(fromClan, toClan),
                    resource: 'honorSeals',
                    amount: CLAN_WAR_DECLARATION_COST,
                    meta: { fromClan, toClan },
                    // Only reached when the debit receipt is gone, and the
                    // journal says this request already charged.
                    decide: () => ({ ok: false, status: 409, error: 'This declaration needs an administrator to finish it.', details: { reconcile: true } }),
                });
                return res.status(200).json({ war: outcome.shared, character: outcome.character, _saveVersion: outcome._saveVersion });
            }
        }

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
        const toClanRecord = await kv.get<{ name?: string; village?: string; members?: unknown[]; upgrades?: Record<string, number>; doctrine?: string }>(`save:${toClanSlug}`);
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

        // War Room clan-upgrade: each clan's starting HP pool is the base plus
        // its own War Room bonus. toClanRecord is already loaded; load fromClan's
        // record for its upgrades (cheap — declare is a rare action).
        const fromClanSlug = `clan-${fromClan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const fromClanRecord = await kv.get<{ upgrades?: Record<string, number>; doctrine?: string }>(`save:${fromClanSlug}`);
        const fromStartHp = CLAN_WAR_HP_MAX + warRoomBonusHp(fromClanRecord) + doctrineWarHp(fromClanRecord);
        const toStartHp = CLAN_WAR_HP_MAX + warRoomBonusHp(toClanRecord) + doctrineWarHp(toClanRecord);

        const sortedClans: [string, string] = [fromClan, toClan].sort((a, b) => a.localeCompare(b)) as [string, string];
        const id = clanWarPairId(fromClan, toClan);
        const key = clanWarKey(fromClan, toClan);
        const buildWar = (now: number): ClanWar => {
            const villages: Record<string, string> = {};
            const hp: Record<string, number> = {};
            const hpMax: Record<string, number> = {};
            setSafeRecordValue(villages, fromClan, ctx.village);
            setSafeRecordValue(villages, toClan, toVillage);
            setSafeRecordValue(hp, fromClan, fromStartHp);
            setSafeRecordValue(hp, toClan, toStartHp);
            setSafeRecordValue(hpMax, fromClan, fromStartHp);
            setSafeRecordValue(hpMax, toClan, toStartHp);
            return {
                id,
                clans: sortedClans,
                villages,
                hp,
                hpMax,
                startedAt: now,
                updatedAt: now,
                declaredBy: identity.admin ? 'admin' : (ctx.name || identity.name),
                pendingChallenges: [],
                completedChallenges: [],
                warCrateId: `clan-war-crate-${id}`,
            };
        };

        if (identity.admin) {
            // An admin declaration (testing) charges nothing, so there is
            // nothing to settle: re-check under the pair lock and write.
            const result = await withKvLock(key, async () => {
                const existing = await kv.get<ClanWar>(key);
                if (existing && !existing.endedAt) {
                    return { status: 409 as const, body: { error: 'War already exists for this clan pair.', war: existing } };
                }
                const war = buildWar(Date.now());
                await kv.set(key, war);
                return { status: 200 as const, body: { war } };
            }, { failClosed: true });
            return res.status(result.status).json(result.body);
        }

        // The Honor Seal cost and the war record settle as one retry-safe
        // saga (api/_save-debit-saga.ts), under the same pair lock as before
        // and then the declarer's save. The war used to be written after a
        // plain debit: when that write failed the seals were gone with no war
        // and no record, and pressing Declare again charged a second 100. Now
        // a war write that provably failed refunds the seals (503, refunded),
        // and one whose outcome is unknown is finished by the retry with the
        // same request id, never charged twice.
        const outcome = await runSaveDebitSaga<Record<string, unknown>, ClanWarDeclarePlan, Record<string, never>>({
            definition: CLAN_WAR_DECLARE_SAGA,
            playerName: identity.name,
            requestId,
            identity: { war: id },
            sharedKey: key,
            resource: 'honorSeals',
            amount: CLAN_WAR_DECLARATION_COST,
            meta: { fromClan, toClan },
            decide: ({ character, shared }) => {
                // Re-check under the lock so two simultaneous declares for the
                // same pair cannot both succeed.
                if (shared?.startedAt && !shared.endedAt) {
                    return { ok: false, status: 409, error: 'War already exists for this clan pair.', details: { war: shared } };
                }
                const balance = Number(character.honorSeals ?? 0);
                if (balance < CLAN_WAR_DECLARATION_COST) {
                    return {
                        ok: false,
                        status: 400,
                        error: `Declaring war costs ${CLAN_WAR_DECLARATION_COST} Honor Seals. You hold ${balance}.`,
                        details: { cost: CLAN_WAR_DECLARATION_COST, balance },
                    };
                }
                return {
                    ok: true,
                    character: { ...character, honorSeals: balance - CLAN_WAR_DECLARATION_COST },
                    plan: { war: buildWar(Date.now()) as unknown as Record<string, unknown>, cost: CLAN_WAR_DECLARATION_COST },
                    result: {},
                };
            },
            messages: {
                refunded: 'The war could not be declared, so your Honor Seals were refunded. Please retry.',
                pending: 'Your Honor Seals were spent but the war was not declared yet. Press Declare again to finish it; you will not be charged twice.',
            },
        });
        // The character travels with its version, so the global client echo
        // leaves it to the caller; this screen refetches on its next save.
        return res.status(200).json({ war: outcome.shared, character: outcome.character, _saveVersion: outcome._saveVersion });
    } catch (err) {
        if (err instanceof SaveDebitRefusal) return res.status(err.status).json({ ...err.details, error: err.message });
        if (err instanceof LockContendedError) return res.status(503).json({ error: 'The war table is busy. Nothing was spent; try again.', retryable: true });
        console.error('[clan/war/declare]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
