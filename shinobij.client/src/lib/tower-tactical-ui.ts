export type TowerPan = { x: number; y: number };

export const TOWER_ZOOM_MIN = 1;
export const TOWER_ZOOM_MAX = 2.5;
export const TOWER_ZOOM_STEP = 0.25;

export type TowerProjectedGrade = "S" | "A" | "B" | "C";

export type TowerScoreProjection = {
    score: number;
    grade: TowerProjectedGrade;
    paceLabel: string;
    noDeathBonusActive: boolean;
};

/**
 * Display-only mirror of the server's v1 Tower score. The settlement endpoint
 * remains authoritative; this lets the player understand the consequence of
 * the current round and squad health before the floor ends.
 */
export function projectTowerClearScore(input: {
    floor: number;
    round: number;
    roundBudget: number;
    squadHpRemaining: number;
    squadHpMax: number;
    deaths: number;
    scoreMultiplier?: number;
}): TowerScoreProjection {
    const floor = Math.max(1, Math.floor(Number(input.floor) || 1));
    const round = Math.max(1, Math.floor(Number(input.round) || 1));
    const budget = Math.max(1, Math.floor(Number(input.roundBudget) || 1));
    const hpMax = Math.max(1, Number(input.squadHpMax) || 1);
    const hpRemaining = Math.max(0, Math.min(hpMax, Number(input.squadHpRemaining) || 0));
    const deaths = Math.max(0, Math.floor(Number(input.deaths) || 0));
    const multiplier = Math.max(1, Math.min(2, Number(input.scoreMultiplier) || 1));
    const speedTerm = Math.max(0, Math.min(1, (budget - round + 1) / budget));
    const survivalTerm = hpRemaining / hpMax;
    const noDeathTerm = deaths === 0 ? 1 : 0;
    const floorBase = 100 * floor;
    const baseScore = Math.round(floorBase * (1 + 0.4 * speedTerm + 0.45 * survivalTerm + 0.15 * noDeathTerm))
        + (deaths === 0 ? 50 : 0);
    const score = Math.round(baseScore * multiplier);
    const maximum = Math.round((floorBase * 2 + 50) * multiplier);
    const ratio = score / Math.max(1, maximum);
    const grade: TowerProjectedGrade = ratio >= 0.86 ? "S" : ratio >= 0.74 ? "A" : ratio >= 0.62 ? "B" : "C";
    const paceDelta = budget - round;
    const paceLabel = paceDelta > 0
        ? `${paceDelta} round${paceDelta === 1 ? "" : "s"} ahead of par`
        : paceDelta === 0
            ? "On par pace"
            : `${Math.abs(paceDelta)} round${Math.abs(paceDelta) === 1 ? "" : "s"} over par`;
    return { score, grade, paceLabel, noDeathBonusActive: deaths === 0 };
}

type PreviewActor = {
    hp: number;
    maxHp: number;
    shield?: number;
    statuses?: Array<{ name: string; percent?: number; rounds?: number; activeRound?: number }>;
    character?: Record<string, unknown>;
};

function combatComposite(stats: Record<string, unknown>, type: string, offense: boolean): number {
    const number = (key: string) => Number(stats[key]) || 0;
    const strength = number("strength");
    const speed = number("speed");
    const intelligence = number("intelligence");
    const willpower = number("willpower");
    const discipline = type === "Genjutsu" ? "genjutsu"
        : type === "Ninjutsu" ? "ninjutsu"
            : type === "Bukijutsu" ? "bukijutsu" : "taijutsu";
    const general = discipline === "taijutsu" ? strength + speed
        : discipline === "bukijutsu" ? intelligence + strength
            : discipline === "genjutsu" ? intelligence + willpower
                : willpower + speed;
    return number(`${discipline}${offense ? "Offense" : "Defense"}`) + general;
}

/** Conservative deterministic hit preview. Reactive tags and future AI actions
 * are intentionally excluded and the UI labels the result as an estimate. */
