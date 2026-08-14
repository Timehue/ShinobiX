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
        const result = await mutatePlayerSave(playerName, ({ character }) => {
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
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
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
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[world/open-chest]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
