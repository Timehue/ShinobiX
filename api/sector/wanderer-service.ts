import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict } from '../save/_projected-write.js';
import {
    claimWandererUseCooldown,
    currentWandererCooldownUntil,
    naturalWandererOffers,
    resolveNaturalWanderer,
    wandererUseCooldownKey,
    withWandererUseState,
} from './_wanderer-encounter.js';
import {
    wandererFavorReward,
    wandererFavorTargetSector,
    wandererMedicOffer,
    wandererMerchantOffer,
} from './_wanderer-service.js';
import { bumpEraDiscoveryContribution } from '../_era.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { recordEconomyTxn } from '../_economy.js';
import { MAX_WILD_SECTOR, playableFieldObjectiveSector } from '../../shared/sector-geo.js';
import { randomUUID } from 'node:crypto';
import { TRACKER_TRAIL_TTL_MS, trackerTrailSectors, type TrackerTrail } from '../../shared/tracker-trail.js';
import type { WandererVerb } from '../../shared/wanderer-roster.js';
import { loadTrackerTrail, saveTrackerTrail, trackerTrailEncounterLive, trackerTrailInProgress, trackerTrailKey } from './_tracker-trail.js';
import { linkLifeTracking } from './_life-tracking.js';
import { lifeStorageKey,parseLifeState } from '../../shared/sector-life.js';
import { LIFE_HUNT_LINES } from '../../shared/sector-life-tracking.js';

type FavorRecord = {
    id: string;
    originSector: number;
    targetSector: number;
    giver: string;
    expiresAt: number;
};

/** Which rolled wanderers may perform each road service. Favors are offered
 *  only by trackers (WorldWandererDialog's "Take a favor"). */
const SERVICE_VERBS: Record<'merchant' | 'medic' | 'favor-start' | 'tracker-trail-start', readonly WandererVerb[]> = {
    merchant: ['merchant'],
    medic: ['medic'],
    'favor-start': ['tracker'],
    'tracker-trail-start': ['tracker'],
};

/** Services that happen in one sector. Each must name it: an omitted sector used
 *  to skip the presence gate and default to sector 1, so a merchant, medic or
 *  favour could be used from anywhere. Abandoning a trail is not sector-bound. */
const SECTOR_BOUND_ACTIONS: ReadonlySet<string> = new Set([
    'merchant', 'medic', 'favor-start', 'favor-claim', 'tracker-trail-start', 'tracker-trail-step',
]);

const FAVOR_TTL_SECONDS = 24 * 60 * 60;
const favorKeyFor = (playerName: string) => `wanderer-favor:${playerName}`;

