import { setSafeRecordValue } from '../_utils.js';

export function tickCombatCooldowns(cooldowns: Record<string, number>): Record<string, number> {
    const next: Record<string, number> = {};
    for (const [key, turns] of Object.entries(cooldowns)) {
        if (turns > 1) setSafeRecordValue(next, key, turns - 1);
    }
    return next;
}
