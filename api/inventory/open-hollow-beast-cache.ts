import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../_settlement-receipts.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { recordEconomyTxn } from '../_economy.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { gearRoll } from '../_gear-drops.js';
import { HOLLOW_BEAST_CACHE_ID } from '../../shared/world-boss-cache.js';

const CACHE_RYO = 1_500;
const CACHE_BONE_CHARMS = 1;
const CACHE_DUNGEON_KEY_CHANCE = 0.2;
const MATERIALS = [
    'hunt-legendary-material',
    'hunt-ancient-beast-core',
    'hunt-titan-bone',
    'hunt-ember-scale',
    'hunt-shadow-pelt',
] as const;

type CacheRewards = { ryo: number; boneCharms: number; materialId: string; dungeonKey: boolean };

function openReceiptId(requestId: string): string {
    return `hbc_${createHash('sha256').update(requestId).digest('hex').slice(0, 32)}`;
}

function removeOneCache(character: Record<string, unknown>): { itemStacks: Array<Record<string, unknown>>; inventory: string[] } | null {
    if (character.itemStacks !== undefined && !Array.isArray(character.itemStacks)) return null;
    if (character.inventory !== undefined && !Array.isArray(character.inventory)) return null;
    const itemStacks = [...((character.itemStacks as Array<Record<string, unknown>> | undefined) ?? [])];
    const stackIndex = itemStacks.findIndex(stack => stack?.itemId === HOLLOW_BEAST_CACHE_ID);
    if (stackIndex >= 0) {
        const count = Math.floor(Number(itemStacks[stackIndex]?.count) || 0);
        if (count < 1) return null;
        if (count === 1) itemStacks.splice(stackIndex, 1);
        else itemStacks[stackIndex] = { ...itemStacks[stackIndex], count: count - 1 };
        return { itemStacks, inventory: [...((character.inventory as string[] | undefined) ?? [])] };
    }
    const inventory = [...((character.inventory as string[] | undefined) ?? [])];
    const index = inventory.indexOf(HOLLOW_BEAST_CACHE_ID);
    if (index < 0) return null;
    inventory.splice(index, 1);
    return { itemStacks, inventory };
}

function cacheRewards(requestId: string): CacheRewards {
    const materialIndex = Math.floor(gearRoll(`${requestId}:material`) * MATERIALS.length);
    return {
        ryo: CACHE_RYO,
        boneCharms: CACHE_BONE_CHARMS,
        materialId: MATERIALS[Math.min(MATERIALS.length - 1, materialIndex)]!,
        dungeonKey: gearRoll(`${requestId}:dungeon-key`) < CACHE_DUNGEON_KEY_CHANCE,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = String(body.requestId ?? '').trim();
        if (!playerName || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return res.status(400).json({ error: 'A player and valid cache request ID are required.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only open your own Hollow Beast Cache.' });
        const playerSlug = identity.admin ? playerName : identity.name;
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'open-hollow-beast-cache', 10, 60_000, playerSlug, { strict: true }))) return;

        const receiptId = openReceiptId(requestId);
        const fingerprint = `hollow-beast-cache-open:${playerSlug}:${requestId}`;
        const rewards = cacheRewards(requestId);
        const result = await retryOnSaveVersionConflict(() => mutatePlayerSave<CacheRewards>(playerSlug, ({ character }) => {
            const inspected = inspectSettlementReceipt(character, receiptId, fingerprint);
            if (inspected.status === 'replay') {
                return { ok: true, write: false, character, value: inspected.receipt.value as unknown as CacheRewards };
            }
            if (inspected.status !== 'fresh') return { ok: false, status: 409, error: 'This cache request is not safe to replay.' };
            const removed = removeOneCache(character);
            if (!removed) return { ok: false, status: 400, error: 'You do not have a Hollow Beast Cache to open.' };
            const ryo = Math.max(0, Math.floor(Number(character.ryo) || 0));
            const boneCharms = Math.max(0, Math.floor(Number(character.boneCharms) || 0));
            if (!Number.isSafeInteger(ryo + rewards.ryo) || !Number.isSafeInteger(boneCharms + rewards.boneCharms)) {
                return { ok: false, status: 409, error: 'A reward balance is too large to update safely.' };
            }
            const itemStacks = [...removed.itemStacks];
            if (rewards.dungeonKey) {
                const keyIndex = itemStacks.findIndex(stack => stack?.itemId === 'dungeon-key');
                if (keyIndex >= 0) {
                    const count = Math.floor(Number(itemStacks[keyIndex]?.count) || 0);
                    if (count >= 9_999) return { ok: false, status: 409, error: 'Your Dungeon Key stack is full.' };
                    itemStacks[keyIndex] = { ...itemStacks[keyIndex], count: count + 1 };
                } else itemStacks.push({ itemId: 'dungeon-key', count: 1 });
            }
            const next = {
                ...character,
                ryo: ryo + rewards.ryo,
                boneCharms: boneCharms + rewards.boneCharms,
                inventory: [...removed.inventory, rewards.materialId],
                itemStacks,
            };
            return {
                ok: true,
                character: appendSettlementReceipt(next, inspected.receipts, {
                    requestId: receiptId,
                    fingerprint,
                    value: rewards as unknown as Record<string, unknown>,
                    settledAt: Date.now(),
                }),
                value: rewards,
            };
        }));
        if (!result.ok) return res.status(result.status).json({ error: result.error });

        const entries = [
            { currency: 'ryo', delta: result.value.ryo, balanceAfter: Number(result.character.ryo ?? 0) },
            { currency: 'boneCharms', delta: result.value.boneCharms, balanceAfter: Number(result.character.boneCharms ?? 0) },
        ];
        await Promise.allSettled(entries.map(entry => recordEconomyTxn({
            txnId: `hollow-beast-cache:${playerSlug}:${entry.currency}:${receiptId}`,
            player: playerSlug,
            currency: entry.currency,
            delta: entry.delta,
            source: 'inventory.hollow-beast-cache-open',
            balanceAfter: entry.balanceAfter,
        })));
        return res.status(200).json({
            ok: true,
            rewards: result.value,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (error) {
        console.error('[inventory/open-hollow-beast-cache]', error);
        return res.status(503).json({ error: 'Could not open the Hollow Beast Cache. Retry the same request.' });
    }
}
