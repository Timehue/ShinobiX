import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTowerEncounter } from './_encounter.js';
import { FLOOR_CATALOG, getFloor } from './_floor-catalog.js';
import { applyAction, checkTowerWinner, startRound } from './_engine.js';
import { TOWER_BOSS_TRANSFORMATIONS, towerBossTransformationProblems } from './_boss-forms.js';
import type { TowerActor, TowerSession } from './_tower-session.js';
import type { BossTransformationPlan } from '../../shared/boss-transformations.js';

const build = (floorId: number): TowerSession => buildTowerEncounter({
    floor: structuredClone(getFloor(floorId)!), partySize: 4, runId: `forms-${floorId}`, seed: 77, now: 0,
    squad: Array.from({ length: 4 }, (_, index) => ({
        id: `sq-${index}`, name: `Player ${index}`, ownerSlug: `player-${index}`, ai: false,
        character: { level: 100, maxHp: 10000, maxChakra: 10000, maxStamina: 10000,
            specialty: 'Taijutsu', stats: { taijutsuOffense: 2000, strength: 2000, speed: 2000 } },
    })),
});
const bossOf = (session: TowerSession): TowerActor => session.actors.find(actor => actor.id === 'boss')!;
const kitIds = (boss: TowerActor) => (boss.character.jutsu as Array<{ id: string }>).map(jutsu => jutsu.id);
const reload = (session: TowerSession): TowerSession => JSON.parse(JSON.stringify(session)) as TowerSession;
/** Clear the guards so objective gates cannot mask the boss's own state. */
function clearAdds(session: TowerSession): void {
    for (const actor of session.actors) if (actor.side === 'enemy' && actor.id !== 'boss') actor.hp = 0;
    session.pendingEnemyWaves = [];
}

test('authored tower plans are valid and every milestone floor (5, 10, 15) transforms', () => {
    assert.deepEqual(towerBossTransformationProblems(), []);
    const milestones = FLOOR_CATALOG.filter(floor => floor.id % 5 === 0);
    assert.deepEqual(milestones.map(floor => floor.id), [5, 10, 15]);
    for (const floor of milestones) {
        assert.ok(floor.boss?.transformation, `F${floor.id} names a plan`);
        assert.ok(TOWER_BOSS_TRANSFORMATIONS[floor.boss!.transformation!], `F${floor.id} plan exists`);
        const session = build(floor.id);
        assert.ok(session.bossForms, `F${floor.id} seals the plan into the run`);
        assert.equal(session.bossForms!.phase, 0);
    }
    for (const floor of FLOOR_CATALOG.filter(floor => floor.id % 5 !== 0)) {
        assert.equal(build(floor.id).bossForms, undefined, `F${floor.id} is unchanged`);
    }
});

test('every authored form (tower and story) ships its portrait and battle sprite', async () => {
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { STORY_KAGE_TRANSFORMATIONS } = await import('../story/_kage-transformations.js');
    const publicDir = resolve(process.cwd(), 'shinobij.client/public'); // tests run from the repo root
    const plans = [...Object.values(TOWER_BOSS_TRANSFORMATIONS), ...Object.values(STORY_KAGE_TRANSFORMATIONS)];
    assert.equal(plans.length, 7);
    for (const plan of plans) for (const phase of plan.phases) {
        for (const art of [phase.portrait, phase.sprite]) {
            assert.ok(art, `${plan.id}/${phase.id}: portrait and sprite are authored`);
            assert.ok(existsSync(resolve(publicDir, `.${art}`)), `${art} exists in shinobij.client/public`);
        }
    }
});

test('the boss transforms at half health inside the same run, exactly once, alongside its HP gates', () => {
    for (const floorId of [5, 10, 15]) {
        const floor = getFloor(floorId)!;
        const plan = TOWER_BOSS_TRANSFORMATIONS[floor.boss!.transformation!]!;
        const form = plan.phases[0]!;
        const session = build(floorId);
        clearAdds(session);
        const boss = bossOf(session);
        const opening = kitIds(boss);
        boss.hp = Math.floor(boss.maxHp * 0.6) + 5;
        checkTowerWinner(session, floor);
        assert.equal(session.bossForms!.phase, 0, `F${floorId}: above half nothing changes`);
        boss.hp = Math.floor(boss.maxHp * 0.49);
        const hpAtCross = boss.hp;
        checkTowerWinner(session, floor);
        assert.equal(session.status, 'active');
        assert.equal(session.bossForms!.phase, 1, `F${floorId}: transformed`);
        assert.equal(boss.hp, hpAtCross, 'tower forms carry no heal');
        for (const id of form.moveset!.remove!) assert.ok(opening.includes(id) && !kitIds(boss).includes(id), `F${floorId}: drops ${id}`);
        for (const id of form.moveset!.add!) assert.ok(kitIds(boss).includes(id), `F${floorId}: learns ${id}`);
        const favored = (boss.character.jutsu as Array<{ id: string; aiPriority?: number }>).find(jutsu => jutsu.id === form.moveset!.favor![0]);
        assert.equal(favored?.aiPriority, 100, 'the favoured signature is the AI priority');
        assert.ok(session.log.some(line => line.includes(form.formName)));
        assert.ok(session.phaseState.triggeredPhases.length > 0, 'the floor gates still fired');

        const again = reload(session);
        const againBoss = bossOf(again);
        againBoss.hp = Math.floor(againBoss.maxHp * 0.2);
        checkTowerWinner(again, floor);
        assert.equal(again.bossForms!.seq, 1, `F${floorId}: never twice, even after a reload`);
    }
});

