import { createHash } from 'node:crypto';
import { appendSettlementReceipt, inspectSettlementReceipt, SERVER_SETTLEMENT_RECEIPT_LIMIT } from '../_settlement-receipts.js';
import { receiptAbsenceProvable } from '../_save-debit-saga.js';
import { GEAR_DROP_CHANCE_BP, gearRoll, pickGearDrop } from '../_gear-drops.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { applyDerivedLevel, type XpCharacter } from '../_xp-engine.js';
import { recordEconomyTxn } from '../_economy.js';
import { grantItemIds } from '../../shared/stacked-materials.js';
import type { WorldBossRewardReceipt } from './_event.js';

const WORLD_BOSS_STAT_POINTS = 3;
const WORLD_BOSS_RYO = 2_500;
const WORLD_BOSS_BONE_CHARMS = 2;
const WORLD_BOSS_CORE_ID = 'weekly-boss-core';
const HIGH_END_MATERIALS = [
    'hunt-legendary-material',
    'hunt-ancient-beast-core',
    'hunt-titan-bone',
    'hunt-ember-scale',
    'hunt-shadow-pelt',
] as const;

function stableRng(eventId: string, slug: string): (max: number) => number {
    let index = 0;
    return (max) => Math.floor(gearRoll(`world-boss:${eventId}:${slug}:gear:${index++}`) * Math.max(1, max));
}

function rewardReceiptId(eventId: string, slug: string): string {
    return `wbe_${createHash('sha256').update(`${eventId}:${slug}`).digest('hex').slice(0, 32)}`;
}

/** The reward a stored receipt records, and nothing else. The save merge pairs
 *  receipts by position (they carry no `id`), so a stored value can also hold
 *  keys from the receipt that preceded it, such as the raid's pve-outcome. */
function replayedReward(value: Record<string, unknown>): WorldBossRewardReceipt {
    const whole = (raw: unknown) => Math.max(0, Math.floor(Number(raw) || 0));
    return {
        ryo: whole(value.ryo),
        statPoints: whole(value.statPoints),
        boneCharms: whole(value.boneCharms),
        itemIds: Array.isArray(value.itemIds) ? value.itemIds.filter((item): item is string => typeof item === 'string') : [],
        ...(typeof value.gearDrop === 'string' ? { gearDrop: value.gearDrop } : {}),
    };
}

/** Economy telemetry for one committed package (I-19). Not awaited: telemetry
 *  never holds the save lock. The txnIds derive from the package receipt. */
function recordWorldBossReward(requestId: string, playerSlug: string): void {
    void recordEconomyTxn({ txnId: `${requestId}:ryo`, player: playerSlug, currency: 'ryo', delta: WORLD_BOSS_RYO, source: 'worldboss.reward' });
    void recordEconomyTxn({ txnId: `${requestId}:boneCharms`, player: playerSlug, currency: 'boneCharms', delta: WORLD_BOSS_BONE_CHARMS, source: 'worldboss.reward' });
}

/** Once-per-event account-bound package; every item and currency is saved under one receipt. */
export async function settleWorldBossReward(input: {
    eventId: string;
    eventStartedAt: number;
    playerSlug: string;
}): Promise<{ character: Record<string, unknown>; saveVersion: number; reward: WorldBossRewardReceipt } | null> {
    const requestId = rewardReceiptId(input.eventId, input.playerSlug);
    const fingerprint = `world-boss-event:${input.eventId}:${input.playerSlug}`;
    const eventSeed = `world-boss:${input.eventId}:${input.playerSlug}`;
    const result = await retryOnSaveVersionConflict(() => mutatePlayerSave<WorldBossRewardReceipt>(input.playerSlug, ({ character }) => {
        const inspected = inspectSettlementReceipt(character, requestId, fingerprint);
        if (inspected.status === 'replay') {
            return { ok: true, write: false, character, value: replayedReward(inspected.receipt.value) };
        }
        if (inspected.status !== 'fresh') throw new Error('World boss reward receipt is not safe to replay.');
        if (!receiptAbsenceProvable(inspected.receipts, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', input.eventStartedAt)) {
            return { ok: true, write: false, character, value: { ryo: 0, statPoints: 0, boneCharms: 0, itemIds: [] } };
        }

        const material = HIGH_END_MATERIALS[Math.floor(gearRoll(`${eventSeed}:material`) * HIGH_END_MATERIALS.length)]!;
        const itemIds = [WORLD_BOSS_CORE_ID, material];
        let gearDrop: string | undefined;
        if (gearRoll(`${eventSeed}:weapon-armor`) < GEAR_DROP_CHANCE_BP.boss / 10_000) {
            gearDrop = pickGearDrop(character, stableRng(input.eventId, input.playerSlug)) ?? undefined;
            if (gearDrop) itemIds.push(gearDrop);
        }
        // The Core and the material join their itemStacks entries (owner ruling
        // A12); the gear drop is a unique piece and stays in inventory[].
        const stores = grantItemIds({
            inventory: Array.isArray(character.inventory) ? character.inventory.filter((item): item is string => typeof item === 'string') : [],
            itemStacks: character.itemStacks,
        }, itemIds);
        const unspentStats = Math.max(0, Math.floor(Number(character.unspentStats) || 0)) + WORLD_BOSS_STAT_POINTS;
        const leveled = applyDerivedLevel({ ...character, unspentStats } as unknown as XpCharacter) as unknown as Record<string, unknown>;
        const reward: WorldBossRewardReceipt = {
            ryo: WORLD_BOSS_RYO,
            statPoints: WORLD_BOSS_STAT_POINTS,
            boneCharms: WORLD_BOSS_BONE_CHARMS,
            itemIds: itemIds.filter(item => item !== gearDrop),
            ...(gearDrop ? { gearDrop } : {}),
        };
        const credited = {
            ...character,
            unspentStats: leveled.unspentStats,
            level: leveled.level,
            maxHp: leveled.maxHp,
            maxChakra: leveled.maxChakra,
            maxStamina: leveled.maxStamina,
            hp: leveled.hp,
            chakra: leveled.chakra,
            stamina: leveled.stamina,
            rankTitle: leveled.rankTitle,
            ryo: Math.max(0, Number(character.ryo) || 0) + WORLD_BOSS_RYO,
            boneCharms: Math.max(0, Number(character.boneCharms) || 0) + WORLD_BOSS_BONE_CHARMS,
            inventory: stores.inventory,
            ...(stores.itemStacks !== undefined ? { itemStacks: stores.itemStacks } : {}),
        };
        return {
            ok: true,
            character: appendSettlementReceipt(credited, inspected.receipts, {
                requestId,
                fingerprint,
                value: reward as unknown as Record<string, unknown>,
                settledAt: Date.now(),
            }),
            value: reward,
            // Only the fresh credit reaches here, and afterCommit runs only once
            // it committed, so a replay or a lost compare-and-set logs nothing.
            afterCommit: () => recordWorldBossReward(requestId, input.playerSlug),
        };
    }));
    if (!result.ok) return null;
    return {
        character: result.character as unknown as Record<string, unknown>,
        saveVersion: result._saveVersion,
        reward: result.value,
    };
}
