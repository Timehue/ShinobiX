import { safeLogValue } from '../_safe-log.js';
import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { DAILY_ANCIENT_CHEST_LIMIT, rollAncientChestLoot, settleAncientChestLoot } from './_chest.js';
import { kv } from '../_storage.js';
import {
    cleanWorldExploreAuthorityReceipt,
    WORLD_EXPLORE_RECEIPT_TTL_SECONDS,
    worldExploreAuthorityKey,
} from './_explore-authority.js';
import { loadSectorPoolOwner, readSectorPool, reserveSectorPool, type SectorPoolOwner, type SectorPoolReservation } from './_sector-pool.js';
import { creditSectorIntel, INTEL_PER_CHEST } from '../_village-intel.js';
import { villageStoresEnabled } from '../_release-flags.js';
import { settlePendingWorldReward } from './_pending-rewards.js';

const cleanId = (value: unknown) => {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = cleanId(body.requestId);
        const worldExploreRequestId = cleanId(body.worldExploreRequestId);
        if (!playerName || !requestId || !worldExploreRequestId) {
            return res.status(400).json({ error: 'Invalid player, request id, or exploration proof.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your chest.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'world-open-chest', 30, 60_000, identity.name))) return;
        const durableDiscovery = cleanWorldExploreAuthorityReceipt(await kv.get(
            worldExploreAuthorityKey(playerName, worldExploreRequestId),
        ));
        const today = new Date().toISOString().slice(0, 10);
        // Shared per-sector chest pool. A chest discovered by /world/explore
        // ALREADY took its slot at discovery (`outcome.poolReserved`), so this
        // endpoint never reserves and — critically — never refuses. Reserving
        // here was a permanent loss: the per-player chest slot was already spent
        // at discovery, a 409 is classified definitive by the client outbox, and
        // the server-side pending mirror kept re-importing the entry, so the
        // player got "picked clean for today" on a loop for loot they could
        // never collect. Only a LEGACY discovery (sealed before the cutover)
        // still debits here, and even that is best-effort: a depleted pool is
        // logged as over-draw, not turned into a refusal.
        //
        // The pool is part of Village Stores and rides that feature's kill
        // switch: with DISABLE_VILLAGE_STORES=1 nothing is debited and nothing is
        // reported, matching the pool display gate in api/world-state.ts and the
        // reservation gate in api/world/explore.ts.
        const poolEnabled = villageStoresEnabled();
        const sectorId = Math.floor(Number(body.sector));
        const poolOwner: SectorPoolOwner | null = poolEnabled && Number.isFinite(sectorId) && sectorId > 0
            ? await loadSectorPoolOwner(sectorId).catch(() => null)
            : null;
        const pool: { reservation: SectorPoolReservation | null; village: string | undefined } = { reservation: null, village: undefined };
        const releasePool = async () => {
            if (pool.reservation?.ok) {
                const held = pool.reservation;
                pool.reservation = null;
                await held.release().catch((err) => console.error('[world/open-chest] pool release', safeLogValue(err)));
            }
        };
        const result = await mutatePlayerSave(playerName, async ({ character }) => {
            pool.village = typeof character.village === 'string' ? character.village : undefined;
            const receipts = Array.isArray(character.redeemedAncientChests)
                ? (character.redeemedAncientChests as Array<Record<string, unknown>>).filter((entry) => entry && typeof entry.id === 'string') : [];
            // The payout receipt is sufficient replay authority. Discovery and
            // presence gate a NEW chest only, so ACK-loss can recover after the
            // player moves, disconnects, or the discovery list is compacted.
            const prior = receipts.find((entry) => entry.id === worldExploreRequestId);
            if (prior) return {
                ok: true as const,
                character,
                value: { loot: prior.loot, replayed: true },
                write: false as const,
            };
            const explorationReceipts = Array.isArray(character.redeemedSectorExplorations)
                ? (character.redeemedSectorExplorations as Array<Record<string, unknown>>)
                : [];
            const discovery = explorationReceipts.find((entry) => entry
                && entry.id === worldExploreRequestId
                && Number(entry.sector) === Math.floor(Number(body.sector))
                && typeof entry.outcome === 'object'
                && entry.outcome !== null
                && (entry.outcome as Record<string, unknown>).kind === 'chest')
                ?? (durableDiscovery
                    && durableDiscovery.playerName.toLowerCase() === playerName.toLowerCase()
                    && durableDiscovery.sector === Math.floor(Number(body.sector))
                    && durableDiscovery.outcome?.kind === 'chest'
                    ? {
                        id: durableDiscovery.requestId,
                        sector: durableDiscovery.sector,
                        reward: durableDiscovery.reward,
                        outcome: durableDiscovery.outcome,
                        at: durableDiscovery.at,
                    }
                    : undefined);
            if (!discovery) return { ok: false as const, status: 409, error: 'missing-chest-discovery' };
            const discoveryOutcome = discovery.outcome as Record<string, unknown>;
            if (discoveryOutcome.openedLoot && typeof discoveryOutcome.openedLoot === 'object') {
                return {
                    ok: true as const,
                    character,
                    value: { loot: discoveryOutcome.openedLoot, replayed: true },
                    write: false as const,
                };
            }
            const reservationDate = typeof discoveryOutcome.reservationDate === 'string'
                && /^\d{4}-\d{2}-\d{2}$/.test(discoveryOutcome.reservationDate)
                ? discoveryOutcome.reservationDate
                : '';
            const reservationOrdinal = Math.floor(Number(discoveryOutcome.reservationOrdinal));
            const reserved = !!reservationDate
                && Number.isSafeInteger(reservationOrdinal)
                && reservationOrdinal >= 1
                && reservationOrdinal <= DAILY_ANCIENT_CHEST_LIMIT;
            // The exact sealed discovery already proved presence and reserved
            // its daily slot. Requiring live presence again would strand a
            // committed chest after a tab crash, reconnect, or later movement.
            const storedDate = typeof character.serverChestDate === 'string' ? character.serverChestDate : '';
            const count = storedDate === today ? Math.max(0, Math.floor(Number(character.serverChestsToday) || 0)) : 0;
            // New discoveries already reserved their slot. Only legacy chest
            // receipts (from before reservation cutover) spend one at open.
            if (!reserved && count >= DAILY_ANCIENT_CHEST_LIMIT) return { ok: false as const, status: 409, error: 'daily-limit' };
            const loot = rollAncientChestLoot(body.sector, () => randomInt(1_000_000_000) / 1_000_000_000);
            if (!loot) return { ok: false as const, status: 400, error: 'invalid-sector' };
            // Legacy discoveries only (see the pool comment above). Never a
            // refusal: this chest is already the player's, and the discovery
            // that minted it already cost them a daily chest slot.
            if (poolEnabled && discoveryOutcome.poolReserved !== true) {
                // Swallowed on contention too: `reserveSectorPool` fails closed
                // (it throws rather than racing), and pool bookkeeping must
                // never turn into a 500 on a payout the player is already owed.
                const taken = await reserveSectorPool(sectorId, 'chests', pool.village, Date.now(), poolOwner ?? undefined)
                    .catch((err) => { console.error('[world/open-chest] legacy pool debit', safeLogValue(err)); return null; });
                if (taken?.ok) pool.reservation = taken;
            }
            // Village Stores — Intel: a chest cracked on foreign ground is worth
            // three explores of scouting. Best-effort, never fails the open.
            // `poolOwner` is this request's already-read territory row, so the
            // credit reuses it instead of re-reading `world:territory:<sector>`
            // (one KV round-trip saved per chest-open). Credit rules unchanged.
            await creditSectorIntel(pool.village, Math.floor(Number(body.sector)), INTEL_PER_CHEST, Date.now(), poolOwner).catch(() => undefined);
            const settled = settleAncientChestLoot(character, loot);
            const receipt = {
                id: worldExploreRequestId,
                operationId: requestId,
                sector: Math.floor(Number(body.sector)),
                loot: settled.loot,
                at: Date.now(),
            };
            const openedAt = Date.now();
            const nextExplorationReceipts = explorationReceipts.map((entry) => entry.id === worldExploreRequestId
                ? { ...entry, outcome: { ...discoveryOutcome, openedLoot: settled.loot, chestOpenedAt: openedAt } }
                : entry);
            return { ok: true as const, character: {
                ...settled.character,
                ...(reserved ? {} : { serverChestDate: today, serverChestsToday: count + 1 }),
                redeemedSectorExplorations: nextExplorationReceipts,
                redeemedAncientChests: [...receipts.slice(-149), receipt],
            }, value: { loot: settled.loot, replayed: false } };
        }).catch(async (err: unknown) => { await releasePool(); throw err; });
        if (!result.ok) {
            await releasePool();
            try {
                const details = JSON.parse(result.error) as Record<string, unknown>;
                if (details && typeof details.error === 'string') return res.status(result.status).json(details);
            } catch { /* plain error */ }
            return res.status(result.status).json({ error: result.error });
        }
        if (durableDiscovery && result.value.loot && typeof result.value.loot === 'object') {
            // The character projection is intentionally bounded. Seal the
            // payout into the longer-lived discovery authority as well, so a
            // 150-row compaction can never make the same chest payable again.
            try {
                await kv.set(worldExploreAuthorityKey(playerName, worldExploreRequestId), {
                    ...durableDiscovery,
                    outcome: {
                        ...durableDiscovery.outcome,
                        openedLoot: result.value.loot,
                        chestOpenedAt: typeof durableDiscovery.outcome?.chestOpenedAt === 'number'
                            ? durableDiscovery.outcome.chestOpenedAt
                            : Date.now(),
                    },
                }, { ex: WORLD_EXPLORE_RECEIPT_TTL_SECONDS });
            } catch (error) {
                console.error('[world/open-chest] durable payout receipt', safeLogValue(error));
                return res.status(503).json({ error: 'Chest settlement is still being saved. Retry the same request.' });
            }
        }
        // The chest is paid and sealed: un-list the discovery from the
        // account-side outbox mirror (advisory — a stale entry only costs one
        // more replayed open that lands right back here).
        await settlePendingWorldReward(playerName, worldExploreRequestId)
            .catch((err) => console.error('[world/open-chest] pending mirror settle', safeLogValue(err)));
        const sectorPool = !poolEnabled
            ? undefined
            : pool.reservation?.ok
                ? pool.reservation.view
                : await readSectorPool(sectorId, pool.village, Date.now(), poolOwner ?? undefined).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, sectorPool, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[world/open-chest]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
