import { scaleHollowGateRyo } from './_gate-scale.js';
import { hollowShardDrop } from './_run-token.js';

export type HollowLockedDoorResult = {
    // 'pet' is no longer rolled. It stays in the type so a door receipt rolled
    // before the change (hg-event-roll:, 8-day TTL) still replays.
    outcome: 'chest' | 'trap' | 'pet';
    rarity?: 'rare' | 'legendary' | 'mythic';
    pet?: Record<string, unknown>;
    loot?: { xp: number; ryo?: number; fateShards?: number; boneCharms?: number; auraStones?: number; auraDust?: number; hollowShards: number };
};

/** Locked-door chest bands (2026-10 rebalance #11). Fate Shards keep 26.7% so
 *  a full run's doors pay ~1.0 FS, the framework total, now that the old pet
 *  quarter rolls a chest too; the rest split 35 : 20 : 5 as Aura Dust, Bone
 *  Charms and Aura Stones. */
export const LOCKED_DOOR_FATE_SHARD_BAND = 0.267;
export const LOCKED_DOOR_AURA_DUST_BAND = 0.695;
export const LOCKED_DOOR_BONE_CHARM_BAND = 0.939;

export function maxLockedDoorsForDepth(depthRaw: unknown): number {
    return Math.max(1, Math.min(60, Math.floor(Number(depthRaw) || 1) * 3));
}

export function rollHollowLockedDoor(random: () => number, now = Date.now(), floorRaw: unknown = 1, ryoScale = 1): HollowLockedDoorResult {
    void now; // named the old pet's id; kept so existing callers keep their argument order
    const unit = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    const roll = unit();
    // A quarter of doors used to offer a pet that /api/pet/befriend can never
    // accept (it needs an explore or caravan proof), so the key bought nothing.
    // That band rolls the chest now; befriend must NOT start accepting Gate
    // doors, or every fourth door would mint a rare-or-better pet.
    if (roll >= 0.5 && roll < 0.75) return { outcome: 'trap' };
    const floor = Math.max(1, Math.min(20, Math.floor(Number(floorRaw) || 1)));
    // Character XP is retired: the old xp line (100 + floor·10) folds into a
    // guaranteed ryo floor. `xp` stays as 0 for old clients.
    const loot: NonNullable<HollowLockedDoorResult['loot']> = { xp: 0, ryo: 75 + floor * 8, hollowShards: hollowShardDrop(floor, 'lockedChest') };
    if (unit() < 0.5) loot.ryo = (loot.ryo ?? 0) + 100 + Math.floor(unit() * 401);
    // Scaled once, after the bonus, so the loot shown equals the credit before the augment.
    loot.ryo = scaleHollowGateRyo(loot.ryo, ryoScale);
    const lootRoll = unit();
    if (lootRoll < LOCKED_DOOR_FATE_SHARD_BAND) loot.fateShards = 1;
    else if (lootRoll < LOCKED_DOOR_AURA_DUST_BAND) loot.auraDust = 10 + Math.floor(unit() * 11);
    else if (lootRoll < LOCKED_DOOR_BONE_CHARM_BAND) loot.boneCharms = 1;
    else loot.auraStones = 1;
    if (unit() < 0.2) loot.auraDust = (loot.auraDust ?? 0) + 5 + Math.floor(unit() * 11);
    return { outcome: 'chest', loot };
}