export function estimateTowerActionDamage(input: {
    attacker: PreviewActor;
    target: PreviewActor;
    effectPower: number;
    type?: string;
    actionId?: string;
    biome?: string;
}): { rawDamage: number; hpDamage: number; shieldAbsorbed: number } {
    const effectPower = Math.max(0, Number(input.effectPower) || 0);
    if (effectPower <= 0) return { rawDamage: 0, hpDamage: 0, shieldAbsorbed: 0 };
    const type = String(input.type || "Taijutsu");
    const attackerCharacter = input.attacker.character ?? {};
    const defenderCharacter = input.target.character ?? {};
    const attackerStats = (attackerCharacter.stats as Record<string, unknown> | undefined) ?? {};
    const defenderStats = (defenderCharacter.stats as Record<string, unknown> | undefined) ?? {};
    const offense = combatComposite(attackerStats, type, true);
    const defense = combatComposite(defenderStats, type, false);
    const statFactor = Math.max(0.35, Math.min(1.85, 1 + ((offense - defense) / 5000) * 0.85));
    const masteryRows = Array.isArray(attackerCharacter.jutsuMastery)
        ? attackerCharacter.jutsuMastery as Array<{ jutsuId?: unknown; level?: unknown }>
        : [];
    const masteryRow = masteryRows.find(row => String(row.jutsuId ?? "") === String(input.actionId ?? ""));
    const mastery = masteryRow ? Math.max(0, Math.min(50, Number(masteryRow.level) || 0)) : 0;
    const masteryFraction = 0.3 + 0.7 * (mastery / 50);
    const scaledEp = (effectPower + 10) * masteryFraction;
    const bloodline = Math.max(0, Number(attackerCharacter.bloodlineMult) || 1);
    const item = 1 + Math.max(0, Number(attackerCharacter.itemDamagePct) || 0) / 100;
    const partyScale = Math.max(0, Number(attackerCharacter.towerDmgScale) || 1);
    const biome = String(input.biome ?? "central");
    const terrain = (biome === "forest" && type === "Taijutsu")
        || (biome === "snow" && type === "Bukijutsu")
        || (biome === "volcano" && type === "Ninjutsu")
        || (biome === "shadow" && type === "Genjutsu") ? 1.1 : 1;
    const attackerStatuses = input.attacker.statuses ?? [];
    const targetStatuses = input.target.statuses ?? [];
    const rawAmp = [...attackerStatuses.filter(status => status.name === "Increase Damage Given"),
        ...targetStatuses.filter(status => status.name === "Increase Damage Taken" || status.name === "Ignition")]
        .reduce((total, status) => total + Math.max(0, Number(status.percent) || 0) / 100, 0);
    const amp = rawAmp > 0 ? 1 + rawAmp / (rawAmp + 0.5) : 1;
    const authoredArmor = defenderCharacter.armorRawDR;
    const armorFactor = Math.min(1, Math.max(0.25, Number(defenderCharacter.armorFactor) || 1));
    const rawArmor = authoredArmor != null
        ? Math.min(1.5, Math.max(0, Number(authoredArmor) || 0))
        : Math.max(0, 1 - armorFactor);
    const rawStatusDr = [...attackerStatuses.filter(status => status.name === "Decrease Damage Given"),
        ...targetStatuses.filter(status => status.name === "Decrease Damage Taken")]
        .reduce((total, status) => total + Math.max(0, Number(status.percent) || 0) / 100, 0);
    const rawDr = rawArmor + rawStatusDr;
    const effectiveDr = rawDr > 0 ? rawDr / (rawDr + 0.5) : 0;
    const guardMitigation = Math.min(0.5, Math.max(0, Number(defenderCharacter.guardDefensePct) || 0) / 100);
    const rawDamage = Math.max(0, Math.floor(scaledEp * 32 * statFactor * terrain * bloodline * item * partyScale * amp * (1 - effectiveDr) * (1 - guardMitigation)));
    const shieldAbsorbed = Math.min(Math.max(0, Number(input.target.shield) || 0), rawDamage);
    return { rawDamage, hpDamage: Math.max(0, rawDamage - shieldAbsorbed), shieldAbsorbed };
}

