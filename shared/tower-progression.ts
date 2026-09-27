export type TowerSignature = 'charge' | 'marked-strike' | 'commander';
export function towerSignatureForMechanic(mechanic: unknown): TowerSignature {
    return mechanic === 'enrage' ? 'charge' : mechanic === 'regen' ? 'marked-strike' : 'commander';
}
export type TowerTacticsState = {
    version: 1 | 2;
    lastSignatureRound?: number;
    signature?: TowerSignature;
    disruptedPylons: number[];
    chargeBaits: number;
    avoidedStrikes: number;
    squadKnockouts: string[];
    telegraph?: { kind: 'charge' | 'marked-strike'; origin: number; targetId: string };
};
export const TOWER_DISRUPT_AP = 40;
export const TOWER_SIGNATURES = {
    charge: { name: 'Ruin Charge', counter: 'Leave the marked lane. Bait the charge into a stone pillar to stagger the boss.' },
    'marked-strike': { name: 'Death Mark', counter: 'The marked ground is locked in. Move out before round end; a missed strike exposes the boss.' },
    commander: { name: 'Command Guard', counter: 'Eliminate guards first. Shieldmen protect adjacent allies; controllers restore wounded enemies.' },
} as const;

/** Phase patterns are shared with inspection; the server seals each footprint at round start. */
export function towerSignaturePattern(signature: TowerSignature, completedPhases: number) {
    const phase = Math.min(2, Math.max(0, completedPhases));
    const interval = phase >= 2 ? 2 : 3;
    if (signature === 'charge') return {
        kind: 'charge' as const, interval, targets: 1, farthest: phase > 0, reach: phase === 0 ? 8 : phase === 1 ? 10 : 12,
        name: phase === 0 ? 'Ruin Charge' : phase === 1 ? 'Hunting Charge' : 'Relentless Charge',
        counter: `${phase > 0 ? `Hunts a distant fighter${phase >= 2 ? ' every two rounds' : ''}. ` : ''}${TOWER_SIGNATURES.charge.counter}`,
    };
    return {
        kind: signature === 'commander' && phase === 0 ? null : 'marked-strike' as const,
        interval, targets: signature === 'marked-strike' && phase > 0 || phase >= 2 ? 2 : 1, farthest: false, reach: 8,
        name: signature === 'commander' ? phase === 0 ? 'Command Guard' : 'Commander Crossfire'
            : phase === 0 ? 'Death Mark' : phase === 1 ? 'Twin Marks' : 'Relentless Marks',
        counter: signature === 'commander' && phase === 0 ? TOWER_SIGNATURES.commander.counter
            : `${phase >= 2 ? 'Marks two fighters every two rounds. ' : signature === 'marked-strike' && phase > 0 ? 'Marks two separated fighters. ' : ''}${TOWER_SIGNATURES['marked-strike'].counter}`,
    };
}
export const TOWER_HONORS = [
    { id: 'tower-clean-clear', name: 'Unbroken Squad', description: 'Clear a Tower floor with no squad knockouts.' },
    { id: 'tower-par-clear', name: 'Ahead of the Bell', description: 'Clear a Tower floor within its score par.' },
    { id: 'tower-disrupt-clear', name: 'Seal Breaker', description: 'Disrupt a pylon and clear the floor.' },
    { id: 'tower-bait-clear', name: 'Turn the Tide', description: 'Bait a boss charge into a pillar and clear the floor.' },
    { id: 'tower-dodge-clear', name: 'Untouchable', description: 'Evade a signature boss strike and clear the floor.' },
    { id: 'tower-elite-clear', name: 'Against the Odds', description: 'Clear a floor using the Elite Shortcut.' },
] as const;
export type TowerHonorId = typeof TOWER_HONORS[number]['id'];
export type TowerPersonalBest = {
    mode: 'story' | 'spire'; floor: number; partySize: number;
    bestScore: number; fastestRounds: number; noKnockout: boolean;
};
export type TowerRecords = { bests: Record<string, TowerPersonalBest>; honors: Partial<Record<TowerHonorId, number>> };
export type TowerClearComparison = {
    runId: string; key: string; score: number; rounds: number; clean: boolean;
    previous?: TowerPersonalBest;
};