function num(v: unknown): number {
    return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function int(v: unknown): number {
    return Math.floor(num(v));
}

function cleanShortText(v: unknown, fallback: string): string {
    const s = String(v ?? '').replace(/[^\w .'-]/g, '').trim().slice(0, 48);
    return s || fallback;
}

function sectorFrom(v: unknown): number {
    return Math.max(1, Math.min(MAX_WILD_SECTOR, int(v) || 1));
}

/** A service reply, and whether it acknowledges the save version it reflects. */
type Reply = { body: Record<string, unknown>; echo?: boolean };

function replyFor(committed: PlayerSaveMutationResult<Reply>): { status: number; body: Record<string, unknown> } {
    if (!committed.ok) {
        return committed.status === 404
            ? { status: 404, body: { error: 'Your save was not found.' } }
            : { status: committed.status, body: { error: committed.error } };
    }
    const { body, echo } = committed.value;
    return { status: 200, body: echo ? { ...body, _saveVersion: committed._saveVersion } : body };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `wanderer-service-${action}`, 20, 60_000, identity.name))) return;

        if (SECTOR_BOUND_ACTIONS.has(action) && !(int(body.sector) >= 1)) {
            return res.status(400).json({ error: 'Missing sector.' });
        }
        // Same wild-field rule as exploring and attacking: a wanderer service is
        // an in-sector encounter, so the payout requires actually being there
        // (api/_sector-presence-gate.ts). Every sector-bound action carries a
        // sector (checked above); the helper ignores anything below sector 1.
        const presenceBlock = sectorPresenceBlock(playerName, body.sector);
        if (presenceBlock && !identity.admin) {
            return res.status(presenceBlock.status).json({ error: presenceBlock.error, reason: presenceBlock.reason });
        }

        if (action === 'merchant' || action === 'medic' || action === 'favor-start' || action === 'tracker-trail-start') {
            const wandererId = typeof body.wandererId === 'string' ? body.wandererId.trim() : '';
            // Not just the id's SHAPE: the server re-rolls the roster and refuses
            // an id it does not currently put on the road, plus any archetype/
            // verb/level/name the client echoed back that disagrees with that
            // roll. `wandererName` matters here — favor-start seals the claimed
            // name into the favor record the player later delivers. The rolled
            // wanderer must also offer THIS service (SERVICE_VERBS), whatever the
            // client echoed: only merchants trade, medics heal, trackers give
            // favors and trails.
            if (!naturalWandererOffers(wandererId, Date.now(), body, SERVICE_VERBS[action])) {
                return res.status(200).json({ ok: false, reason: 'invalid-wanderer' });
            }
            const sector = sectorFrom(body.sector);
            if(action==='tracker-trail-start'){
                const hunt=parseLifeState(await kv.get(lifeStorageKey(sector)),Date.now()).hunt;
                if(hunt?.trackerId===wandererId&&hunt.owner!==playerName)return res.status(200).json({ok:false,reason:'tracker-away',error:hunt.result?LIFE_HUNT_LINES.unavailable:LIFE_HUNT_LINES.busy});
            }
            let legacyWandererId = '';

            const committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
                const answer = (reply: Record<string, unknown>) => ({ ok: true as const, write: false, character: char, value: { body: reply } });
                const now = Date.now();

                const saveCooldownUntil = currentWandererCooldownUntil(char, wandererId, now);
                if (saveCooldownUntil) {
                    if (await kv.get(wandererUseCooldownKey(playerName, wandererId))) {
                        legacyWandererId = wandererId;
                    }
                    return answer({ ok: false, reason: 'cooldown', cooldownUntil: saveCooldownUntil });
                }
                // The rolled wanderer must stand in the sector the player is in
                // (relocation honoured through char.wandererMoves), so a road
                // service cannot be bought from a sector it was never in.
                if (!resolveNaturalWanderer(wandererId, now, char, sector)) {
                    return answer({ ok: false, reason: 'invalid-wanderer' });
                }

                // Every service below claims the wanderer's hard cooldown row
                // ahead of its save write. A write that loses its compare-and-set
                // committed nothing, so each one hands that row back (and undoes
                // whatever else it wrote first) for the player's retry.
                const releaseCooldown = (cooldownUntil: number | undefined) =>
                    kv.delIfEqual(wandererUseCooldownKey(playerName, wandererId), { cooldownUntil }).then(() => undefined);

                if (action === 'merchant') {
                    const offer = wandererMerchantOffer(char.level, wandererId);
                    if (num(char.ryo) < offer.cost) {
                        return answer({ ok: false, reason: 'no-ryo', offer });
                    }
                    const hardCooldown = await claimWandererUseCooldown(kv, playerName, wandererId, now);
                    if (!hardCooldown.ok) {
                        return answer({ ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil });
                    }
                    const spent = {
                        ...char,
                        ryo: num(char.ryo) - offer.cost,
                        boneCharms: num(char.boneCharms) + offer.boneCharms,
                    };
                    const used = withWandererUseState(spent, wandererId, now, sector);
                    return {
                        ok: true,
                        character: used.character,
                        value: {
                            body: {
                                ok: true,
                                offer,
                                totals: { ryo: used.character.ryo, boneCharms: used.character.boneCharms },
                                cooldownUntil: used.cooldownUntil,
                                moveToSector: used.moveToSector,
                            },
                            echo: true,
                        },
                        onConflict: () => releaseCooldown(hardCooldown.cooldownUntil),
                    };
                }

                if (action === 'medic') {
                    const offer = wandererMedicOffer(char.level, char.hp, char.maxHp, char.chakra, char.maxChakra, char.stamina, char.maxStamina);
                    if (offer.missingHp + offer.missingChakra + offer.missingStamina <= 0) {
                        return answer({ ok: false, reason: 'already-well', offer });
                    }
                    if (num(char.ryo) < offer.cost) {
                        return answer({ ok: false, reason: 'no-ryo', offer });
                    }
                    const hardCooldown = await claimWandererUseCooldown(kv, playerName, wandererId, now);
                    if (!hardCooldown.ok) {
                        return answer({ ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil });
                    }
                    const healed = {
                        ...char,
                        ryo: num(char.ryo) - offer.cost,
                        hp: Math.max(num(char.hp), num(char.maxHp)),
                        chakra: Math.max(num(char.chakra), num(char.maxChakra)),
                        stamina: Math.max(num(char.stamina), num(char.maxStamina)),
                    };
                    const used = withWandererUseState(healed, wandererId, now, sector);
                    return {
                        ok: true,
                        character: used.character,
                        value: {
                            body: {
                                ok: true,
                                offer,
                                totals: {
                                    ryo: used.character.ryo,
                                    hp: used.character.hp,
                                    chakra: used.character.chakra,
                                    stamina: used.character.stamina,
                                },
                                cooldownUntil: used.cooldownUntil,
                                moveToSector: used.moveToSector,
                            },
                            echo: true,
                        },
                        onConflict: () => releaseCooldown(hardCooldown.cooldownUntil),
                    };
                }

                if (action === 'tracker-trail-start') {
                    // Only a tracker gives a trail, and it must be standing in
                    // the sector the player is in (relocation honoured).
                    const tracker = resolveNaturalWanderer(wandererId, now, char, sector);
                    if (tracker?.verb !== 'tracker') {
                        return answer({ ok: false, reason: 'invalid-wanderer' });
                    }
                    const existingTrail = await loadTrackerTrail(playerName);
                    if (existingTrail && await trackerTrailInProgress(playerName, existingTrail, now)) {
                        return answer({ ok: false, reason: 'busy', trail: existingTrail });
                    }
                    const hardCooldown = await claimWandererUseCooldown(kv, playerName, wandererId, now);
                    if (!hardCooldown.ok) {
                        return answer({ ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil });
                    }
                    const trailId = `trail-${wandererId}-${now}`;
                    const trail: TrackerTrail = {
                        id: trailId,
                        requestId: `trk_${randomUUID().replace(/-/g, '')}`,
                        giver: tracker.name,
                        originSector: sector,
                        sectors: trackerTrailSectors(trailId, sector),
                        step: 0,
                        expiresAt: now + TRACKER_TRAIL_TTL_MS,
                    };
                    await saveTrackerTrail(playerName, trail, now);
                    const used = withWandererUseState({ ...char, activeTrackerTrail: trail }, wandererId, now, sector);
                    return {
                        ok: true,
                        character: used.character,
                        value: {
                            body: {
                                ok: true,
                                trail,
                                cooldownUntil: used.cooldownUntil,
                                moveToSector: used.moveToSector,
                            },
                            echo: true,
                        },
                        onConflict: async () => {
                            await releaseCooldown(hardCooldown.cooldownUntil);
                            if ((await loadTrackerTrail(playerName))?.id === trail.id) await kv.del(trackerTrailKey(playerName));
                        },
                    };
                }

                const favorKey = favorKeyFor(playerName);
                const existing = await kv.get<FavorRecord>(favorKey);
                if (existing && num(existing.expiresAt) > now) {
                    return answer({ ok: false, reason: 'busy', favor: { ...existing, targetSector: playableFieldObjectiveSector(existing.targetSector) } });
                }
                if (existing) await kv.del(favorKey).catch(() => undefined);

                const hardCooldown = await claimWandererUseCooldown(kv, playerName, wandererId, now);
                if (!hardCooldown.ok) {
                    return answer({ ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil });
                }
                const favor: FavorRecord = {
                    id: `favor-${wandererId}-${now}`,
                    originSector: sector,
                    targetSector: wandererFavorTargetSector(wandererId, sector),
                    giver: cleanShortText(body.wandererName, 'road courier'),
                    expiresAt: now + FAVOR_TTL_SECONDS * 1000,
                };
                await kv.set(favorKey, favor, { ex: FAVOR_TTL_SECONDS });
                const used = withWandererUseState({ ...char, activeWandererFavor: favor }, wandererId, now, sector);
                return {
                    ok: true,
                    character: used.character,
                    value: {
                        body: {
                            ok: true,
                            favor,
                            cooldownUntil: used.cooldownUntil,
                            moveToSector: used.moveToSector,
                        },
                        echo: true,
                    },
                    onConflict: async () => {
                        await releaseCooldown(hardCooldown.cooldownUntil);
                        await kv.delIfEqual(favorKey, favor);
                    },
                };
            });
            if (committed.ok && committed.value.body.ok === true) legacyWandererId = wandererId;
            const out = replyFor(committed);

            // Telemetry (I-19) for the two road services that move currency, once
            // the save has committed. The cooldown stamp makes each txn id unique.
            if (committed.ok && committed.value.body.ok === true && (action === 'merchant' || action === 'medic')) {
                const offer = committed.value.body.offer as { cost?: unknown; boneCharms?: unknown };
                const totals = committed.value.body.totals as Record<string, unknown>;
                const txnId = `${action}:${playerName}:${wandererId}:${num(committed.value.body.cooldownUntil)}`;
                if (action === 'merchant') {
                    await recordEconomyTxn({ txnId, player: playerName, currency: 'ryo', delta: -num(offer.cost), source: 'wanderer.merchant', balanceAfter: num(totals.ryo) });
                    await recordEconomyTxn({ txnId: `${txnId}:boneCharms`, player: playerName, currency: 'boneCharms', delta: num(offer.boneCharms), source: 'wanderer.merchant', balanceAfter: num(totals.boneCharms) });
                } else {
                    await recordEconomyTxn({ txnId, player: playerName, currency: 'ryo', delta: -num(offer.cost), source: 'wanderer.medic', balanceAfter: num(totals.ryo) });
                }
            }

            if (legacyWandererId) {
                const receiptId = `wanderer-discovery:${legacyWandererId}`;
                const delivered = await bumpLegacyStats(playerName, { sectorDiscoveries: 1 }, { receiptId });
                if (!delivered || !(await bumpEraDiscoveryContribution(playerName, receiptId))) {
                    return res.status(503).json({
                        error: 'The encounter is safe, but its Legacy record is still being sealed. Retry the same wanderer.',
                        code: 'legacy-delivery-pending',
                        retryable: true,
                    });
                }
            }
            if(action==='tracker-trail-start'&&committed.ok){
                if(out.body.reason==='cooldown'){
                    const hunt=parseLifeState(await kv.get(lifeStorageKey(sector)),Date.now()).hunt,trail=await loadTrackerTrail(playerName);
                    if(hunt?.owner===playerName&&!hunt.result&&hunt.trailId===trail?.id&&await trackerTrailInProgress(playerName,trail)){
                        const saved=await kv.get<{_saveVersion?:number}>(`save:${playerName}`);out.body={...out.body,ok:true,trail,_saveVersion:Number(saved?._saveVersion??committed._saveVersion)};
                    }
                }
                if(out.body.ok===true&&out.body.trail)await linkLifeTracking(playerName,out.body.trail,wandererId);
            }
            return res.status(out.status).json(out.body);
        }

        if (action === 'favor-claim') {
            const favorId = typeof body.favorId === 'string' ? body.favorId.trim() : '';
            const sector = sectorFrom(body.sector);
            if (!favorId) return res.status(400).json({ error: 'Missing favorId.' });

            const committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
                const answer = (reply: Record<string, unknown>, echo = false) => ({ ok: true as const, write: false, character: char, value: { body: reply, echo } });
                const now = Date.now();
                const favorKey = favorKeyFor(playerName);
                const favor = await kv.get<FavorRecord>(favorKey);
                if (!favor || favor.id !== favorId) {
                    if (!char.activeWandererFavor) return answer({ ok: false, reason: 'none' }, true);
                    return { ok: true, character: { ...char, activeWandererFavor: null }, value: { body: { ok: false, reason: 'none' }, echo: true } };
                }
                if (num(favor.expiresAt) <= now) {
                    await kv.del(favorKey).catch(() => undefined);
                    return { ok: true, character: { ...char, activeWandererFavor: null }, value: { body: { ok: false, reason: 'expired' }, echo: true } };
                }
                if (sector !== playableFieldObjectiveSector(favor.targetSector)) {
                    return answer({ ok: false, reason: 'wrong-sector', favor: { ...favor, targetSector: playableFieldObjectiveSector(favor.targetSector) } });
                }
                const reward = wandererFavorReward(char.level, favor.id);
                await kv.del(favorKey).catch(() => undefined);
                const updated = {
                    ...char,
                    ryo: num(char.ryo) + reward.ryo,
                    boneCharms: num(char.boneCharms) + reward.boneCharms,
                    activeWandererFavor: null,
                };
                return {
                    ok: true,
                    character: updated,
                    value: {
                        body: {
                            ok: true,
                            reward,
                            totals: { ryo: updated.ryo, boneCharms: updated.boneCharms },
                        },
                        echo: true,
                    },
                    // The favor row was consumed ahead of the payout. A payout
                    // that loses its compare-and-set paid nothing, so the favor
                    // goes back for the player's retry.
                    onConflict: async () => {
                        const ttlSeconds = Math.ceil((num(favor.expiresAt) - Date.now()) / 1000);
                        if (ttlSeconds > 0 && !(await kv.get(favorKey))) await kv.set(favorKey, favor, { ex: ttlSeconds });
                    },
                };
            });
            const out = replyFor(committed);
            if (committed.ok && committed.value.body.ok === true) {
                const reward = committed.value.body.reward as { ryo?: unknown; boneCharms?: unknown };
                const totals = committed.value.body.totals as Record<string, unknown>;
                await recordEconomyTxn({ txnId: `favor:${favorId}`, player: playerName, currency: 'ryo', delta: num(reward.ryo), source: 'wanderer.favor', balanceAfter: num(totals.ryo) });
                await recordEconomyTxn({ txnId: `favor:${favorId}:boneCharms`, player: playerName, currency: 'boneCharms', delta: num(reward.boneCharms), source: 'wanderer.favor', balanceAfter: num(totals.boneCharms) });
            }
            // The encounter itself was credited at favor-start. Delivering the
            // parcel is not a second NPC discovery; counting both made one
            // wanderer worth two sector discoveries and had no replay-safe
            // server receipt after the favor row was consumed.
            return res.status(out.status).json(out.body);
        }

        if (action === 'tracker-trail-step' || action === 'tracker-trail-abandon') {
            const trailId = typeof body.trailId === 'string' ? body.trailId.trim() : '';
            if (!trailId) return res.status(400).json({ error: 'Missing trailId.' });

            const committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
                const answer = (reply: Record<string, unknown>, echo = false) => ({ ok: true as const, write: false, character: char, value: { body: reply, echo } });
                const now = Date.now();
                const trail = await loadTrackerTrail(playerName);
                // Clears the display mirror (and the row, when it is this one).
                // A cleared mirror that loses its compare-and-set self-heals: the
                // retry finds no row and clears it then.
                const clear = async (reason: string, deleteRow: boolean) => {
                    if (deleteRow) await kv.del(trackerTrailKey(playerName)).catch(() => undefined);
                    const reply = { ok: action === 'tracker-trail-abandon', reason };
                    if (!char.activeTrackerTrail) return answer(reply, true);
                    return { ok: true as const, character: { ...char, activeTrackerTrail: null }, value: { body: reply, echo: true } };
                };

                if (!trail || trail.id !== trailId) return clear('none', false);

                if (action === 'tracker-trail-abandon') {
                    // Never pull the proof out from under a live capture battle.
                    if (await trackerTrailEncounterLive(playerName, trail)) {
                        return answer({ ok: false, reason: 'in-battle', trail });
                    }
                    return clear('abandoned', true);
                }

                if (!trail.flushedAt && trail.expiresAt <= now) return clear('expired', true);
                if (trail.step === 1) return answer({ ok: true, trail });
                if (sectorFrom(body.sector) !== trail.sectors[0]) {
                    return answer({ ok: false, reason: 'wrong-sector', trail });
                }
                const advanced: TrackerTrail = { ...trail, step: 1 };
                await saveTrackerTrail(playerName, advanced, now);
                return {
                    ok: true,
                    character: { ...char, activeTrackerTrail: advanced },
                    value: { body: { ok: true, trail: advanced }, echo: true },
                    // The row advanced ahead of the mirror. A mirror write that
                    // loses its compare-and-set leaves the row a step ahead, so
                    // the retry would never write the mirror; step the row back.
                    onConflict: async () => {
                        const current = await loadTrackerTrail(playerName);
                        if (current?.id === trail.id && current.step === 1) await saveTrackerTrail(playerName, trail, Date.now());
                    },
                };
            });
            const out = replyFor(committed);
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) {
            return res.status(503).json({ error: 'The road is busy - please retry.' });
        }
        console.error('[sector/wanderer-service]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
