import { jutsuLevelCapForLevel } from '../combat-core/formulas.js';
import { strongholdPvpRewardMultiplier } from '../../shared/sector-stronghold.js';
import type { PvpSession } from './session.js';

/** Once per distinct successful cast, per victory. Repeated casts cannot farm XP. */
export const PVP_JUTSU_XP_PER_WIN = 10;
export function creditPvpJutsuMastery(character: Record<string, unknown>, session: PvpSession, decay: number) {
    const side = session.winner;
    if ((side !== 'p1' && side !== 'p2') || session.ranked || session.playerRankedAuthorityVersion === 2
        || session.realFighters?.p1 !== true || session.realFighters?.p2 !== true) return { character, awarded: 0 };
    const amount = Math.floor(PVP_JUTSU_XP_PER_WIN * strongholdPvpRewardMultiplier(session.rewardSector, session.rewardStronghold) * Math.max(0, Math.min(1, decay)));
    const cap = jutsuLevelCapForLevel(Number(character.level) || 1);
    const jutsus = session[side].character.jutsu;
    const loadout = new Set((Array.isArray(jutsus) ? jutsus : []).map(jutsu => String(jutsu.id)));
    const mastery = Array.isArray(character.jutsuMastery) ? [...character.jutsuMastery] as Array<{ jutsuId: string; level: number; xp: number }> : [];
    let awarded = 0;
    for (const id of new Set(session.jutsuUsed?.[side] ?? [])) {
        if (!amount || id.startsWith('legacy-') || !loadout.has(id)) continue;
        const index = mastery.findIndex(row => row.jutsuId === id);
        const row = mastery[index] ?? { jutsuId: id, level: 1, xp: 0 };
        if (row.level >= cap) continue; // Preserve grandfathered mastery above the cap.
        let level = Math.max(1, Math.floor(Number(row.level) || 1));
        let xp = Math.max(0, Math.floor(Number(row.xp) || 0));
        let remaining = amount;
        while (remaining > 0 && level < cap) {
            const gained = Math.min(remaining, Math.max(0, level * 50 - xp));
            xp += gained; remaining -= gained; awarded += gained;
            if (xp >= level * 50) { xp -= level * 50; level++; }
        }
        const next = { jutsuId: id, level, xp: level >= cap ? 0 : xp };
        if (index < 0) mastery.push(next); else mastery[index] = next;
    }
    return { character: awarded > 0 ? { ...character, jutsuMastery: mastery } : character, awarded };
}
