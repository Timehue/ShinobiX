import { safeLogValue } from '../_safe-log.js';
import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applySectorExploreReward, rollSectorExploreOutcome } from './_explore.js';
import { isWildSector } from '../../shared/sector-geo.js';
import { DAILY_ANCIENT_CHEST_LIMIT } from './_chest.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import {
    cleanPetEncounterPointer,
    petEncounterActiveKey,
    petEncounterRequestKey,
    PET_ENCOUNTER_POINTER_TTL_SECONDS,
} from '../pet/_encounter-pointer.js';
import { resolveFreeDungeonMiss, unresolvedFreeDungeonMiss } from '../dungeon/_run.js';
import {
    cleanWorldExploreAuthorityReceipt,
    WORLD_EXPLORE_RECEIPT_TTL_SECONDS,
    worldExploreAuthorityKey,
    type WorldExploreAuthorityReceipt,
} from './_explore-authority.js';
import { creditFieldExploreProgress } from '../missions/_field-explore-progress.js';
import {
    loadSectorPoolFrame, readSectorPool, reserveSectorPool, sectorPoolHasRoom,
    type SectorPoolFrame, type SectorPoolReservation,
} from './_sector-pool.js';
import { creditSectorIntel, INTEL_PER_EXPLORE } from '../_village-intel.js';
import { creditSectorContractProgress } from '../_sector-contracts.js';
import { villageStoresEnabled } from '../_release-flags.js';
import { addPendingWorldReward, settlePendingWorldReward } from './_pending-rewards.js';

function cleanRequestId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

type ExternalExploreProof = { kind: 'dungeon' | 'pet'; token: string };