test('a summon form calls its sealed reinforcements once, near the boss', () => {
    const plans = TOWER_BOSS_TRANSFORMATIONS as Record<string, BossTransformationPlan>;
    plans['test-summon'] = {
        id: 'test-summon', lethalGuard: false,
        phases: [{
            id: 'call', atHpPct: 50, formName: 'Calling Form', aura: 'eclipse', summary: 'It calls its guard.',
            cutscene: { speaker: 'Boss', lines: ['To me.'] },
            mechanic: { kind: 'summon', name: 'Rally', aiId: 'grunt-bandit', count: 2, tell: 'Two Bandits answer.' },
        }],
    };
    try {
        const floor = structuredClone(getFloor(10)!);
        floor.boss!.transformation = 'test-summon';
        const session = buildTowerEncounter({
            floor, partySize: 4, runId: 'forms-summon', seed: 77, now: 0,
            squad: Array.from({ length: 4 }, (_, index) => ({
                id: `sq-${index}`, name: `Player ${index}`, ownerSlug: `player-${index}`, ai: false,
                character: { level: 100, maxHp: 10000, maxChakra: 10000, maxStamina: 10000, specialty: 'Taijutsu', stats: { taijutsuOffense: 2000 } },
            })),
        });
        assert.equal(session.bossFormKit?.summons?.call?.count, 2, 'the reinforcement template is sealed with the run');
        clearAdds(session);
        const adds = () => [...session.actors, ...(session.pendingEnemyWaves ?? []).flatMap(wave => wave.actors)].filter(actor => actor.id.startsWith('add-'));
        assert.equal(adds().length, 0);
        bossOf(session).hp = Math.floor(bossOf(session).maxHp * 0.45);
        checkTowerWinner(session, floor);
        assert.equal(session.bossForms!.phase, 1);
        assert.equal(adds().length, 2, 'two Bandits arrive');
        assert.ok(adds().every(add => add.name === 'Bandit'));
        checkTowerWinner(session, floor);
        assert.equal(adds().length, 2, 'and only once');
    } finally {
        delete plans['test-summon'];
    }
});

test('a killing blow still wins the floor: tower plans do not hold the boss at 1 HP', () => {
    const floor = getFloor(10)!;
    const session = build(10);
    clearAdds(session);
    bossOf(session).hp = 0;
    checkTowerWinner(session, floor);
    assert.equal(session.status, 'done');
    assert.equal(session.winner, 'squad');
    assert.equal(session.bossForms!.phase, 0, 'no transformation on a dead boss');
});

test('Obsidian Colossus takes less damage, except from Water', async () => {
    const { towerBossFormTakenMult } = await import('./_boss-forms.js');
    const floor = getFloor(5)!;
    const hitFor = (transformed: boolean): number => {
        const session = build(5);
        clearAdds(session);
        const boss = bossOf(session);
        boss.hp = transformed ? Math.floor(boss.maxHp * 0.45) : Math.floor(boss.maxHp * 0.8);
        checkTowerWinner(session, floor);
        assert.equal(session.bossForms!.phase, transformed ? 1 : 0);
        const attacker = session.actors.find(actor => actor.id === 'sq-0')!;
        attacker.chakra = attacker.maxChakra; attacker.stamina = attacker.maxStamina;
        boss.shield = 0; boss.statuses = []; boss.character.aegis = undefined;
        session.map.blockedTiles = []; session.map.features = []; session.map.boardObjects = [];
        attacker.pos = 0; boss.pos = 1;
        session.turnQueue = ['sq-0']; session.activeIndex = 0; session.activeAp = 100; session.actionsThisTurn = 0;
        const before = boss.hp;
        const result = applyAction(session, floor, { actorId: 'sq-0', type: 'attack', targetId: 'boss' }, () => .5);
        assert.ok(result.applied, JSON.stringify(result));
        return before - boss.hp;
    };
    const base = hitFor(false), form = hitFor(true);
    assert.ok(base > 0);
    assert.ok(Math.abs(form - base * 0.75) <= 2, `the stance cuts damage 25% in the real engine (${base} → ${form})`);
    const session = build(5);
    clearAdds(session);
    bossOf(session).hp = Math.floor(bossOf(session).maxHp * 0.45);
    checkTowerWinner(session, floor);
    assert.equal(towerBossFormTakenMult(session, bossOf(session), { element: 'Fire', type: 'Ninjutsu' }), 0.75);
    assert.equal(towerBossFormTakenMult(session, bossOf(session), { element: 'Water', type: 'Ninjutsu' }), 1.3, 'Water cracks the shell');
    assert.equal(towerBossFormTakenMult(session, session.actors.find(actor => actor.id === 'sq-0')!, { element: 'Water' }), 1, 'only the boss');
});

