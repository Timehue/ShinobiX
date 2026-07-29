import { canonicalHollowGateDepth, type HollowGateHoundKind } from "../../../shared/hollow-gate-contract";

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

type HollowGateCombatDirectorInput = {
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

const EMPTY_TILES: readonly number[] = Object.freeze([]);

function clampTurn(turn: number): number {
    return Math.max(1, Math.floor(Number(turn) || 1));
}

function hpRatio(enemyHp: number, enemyMaxHp: number): number {
    return Math.max(0, Math.min(1, Number(enemyHp) / Math.max(1, Number(enemyMaxHp) || 1)));
}

function tilesWhere(width: number, height: number, predicate: (x: number, y: number) => boolean): number[] {
    const tiles: number[] = [];
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (predicate(x, y)) tiles.push(y * width + x);
        }
    }
    return tiles;
}

function axialDistance(a: number, b: number, width: number): number {
    const ax = a % width;
    const ay = Math.floor(a / width);
    const bx = b % width;
    const by = Math.floor(b / width);
    const aq = ax;
    const ar = ay - ((ax - (ax & 1)) / 2);
    const bq = bx;
    const br = by - ((bx - (bx & 1)) / 2);
    return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
}

export function hollowGateAlphaPhase(enemyHp: number, enemyMaxHp: number): 1 | 2 | 3 {
    const ratio = hpRatio(enemyHp, enemyMaxHp);
    if (ratio <= 0.35) return 3;
    if (ratio <= 0.7) return 2;
    return 1;
}

function floorOneDirective(turn: number, width: number, height: number): HollowGateCombatDirective {
    const active = turn % 3 === 0;
    const lane = turn % 4;
    const hazardTiles = active
        ? tilesWhere(width, height, (x) => x % 4 === lane || x % 4 === (lane + 1) % 4)
        : EMPTY_TILES;
    return {
        floor: 1,
        phase: 1,
        phaseName: "First Ward",
        title: active ? "Broken wards are collapsing" : "Cinders gather along the ward lines",
        instruction: active
            ? "Leave the orange fracture lanes before Ashfang takes its turn."
            : "Watch the floor. The fractured lanes ignite every third turn.",
        tone: "ward",
        hazardTiles,
        safeTiles: active ? tilesWhere(width, height, (x) => !hazardTiles.some((tile) => tile % width === x)) : EMPTY_TILES,
        hazardDamagePct: active ? 0.04 : 0,
        incomingDamageMultiplier: active ? 1.08 : 1,
        outgoingDamageMultiplier: active ? 1.12 : 1,
        musicIntensity: active ? "pressure" : "calm",
        signature: "Cinder Pounce",
    };
}

function floorTwoDirective(turn: number): HollowGateCombatDirective {
    const lanternsLit = turn % 3 === 1;
    return {
        floor: 2,
        phase: 1,
        phaseName: lanternsLit ? "Lanternlight" : "Veil-Slip",
        title: lanternsLit ? "The memory lanterns expose Veilrunner" : "The lanterns go dark",
        instruction: lanternsLit
            ? "Strike now: the Hound takes 25% more damage while the names burn."
            : "Hold your guard. Veilrunner hunts harder between extinguished lanterns.",
        tone: "lantern",
        hazardTiles: EMPTY_TILES,
        safeTiles: EMPTY_TILES,
        hazardDamagePct: 0,
        incomingDamageMultiplier: lanternsLit ? 0.9 : 1.14,
        outgoingDamageMultiplier: lanternsLit ? 1.25 : 0.92,
        musicIntensity: lanternsLit ? "pressure" : "calm",
        signature: "Lantern-Slip Rend",
    };
}

function floorThreeDirective(turn: number, width: number, height: number): HollowGateCombatDirective {
    const highTide = turn % 2 === 0;
    const hazardTiles = highTide
        ? tilesWhere(width, height, (_x, y) => y <= 1 || y >= height - 2)
        : EMPTY_TILES;
    const safeTiles = highTide
        ? tilesWhere(width, height, (_x, y) => y > 1 && y < height - 2)
        : EMPTY_TILES;
    return {
        floor: 3,
        phase: 1,
        phaseName: highTide ? "Black Tide" : "Low Water",
        title: highTide ? "The reliquary floods from both edges" : "The black water recedes",
        instruction: highTide
            ? "Reach the blue-lit center before Shrineback acts."
            : "Use the opening to reposition before the next high tide.",
        tone: "tide",
        hazardTiles,
        safeTiles,
        hazardDamagePct: highTide ? 0.05 : 0,
        incomingDamageMultiplier: highTide ? 1.08 : 0.95,
        outgoingDamageMultiplier: highTide ? 0.96 : 1.1,
        musicIntensity: highTide ? "pressure" : "calm",
        signature: "Reliquary Breaker",
    };
}

