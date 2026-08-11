import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { inspectSettlementReceipt } from '../_settlement-receipts.js';
import { mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { embedPvpSettlementReceipt, pvpSettlementId } from './_reward-settlement.js';
import {
    confirmPlayerRankedItemSettlement,
    getPlayerRankedJournal,
    playerRankedItemUsageFingerprint,
    type PlayerRankedJournal,
} from './_player-ranked-journal.js';
import { isPlayerRankedV2Session, type PvpSession } from './session.js';

type ConsumableStore = Pick<KvLike, 'get' | 'compareSet'>;
export type SaveLockRunner = <T>(key: string, action: () => Promise<T>) => Promise<T>;

/** Remove the exact server-recorded item counts from stacks, then inventory. */
export function deductUsedItems(
    character: Record<string, unknown>,
    used: Record<string, number>,
): Record<string, unknown> {
    const stacks = Array.isArray(character.itemStacks)
        ? (character.itemStacks as Array<Record<string, unknown>>).map((stack) => ({ ...stack }))
        : [];
    const inventory = Array.isArray(character.inventory) ? [...character.inventory as unknown[]] : [];
    for (const [id, rawCount] of Object.entries(used)) {
        let remaining = Math.max(0, Math.floor(Number(rawCount) || 0));
        if (remaining <= 0) continue;
        for (const stack of stacks) {
            if (remaining <= 0) break;
            if (stack.itemId !== id) continue;
            const count = Math.max(0, Math.floor(Number(stack.count) || 0));
            const taken = Math.min(count, remaining);
            stack.count = count - taken;
            remaining -= taken;
        }
        while (remaining > 0) {
            const index = inventory.indexOf(id);
            if (index < 0) break;
            inventory.splice(index, 1);
            remaining -= 1;
        }
    }
    return {
        ...character,
        itemStacks: stacks.filter((stack) => Math.floor(Number(stack.count) || 0) > 0),
        inventory,
    };
}

function itemSides(
    session: PvpSession,
    legacyPlayerName?: string,
): Array<{ role: 'p1' | 'p2'; slug: string; used: Record<string, number> }> {
    const legacy = safeName(legacyPlayerName ?? '');
    return (['p1', 'p2'] as const)
        .map((role) => {
            const slug = safeName(session[role]?.name ?? '');
            const real = session.realFighters
                ? session.realFighters[role] === true
                : !!legacy && slug === legacy;
            return { role, slug, real, used: session.itemsUsed?.[role] ?? {} };
        })
        .filter((side) => side.real && !!side.slug && Object.keys(side.used).length > 0)
        .map(({ role, slug, used }) => ({ role, slug, used }));
}

async function settleLegacySide(
    store: ConsumableStore,
    session: PvpSession,
    side: { slug: string; used: Record<string, number> },
    now: number,
): Promise<void> {
    const key = `save:${side.slug}`;
    const settlementId = pvpSettlementId('items', session.battleId);
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const record = await store.get<Record<string, unknown>>(key);
        const character = (record?.character ?? null) as Record<string, unknown> | null;
        if (!record || !character) throw new Error(`pvp-items-save-unreadable:${side.slug}`);
        const inspection = inspectSettlementReceipt(character, settlementId, 'items');
        if (inspection.status === 'replay') return;
        if (inspection.status !== 'fresh') throw new Error('pvp-items-settlement-receipt-invalid');

        const deducted = deductUsedItems(character, side.used);
        const withReceipt = embedPvpSettlementReceipt(
            deducted,
            inspection.receipts,
            settlementId,
            'items',
            now,
        );
        const next = mergePreservingImages(
            bumpSaveVersion({ ...record, character: withReceipt }),
            record,
        ) as Record<string, unknown>;
        try {
            if (await store.compareSet(key, record, next)) return;
        } catch (error) {
            const recovered = await store.get<Record<string, unknown>>(key).catch(() => null);
            const recoveredCharacter = (recovered?.character ?? null) as Record<string, unknown> | null;
            if (recoveredCharacter
                && inspectSettlementReceipt(recoveredCharacter, settlementId, 'items').status === 'replay') return;
            throw error;
        }
        const current = await store.get<Record<string, unknown>>(key);
        if (isDeepStrictEqual(current, next)) return;
    }
    throw new Error('pvp-items-save-cas-busy');
}

async function confirmDisabledV2Consumables(
    store: ConsumableStore,
    session: PvpSession,
    journalInput: PlayerRankedJournal | undefined,
    now: number,
): Promise<void> {
    if (!journalInput) throw new Error('player-ranked-item-journal-missing');
    let journal = await getPlayerRankedJournal(store, journalInput.terminal.matchId);
    if (!journal || !isDeepStrictEqual(journal.terminal, journalInput.terminal)) {
        throw new Error('player-ranked-item-journal-conflict');
    }
    for (const side of ['a', 'b'] as const) {
        const player = journal.terminal[side];
        const roles = (['p1', 'p2'] as const).filter((role) => safeName(session[role]?.name ?? '') === player);
        if (roles.length !== 1 || session.realFighters?.[roles[0]] !== true) {
            throw new Error('player-ranked-item-side-invalid');
        }
        const used = session.itemsUsed?.[roles[0]] ?? {};
        // Player-ranked V2 launches with every consumable/throwable charge
        // disabled. This avoids a terminal whose liveness depends on mutable
        // inventory after the fight. Any non-empty usage is impossible under
        // upgraded move workers and therefore fails closed as corruption.
        if (Object.keys(used).length > 0) {
            throw new Error('player-ranked-v2-consumables-disabled');
        }
        const fingerprint = playerRankedItemUsageFingerprint(session, journal.terminal, side);
        if (journal.items[side].usageFingerprint !== fingerprint) {
            throw new Error('player-ranked-item-journal-conflict');
        }
        journal = await confirmPlayerRankedItemSettlement(store, journal, side, fingerprint, now);
    }
}

/**
 * Legacy sessions retain their bounded-receipt drain behavior. Player-ranked
 * V2 has consumables disabled at creation and move validation; the journal
 * records and confirms the exact empty usage for both real participants before
 * Elo can settle, so no mutable post-use inventory can wedge season rollover.
 */
export async function settlePvpConsumablesDurably(
    store: ConsumableStore,
    session: PvpSession,
    lock: SaveLockRunner,
    options: {
        now?: number;
        legacyPlayerName?: string;
        playerRankedJournal?: PlayerRankedJournal;
    } = {},
): Promise<void> {
    const settledAt = Math.max(1, Math.floor(options.now ?? Date.now()));
    if (isPlayerRankedV2Session(session)) {
        await confirmDisabledV2Consumables(store, session, options.playerRankedJournal, settledAt);
        return;
    }

    const sides = itemSides(session, options.legacyPlayerName);
    if (sides.length === 0) return;
    const orderedKeys = [...new Set(sides.map((side) => `save:${side.slug}`))].sort();
    let run = async () => {
        for (const side of sides) await settleLegacySide(store, session, side, settledAt);
    };
    for (let index = orderedKeys.length - 1; index >= 0; index -= 1) {
        const key = orderedKeys[index];
        const next = run;
        run = () => lock(key, next);
    }
    await run();
}
