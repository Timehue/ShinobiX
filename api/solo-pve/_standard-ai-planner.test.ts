import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { PvpFighter } from '../pvp/session.js';
import type { ServerAiRule } from '../combat-core/ai-authoring.js';
import { GRID_H, GRID_W } from '../combat-core/constants.js';
import { hexDistance, hexNeighbors } from '../combat-core/grid.js';
import { applySoloPveAction, runStandardPveEnemyTurnForTest } from './_engine.js';
import { buildSoloPveAiEncounter } from './_ai-encounter.js';
import { createSoloPveSession, type SoloPveCombatEvent, type SoloPveJutsu, type SoloPveSession } from './_session.js';
import {
    enemyTurnPolicy,
    STANDARD_PVE_AI_KINDS,
    STANDARD_PVE_AI_POLICY,
    standardPvePlannerApplies,
} from './_ai-turn-policy.js';

/*
 * The standard-PvE enemy turn planner (./_ai-turn-policy.ts + ./_engine.ts).
 * Every scenario runs the real Solo-PvE resolver: the planner only chooses.
 */

const NOW = 1_800_000_000_000;
const PLAYER_POS = 62;

function jutsu(id: string, ap: number, over: Partial<SoloPveJutsu> = {}): SoloPveJutsu {
    return {
        id, name: id, type: 'Taijutsu', element: 'None', effectPower: 30, ap, range: 4, cooldown: 3,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [], ...over,
    } as SoloPveJutsu;
}

const FLICKER = jutsu('flicker', 20, { effectPower: 1, range: 5, cooldown: 2, target: 'EMPTY_GROUND', tags: [{ name: 'Move', percent: 0 }] });

function fighter(name: string, pos: number, over: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name, hp: 1_000, maxHp: 1_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, shield: 0,
        statuses: [], pos,
        character: { level: 60, specialty: 'Taijutsu', stats: { taijutsuOffense: 600, taijutsuDefense: 400 }, jutsu: [], pvpItems: [], equipment: {} },
        ...over,
    };
}

type Scenario = {
    level?: number;
    kit: SoloPveJutsu[];
    distance?: number;
    kind?: string;
    sealed?: boolean;
    rules?: ServerAiRule[];
    enemy?: Partial<PvpFighter>;
    player?: Partial<PvpFighter>;
    blockedTiles?: number[];
    weeklyBossRoundBudget?: number;
    id?: string;
};

function tileAtDistance(distance: number): number {
    for (let tile = 0; tile < GRID_W * GRID_H; tile++) if (hexDistance(tile, PLAYER_POS) === distance) return tile;
    throw new Error(`no tile at distance ${distance}`);
}

function scenario(s: Scenario): SoloPveSession {
    const level = s.level ?? 60;
    return createSoloPveSession({
        sessionId: s.id ?? 'planner',
        ownerSlug: 'alice',
        encounter: { kind: s.kind ?? 'generic-ai', id: 'planner-test', level },
        player: fighter('Alice', PLAYER_POS, s.player),
        enemy: fighter('Rival', tileAtDistance(s.distance ?? 1), {
            ...s.enemy,
            character: {
                level, specialty: 'Taijutsu', stats: { taijutsuOffense: 600, taijutsuDefense: 400 },
                jutsu: s.kit, pvpItems: [], equipment: {},
                ...(s.sealed === false ? {} : { aiTurnPolicy: STANDARD_PVE_AI_POLICY }),
                ...(s.rules ? { aiRules: s.rules } : {}),
            },
        }),
        now: NOW,
        environment: { blockedTiles: s.blockedTiles ?? [] },
        ...(s.weeklyBossRoundBudget ? { weeklyBossRoundBudget: s.weeklyBossRoundBudget } : {}),
    });
}

/** The player waits; the enemy plays one full turn through the real engine. */
function enemyTurn(session: SoloPveSession): SoloPveSession {
    return applySoloPveAction(session, { type: 'wait' }).session;
}

function enemyEvents(session: SoloPveSession): SoloPveCombatEvent[] {
    return session.events.filter((event) => event.actor === 'enemy' && event.kind === 'action');
}

