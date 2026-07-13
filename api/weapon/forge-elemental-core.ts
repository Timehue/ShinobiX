import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin, bodyNameMatchesAuth } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';

export const ELEMENTAL_SHARDS_PER_CORE = 10;
const SHARD_ID = 'elemental-shard';
const CORE_ID = 'elemental-core';

function whole(value: unknown): number {
    return Math.max(0, Math.floor(Number(value) || 0));
}

export function forgeElementalCore(character: Record<string, unknown>) {
    const stacks = Array.isArray(character.itemStacks)
        ? (character.itemStacks as Array<Record<string, unknown>>).map((stack) => ({ ...stack }))
        : [];
    const inventory = Array.isArray(character.inventory)
        ? (character.inventory as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
    const stackedShards = stacks.reduce((sum, stack) => sum + (stack.itemId === SHARD_ID ? whole(stack.count) : 0), 0);
    const inlineShards = inventory.filter((item) => item === SHARD_ID).length;
    if (stackedShards + inlineShards < ELEMENTAL_SHARDS_PER_CORE) {
        return { ok: false as const, status: 409, error: `You need ${ELEMENTAL_SHARDS_PER_CORE} Elemental Shards.` };
    }

    let remaining = ELEMENTAL_SHARDS_PER_CORE;
    const itemStacks = stacks
        .map((stack) => {
            if (stack.itemId !== SHARD_ID || remaining <= 0) return stack;
            const count = whole(stack.count);
            const spent = Math.min(count, remaining);
            remaining -= spent;
            return { ...stack, count: count - spent };
        })
        .filter((stack) => whole(stack.count) > 0);
    const nextInventory = inventory.filter((item) => {
        if (item !== SHARD_ID || remaining <= 0) return true;
        remaining -= 1;
        return false;
    });

    const coreStack = itemStacks.find((stack) => stack.itemId === CORE_ID);
    if (coreStack) coreStack.count = whole(coreStack.count) + 1;
    else itemStacks.push({ itemId: CORE_ID, count: 1 });

    return {
        ok: true as const,
        character: { ...character, inventory: nextInventory, itemStacks },
        value: { shardsSpent: ELEMENTAL_SHARDS_PER_CORE, coresForged: 1 },
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!bodyNameMatchesAuth(identity, playerName)) return res.status(403).json({ error: 'Can only forge for your own character.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'forge-elemental-core', 12, 60_000, identity.name))) return;

        const result = await mutatePlayerSave(playerName, ({ character }) => forgeElementalCore(character));
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({
            ok: true,
            ...result.value,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (error) {
        console.error('[weapon/forge-elemental-core]', error);
        return res.status(500).json({ error: 'Elemental Core could not be forged.' });
    }
}
