import { createHmac } from 'node:crypto';
import { PVP_STAT_POINTS_PER_WIN } from '../../shared/combat-growth-rules.js';

/** A secret-salted, uniform 1–6 roll fixed to the winner and battle on every retry. */
export function pvpStatPointsForWin(playerName: string, battleId: string): number {
    const salt = process.env.SESSION_SECRET || 'pvp-stat-roll-unsalted';
    const size = PVP_STAT_POINTS_PER_WIN;
    const ceiling = Math.floor(0x1_0000_0000 / size) * size;
    for (let attempt = 0; ; attempt++) {
        const roll = createHmac('sha256', salt).update(`pvp-stat-v1:${playerName}:${battleId}:${attempt}`).digest().readUInt32BE(0);
        if (roll < ceiling) return 1 + roll % size;
    }
}
