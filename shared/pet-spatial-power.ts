import { petUnmasteredPower } from './pet-ability-mastery.js';

type SpatialPowerInput = { power?: unknown; abilityId?: unknown; tier?: unknown; kind?: unknown };
const BASE_POWER: Readonly<Record<string, number>> = { basic: 145, utility: 75, advanced: 200, signature: 280 };
const SUPPORT = new Set(['heal', 'shield', 'barrier', 'absorb', 'buff', 'haste', 'taunt', 'cleanse', 'move']);
/** Native spatial attacks use 100 power for an ordinary strike. Authored powers
 * have different catalog units, so earned arts need an explicit tier conversion.
 * This remains attack/defense damage; it never reads defender HP. */
export function petSpatialTechniquePower(input: SpatialPowerInput, progression: boolean): number {
    const value = Number(input.power);
    const sourcePower = Number.isFinite(value) ? Math.max(1, value) : 1;
    if (!progression || SUPPORT.has(String(input.kind))) return sourcePower;
    const id = typeof input.abilityId === 'string' ? input.abilityId : '';
    const tier = Object.hasOwn(BASE_POWER, String(input.tier)) ? String(input.tier)
        : ['signature', 'advanced', 'utility', 'basic'].find(value => id.split(':').includes(value));
    if (!tier) return sourcePower;
    const upgrade = id.includes(':mastery-75') ? 'signature-mastery'
        : id.includes(':mastery-50') ? 'offense-mastery' : undefined;
    const unmastered = petUnmasteredPower(sourcePower, upgrade);
    const lean = Math.max(.9, Math.min(1.1, .8 + unmastered / 500));
    const mastery = upgrade === 'signature-mastery' ? 1.1 : upgrade === 'offense-mastery' ? 1.08 : 1;
    const kind = String(input.kind);
    const riderBudget = ['stun', 'freeze', 'confuse', 'movelock'].includes(kind) ? .55
        : ['burn', 'dot', 'wound', 'slow', 'mark', 'debuff'].includes(kind) ? .65 : 1;
    return Math.max(1, Math.round(BASE_POWER[tier] * lean * mastery * riderBudget));
}
