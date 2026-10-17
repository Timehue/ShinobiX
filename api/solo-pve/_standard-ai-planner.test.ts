import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { PvpFighter } from '../pvp/session.js';
import type { ServerAiRule } from '../combat-core/ai-authoring.js';
import { GRID_H, GRID_W } from '../combat-core/constants.js';
import { hexDistance, hexNeighbors } from '../combat-core/grid.js';
import { applySoloPveAction, planStandardPveEnemyActionForTest, runStandardPveEnemyTurnForTest } from './_engine.js';
import { buildSoloPveAiEncounter } from './_ai-encounter.js';
import { createSoloPveSession, type SoloPveCombatEvent, type SoloPveJutsu, type SoloPveSession } from './_session.js';
import {
    enemyTurnPolicy,
    enemyStatusValue,
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
    it('lets a sealed village-war ANBU plan with its copied kit without changing stats or granting a difficulty guard', () => {
        const kit = [jutsu('hit-a', 40), jutsu('hit-b', 40), FLICKER];
        const copied = scenario({ level: 20, kit, distance: 3, kind: 'village-war-garrison' });
        copied.enemy.character.masterAi = true;
        const legacy = structuredClone(copied); delete legacy.enemy.character.aiTurnPolicy;
        const planned = enemyTurn(copied), original = enemyTurn(legacy);
        assert.ok(sum(apSpent(planned)) > sum(apSpent(original)), 'the tactical copy uses legal follow-ups the old runner left unused');
        assert.deepEqual(planned.enemy.character, copied.enemy.character, 'the planner leaves the copied build intact');
        assert.equal(planned.enemy.maxHp, copied.enemy.maxHp);
        assert.equal(planned.difficultyGuard, undefined);
        assert.equal(planned.weeklyBossGuard, undefined);
        assert.ok(enemyEvents(planned).filter(event => event.action === 'jutsu').every(event => kit.some(move => move.id === event.actionId)), 'only copied moves can be cast');
    });
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

    it('limits the new shield/prevention utility eligibility to the standard planner', () => {
        const preventedBuff = [{ name: 'Clear Prevent', rounds: 2, kind: 'positive' as const }];
        const preventedDebuffs = [
            { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' as const },
            { name: 'Wound', rounds: 2, amount: 10, kind: 'negative' as const },
        ];
        for (const kind of ['hollow-gate', 'endless-wave', 'caravan', 'stronghold-patrol', 'anbu-infiltration', 'sector-war-garrison', 'weekly-boss']) {
            const shieldOnly = enemyTurn(scenario({ level: 75, kind, kit: [], player: { shield: 200 } }));
            assert.equal(enemyEvents(shieldOnly)[0]?.action, 'basicAttack', `${kind}: legacy does not detect shield-only Clear`);
            const clearPrevent = enemyTurn(scenario({ level: 75, kind, kit: [], player: { shield: 200, statuses: preventedBuff } }));
            assert.equal(enemyEvents(clearPrevent)[0]?.action, 'clear', `${kind}: preserve legacy prevention eligibility`);
            const cleansePrevent = enemyTurn(scenario({ level: 75, kind, kit: [], enemy: { statuses: preventedDebuffs } }));
            assert.equal(enemyEvents(cleansePrevent)[0]?.action, 'cleanse', `${kind}: preserve legacy Cleanse eligibility`);
        }
        const standardShield = enemyTurn(scenario({ level: 75, kit: [], player: { shield: 200 } }));
        assert.equal(enemyEvents(standardShield)[0]?.action, 'clear');
        const standardPrevent = enemyTurn(scenario({ level: 75, kit: [], player: { shield: 200, statuses: preventedBuff } }));
        assert.ok(enemyEvents(standardPrevent).every((event) => event.action !== 'clear'));
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

    it('closes toward universal basic range when its only ranged damage is Elementally Sealed', () => {
        const kit = [jutsu('fire-burst', 60, { element: 'Fire', effectPower: 36, range: 4 })];
        for (const level of [16, 25, 50, 75, 85]) {
            const source = scenario({ level, kit, distance: 3, enemy: { statuses: [
                { name: 'Elemental Seal', rounds: 3, kind: 'negative' },
                { name: 'Cleanse Prevent', rounds: 3, kind: 'negative' },
            ] } });
            source.activeSide = 'enemy';
            const planned = planStandardPveEnemyActionForTest(source, enemyTurnPolicy(level));
            assert.equal(planned.action?.type, 'move', `level ${level}: legal gap closing has real value`);
            // Run the enemy directly because this fixture is already in its
            // turn; no player action may alter its AP or status eligibility.
            runStandardPveEnemyTurnForTest(source, enemyTurnPolicy(level));
            assert.deepEqual(enemyEvents(source).map((event) => event.action), ['move', 'move', 'basicAttack'], `level ${level}`);
            assert.ok(source.player.hp < 1_000);
            assert.ok(sum(apSpent(source)) <= 100);
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
        runStandardPveEnemyTurnForTest(probe, enemyTurnPolicy(10));
        const first = enemyEvents(probe)[0];
        assert.equal(first?.action, id ? 'jutsu' : 'basicAttack', 'the probe opens with the action being measured');
        return first.before.player.hp - first.after.player.hp;
    }

    it('trained and higher enemies find a 40 + 60 kill the readable novice misses', () => {
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
        const novice = run(10);
        assert.ok(novice.player.hp > 0, 'the readable power-sorted novice misses the two-action finisher');
        for (const level of [16, 25, 40, 60, 75, 100]) {
            const planned = run(level);
            assert.equal(planned.status, 'done', `level ${level}`);
            assert.equal(planned.winner, 'enemy');
            assert.deepEqual(apSpent(planned).sort((a, b) => a - b), [40, 60], 'the deliberate 40 + 60 combination');
        }
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
        assert.ok(enemyEvents(refused).every((event) => event.actionId !== 'opener'), 'the illegal scripted pick is skipped');
        assert.ok(enemyEvents(refused).some((event) => event.actionId === 'big'), 'the generic best-action rule can combine a basic and the legal burst');
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

describe('progressive PvE tactical regressions', () => {
    it('has five tactical tiers without changing the damage guard bands', () => {
        assert.equal(enemyTurnPolicy(15).tier, 'novice');
        assert.equal(enemyTurnPolicy(16).tier, 'trained');
        assert.equal(enemyTurnPolicy(35).tier, 'trained');
        assert.equal(enemyTurnPolicy(36).tier, 'tactical');
        assert.equal(enemyTurnPolicy(61).tier, 'advanced');
        assert.equal(enemyTurnPolicy(86).tier, 'master');
        assert.equal(enemyTurnPolicy(1, true).tier, 'master');
        assert.equal(enemyTurnPolicy(25).band, 'easy', 'onboarding protection remains independent');
    });

    it('clears a shield with no status icons and never spends Clear into Clear Prevent', () => {
        const turn = enemyTurn(scenario({ level: 75, kit: [], player: { shield: 200 } }));
        assert.equal(enemyEvents(turn)[0]?.action, 'clear', 'the shield alone is a useful target');
        assert.equal(turn.player.shield, 0);
        const prevented = enemyTurn(scenario({ level: 75, kit: [], player: {
            shield: 200, statuses: [{ name: 'Clear Prevent', rounds: 2, kind: 'positive' }],
        } }));
        assert.ok(enemyEvents(prevented).every((event) => event.action !== 'clear'));
    });

    it('does not attempt Cleanse while Cleanse Prevent is active', () => {
        const turn = enemyTurn(scenario({ level: 100, kit: [], enemy: { statuses: [
            { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' },
            { name: 'Wound', rounds: 2, amount: 200, kind: 'negative' },
            { name: 'Drain', rounds: 2, amount: 200, kind: 'negative' },
        ] } }));
        assert.ok(enemyEvents(turn).every((event) => event.action !== 'cleanse'));
        assert.ok(enemyEvents(turn).length > 0, 'still uses a legal offensive option');
    });

    it('takes a legal finisher before healing, clearing buffs, or stacking delayed defenses', () => {
        const delayed = jutsu('delayed-defense', 40, { effectPower: 0, target: 'SELF', tags: [
            { name: 'Reflect', percent: 40 }, { name: 'Absorb', percent: 40 },
        ] });
        const turn = enemyTurn(scenario({ level: 100, kit: [delayed], enemy: { hp: 35 }, player: {
            hp: 50, statuses: [{ name: 'Increase Damage Given', rounds: 2, percent: 30, kind: 'positive' }],
        } }));
        assert.equal(turn.winner, 'enemy');
        assert.equal(enemyEvents(turn)[0]?.action, 'basicAttack');
        const authored = enemyTurn(scenario({ level: 100, kit: [delayed], enemy: { hp: 35 }, player: { hp: 50 }, rules: [
            { condition: 'hp_lower_than', value: 50, action: 'use_specific_jutsu', jutsuId: 'delayed-defense' },
            { condition: 'always', value: 0, action: 'use_basic_attack' },
        ] }));
        assert.equal(authored.winner, 'enemy');
        assert.equal(enemyEvents(authored)[0]?.action, 'basicAttack', 'conditional defensive scripts cannot preempt the finisher');
    });

    it('uses immediate survival instead of Reflect/Absorb that cannot save it from a lethal basic', () => {
        const delayed = jutsu('delayed-defense', 40, { effectPower: 0, target: 'SELF', tags: [
            { name: 'Reflect', percent: 40 }, { name: 'Absorb', percent: 40 },
        ] });
        const shield = jutsu('shield', 40, { effectPower: 0, target: 'SELF', tags: [{ name: 'Shield' }] });
        const turn = enemyTurn(scenario({ level: 100, kit: [delayed, shield], enemy: { hp: 35 } }));
        assert.notEqual(enemyEvents(turn)[0]?.actionId, 'delayed-defense');
        assert.ok(enemyEvents(turn).some((event) => event.actionId === 'shield' || event.action === 'move'), 'immediate shield or useful retreat');
    });

    it('does not Flicker beside an adjacent opponent just to consume leftover AP', () => {
        const turn = enemyTurn(scenario({ level: 100, kit: [FLICKER], distance: 1 }));
        assert.equal(turn.enemy.pos, tileAtDistance(1));
        assert.ok(enemyEvents(turn).every((event) => event.actionId !== 'flicker'));
        assert.equal(sum(apSpent(turn)), 80, 'two real basic attacks, no pointless 20-AP dash');
    });

    it('does not stack another Reflect above the real aggregate ceiling', () => {
        const reflect = jutsu('reflect', 40, { effectPower: 0, target: 'SELF', tags: [{ name: 'Reflect', percent: 40 }] });
        const source = scenario({ level: 100, kit: [reflect], enemy: {
            hp: 8_000, maxHp: 10_000, statuses: [{ name: 'Reflect', percent: 60, rounds: 3, kind: 'positive' }],
        }, player: { hp: 10_000, maxHp: 10_000 } });
        source.activeSide = 'enemy';
        source.ap.enemy = 40;
        runStandardPveEnemyTurnForTest(source, enemyTurnPolicy(100));
        assert.equal(enemyEvents(source)[0]?.action, 'basicAttack');
    });

    it('the highest tier sees movement plus two attacks beyond a two-action horizon', () => {
        const kit = [FLICKER,
            jutsu('close-a', 40, { effectPower: 12, range: 1, isUtility: false }),
            jutsu('close-b', 40, { effectPower: 12, range: 1, isUtility: false }),
            jutsu('ranged', 60, { effectPower: 18, range: 4 }),
        ];
        const run = (level: number) => {
            const source = scenario({ level: 100, kit, distance: 3 });
            source.activeSide = 'enemy';
            runStandardPveEnemyTurnForTest(source, enemyTurnPolicy(level));
            return source;
        };
        const advanced = run(75), master = run(100);
        assert.equal(enemyEvents(advanced)[0]?.actionId, 'ranged', JSON.stringify(enemyEvents(advanced).map((event) => [event.action, event.actionId, event.before.player.hp - event.after.player.hp])));
        assert.equal(enemyEvents(master)[0]?.actionId, 'flicker');
        assert.equal(sum(apSpent(master)), 100);
        assert.ok(master.player.hp < advanced.player.hp, 'the legal three-action line deals more effective damage');
    });

    it('values status potency, duration and actual cleanup needs instead of icon counts', () => {
        const context = { round: 1, maxHp: 1_000, hp: 1_000, shield: 0, positiveCount: 1, negativeCount: 0, opponentNegativeCount: 0 };
        const weak = enemyStatusValue({ name: 'Decrease Damage Taken', percent: 5, rounds: 1, kind: 'positive' }, context);
        const strong = enemyStatusValue({ name: 'Decrease Damage Taken', percent: 40, rounds: 2, kind: 'positive' }, context);
        assert.ok(strong > weak * 5);
        assert.equal(enemyStatusValue({ name: 'Increase Heal', percent: 40, rounds: 2, kind: 'positive' }, context), 0, 'full HP has no immediate heal amplification benefit');
        const seal = { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' as const };
        assert.ok(enemyStatusValue(seal, { ...context, negativeCount: 3 }) > enemyStatusValue(seal, context));
    });

    it('a fully shielded Siphon hit has no invented healing benefit', () => {
        const siphon = jutsu('siphon', 60, { effectPower: 2, tags: [{ name: 'Siphon', percent: 40 }] });
        const source = scenario({ level: 100, kit: [siphon], distance: 3, enemy: { hp: 800 }, player: { shield: 200 } });
        source.activeSide = 'enemy';
        source.ap.enemy = 60;
        source.cooldowns.enemy.basicHeal = 5;
        source.cooldowns.enemy.clear = 5;
        const turn = structuredClone(source);
        runStandardPveEnemyTurnForTest(turn, enemyTurnPolicy(100));
        const hit = enemyEvents(turn).find((event) => event.actionId === 'siphon');
        assert.ok(hit, 'uses the real shield-damaging attack');
        assert.equal(hit.after.enemy.hp, hit.before.enemy.hp, 'post-shield damage is zero, so Siphon cannot heal');
        assert.equal(hit.after.player.hp, hit.before.player.hp);
    });

    it('bounds highest-tier work deterministically even with a large legal kit', () => {
        const kit = [...Array.from({ length: 12 }, (_, index) => jutsu(`quick-${index}`, 20, { effectPower: 4, range: 5 })), FLICKER];
        const source = scenario({ level: 100, kit, distance: 3 });
        source.activeSide = 'enemy';
        const policy = enemyTurnPolicy(100);
        const a = planStandardPveEnemyActionForTest(source, policy);
        const b = planStandardPveEnemyActionForTest(source, policy);
        assert.deepEqual(a, b);
        assert.ok(a.simulations <= policy.maxSimulations && a.simulations > 0);
        assert.equal(source.events.length, 0, 'all previews are isolated');
    });

    it('keeps worst-case decision latency bounded with a full history attached', (t) => {
        const kit = [...Array.from({ length: 8 }, (_, index) => jutsu(`quick-${index}`, 20, { effectPower: 4, range: 5 })), FLICKER];
        const source = scenario({ level: 100, kit, distance: 3 });
        source.activeSide = 'enemy';
        source.log = Array.from({ length: 250 }, () => 'A retained combat log line.');
        // History is intentionally retained by the caller; preview copies must
        // drop it rather than clone a growing battle once per search branch.
        const historyEvent = enemyTurn(scenario({ level: 100, kit: [], distance: 1 })).events[0];
        source.events = Array.from({ length: 250 }, () => structuredClone(historyEvent));
        const times: number[] = [];
        for (let sample = 0; sample < 24; sample++) {
            const start = performance.now();
            const decision = planStandardPveEnemyActionForTest(source, enemyTurnPolicy(100));
            times.push(performance.now() - start);
            assert.ok(decision.simulations <= 128);
        }
        const p95 = times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1];
        t.diagnostic(`highest-tier decision p95: ${p95.toFixed(2)} ms (${times.length} samples, max 128 resolver previews)`);
        assert.ok(p95 < 1_000, `bounded planner smoke budget: ${p95.toFixed(2)} ms`);
        assert.equal(source.events.length, 250);
    });
});
