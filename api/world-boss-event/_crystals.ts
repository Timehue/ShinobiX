import {
    WORLD_BOSS_CRYSTAL_MAX_NODES,
    WORLD_BOSS_HOLLOW_SHARD_POINTS,
    worldBossCrystalEffects,
    worldBossEventStatus,
} from '../../shared/world-boss-event.js';
import { withKvLock } from '../_lock.js';
import {
    readActiveWorldBossEvent,
    readWorldBossEvent,
    worldBossEventIsOpen,
    worldBossEventKey,
    writeWorldBossEvent,
    type WorldBossEventRecord,
} from './_event.js';

export type WorldBossCrystalPlayer = {
    slug: string;
    name: string;
    village: string;
    clan: string;
};

function updatePlayerEntry<T>(record: Record<string, T>, slug: string, value: T): Record<string, T> {
    // Identities are dictionary keys, including retained prototype-shaped
    // names. Map keeps them as data; fromEntries defines JSON-safe own entries.
    const entries = new Map(Object.entries(record));
    entries.set(slug, value);
    return Object.fromEntries(entries);
}

export async function worldBossCrystalCanBeMined(nodeId: string, now = Date.now()): Promise<boolean> {
    const event = await readActiveWorldBossEvent();
    if (!event || !worldBossEventIsOpen({ ...event, status: worldBossEventStatus(event, now) }, now)) return false;
    return !(event.minedCrystalNodeIds ?? []).includes(nodeId);
}

/** Claim one globally unique vein and put its shard in the miner's event reserve. */
export async function applyWorldBossCrystalHarvest(
    eventId: string,
    nodeId: string,
    player: WorldBossCrystalPlayer,
    now = Date.now(),
) {
    return withKvLock(worldBossEventKey(eventId), async () => {
        const event: WorldBossEventRecord | null = await readWorldBossEvent(eventId);
        if (!event || !worldBossEventIsOpen({ ...event, status: worldBossEventStatus(event, now) }, now)) return null;
        const mined = event.minedCrystalNodeIds ?? [];
        let harvested = false;
        if (!mined.includes(nodeId) && mined.length < WORLD_BOSS_CRYSTAL_MAX_NODES) {
            event.minedCrystalNodeIds = [...mined, nodeId];
            const held = event.hollowShardsHeldByPlayer ?? {};
            const priorHeld = Object.hasOwn(held, player.slug) ? held[player.slug] : 0;
            event.hollowShardsHeldByPlayer = updatePlayerEntry(
                held, player.slug, Math.max(0, Math.floor(Number(priorHeld) || 0)) + 1,
            );
            const profiles = event.hollowShardProfileByPlayer ?? {};
            const priorProfile = Object.hasOwn(profiles, player.slug) ? profiles[player.slug] : undefined;
            event.hollowShardProfileByPlayer = updatePlayerEntry(
                profiles, player.slug, priorProfile ?? {
                    name: player.name.slice(0, 40),
                    village: player.village.slice(0, 40),
                    clan: player.clan.slice(0, 40),
                },
            );
            event.updatedAt = now;
            await writeWorldBossEvent(event);
            harvested = true;
        }
        const effects = worldBossCrystalEffects(event.hollowShardsDeposited ?? 0);
        return {
            harvested,
            heldHollowShards: Math.max(0, Math.floor(Number(event.hollowShardsHeldByPlayer?.[player.slug]) || 0)),
            totalMined: event.minedCrystalNodeIds?.length ?? 0,
            crystalNodeCount: WORLD_BOSS_CRYSTAL_MAX_NODES,
            pointsPerShard: WORLD_BOSS_HOLLOW_SHARD_POINTS,
            ...effects,
        };
    }, { failClosed: true });
}

export type WorldBossCrystalDepositResult =
    | {
        ok: true;
        replayed: boolean;
        deposited: number;
        points: number;
        heldHollowShards: number;
        totalDeposited: number;
        effects: ReturnType<typeof worldBossCrystalEffects>;
    }
    | { ok: false; error: string };

