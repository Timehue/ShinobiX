export type TowerPan = { x: number; y: number };

export const TOWER_ZOOM_MIN = 1;
export const TOWER_ZOOM_MAX = 2.5;
export const TOWER_ZOOM_STEP = 0.25;

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
