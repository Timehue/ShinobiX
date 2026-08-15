import { pveAiMasteryForLevel } from '../_pve-difficulty.js';
import type { TowerFloor } from './_floor-catalog.js';
import { createTowerSession, type TowerActor, type TowerSession } from './_tower-session.js';

/** Test-only Tower session for engine wiring. Generic AI fights run on Solo-PvE;
 * these fixtures deliberately model only the legacy Tower engine feature under
 * test instead of reaching through a retired production encounter constructor. */
export function makePveEngineTestSession(params: {
    enemyLevel: number;
    playerMaxHp?: number;
    runId?: string;
}): TowerSession {
    const level = Math.max(1, Math.min(100, Math.floor(Number(params.enemyLevel) || 1)));
    const playerMaxHp = Math.max(1, Math.floor(Number(params.playerMaxHp) || 800));
    const burst = {
        id: 'pve-engine-test-burst',
        name: 'PvE Engine Test Burst',
        type: 'Ninjutsu',
        element: 'Fire',
        method: 'SINGLE',
        target: 'OPPONENT',
        ap: 60,
        range: 8,
        effectPower: 100,
        tags: [],
    };
    const player: TowerActor = {
        id: 'player', side: 'squad', name: 'Rill', ownerSlug: 'Rill', ai: false,
        hp: playerMaxHp, maxHp: playerMaxHp,
        chakra: 5_000, maxChakra: 5_000, stamina: 5_000, maxStamina: 5_000,
        shield: 0, statuses: [], cooldowns: {}, pos: 0,
        character: {
            name: 'Rill', level: 60, specialty: 'Ninjutsu',
            stats: {
                strength: 100, speed: 2_000, intelligence: 100, willpower: 100,
                ninjutsuOffense: 200, ninjutsuDefense: 100,
                taijutsuOffense: 100, taijutsuDefense: 100,
                bukijutsuOffense: 100, bukijutsuDefense: 100,
                genjutsuOffense: 100, genjutsuDefense: 100,
            },
            jutsu: [],
        },
    };
    const enemy: TowerActor = {
        id: 'boss', side: 'enemy', name: 'Test Rival', ownerSlug: null, ai: true,
        hp: 10_000, maxHp: 10_000,
        chakra: 5_000, maxChakra: 5_000, stamina: 5_000, maxStamina: 5_000,
        shield: 0, statuses: [], cooldowns: {}, pos: 1,
        character: {
            name: 'Test Rival', level, specialty: 'Ninjutsu',
            stats: {
                strength: 1_000, speed: 100, intelligence: 1_000, willpower: 1_000,
                ninjutsuOffense: 2_500, ninjutsuDefense: 500,
                taijutsuOffense: 1_000, taijutsuDefense: 500,
                bukijutsuOffense: 1_000, bukijutsuDefense: 500,
                genjutsuOffense: 1_000, genjutsuDefense: 500,
            },
            jutsu: [burst],
            jutsuMastery: [{ jutsuId: burst.id, level: pveAiMasteryForLevel(level) }],
        },
    };
    const floor: TowerFloor = {
        id: 9_300,
        name: 'PvE Engine Fixture',
        biome: 'central',
        objective: 'defeat-boss',
        roundBudget: 24,
        map: { width: 8, height: 8 },
        fieldRule: { kind: 'none' },
        enemies: [],
        boss: { aiId: 'pve-engine-test-boss' },
        firstClearReward: {},
    };
    const session = createTowerSession({
        towerId: 'pve-engine-test',
        runId: params.runId ?? `pve-engine-test-${level}`,
        floor: floor.id,
        seed: 99,
        partySize: 1,
        map: {
            width: 8,
            height: 8,
            biome: floor.biome,
            fieldRule: floor.fieldRule,
            blockedTiles: [],
            hazardTiles: [],
            objectiveTiles: [],
        },
        actors: [player, enemy],
        objectiveKind: floor.objective,
        bossId: enemy.id,
        now: 1_770_000_000_000,
    });
    session.encounterFloor = floor;
    session.pveGuard = { enemyLevel: level, turnStartHp: {}, dealtThisTurn: {} };
    return session;
}
