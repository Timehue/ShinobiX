import { canonicalHollowGateDepth, type HollowGateHoundKind } from "./hollow-gate-contract.js";

export type HollowGateCombatTone = "ward" | "lantern" | "tide" | "hunt" | "alpha";
export type HollowGateMusicIntensity = "calm" | "pressure" | "climax";
export type HollowGateCombatDirective = {
    floor: number;
    phase: 1 | 2 | 3;
    phaseName: string;
    title: string;
    instruction: string;
    tone: HollowGateCombatTone;
    hazardTiles: readonly number[];
    safeTiles: readonly number[];
    hazardDamagePct: number;
    incomingDamageMultiplier: number;
    outgoingDamageMultiplier: number;
    musicIntensity: HollowGateMusicIntensity;
    signature: string;
};
export type HollowGateCombatDirectorInput = {
    floor: unknown;
    kind: HollowGateHoundKind;
    turn: number;
    enemyHp: number;
    enemyMaxHp: number;
    playerPos: number;
    enemyPos: number;
    gridWidth?: number;
    gridHeight?: number;
};

const EMPTY: readonly number[] = Object.freeze([]);
const tilesWhere = (width: number, height: number, predicate: (x: number, y: number) => boolean): number[] => {
    const tiles: number[] = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (predicate(x, y)) tiles.push(y * width + x);
    return tiles;
};
const hpRatio = (hp: number, maxHp: number) => Math.max(0, Math.min(1, Number(hp) / Math.max(1, Number(maxHp) || 1)));
const distance = (a: number, b: number, width: number) => {
    const ax = a % width, ay = Math.floor(a / width), bx = b % width, by = Math.floor(b / width);
    const aq = ax, ar = ay - ((ax - (ax & 1)) / 2), bq = bx, br = by - ((bx - (bx & 1)) / 2);
    return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
};

export function hollowGateAlphaPhase(enemyHp: number, enemyMaxHp: number): 1 | 2 | 3 {
    const ratio = hpRatio(enemyHp, enemyMaxHp);
    return ratio <= 0.35 ? 3 : ratio <= 0.7 ? 2 : 1;
}

function alpha(turn: number, phase: 1 | 2 | 3, width: number, height: number): HollowGateCombatDirective {
    if (phase === 1) {
        const charging = turn % 3 === 0, safeColumn = (turn * 2 + 1) % width;
        const safeTiles = charging ? tilesWhere(width, height, (x) => Math.abs(x - safeColumn) <= 1) : EMPTY;
        const safe = new Set(safeTiles);
        return { floor: 5, phase, phaseName: "Guardian", title: charging ? "Gate-Eater's Howl is charging" : "The Alpha tests the surviving wards", instruction: charging ? "Stand inside the violet ward column before the Alpha acts." : "Read the ward lines. The Alpha howls every third turn.", tone: "alpha", hazardTiles: charging ? tilesWhere(width, height, (x, y) => !safe.has(y * width + x)) : EMPTY, safeTiles, hazardDamagePct: charging ? 0.07 : 0, incomingDamageMultiplier: 1, outgoingDamageMultiplier: 1, musicIntensity: "pressure", signature: "Gate-Eater's Howl" };
    }
    if (phase === 2) {
        const open = turn % 2 === 0, parity = turn % 2;
        const hazardTiles = open ? tilesWhere(width, height, (x) => x % 2 === parity) : EMPTY;
        const hazard = new Set(hazardTiles);
        return { floor: 5, phase, phaseName: "Riftstalker", title: open ? "The Alpha tears open alternating rift lanes" : "The rifts inhale", instruction: open ? "Cross onto an unmarked lane before the Alpha pounces." : "Reposition now. The lane pattern reverses on the next turn.", tone: "alpha", hazardTiles, safeTiles: open ? tilesWhere(width, height, (x, y) => !hazard.has(y * width + x)) : EMPTY, hazardDamagePct: open ? 0.08 : 0, incomingDamageMultiplier: 1.1, outgoingDamageMultiplier: open ? 1.12 : 1.04, musicIntensity: "climax", signature: "Rift-Hunt Pounce" };
    }
    const parity = turn % 2, safeTiles = tilesWhere(width, height, (x, y) => (x + y) % 2 === parity), safe = new Set(safeTiles);
    return { floor: 5, phase, phaseName: "Gate-Eater", title: "The Alpha devours the arena one seal at a time", instruction: "Move onto a glowing seal. The safe pattern flips every turn—finish the fight.", tone: "alpha", hazardTiles: tilesWhere(width, height, (x, y) => !safe.has(y * width + x)), safeTiles, hazardDamagePct: 0.09, incomingDamageMultiplier: 1.18, outgoingDamageMultiplier: 1.3, musicIntensity: "climax", signature: "Last Shrine Devourer" };
}

