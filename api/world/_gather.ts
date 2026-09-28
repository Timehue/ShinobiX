import { addOwned } from '../craft/_forge.js';
import { isPlayableWildSector, sectorBiomeOf } from '../../shared/sector-geo.js';
import { GATHER_TRACE_CHANCE, gatherYield, pendingGatherFinds, type GatherChoice, type PendingGatherFind } from '../../shared/gathering.js';

export function sealGatherFind(id: string, sector: number, random: () => number, at = Date.now()): PendingGatherFind | null {
    if (!isPlayableWildSector(sector)) return null;
    return { id, sector, biome: sectorBiomeOf(sector), rareTrace: random() < GATHER_TRACE_CHANCE, at };
}
export function applyGatherClaim(character: Record<string, unknown>, id: string, sector: number, choice: GatherChoice) {
    const pending = pendingGatherFinds(character);
    const receipts = Array.isArray(character.redeemedGatherFinds)
        ? character.redeemedGatherFinds as Array<{ id: string; sector: number; choice: GatherChoice; rewards: { itemId: string; count: number }[] }>
        : [];
    const prior = receipts.find((r) => r.id === id);
    if (prior) {
        if (prior.sector !== sector || prior.choice.common !== choice.common || prior.choice.takeTrace !== choice.takeTrace)
            return { ok: false as const, error: 'That find has already been claimed with another choice.' };
        return { ok: true as const, character, rewards: prior.rewards, replayed: true };
    }
    const find = pending.find((f) => f.id === id);
    if (!find || find.sector !== sector) return { ok: false as const, error: 'That find is no longer pending. Refresh the map to see your saved finds.' };
    const rewards = gatherYield(find, choice);
    if (!rewards) return { ok: false as const, error: 'Choose an available material and a trace shown on this find.' };
    let next = character;
    for (const reward of rewards) next = addOwned(next, reward.itemId, reward.count, true);
    return {
        ok: true as const, replayed: false, rewards,
        character: { ...next, gatherIntroSeen: true, pendingGatherFinds: pending.filter((f) => f.id !== id),
            redeemedGatherFinds: [...receipts.slice(-149), { id, sector, choice, rewards }] },
    };
}
