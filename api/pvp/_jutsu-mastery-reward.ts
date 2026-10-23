import { jutsuLevelCapForLevel } from '../combat-core/formulas.js';
import {
    PVP_MASTERY_40_49_XP,
    PVP_MASTERY_BASE_XP,
    pvpMastery4049Enabled,
    pvpStrongholdMult,
} from './_valid-fight.js';
import type { PvpSession } from './session.js';

/** Once per distinct successful cast, per victory. Repeated casts cannot farm XP. */
export const PVP_JUTSU_XP_PER_WIN = PVP_MASTERY_BASE_XP.win;

/**
 * Per-row mastery for one valid fight. Lv40-49 rows sit past the seal-lesson
 * ladder, where 10 XP a win took years; with PVP_MASTERY_40_49 on they earn
 * 60 a win / 30 an engaged loss (#23). Other rows earn 10 a win, 0 a loss.
 * The row's starting level prices the whole award.
 */
function rowBaseXp(rowLevel: number, role: 'win' | 'loss'): number {
    if (rowLevel >= 40 && rowLevel < 50 && pvpMastery4049Enabled()) return PVP_MASTERY_40_49_XP[role];
    return PVP_MASTERY_BASE_XP[role];
}

/**
 * Credit jutsu mastery for the casts `role`'s side committed in this fight.
 * `factor` is the fight's credit (pair weight x short-fight share, api/pvp/_valid-fight.ts);
 * the stronghold multiplier follows the purse table in force.
 */
export function creditPvpJutsuMastery(
    character: Record<string, unknown>,
    session: PvpSession,
    factor: number,
    role: 'win' | 'loss' = 'win',
) {
    const winner = session.winner;
    if ((winner !== 'p1' && winner !== 'p2') || session.ranked || session.playerRankedAuthorityVersion === 2
        || session.realFighters?.p1 !== true || session.realFighters?.p2 !== true) return { character, awarded: 0 };
    const side = role === 'win' ? winner : winner === 'p1' ? 'p2' : 'p1';
    const scale = pvpStrongholdMult(session.rewardSector, session.rewardStronghold) * Math.max(0, Math.min(1, factor));
    const cap = jutsuLevelCapForLevel(Number(character.level) || 1);
    const jutsus = session[side].character.jutsu;
    const loadout = new Set((Array.isArray(jutsus) ? jutsus : []).map(jutsu => String(jutsu.id)));
    const mastery = Array.isArray(character.jutsuMastery) ? [...character.jutsuMastery] as Array<{ jutsuId: string; level: number; xp: number }> : [];
    let awarded = 0;
    for (const id of new Set(session.jutsuUsed?.[side] ?? [])) {
        if (scale <= 0 || id.startsWith('legacy-') || !loadout.has(id)) continue;
        const index = mastery.findIndex(row => row.jutsuId === id);
        const row = mastery[index] ?? { jutsuId: id, level: 1, xp: 0 };
        if (row.level >= cap) continue; // Preserve grandfathered mastery above the cap.
        let level = Math.max(1, Math.floor(Number(row.level) || 1));
        let xp = Math.max(0, Math.floor(Number(row.xp) || 0));
        let remaining = Math.floor(rowBaseXp(level, role) * scale + 1e-9);
        while (remaining > 0 && level < cap) {
            const gained = Math.min(remaining, Math.max(0, level * 50 - xp));
            // Only XP granted in this call may level the row. Banked XP at or past
            // the threshold (a forged save) would otherwise cascade into levels on
            // every win while `remaining` never moves (I-1).
            if (gained <= 0) break;
            xp += gained; remaining -= gained; awarded += gained;
            if (xp >= level * 50) { xp -= level * 50; level++; }
        }
        const next = { jutsuId: id, level, xp: level >= cap ? 0 : xp };
        if (index < 0) mastery.push(next); else mastery[index] = next;
    }
    return { character: awarded > 0 ? { ...character, jutsuMastery: mastery } : character, awarded };
}