function floorFourDirective(turn: number, playerPos: number, enemyPos: number, width: number): HollowGateCombatDirective {
    const distance = axialDistance(playerPos, enemyPos, width);
    const hunted = distance >= 4;
    const pressuring = distance <= 1;
    return {
        floor: 4,
        phase: 1,
        phaseName: hunted ? "Pack Pursuit" : pressuring ? "Broken Hunt" : "Circling Pack",
        title: hunted ? "Riftmaw has your scent" : pressuring ? "You turn the hunt against Riftmaw" : "Spectral paws circle just beyond sight",
        instruction: hunted
            ? "Close the distance. Riftmaw deals 22% more damage to isolated prey."
            : pressuring
                ? "Stay close: pressure breaks the phantom pack and boosts your damage."
                : "Do not let four hexes open between you and the Hound.",
        tone: "hunt",
        hazardTiles: EMPTY_TILES,
        safeTiles: EMPTY_TILES,
        hazardDamagePct: 0,
        incomingDamageMultiplier: hunted ? 1.22 : pressuring ? 0.9 : 1.05,
        outgoingDamageMultiplier: pressuring ? 1.18 : 1,
        musicIntensity: hunted ? "climax" : "pressure",
        signature: "Moonless Execution",
    };
}

function alphaDirective(
    turn: number,
    phase: 1 | 2 | 3,
    width: number,
    height: number,
): HollowGateCombatDirective {
    if (phase === 1) {
        const charging = turn % 3 === 0;
        const safeColumn = (turn * 2 + 1) % width;
        const safeTiles = charging
            ? tilesWhere(width, height, (x) => Math.abs(x - safeColumn) <= 1)
            : EMPTY_TILES;
        const safeSet = new Set(safeTiles);
        return {
            floor: 5,
            phase,
            phaseName: "Guardian",
            title: charging ? "Gate-Eater's Howl is charging" : "The Alpha tests the surviving wards",
            instruction: charging
                ? "Stand inside the violet ward column before the Alpha acts."
                : "Read the ward lines. The Alpha howls every third turn.",
            tone: "alpha",
            hazardTiles: charging ? tilesWhere(width, height, (x, y) => !safeSet.has(y * width + x)) : EMPTY_TILES,
            safeTiles,
            hazardDamagePct: charging ? 0.07 : 0,
            incomingDamageMultiplier: 1,
            outgoingDamageMultiplier: 1,
            musicIntensity: "pressure",
            signature: "Gate-Eater's Howl",
        };
    }

    if (phase === 2) {
        const riftOpen = turn % 2 === 0;
        const hazardParity = turn % 2;
        const hazardTiles = riftOpen
            ? tilesWhere(width, height, (x) => x % 2 === hazardParity)
            : EMPTY_TILES;
        const hazardSet = new Set(hazardTiles);
        return {
            floor: 5,
            phase,
            phaseName: "Riftstalker",
            title: riftOpen ? "The Alpha tears open alternating rift lanes" : "The rifts inhale",
            instruction: riftOpen
                ? "Cross onto an unmarked lane before the Alpha pounces."
                : "Reposition now. The lane pattern reverses on the next turn.",
            tone: "alpha",
            hazardTiles,
            safeTiles: riftOpen ? tilesWhere(width, height, (x, y) => !hazardSet.has(y * width + x)) : EMPTY_TILES,
            hazardDamagePct: riftOpen ? 0.08 : 0,
            incomingDamageMultiplier: 1.1,
            outgoingDamageMultiplier: riftOpen ? 1.12 : 1.04,
            musicIntensity: "climax",
            signature: "Rift-Hunt Pounce",
        };
    }

    const safeParity = turn % 2;
    const safeTiles = tilesWhere(width, height, (x, y) => (x + y) % 2 === safeParity);
    const safeSet = new Set(safeTiles);
    return {
        floor: 5,
        phase,
        phaseName: "Gate-Eater",
        title: "The Alpha devours the arena one seal at a time",
        instruction: "Move onto a glowing seal. The safe pattern flips every turn—finish the fight.",
        tone: "alpha",
        hazardTiles: tilesWhere(width, height, (x, y) => !safeSet.has(y * width + x)),
        safeTiles,
        hazardDamagePct: 0.09,
        incomingDamageMultiplier: 1.18,
        outgoingDamageMultiplier: 1.3,
        musicIntensity: "climax",
        signature: "Last Shrine Devourer",
    };
}

export function hollowGateCombatDirective(input: HollowGateCombatDirectorInput): HollowGateCombatDirective {
    const floor = canonicalHollowGateDepth(input.floor);
    const turn = clampTurn(input.turn);
    const width = Math.max(3, Math.floor(input.gridWidth ?? 12));
    const height = Math.max(3, Math.floor(input.gridHeight ?? 10));

    if (input.kind === "boss") {
        return alphaDirective(turn, hollowGateAlphaPhase(input.enemyHp, input.enemyMaxHp), width, height);
    }

    if (floor === 1) return floorOneDirective(turn, width, height);
    if (floor === 2) return floorTwoDirective(turn);
    if (floor === 3) return floorThreeDirective(turn, width, height);
    if (floor === 4) return floorFourDirective(turn, input.playerPos, input.enemyPos, width);

    return alphaDirective(turn, 1, width, height);
}

export function hollowGateHazardDamage(
    directive: HollowGateCombatDirective,
    playerPos: number,
    playerMaxHp: number,
): number {
    if (directive.hazardDamagePct <= 0 || !directive.hazardTiles.includes(playerPos)) return 0;
    return Math.max(1, Math.floor(Math.max(1, playerMaxHp) * directive.hazardDamagePct));
}

export function hollowGatePhaseTransitionText(previous: number, next: number): string | null {
    if (next <= previous || next < 2) return null;
    if (next === 2) return "PHASE II — RIFTSTALKER: the Alpha shatters the first ward and begins hunting through the lanes.";
    return "PHASE III — GATE-EATER: the last guardian abandons restraint and starts devouring the arena.";
}