function apSpent(session: SoloPveSession, events = enemyEvents(session)): number[] {
    const kit = session.enemy.character.jutsu as SoloPveJutsu[];
    return events.map((event) => {
        if (event.action === 'jutsu') return Number(kit.find((entry) => entry.id === event.actionId)?.ap ?? NaN);
        return ({ move: 30, basicAttack: 40, basicHeal: 60, clear: 60, cleanse: 60, wait: 0 } as Record<string, number>)[event.action] ?? NaN;
    });
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('standard-PvE turn planner — scope', () => {
    it('applies only to sealed standard-PvE sessions, and never to a weekly boss or an authored mission kit', () => {
        for (const kind of STANDARD_PVE_AI_KINDS) {
            assert.equal(standardPvePlannerApplies({ policy: STANDARD_PVE_AI_POLICY, kind, missionTactics: false, weeklyBoss: false, env: {} }), true, kind);
        }
        for (const kind of ['hollow-gate', 'endless-wave', 'caravan', 'stronghold-patrol', 'weekly-boss', 'anbu-infiltration', 'sector-war-garrison', 'test']) {
            assert.equal(standardPvePlannerApplies({ policy: STANDARD_PVE_AI_POLICY, kind, missionTactics: false, weeklyBoss: false, env: {} }), false, kind);
        }
        assert.equal(standardPvePlannerApplies({ policy: undefined, kind: 'generic-ai', missionTactics: false, weeklyBoss: false, env: {} }), false, 'unsealed');
        assert.equal(standardPvePlannerApplies({ policy: STANDARD_PVE_AI_POLICY, kind: 'mission', missionTactics: true, weeklyBoss: false, env: {} }), false, 'authored kits');
        assert.equal(standardPvePlannerApplies({ policy: STANDARD_PVE_AI_POLICY, kind: 'generic-ai', missionTactics: false, weeklyBoss: true, env: {} }), false, 'weekly boss guard');
        assert.equal(standardPvePlannerApplies({ policy: STANDARD_PVE_AI_POLICY, kind: 'generic-ai', missionTactics: false, weeklyBoss: false, env: { DISABLE_PVE_AI_PLANNER: '1' } }), false, 'kill switch');
    });

    it('keeps every protected Solo host on the original runner, byte for byte', () => {
        // 40 + 40 + a legal 20-AP Flicker: the planner spends the last 20 AP,
        // the original runner stops below 30. A sealed protected session must
        // behave exactly like an unsealed one.
        const kit = [jutsu('hit-a', 40), jutsu('hit-b', 40), FLICKER];
        const planned = enemyTurn(scenario({ kit, distance: 3 }));
        const original = enemyTurn(scenario({ kit, distance: 3, sealed: false }));
        assert.notDeepEqual(apSpent(planned), apSpent(original), 'the scenario distinguishes the two runners');
        for (const kind of ['hollow-gate', 'endless-wave', 'caravan', 'stronghold-patrol', 'anbu-infiltration', 'sector-war-garrison', 'weekly-boss']) {
            const sealed = enemyTurn(scenario({ kit, distance: 3, kind }));
            const unsealed = enemyTurn(scenario({ kit, distance: 3, kind, sealed: false }));
            assert.deepEqual(sealed.events, unsealed.events, kind);
            assert.deepEqual({ player: sealed.player.hp, enemy: sealed.enemy.pos, ap: sealed.ap }, { player: unsealed.player.hp, enemy: unsealed.enemy.pos, ap: unsealed.ap }, kind);
        }
        const weekly = enemyTurn(scenario({ kit, distance: 3, weeklyBossRoundBudget: 20 }));
        assert.deepEqual(apSpent(weekly), apSpent(enemyTurn(scenario({ kit, distance: 3, weeklyBossRoundBudget: 20, sealed: false }))), 'weekly boss guard');
    });

    it('DISABLE_PVE_AI_PLANNER=1 restores the original runner for sealed sessions', () => {
        const kit = [jutsu('hit-a', 40), jutsu('hit-b', 40), FLICKER];
        const before = process.env.DISABLE_PVE_AI_PLANNER;
        process.env.DISABLE_PVE_AI_PLANNER = '1';
        try {
            assert.deepEqual(apSpent(enemyTurn(scenario({ kit, distance: 3 }))), apSpent(enemyTurn(scenario({ kit, distance: 3, sealed: false }))));
        } finally {
            if (before === undefined) delete process.env.DISABLE_PVE_AI_PLANNER; else process.env.DISABLE_PVE_AI_PLANNER = before;
        }
    });

    it('seals the policy only when a host opts in, and not under the kill switch', () => {
        const save = { character: { name: 'Alice', level: 40, specialty: 'Taijutsu', hp: 1_000, maxHp: 1_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, stats: {} }, creatorJutsus: [], creatorItems: [], savedBloodlines: [] };
        const profile = { id: 'planner-seal', name: 'Seal Rival', level: 40, hp: 2_000, chakra: 500, stamina: 500, stats: { taijutsuOffense: 500 }, jutsu: [jutsu('seal-hit', 40)] };
        const build = (extra: Record<string, unknown>) => buildSoloPveAiEncounter({ sessionId: 'seal', playerName: 'alice', save, profile, now: NOW, admin: null, ...extra });
        assert.equal(build({}).enemy.character.aiTurnPolicy, undefined, 'protected hosts pass nothing');
        assert.equal(build({ aiTurnPolicy: STANDARD_PVE_AI_POLICY }).enemy.character.aiTurnPolicy, STANDARD_PVE_AI_POLICY);
        assert.equal(build({ aiTurnPolicy: STANDARD_PVE_AI_POLICY, env: { ...process.env, DISABLE_PVE_AI_PLANNER: '1' } }).enemy.character.aiTurnPolicy, undefined);
    });
});

describe('standard-PvE turn planner — turn economy and legality', () => {
    it('spends 40 + 40 + 20 where the original runner discarded the last 20 AP (medium and up)', () => {
        const kit = [jutsu('hit-a', 40), jutsu('hit-b', 40), FLICKER];
        for (const level of [40, 60, 95]) {
            const turn = enemyTurn(scenario({ level, kit, distance: 3 }));
            assert.deepEqual(apSpent(turn).sort((a, b) => b - a), [40, 40, 20], `level ${level}`);
        }
        assert.deepEqual(apSpent(enemyTurn(scenario({ level: 60, kit, distance: 3, sealed: false }))), [40, 40], 'the original runner stops below 30 AP');
    });

    it('keeps easy enemies readable: the original turn end and the original choices', () => {
        const kit = [jutsu('hit-a', 40), jutsu('hit-b', 40), FLICKER];
        const easy = enemyTurn(scenario({ level: 10, kit, distance: 3 }));
        const original = enemyTurn(scenario({ level: 10, kit, distance: 3, sealed: false }));
        assert.deepEqual(apSpent(easy), [40, 40], 'no 20-AP follow-up below 30 AP');
        assert.deepEqual(enemyEvents(easy).map((e) => [e.action, e.actionId, e.tile]), enemyEvents(original).map((e) => [e.action, e.actionId, e.tile]),
            'with nothing illegal on the table, an easy enemy makes exactly the original moves');
    });

    it('never exceeds five actions or the AP the turn grants, stunned or not', () => {
        const five = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => jutsu(`quick-${id}`, 20, { effectPower: 5 }));
        const full = enemyTurn(scenario({ kit: five, distance: 2 }));
        assert.equal(enemyEvents(full).length, 5, 'the engine cap of five actions');
        assert.ok(sum(apSpent(full)) <= 100);
        const stunned = enemyTurn(scenario({ kit: five, distance: 2, enemy: { statuses: [{ name: 'Stun', rounds: 2, kind: 'negative' }] } }));
        assert.ok(sum(apSpent(stunned)) <= 60, `a stunned turn has 60 AP, spent ${sum(apSpent(stunned))}`);
        assert.equal(enemyEvents(stunned).length, 3);
    });

    it('ends at once when no legal action exists', () => {
        const blocked = hexNeighbors(tileAtDistance(4));
        const turn = enemyTurn(scenario({ kit: [], distance: 4, blockedTiles: blocked }));
        assert.equal(enemyEvents(turn).length, 0);
        assert.equal(turn.activeSide, 'player');
        assert.equal(turn.status, 'active');
    });

    it('uses a legal option when Elemental Seal locks its elemental jutsu — the original runner wasted the whole turn', () => {
        const kit = [jutsu('fire-burst', 60, { element: 'Fire', effectPower: 40 })];
        const sealed = { statuses: [{ name: 'Elemental Seal', rounds: 3, kind: 'negative' as const }] };
        const original = enemyTurn(scenario({ kit, distance: 1, enemy: sealed, sealed: false }));
        assert.equal(enemyEvents(original).length, 0, 'the original runner re-picked the rejected cast until its guard ran out');
        for (const level of [10, 40, 60]) {
            const planned = enemyTurn(scenario({ level, kit, distance: 1, enemy: sealed }));
            const actions = enemyEvents(planned).map((event) => event.action);
            assert.ok(actions.length > 0 && actions.every((action) => action === 'basicAttack'), `level ${level}: ${actions.join(',')}`);
            assert.ok(planned.player.hp < 1_000);
        }
    });

    it('respects cooldowns, range and resources', () => {
        const heavy = jutsu('heavy', 60, { effectPower: 40, range: 4 });
        const onCooldown = scenario({ kit: [heavy], distance: 1 });
        onCooldown.cooldowns.enemy.heavy = 3;
        assert.ok(enemyEvents(enemyTurn(onCooldown)).every((event) => event.actionId !== 'heavy'), 'on cooldown');

        const far = enemyTurn(scenario({ kit: [heavy], distance: 7 }));
        const farEvents = enemyEvents(far);
        assert.ok(farEvents.length > 0 && farEvents.every((event) => event.action === 'move'), 'closes the distance instead of casting out of range');

        const poor = enemyTurn(scenario({ kit: [jutsu('pricey', 40, { chakraCost: 900 })], distance: 1 }));
        assert.ok(enemyEvents(poor).every((event) => event.action === 'basicAttack'), 'no chakra, no cast');
    });
});