export function hollowGateCombatDirective(input: HollowGateCombatDirectorInput): HollowGateCombatDirective {
    const floor = canonicalHollowGateDepth(input.floor), turn = Math.max(1, Math.floor(Number(input.turn) || 1));
    const width = Math.max(3, Math.floor(input.gridWidth ?? 12)), height = Math.max(3, Math.floor(input.gridHeight ?? 10));
    if (input.kind === "boss") return alpha(turn, hollowGateAlphaPhase(input.enemyHp, input.enemyMaxHp), width, height);
    if (floor === 1) {
        const active = turn % 3 === 0, lane = turn % 4;
        const hazardTiles = active ? tilesWhere(width, height, (x) => x % 4 === lane || x % 4 === (lane + 1) % 4) : EMPTY;
        return { floor, phase: 1, phaseName: "First Ward", title: active ? "Broken wards are collapsing" : "Cinders gather along the ward lines", instruction: active ? "Leave the orange fracture lanes before Ashfang takes its turn." : "Watch the floor. The fractured lanes ignite every third turn.", tone: "ward", hazardTiles, safeTiles: active ? tilesWhere(width, height, (x) => !hazardTiles.some((tile) => tile % width === x)) : EMPTY, hazardDamagePct: active ? 0.04 : 0, incomingDamageMultiplier: active ? 1.08 : 1, outgoingDamageMultiplier: active ? 1.12 : 1, musicIntensity: active ? "pressure" : "calm", signature: "Cinder Pounce" };
    }
    if (floor === 2) {
        const lit = turn % 3 === 1;
        return { floor, phase: 1, phaseName: lit ? "Lanternlight" : "Veil-Slip", title: lit ? "The memory lanterns expose Veilrunner" : "The lanterns go dark", instruction: lit ? "Strike now: the Hound takes 25% more damage while the names burn." : "Hold your guard. Veilrunner hunts harder between extinguished lanterns.", tone: "lantern", hazardTiles: EMPTY, safeTiles: EMPTY, hazardDamagePct: 0, incomingDamageMultiplier: lit ? 0.9 : 1.14, outgoingDamageMultiplier: lit ? 1.25 : 0.92, musicIntensity: lit ? "pressure" : "calm", signature: "Lantern-Slip Rend" };
    }
    if (floor === 3) {
        const high = turn % 2 === 0;
        return { floor, phase: 1, phaseName: high ? "Black Tide" : "Low Water", title: high ? "The reliquary floods from both edges" : "The black water recedes", instruction: high ? "Reach the blue-lit center before Shrineback acts." : "Use the opening to reposition before the next high tide.", tone: "tide", hazardTiles: high ? tilesWhere(width, height, (_x, y) => y <= 1 || y >= height - 2) : EMPTY, safeTiles: high ? tilesWhere(width, height, (_x, y) => y > 1 && y < height - 2) : EMPTY, hazardDamagePct: high ? 0.05 : 0, incomingDamageMultiplier: high ? 1.08 : 0.95, outgoingDamageMultiplier: high ? 0.96 : 1.1, musicIntensity: high ? "pressure" : "calm", signature: "Reliquary Breaker" };
    }
    if (floor === 4) {
        const gap = distance(input.playerPos, input.enemyPos, width), hunted = gap >= 4, pressuring = gap <= 1;
        return { floor, phase: 1, phaseName: hunted ? "Pack Pursuit" : pressuring ? "Broken Hunt" : "Circling Pack", title: hunted ? "Riftmaw has your scent" : pressuring ? "You turn the hunt against Riftmaw" : "Spectral paws circle just beyond sight", instruction: hunted ? "Close the distance. Riftmaw deals 22% more damage to isolated prey." : pressuring ? "Stay close: pressure breaks the phantom pack and boosts your damage." : "Do not let four hexes open between you and the Hound.", tone: "hunt", hazardTiles: EMPTY, safeTiles: EMPTY, hazardDamagePct: 0, incomingDamageMultiplier: hunted ? 1.22 : pressuring ? 0.9 : 1.05, outgoingDamageMultiplier: pressuring ? 1.18 : 1, musicIntensity: hunted ? "climax" : "pressure", signature: "Moonless Execution" };
    }
    return alpha(turn, 1, width, height);
}

export function hollowGateHazardDamage(directive: HollowGateCombatDirective, playerPos: number, playerMaxHp: number): number {
    return directive.hazardDamagePct > 0 && directive.hazardTiles.includes(playerPos)
        ? Math.max(1, Math.floor(Math.max(1, playerMaxHp) * directive.hazardDamagePct))
        : 0;
}

export function hollowGatePhaseTransitionText(previous: number, next: number): string | null {
    if (next <= previous || next < 2) return null;
    return next === 2
        ? "PHASE II — RIFTSTALKER: the Alpha shatters the first ward and begins hunting through the lanes."
        : "PHASE III — GATE-EATER: the last guardian abandons restraint and starts devouring the arena.";
}