/** Consume a player's event reserve once and award contribution points. */
export async function depositWorldBossHollowShards(
    eventId: string,
    player: WorldBossCrystalPlayer,
    requestId: string,
    now = Date.now(),
): Promise<WorldBossCrystalDepositResult> {
    return withKvLock(worldBossEventKey(eventId), async () => {
        const event = await readWorldBossEvent(eventId);
        if (!event) return { ok: false, error: 'This world boss event is no longer available.' };
        const receipts = event.crystalDepositReceipts ?? {};
        const receiptKey = player.slug + ':' + requestId;
        const priorReceipt = receipts[receiptKey];
        if (priorReceipt) {
            const totalDeposited = Math.max(0, Math.min(WORLD_BOSS_CRYSTAL_MAX_NODES, Math.floor(Number(event.hollowShardsDeposited) || 0)));
            return {
                ok: true,
                replayed: true,
                deposited: priorReceipt.shards,
                points: priorReceipt.points,
                heldHollowShards: Math.max(0, Math.floor(Number(event.hollowShardsHeldByPlayer?.[player.slug]) || 0)),
                totalDeposited,
                effects: worldBossCrystalEffects(totalDeposited),
            };
        }
        if (!worldBossEventIsOpen({ ...event, status: worldBossEventStatus(event, now) }, now)) {
            return { ok: false, error: 'Hollow Shards can only be turned in while the event is open.' };
        }

        const held = event.hollowShardsHeldByPlayer ?? {};
        const heldCount = Math.max(0, Math.floor(Number(Object.hasOwn(held, player.slug) ? held[player.slug] : 0) || 0));
        if (heldCount < 1) return { ok: false, error: 'You have no Hollow Shards ready to turn in.' };
        const previousTotal = Math.max(0, Math.min(WORLD_BOSS_CRYSTAL_MAX_NODES, Math.floor(Number(event.hollowShardsDeposited) || 0)));
        const deposited = Math.min(heldCount, WORLD_BOSS_CRYSTAL_MAX_NODES - previousTotal);
        if (deposited < 1) return { ok: false, error: 'The Hollow Shard meter is already full.' };
        const points = deposited * WORLD_BOSS_HOLLOW_SHARD_POINTS;
        const totalDeposited = previousTotal + deposited;
        event.hollowShardsHeldByPlayer = updatePlayerEntry(held, player.slug, heldCount - deposited);
        event.hollowShardsDeposited = totalDeposited;

        const profiles = event.hollowShardProfileByPlayer ?? {};
        const profile = Object.hasOwn(profiles, player.slug) ? profiles[player.slug] : undefined;
        const participants = event.participants ?? {};
        const prior = Object.hasOwn(participants, player.slug) ? participants[player.slug] : undefined;
        const participant = {
            slug: player.slug,
            name: prior?.name ?? profile?.name ?? player.name.slice(0, 40),
            village: prior?.village ?? profile?.village ?? player.village.slice(0, 40),
            clan: prior?.clan ?? profile?.clan ?? player.clan.slice(0, 40),
            damage: Math.max(0, Math.floor(Number(prior?.damage) || 0)),
            score: Math.max(0, Math.floor(Number(prior?.score) || 0)),
            hollowShardsDeposited: Math.max(0, Math.floor(Number(prior?.hollowShardsDeposited) || 0)) + deposited,
            crystalPoints: Math.max(0, Math.floor(Number(prior?.crystalPoints) || 0)) + points,
            actions: Math.max(0, Math.floor(Number(prior?.actions) || 0)),
            matches: Math.max(0, Math.floor(Number(prior?.matches) || 0)),
            firstAt: prior?.firstAt ?? now,
        };
        event.participants = updatePlayerEntry(participants, player.slug, participant);
        event.crystalDepositReceipts = {
            ...receipts,
            [receiptKey]: { playerSlug: player.slug, shards: deposited, points, depositedAt: now },
        };
        event.updatedAt = now;
        await writeWorldBossEvent(event);
        return {
            ok: true,
            replayed: false,
            deposited,
            points,
            heldHollowShards: heldCount - deposited,
            totalDeposited,
            effects: worldBossCrystalEffects(totalDeposited),
        };
    }, { failClosed: true });
}