describe('standard-PvE turn planner — decision quality by bracket', () => {
    // Identical session, identical numbers: only the bracket policy differs.
    // In this resolver a 40-AP cast is a zero-damage utility unless it sets
    // isUtility: false (isZeroDamageFortyApJutsu), and every 60-AP cast deals
    // damage. A 40-AP debuff pile out-scores the 60-AP hit for a
    // one-step chooser (4 statuses), which then has AP for the hit alone. The
    // only lethal line this turn is basic attack (40) + hit (60).
    const kit = [
        jutsu('slam', 60, { effectPower: 10 }),
        // Four debuffs that start next round, so none amplifies this turn.
        jutsu('hex', 40, {
            effectPower: 0,
            tags: [
                { name: 'Decrease Damage Given', percent: 10 },
                { name: 'Lag', percent: 0 },
                { name: 'Buff Prevent', percent: 0 },
                { name: 'Cleanse Prevent', percent: 0 },
            ],
        }),
    ];

    /** What ONE action deals: the first enemy event of a probe turn with only that option. */
    function damageOf(id: string | null): number {
        const probe = scenario({ kit: id ? kit.filter((entry) => entry.id === id) : [] });
        probe.activeSide = 'enemy';
        runStandardPveEnemyTurnForTest(probe, enemyTurnPolicy(40));
        const first = enemyEvents(probe)[0];
        assert.equal(first?.action, id ? 'jutsu' : 'basicAttack', 'the probe opens with the action being measured');
        return first.before.player.hp - first.after.player.hp;
    }

    it('a hard enemy finds the 40 + 60 kill a one-step medium enemy misses', () => {
        const basic = damageOf(null);
        const slam = damageOf('slam');
        assert.ok(basic > 0 && slam > 0, `both hits land (basic ${basic}, slam ${slam})`);
        const hp = Math.max(basic, slam) + 1;
        assert.ok(hp < basic + slam, 'only the pair is lethal');
        const run = (level: number) => {
            // Stamina for ONE basic attack (10 each): two basics would also be
            // lethal, and the planner rightly prefers that cheaper line.
            const session = scenario({ kit, player: { hp }, enemy: { stamina: 15 } });
            session.activeSide = 'enemy';
            runStandardPveEnemyTurnForTest(session, enemyTurnPolicy(level));
            return session;
        };
        const medium = run(40);
        const hard = run(60);
        assert.ok(medium.player.hp > 0, `the one-step chooser opens with the debuff pile (${enemyEvents(medium).map((e) => e.actionId).join(',')})`);
        assert.equal(hard.status, 'done');
        assert.equal(hard.winner, 'enemy');
        assert.deepEqual(apSpent(hard).sort((a, b) => a - b), [40, 60], 'the deliberate 40 + 60 combination');
    });

    it('honours an authored opener, and skips an authored pick the resolver would refuse', () => {
        const opener = jutsu('opener', 40, { effectPower: 5 });
        const big = jutsu('big', 60, { effectPower: 40 });
        // A non-empty program must end in an unconditional basic attack
        // (validateServerAiRules), exactly as every catalog profile does.
        const rules: ServerAiRule[] = [
            { condition: 'specific_round', value: 1, action: 'use_specific_jutsu', jutsuId: 'opener' },
            { condition: 'always', value: 0, action: 'use_highest_power_jutsu' },
            { condition: 'always', value: 0, action: 'use_basic_attack' },
        ];
        const scripted = enemyTurn(scenario({ kit: [opener, big], rules }));
        assert.equal(enemyEvents(scripted)[0]?.actionId, 'opener', 'the scripted round-1 opener comes first');

        const sealedOpener = jutsu('opener', 40, { effectPower: 5, element: 'Water' });
        const refused = enemyTurn(scenario({ kit: [sealedOpener, big], rules, enemy: { statuses: [{ name: 'Elemental Seal', rounds: 3, kind: 'negative' }] } }));
        assert.equal(enemyEvents(refused)[0]?.actionId, 'big', 'an illegal scripted pick falls through to the next rule');
    });

    it('is deterministic in every bracket', () => {
        const mixed = [jutsu('hit-a', 40), jutsu('hit-b', 60, { effectPower: 20 }), FLICKER, ...kit.filter((entry) => entry.id === 'hex')];
        for (const level of [10, 40, 60, 95]) {
            for (const distance of [1, 3, 6]) {
                const a = enemyTurn(scenario({ level, kit: mixed, distance }));
                const b = enemyTurn(scenario({ level, kit: mixed, distance }));
                assert.deepEqual(a, b, `level ${level} distance ${distance}`);
                assert.ok(enemyEvents(a).length <= 5 && sum(apSpent(a)) <= 100, `caps at level ${level} distance ${distance}`);
            }
        }
    });
});