export function buildTowerMilestoneReceipt(milestone: string): string {
    const floorMatch = /^tower-floor-(\d+)$/i.exec(milestone.trim());
    const label = floorMatch
        ? `Floor ${floorMatch[1]}`
        : milestone.replace(/[-_]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
    return `Milestone recorded · ${label}`;
}

export function clampTowerZoom(value: number, maximum = TOWER_ZOOM_MAX): number {
    const finiteMaximum = Number.isFinite(maximum) ? Math.max(TOWER_ZOOM_MIN, maximum) : TOWER_ZOOM_MAX;
    if (!Number.isFinite(value)) return TOWER_ZOOM_MIN;
    return Math.min(finiteMaximum, Math.max(TOWER_ZOOM_MIN, value));
}

/** Keep a centred, zoomed board pannable to every edge without letting it disappear. */
export function clampTowerPan(
    pan: TowerPan,
    container: { width: number; height: number },
    board: { width: number; height: number },
): TowerPan {
    const maxX = Math.max(0, (board.width - container.width) / 2);
    const maxY = Math.max(0, (board.height - container.height) / 2);
    const x = Math.max(-maxX, Math.min(maxX, Number.isFinite(pan.x) ? pan.x : 0));
    const y = Math.max(-maxY, Math.min(maxY, Number.isFinite(pan.y) ? pan.y : 0));
    return {
        x: Object.is(x, -0) ? 0 : x,
        y: Object.is(y, -0) ? 0 : y,
    };
}

export function buildTowerTileLabel(input: {
    position: number;
    width: number;
    occupant?: string;
    feature?: string;
    groundEffect?: string;
    blocked?: boolean;
    objective?: boolean;
    danger?: string[];
    validAction?: string;
}): string {
    const row = Math.floor(input.position / Math.max(1, input.width)) + 1;
    const column = (input.position % Math.max(1, input.width)) + 1;
    const details = [`Tile row ${row}, column ${column}`];
    if (input.occupant) details.push(`Occupied by ${input.occupant}`);
    if (input.blocked) details.push("Impassable terrain");
    if (input.objective) details.push("Objective tile");
    if (input.feature) details.push(input.feature);
    if (input.groundEffect) details.push(input.groundEffect);
    for (const warning of input.danger ?? []) details.push(`Danger: ${warning}`);
    if (input.validAction) details.push(`Available: ${input.validAction}`);
    return `${details.join(". ")}.`;
}

export function buildTowerThreatSummary(input: {
    round: number;
    strikeLabel?: string;
    strikeTiles?: number;
    hazardTiles?: number;
    ringTiles?: number;
    reinforcementRound?: number;
    reinforcementCount?: number;
    nextBossPhase?: number;
    roundCap?: number;
}): string[] {
    const threats: string[] = [];
    if ((input.strikeTiles ?? 0) > 0) {
        threats.push(`End of round ${input.round}: ${input.strikeLabel ?? "boss strike"} hits ${input.strikeTiles} tile${input.strikeTiles === 1 ? "" : "s"}`);
    }
    if ((input.hazardTiles ?? 0) > 0) {
        threats.push(`${input.hazardTiles} hazard tile${input.hazardTiles === 1 ? "" : "s"} erupt at round end`);
    }
    if ((input.ringTiles ?? 0) > 0) {
        threats.push(`${input.ringTiles} outer tile${input.ringTiles === 1 ? " is" : "s are"} outside the safe ring`);
    }
    if (Number.isFinite(input.reinforcementRound) && (input.reinforcementCount ?? 0) > 0) {
        threats.push(`${input.reinforcementCount} reinforcement${input.reinforcementCount === 1 ? "" : "s"} arrive in round ${input.reinforcementRound}`);
    }
    if (Number.isFinite(input.nextBossPhase)) threats.push(`Next boss phase at ${input.nextBossPhase}% HP`);
    if (input.roundCap) {
        const remaining = Math.max(0, input.roundCap - input.round);
        if (remaining <= 3) threats.push(`${remaining} round${remaining === 1 ? "" : "s"} remain before the floor closes`);
    }
    return threats;
}