test('Storm Hermit charges for a round: unanswered it strikes the squad, answered it breaks', () => {
    const floor = getFloor(15)!;
    const transformed = () => {
        const session = build(15);
        clearAdds(session);
        const boss = bossOf(session);
        boss.hp = Math.floor(boss.maxHp * 0.45);
        checkTowerWinner(session, floor);
        assert.equal(session.bossForms!.phase, 1);
        clearAdds(session); // the 70% gate's Weavers would keep it guarded (and unable to charge)
        session.round += 1;
        startRound(session);
        assert.ok(session.bossForms!.charge, 'the charge arms at round start');
        return session;
    };
    const unanswered = transformed();
    const squadBefore = unanswered.actors.filter(actor => actor.side === 'squad').map(actor => actor.hp + actor.shield);
    unanswered.round += 1;
    startRound(unanswered);
    const squadAfter = unanswered.actors.filter(actor => actor.side === 'squad').map(actor => actor.hp + actor.shield);
    assert.ok(squadAfter.every((hp, index) => hp < squadBefore[index]!), 'every shinobi is struck');
    assert.ok(unanswered.log.some(line => line.includes('releases Crown of Ten Thousand Bolts')));

    const answered = transformed();
    const charge = answered.bossForms!.charge!;
    bossOf(answered).hp = charge.hpAtArm - charge.breakAt;
    checkTowerWinner(answered, floor);
    assert.equal(answered.bossForms!.charge, undefined, 'enough damage breaks the charge');
    const squadHp = answered.actors.filter(actor => actor.side === 'squad').map(actor => actor.hp);
    answered.round += 1;
    startRound(answered);
    assert.ok(!answered.log.some(line => line.includes('releases Crown')), 'a broken charge never fires');
    assert.deepEqual(answered.actors.filter(actor => actor.side === 'squad').map(actor => actor.hp).length, squadHp.length);
});

test('while guards make the Regent untargetable it neither charges nor bleeds through its gates', async () => {
    const { towerBossFormRoundEnd } = await import('./_boss-forms.js');
    const floor = getFloor(15)!;
    const session = build(15);
    clearAdds(session);
    const boss = bossOf(session);
    boss.hp = Math.floor(boss.maxHp * 0.45);
    checkTowerWinner(session, floor);
    assert.equal(session.bossForms!.phase, 1);
    assert.equal(session.objectiveState.bossUnlocked, false, "the 70% gate's Weavers guard it");
    const weavers = session.actors.filter(actor => actor.side === 'enemy' && actor.id !== boss.id && actor.hp > 0);
    assert.ok(weavers.length > 0);
    session.round += 1;
    startRound(session);
    assert.equal(session.bossForms!.charge, undefined, 'no charge while guarded');
    for (const weaver of weavers) weaver.hp = 0;
    session.round += 1;
    startRound(session);
    assert.ok(session.bossForms!.charge, 'armed once the Regent can be hit');
    // Guards return (as the 40% gate's summons do): the charge fizzles, none re-arms, upkeep pauses.
    for (const weaver of weavers) weaver.hp = weaver.maxHp;
    session.round += 1;
    startRound(session);
    assert.equal(session.bossForms!.charge, undefined);
    assert.ok(session.log.some(line => line.includes('fades while its guard holds the line')));
    assert.ok(!session.log.some(line => line.includes('releases Crown of Ten Thousand Bolts')), 'the squad is not struck by a charge it could not answer');
    const hp = boss.hp;
    towerBossFormRoundEnd(session);
    assert.equal(boss.hp, hp, 'no upkeep while guarded');
    for (const weaver of weavers) weaver.hp = 0;
    session.round += 1;
    startRound(session); // objective progress re-reads the fallen guards
    towerBossFormRoundEnd(session);
    assert.equal(hp - boss.hp, Math.floor(boss.maxHp * 4 / 100), 'upkeep resumes once the guards fall');
});

test('Eclipse Brand burns the Sovereign each round end but never finishes it alone', async () => {
    const { towerBossFormRoundEnd } = await import('./_boss-forms.js');
    const floor = getFloor(10)!;
    const session = build(10);
    clearAdds(session);
    const boss = bossOf(session);
    boss.hp = Math.floor(boss.maxHp * 0.45);
    checkTowerWinner(session, floor);
    const before = boss.hp;
    towerBossFormRoundEnd(session);
    assert.equal(before - boss.hp, Math.floor(boss.maxHp / 100));
    boss.hp = 3;
    towerBossFormRoundEnd(session);
    assert.equal(boss.hp, 1);
    assert.ok(!kitIds(boss).includes('sovereign-crown'), 'the Reflect guard is gone');
});
