/** Execution values for the earned final-art variant. Baseline values remain
 * explicit so each combat format can preserve its historical branch. */
export function petSignatureMastery(
    ability: { upgrade?: unknown; signatureMastery?: boolean; mastery?: boolean } | string | boolean | null | undefined,
    progression = true,
) {
    const mastered = progression && (ability === true || ability === 'signature-mastery'
        || !!ability && typeof ability === 'object' && (ability.upgrade === 'signature-mastery'
            || ability.signatureMastery === true || ability.mastery === true));
    return {
        mastered,
        offenseMult: mastered ? 1.1 : 1,
        healPct: mastered ? .2 : .175,
        shieldPct: mastered ? .25 : .225,
        buffMult: mastered ? 1.3 : 1.25,
        tauntRounds: mastered ? 2 : 1,
        tauntGuardMult: mastered ? 1.3 : 1.2,
        weatherExtraRounds: mastered ? 1 : 0,
        cleanseResistRounds: mastered ? 1 : 0,
    };
}

/** Materialized projections include their power bonus. Reverse that bonus
 * before a capped format applies it once after its existing power clamp. */
export function petUnmasteredPower(power: number, upgrade: unknown): number {
    return upgrade === 'signature-mastery' ? Math.round(power / 1.1)
        : upgrade === 'offense-mastery' ? Math.round(power / 1.08) : power;
}

export function petSignatureMasteryDescription(kind: string): string {
    switch (kind) {
        case 'heal': return 'Final Art heals 20% maximum HP instead of 17.5%.';
        case 'shield': case 'barrier': case 'absorb': return kind === 'absorb'
            ? 'Final Art absorbs 35% instead of 30%.' : 'Final Art shields 25% maximum HP instead of 22.5%.';
        case 'buff': return 'Final Art strengthens its stance bonus from 25% to 30%.';
        case 'haste': return 'Final Art strengthens the summon stance from 25% to 30%; spatial haste lasts one second longer.';
        case 'taunt': return 'Final Art redirection lasts an extra round, with stronger defense in turn-based formats.';
        case 'cleanse': return 'Final Art also grants a brief resistance to repeated control.';
        case 'weather': return 'Final Art weather lasts an extra round.';
        default: return 'Final Art deals 10% more damage after the format\'s power cap.';
    }
}
