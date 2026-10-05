import type { KvLike } from '../_storage.js';
import type { SaveLockRunner } from '../pvp/_consumable-settlement.js';
import { carriedRegenCursor, settleIdleRecovery, writeVersionedPlayerSaveWithStore } from '../save/_mutate-player-save.js';
import { creditElderWins, ELDER_WIN_HISTORY_MS } from '../../shared/elder-elections.js';

/** Ranked V2 awards rating rather than the field PvP kill counter. Count its
 * verified winner separately, with the receipt and score in one atomic save. */
export async function creditRankedElderWin(store: Pick<KvLike, 'get' | 'compareSet'>, lock: SaveLockRunner,
    winner: string, battleId: string, at: number, now = Date.now()): Promise<void> {
    if (at < now - ELDER_WIN_HISTORY_MS || at > now) return;
    const key = `save:${winner}`;
    await lock(key, async () => {
        const record = await store.get<Record<string, unknown>>(key);
        if (!record?.character) throw new Error('elder-ranked-winner-save-unavailable');
        // The winner keeps the idle recovery earned since their last save:
        // it settles into this write instead of being fenced away.
        const settled = await settleIdleRecovery(store, winner, record);
        const character = settled.character;
        if (!character.village) return;
        const receipts = (Array.isArray(character.elderRankedWinReceipts) ? character.elderRankedWinReceipts : [])
            .filter((entry): entry is { id: string; at: number } => !!entry && typeof entry.id === 'string' && Number(entry.at) >= now - ELDER_WIN_HISTORY_MS);
        if (receipts.some(entry => entry.id === battleId)) return;
        // Like field/PvE rewards, count on the first successful credit. A
        // recovered settlement must not write into an already-elected term.
        const next = { ...creditElderWins(character, 1, 0, now), elderRankedWinReceipts: [...receipts, { id: battleId, at }] };
        await writeVersionedPlayerSaveWithStore(store, key, record, next, {}, {
            regenAt: carriedRegenCursor(character, next, settled.regen),
        });
    });
}