function cleanExternalExploreProof(value: unknown): ExternalExploreProof | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const kind = raw.kind === 'dungeon' || raw.kind === 'pet' ? raw.kind : null;
    const token = typeof raw.token === 'string' ? raw.token.trim().slice(0, 96) : '';
    return kind && /^[A-Za-z0-9]{8,96}$/.test(token) ? { kind, token } : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = cleanRequestId(body.requestId);
        if (!playerName || !requestId) return res.status(400).json({ error: 'Invalid player or request id.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your exploration.' });
        const durableKey = worldExploreAuthorityKey(playerName, requestId);
        const durable = cleanWorldExploreAuthorityReceipt(await kv.get(durableKey));
        if (durable && (durable.playerName.toLowerCase() !== playerName.toLowerCase()
            || durable.sector !== Math.floor(Number(body.sector)))) {
            return res.status(409).json({ error: 'That exploration request id is already bound to another sector.' });
        }
        // Exact lost-ACK replay bypasses the new-action throttle.
        if (!durable && !identity.admin && !(await enforceRateLimitKv(req, res, 'world-explore', 180, 60_000, identity.name))) return;

        // The wild pays out only to someone actually standing in it — the same
        // rule attacking already follows. Without this, a client can report
        // sector 0 (unattackable town presence) and still farm the field.
        const today = new Date().toISOString().slice(0, 10);
        const externalProof = cleanExternalExploreProof(body.externalOutcomeProof);
        if (body.externalOutcomeProof != null && !externalProof) {
            return res.status(400).json({ error: 'Invalid external exploration proof.' });
        }
        // Non-admin callers cannot select the profitable branch. An omitted or
        // false flag is treated as a request for the server roll, which keeps a
        // rolling deploy safe without preserving the old trust boundary.
        const resolveOutcome = identity.admin ? body.resolveOutcome === true : !externalProof;
        const activePetKey = petEncounterActiveKey(playerName);
        // The contested sector pool is part of Village Stores, so it rides that
        // feature's kill switch end to end. api/world-state.ts already gates the
        // pool DISPLAY on this flag; without the same gate here, DISABLE_VILLAGE_
        // STORES=1 left the pool silently throttling gathering (and refusing
        // tiles with `sector-depleted`) while showing players nothing — the exact
        // opposite of what _release-flags.ts promises the switch does.
        const poolEnabled = villageStoresEnabled();
        // Shared per-sector pool slots taken inside the save mutation, right after
        // the per-player daily limit admits the tile. Held here so any failure
        // AFTER the reservation (save write, durable receipt) hands them back.
        //
        // `chest` is the SECOND slot a chest tile takes: the shared chest pool is
        // debited at DISCOVERY, not at open. Reserving it at open meant a chest
        // the player already held — already counted against their own daily chest
        // limit — could be refused forever with `sector-depleted`, which the
        // client outbox then retired while the server-side pending mirror kept
        // re-importing it (a toast loop over loot nobody could ever collect).
        const pool: {
            reservation: SectorPoolReservation | null;
            chest: SectorPoolReservation | null;
            village: string | undefined;
            frame: SectorPoolFrame | null;
            /** Latched once the save mutation carrying this request's reward and
             *  discovery has COMMITTED. From then on the reservation is owed:
             *  the player holds an exploration (and possibly a chest) that the
             *  shared counters must keep counting, and the same-id retry replays
             *  the committed receipt without reserving again. Releasing after
             *  this point refunded a slot nobody gave back. */
            committed: boolean;
        } = { reservation: null, chest: null, village: undefined, frame: null, committed: false };
        const releasePool = async () => {
            if (pool.committed) return;
            for (const slot of ['reservation', 'chest'] as const) {
                const held = pool[slot];
                if (!held?.ok) continue;
                pool[slot] = null;
                await held.release().catch((err) => console.error('[world/explore] pool release', safeLogValue(err)));
            }
        };
        // Territory + pool snapshot read ONCE, outside `lock:save:<name>`. Doing
        // it inside spent part of that lock's 5s TTL on KV round-trips under
        // exactly the crowd the pool exists for.
        const requestedSector = Math.floor(Number(body.sector));
        if (poolEnabled && isWildSector(requestedSector)) {
            pool.frame = await loadSectorPoolFrame(requestedSector).catch(() => null);
        }
        const result = await withKvLock(activePetKey, async () => {
            const mutation = await mutatePlayerSave(playerName, async ({ character }) => {
            pool.village = typeof character.village === 'string' ? character.village : undefined;
            const receipts = Array.isArray(character.redeemedSectorExplorations)
                ? (character.redeemedSectorExplorations as Array<Record<string, unknown>>).filter((entry) => entry && typeof entry.id === 'string')
                : [];
            const activePet = cleanPetEncounterPointer(await kv.get(activePetKey));
            const pendingDungeonMiss = unresolvedFreeDungeonMiss(character);
            const prior = receipts.find((entry) => entry.id === requestId);
            if (prior || durable) {
                const authority = prior ?? durable!;
                const replayCharacter = pendingDungeonMiss?.requestId === requestId
                    ? resolveFreeDungeonMiss(character, requestId)
                    : character;
                return {
                ok: true as const,
                character: replayCharacter,
                value: {
                    reward: authority.reward,
                    outcome: authority.outcome,
                    replayed: true,
                    exploreReceiptAt: Number(authority.at),
                    ...(activePet?.outcome === 'miss'
                        && activePet.requestId === requestId
                        && activePet.sector === Number(authority.sector)
                        ? { petMissRequestId: activePet.requestId }
                        : durable?.petMissRequestId ? { petMissRequestId: durable.petMissRequestId }
                        : {}),
                },
                write: replayCharacter === character ? false as const : true,
                };
            }
            let petMissRequestId = '';
            if (pendingDungeonMiss && pendingDungeonMiss.requestId !== requestId) {
                return {
                    ok: false as const,
                    status: 409,
                    error: JSON.stringify({
                        error: 'pending-dungeon-discovery',
                        reason: 'pending-dungeon-discovery',
                        requestId: pendingDungeonMiss.requestId,
                        sector: pendingDungeonMiss.sector,
                    }),
                };
            }
            if (!externalProof) {
                const activeDungeon = character.activeDungeonRun && typeof character.activeDungeonRun === 'object'
                    ? character.activeDungeonRun as Record<string, unknown>
                    : null;
                if (activeDungeon?.entry === 'free' && activeDungeon.token && !activeDungeon.exploreReceiptId) {
                    return { ok: false as const, status: 409, error: 'pending-dungeon-discovery' };
                }
                if (activePet && activePet.playerName.toLowerCase() === playerName.toLowerCase()) {
                    if (activePet.outcome === 'miss') {
                        if (activePet.requestId !== requestId
                            || activePet.sector !== Math.floor(Number(body.sector))) {
                            return {
                                ok: false as const,
                                status: 409,
                                error: JSON.stringify({
                                    error: 'pending-pet-discovery',
                                    reason: 'pending-pet-discovery',
                                    requestId: activePet.requestId,
                                    sector: activePet.sector,
                                }),
                            };
                        }
                        petMissRequestId = activePet.requestId;
                    } else if (activePet.token && activePet.pet) {
                        const tokenKey = `pet-encounter:${playerName}:${activePet.token}`;
                        let activeToken = await kv.get<Record<string, unknown>>(tokenKey);
                        if (!activeToken) {
                            activeToken = {
                                playerName,
                                token: activePet.token,
                                pet: activePet.pet,
                                sector: activePet.sector,
                                mintedAt: activePet.mintedAt,
                                requestId: activePet.requestId,
                            };
                            await kv.set(tokenKey, activeToken, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                        }
                        const boundReceiptId = typeof activeToken?.exploreReceiptId === 'string' ? activeToken.exploreReceiptId : '';
                        const settled = boundReceiptId && receipts.some((entry) => entry.id === boundReceiptId);
                        return {
                            ok: false as const,
                            status: 409,
                            error: settled ? 'pending-pet-choice' : 'pending-pet-discovery',
                        };
                    }
                }
                // Presence authorizes a NEW ordinary exploration. A sealed pet
                // or dungeon token already proved presence at its own sector,
                // so ACK-loss recovery may settle after movement/reconnect.
                if (!petMissRequestId && !pendingDungeonMiss) {
                    const presenceBlock = sectorPresenceBlock(playerName, body.sector);
                    if (presenceBlock && !identity.admin) {
                        return { ok: false as const, status: presenceBlock.status, error: presenceBlock.error };
                    }
                }
            }
            let authorityCharacter = character;
            if (externalProof?.kind === 'dungeon') {
                const active = character.activeDungeonRun && typeof character.activeDungeonRun === 'object'
                    ? character.activeDungeonRun as Record<string, unknown>
                    : null;
                if (!active
                    || active.entry !== 'free'
                    || active.token !== externalProof.token
                    || Number(active.sector) !== Math.floor(Number(body.sector))) {
                    return { ok: false as const, status: 409, error: 'missing-dungeon-discovery' };
                }
                const boundReceiptId = typeof active.exploreReceiptId === 'string' ? active.exploreReceiptId : '';
                if (boundReceiptId && boundReceiptId !== requestId) {
                    return { ok: false as const, status: 409, error: 'dungeon-discovery-already-used' };
                }
                authorityCharacter = {
                    ...character,
                    activeDungeonRun: { ...active, exploreReceiptId: requestId },
                };
            } else if (externalProof?.kind === 'pet') {
                const key = `pet-encounter:${playerName}:${externalProof.token}`;
                const raw = await kv.get<Record<string, unknown>>(key);
                if (!raw
                    || String(raw.playerName ?? '').toLowerCase() !== playerName.toLowerCase()
                    || Number(raw.sector) !== Math.floor(Number(body.sector))) {
                    return { ok: false as const, status: 409, error: 'missing-pet-discovery' };
                }
                const boundReceiptId = typeof raw.exploreReceiptId === 'string' ? raw.exploreReceiptId : '';
                if (boundReceiptId && boundReceiptId !== requestId) {
                    return { ok: false as const, status: 409, error: 'pet-discovery-already-used' };
                }
                if (!boundReceiptId) {
                    const bound = { ...raw, exploreReceiptId: requestId };
                    const committed = await kv.compareSet(key, raw, bound, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                    if (!committed) {
                        const readback = await kv.get<Record<string, unknown>>(key);
                        if (readback?.exploreReceiptId !== requestId) {
                            return { ok: false as const, status: 409, error: 'pet-discovery-already-used' };
                        }
                    }
                }
            }
            const storedChestDate = typeof character.serverChestDate === 'string' ? character.serverChestDate : '';
            const chestsToday = storedChestDate === today
                ? Math.max(0, Math.floor(Number(character.serverChestsToday) || 0))
                : 0;
            // A sector whose SHARED chest pool is spent stops rolling chests
            // entirely — the tile falls through to the battle/quiet branches
            // exactly as it already does at the per-player chest ceiling. That
            // is the graceful degradation; refusing the tile outright, or
            // minting a chest the pool can't back, are both worse.
            const chestPoolHasRoom = !pool.frame || sectorPoolHasRoom(pool.frame, 'chests', pool.village);
            const rolledOutcome = resolveOutcome
                ? rollSectorExploreOutcome(
                    () => randomInt(1_000_000_000) / 1_000_000_000,
                    chestsToday < DAILY_ANCIENT_CHEST_LIMIT && chestPoolHasRoom,
                )
                : externalProof
                    ? { kind: 'external' as const, source: externalProof.kind }
                    : undefined;
            // Discovering a chest reserves that day's finite slot in this same
            // save mutation. Opening later only consumes the sealed discovery;
            // players cannot bank unlimited chest outcomes before cashing them.
            const outcome = rolledOutcome?.kind === 'chest'
                ? {
                    ...rolledOutcome,
                    reservationDate: today,
                    reservationOrdinal: chestsToday + 1,
                    // Also claims the SHARED chest slot below, before this
                    // discovery is sealed. open-chest reads this and skips
                    // reserving, so the chest can never be refused at open.
                    // False while Village Stores is switched off: nothing was
                    // debited, so a later open (with the switch back on) is a
                    // legacy-shaped best-effort debit rather than a double count.
                    poolReserved: poolEnabled,
                }
                : rolledOutcome;
            // Once the server resolves the branch, a chest or battle counts as
            // the explored tile but cannot also collect the quiet-tile ryo.
            // Legacy pet/dungeon callers may still explicitly request `tile`.
            const credit = externalProof
                ? 'tile' as const
                : resolveOutcome
                    ? (outcome?.kind === 'none' ? 'full' as const : 'tile' as const)
                    : (body.credit === 'tile' ? 'tile' as const : 'full' as const);
            const applied = applySectorExploreReward(authorityCharacter, body.sector, today, credit);
            if (!applied.ok) return { ok: false as const, status: 409, error: applied.reason };
            // The sector itself is finite: same failure shape as `daily-limit`,
            // reserved only once the player's own limit has admitted the tile.
            //
            // EXEMPTION — an explore carrying an `externalProof` is the settle
            // leg of a wild-pet or free-dungeon discovery the server ALREADY
            // committed (a pet-encounter pointer with a 32-day TTL, or an active
            // free dungeon run). Refusing it here left that pointer uncleared,
            // and api/world/explore.ts then answered `pending-pet-discovery` /
            // `pending-pet-choice` to every subsequent explore in EVERY sector —
            // one depleted-sector discovery soft-locked exploring for the rest of
            // the day. A committed discovery must always be able to settle; it
            // pays no explore ryo (credit 'tile') and the tile it counts was
            // already admitted by the player's own daily limit above.
            if (!externalProof && poolEnabled) {
                pool.reservation = await reserveSectorPool(applied.reward.sector, 'explores', pool.village, Date.now(), pool.frame?.owner);
                if (!pool.reservation.ok) {
                    const depleted = pool.reservation;
                    pool.reservation = null;
                    return {
                        ok: false as const,
                        status: 409,
                        error: JSON.stringify({ error: 'sector-depleted', reason: 'sector-depleted', sectorPool: depleted.view }),
                    };
                }
                if (outcome?.kind === 'chest') {
                    // Race-only path: the advisory snapshot said there was room
                    // and the locked debit disagreed. Refuse the tile now, while
                    // nothing has been written and no chest exists yet — that is
                    // strictly better than sealing a discovery the pool can't back.
                    pool.chest = await reserveSectorPool(applied.reward.sector, 'chests', pool.village, Date.now(), pool.frame?.owner);
                    if (!pool.chest.ok) {
                        const depleted = pool.chest;
                        pool.chest = null;
                        await releasePool();
                        return {
                            ok: false as const,
                            status: 409,
                            error: JSON.stringify({ error: 'sector-depleted', reason: 'sector-depleted', sectorPool: depleted.view }),
                        };
                    }
                }
            }
            // Village Stores — Intel is credited AFTER this mutation returns; see
            // the call below `lock:save:<name>`.
            const exploredAt = Date.now();
            const receipt = {
                id: requestId,
                sector: applied.reward.sector,
                reward: applied.reward,
                ...(outcome ? { outcome } : {}),
                at: exploredAt,
            };
            const nextCharacterBeforeDungeonResolution = outcome?.kind === 'chest'
                ? {
                    ...applied.character,
                    serverChestDate: today,
                    serverChestsToday: chestsToday + 1,
                }
                : applied.character;
            const nextCharacter = resolveFreeDungeonMiss(nextCharacterBeforeDungeonResolution, requestId);
            return {
                ok: true as const,
                character: { ...nextCharacter, redeemedSectorExplorations: [...receipts.slice(-149), receipt] },
                value: {
                    reward: applied.reward,
                    outcome,
                    replayed: false,
                    exploreReceiptAt: exploredAt,
                    ...(petMissRequestId ? { petMissRequestId } : {}),
                },
            };
            });
            // The primary operation is durable from here: nothing after this line
            // may hand the shared-sector debit back (see `pool.committed`).
            if (mutation.ok) pool.committed = true;
            if (mutation.ok && 'petMissRequestId' in mutation.value && mutation.value.petMissRequestId) {
                const active = cleanPetEncounterPointer(await kv.get(activePetKey));
                if (active?.outcome === 'miss' && active.requestId === mutation.value.petMissRequestId) {
                    const receiptKey = petEncounterRequestKey(playerName, active.requestId);
                    const priorAttempt = await kv.get<Record<string, unknown>>(receiptKey);
                    await kv.set(receiptKey, {
                        version: 1,
                        playerName,
                        requestId: active.requestId,
                        day: new Date(active.mintedAt).toISOString().slice(0, 10),
                        sector: active.sector,
                        mintedAt: active.mintedAt,
                        ...priorAttempt,
                        resolvedAt: Date.now(),
                        resolution: 'explored-miss',
                        worldExploreRequestId: requestId,
                    }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                    await kv.del(activePetKey);
                }
            }
            return mutation;
        }, { failClosed: true }).catch(async (err: unknown) => { await releasePool(); throw err; });
        if (!result.ok) {
            await releasePool();
            try {
                const details = JSON.parse(result.error) as Record<string, unknown>;
                if (details && typeof details.error === 'string') return res.status(result.status).json(details);
            } catch { /* plain error */ }
            return res.status(result.status).json({ error: result.error, reason: result.error });
        }
        // Village Stores — Intel: exploring ground your village does not own
        // scouts it (api/_village-intel.ts). Best-effort, and never fails the
        // explore — which is exactly why it runs HERE rather than inside
        // `mutatePlayerSave`: it is a KV read plus its own nested lock, and
        // holding `lock:save:<name>` across it spent that lock's 5s TTL on
        // round-trips under the crowd the pool exists for (the same reason the
        // territory/pool snapshot above is read outside the lock). It needs only
        // `character.village`, already captured into `pool.village`, and
        // `pool.frame.owner` — this request's already-read territory row, so the
        // credit does not re-read `world:territory:<sector>`. Credit rules are
        // unchanged: a fresh explore scouts, a replay never did and still does not.
        if (!result.value.replayed) {
            const scoutedSector = Math.floor(Number((result.value.reward as Record<string, unknown>)?.sector ?? body.sector));
            await creditSectorIntel(pool.village, scoutedSector, INTEL_PER_EXPLORE, Date.now(), pool.frame?.owner).catch(() => undefined);
            // Sector Contracts ride the same receipt for the same reason: the
            // server watched this explore land, so contract progress is never a
            // client tally. Best-effort and outside the save lock, exactly like
            // the intel credit above — a storage blip must not fail an explore
            // that already paid. A replay does not tick, so a retried request
            // cannot inflate progress.
            await creditSectorContractProgress(playerName, scoutedSector).catch(() => undefined);
        }
        let authority = durable;
        try {
            if (!authority) {
                authority = {
                    version: 1,
                    playerName,
                    requestId,
                    sector: Math.floor(Number((result.value.reward as Record<string, unknown>)?.sector ?? body.sector)),
                    reward: result.value.reward as Record<string, unknown>,
                    ...(result.value.outcome && typeof result.value.outcome === 'object'
                        ? { outcome: result.value.outcome as Record<string, unknown> }
                        : {}),
                    ...('petMissRequestId' in result.value && typeof result.value.petMissRequestId === 'string'
                        ? { petMissRequestId: result.value.petMissRequestId }
                        : {}),
                    at: Math.floor(Number(result.value.exploreReceiptAt) || Date.now()),
                } satisfies WorldExploreAuthorityReceipt;
                await kv.set(durableKey, authority, { ex: WORLD_EXPLORE_RECEIPT_TTL_SECONDS });
            }
            const fieldProgress = await creditFieldExploreProgress({
                playerName,
                requestId,
                sector: authority.sector,
                proofAt: authority.at,
            });
            // Account-side mirror of the browser outbox: an unopened chest is the
            // one outcome whose payout is still outstanding after the receipt is
            // durable, so list it until /world/open-chest settles it. A replay of
            // anything else is a retry that already has nothing owed — drop any
            // stale entry so a fresh device stops re-posting it. Listing is
            // fatal (503 → same-id retry); un-listing is advisory.
            const chestUnopened = authority.outcome?.kind === 'chest' && !authority.outcome.openedLoot;
            if (chestUnopened) {
                await addPendingWorldReward(playerName, { kind: 'explore', requestId, sector: authority.sector });
            } else if (result.value.replayed) {
                await settlePendingWorldReward(playerName, requestId)
                    .catch((err) => console.error('[world/explore] pending mirror settle', safeLogValue(err)));
            }
            // The chest slot is debited after the explore slot, so its view is
            // the later (and therefore complete) one when both were taken.
            const sectorPool = !poolEnabled
                ? undefined
                : pool.chest?.ok
                    ? pool.chest.view
                    : pool.reservation?.ok
                        ? pool.reservation.view
                        : await readSectorPool(authority.sector, pool.village, Date.now(), pool.frame?.owner).catch(() => undefined);
            return res.status(200).json({ ok: true, ...result.value, fieldProgress, sectorPool, character: result.character, _saveVersion: result._saveVersion });
        } catch (sideEffectError) {
            // The save mutation above has COMMITTED the reward/discovery and its
            // receipt; only the secondary work (durable receipt, field progress,
            // pending-chest mirror) is still owed. The slots stay debited: the
            // player holds the exploration those slots paid for, and the same-id
            // retry replays the committed receipt without reserving again — so a
            // release here refunded a slot that was genuinely consumed (and a
            // chest receipt could still say `poolReserved: true` over a counter
            // that no longer counted it). `releasePool` is a no-op once
            // `pool.committed` is latched; it is kept here so the pre-commit
            // contract reads the same in both places.
            await releasePool();
            console.error('[world/explore] durable settlement pending', safeLogValue(sideEffectError));
            return res.status(503).json({ error: 'Exploration settlement is still finalizing.', retryable: true, requestId });
        }
    } catch (error) {
        console.error('[world/explore]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
