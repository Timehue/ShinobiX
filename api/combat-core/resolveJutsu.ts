export type ResolveJutsuDamageSetup<TStats> = {
    baseDmg: number;
    effectiveDR: number;
    offStats: TStats;
};

export type ResolveJutsuStatusResult<TFighter> = {
    s: TFighter;
    o: TFighter;
    lines: string[];
    damage: number;
    healing: number;
    shieldGain: number;
    pierce: boolean;
};

export type ResolveJutsuPostResult<TFighter, TFx> = {
    s: TFighter;
    o: TFighter;
    lines: string[];
    fx: TFx[];
};

export type ResolveBaseDamagePhase<TFighter, TJutsu, TStats> = (
    self: TFighter,
    opponent: TFighter,
    jutsu: TJutsu,
    wMult: number,
    biome: string,
    round: number,
    masteryLevel: number,
) => ResolveJutsuDamageSetup<TStats>;

export type ResolveTagStatusesPhase<TFighter, TJutsu> = (
    self: TFighter,
    opponent: TFighter,
    jutsu: TJutsu,
    round: number,
    masteryLevel: number,
    baseDmg: number,
    healBoost: number,
) => ResolveJutsuStatusResult<TFighter>;

export type ResolveDamageNumberPhase<TFighter, TJutsu, TStats> = (
    self: TFighter,
    opponent: TFighter,
    jutsu: TJutsu,
    round: number,
    masteryLevel: number,
    offStats: TStats,
    damageIn: number,
    pierce: boolean,
    effectiveDR: number,
) => number;

export type ResolvePostDamagePhase<TFighter, TJutsu, TFx> = (
    self: TFighter,
    opponent: TFighter,
    jutsu: TJutsu,
    round: number,
    damage: number,
    pierce: boolean,
    healBoost: number,
) => ResolveJutsuPostResult<TFighter, TFx>;

export type ResolveJutsuPhases<TFighter, TJutsu, TStats, TFx> = {
    resolveBaseDamage: ResolveBaseDamagePhase<TFighter, TJutsu, TStats>;
    resolveTagStatuses: ResolveTagStatusesPhase<TFighter, TJutsu>;
    resolveDamageNumber: ResolveDamageNumberPhase<TFighter, TJutsu, TStats>;
    resolvePostDamage: ResolvePostDamagePhase<TFighter, TJutsu, TFx>;
    applyHealing: (fighter: TFighter, amount: number) => TFighter;
    applyShield: (fighter: TFighter, amount: number) => TFighter;
    makeHitFx?: (who: 'self' | 'opp', amount: number, kind: 'damage' | 'heal') => TFx | null | undefined;
};

export type ResolveJutsuArgs<TFighter, TJutsu, TStats, TFx> = {
    self: TFighter;
    opponent: TFighter;
    formulaSelf?: TFighter;
    formulaOpponent?: TFighter;
    jutsu: TJutsu;
    wMult: number;
    biome: string;
    round: number;
    masteryLevel: number;
    healBoost: number;
    phases: ResolveJutsuPhases<TFighter, TJutsu, TStats, TFx>;
};

export type ResolveJutsuMetadata = {
    damage: number;
    baseDamage: number;
    effectiveDR: number;
    pierce: boolean;
    healing: number;
    shieldGain: number;
    masteryLevel: number;
};

export type ResolveJutsuResult<TFighter, TFx> = {
    self: TFighter;
    opponent: TFighter;
    logLines: string[];
    hitFx: TFx[];
    metadata: ResolveJutsuMetadata;
};

export function resolveJutsu<TFighter, TJutsu, TStats, TFx>(
    args: ResolveJutsuArgs<TFighter, TJutsu, TStats, TFx>,
): ResolveJutsuResult<TFighter, TFx> {
    const {
        self,
        opponent,
        formulaSelf = self,
        formulaOpponent = opponent,
        jutsu,
        wMult,
        biome,
        round,
        masteryLevel,
        healBoost,
        phases,
    } = args;

    // The phase order is load-bearing: formula copies feed damage, while status
    // and post-damage phases thread their mutated fighter copies forward.
    const base = phases.resolveBaseDamage(formulaSelf, formulaOpponent, jutsu, wMult, biome, round, masteryLevel);
    const status = phases.resolveTagStatuses(self, opponent, jutsu, round, masteryLevel, base.baseDmg, healBoost);
    let s = status.s;
    let o = status.o;
    const logLines = status.lines;
    const hitFx: TFx[] = [];

    const damage = phases.resolveDamageNumber(
        self,
        opponent,
        jutsu,
        round,
        masteryLevel,
        base.offStats,
        status.damage,
        status.pierce,
        base.effectiveDR,
    );

    if (damage > 0) {
        const post = phases.resolvePostDamage(s, o, jutsu, round, damage, status.pierce, healBoost);
        s = post.s;
        o = post.o;
        logLines.push(...post.lines);
        hitFx.push(...post.fx);
    }

    if (status.healing > 0) {
        s = phases.applyHealing(s, status.healing);
        const fx = phases.makeHitFx?.('self', status.healing, 'heal');
        if (fx) hitFx.push(fx);
    }
    if (status.shieldGain > 0) {
        s = phases.applyShield(s, status.shieldGain);
    }

    return {
        self: s,
        opponent: o,
        logLines,
        hitFx,
        metadata: {
            damage,
            baseDamage: base.baseDmg,
            effectiveDR: base.effectiveDR,
            pierce: status.pierce,
            healing: status.healing,
            shieldGain: status.shieldGain,
            masteryLevel,
        },
    };
}
