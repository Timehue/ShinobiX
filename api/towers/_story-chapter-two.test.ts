import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTowerEncounter, type SquadMemberInput } from './_encounter.js';
import { getEnemyTemplate } from './_enemy-templates.js';
import { FLOOR_CATALOG, getFloor, type TowerFloor } from './_floor-catalog.js';
import { applyAction, checkTowerWinner, endTurn, startRound, towerNeighbors } from './_engine.js';
import { makeRng } from './_sim.js';

function hero(id = 'chapter-two-hero'): SquadMemberInput {
    const stat = 2_300;
    return {
        id,
        name: 'Chapter Two Hero',
        ownerSlug: id,
        ai: false,
        character: {
            level: 80,
            maxHp: 11_000,
            maxChakra: 2_000,
            maxStamina: 2_000,
            stats: {
                taijutsuOffense: stat, taijutsuDefense: stat,
                bukijutsuOffense: stat, bukijutsuDefense: stat,
                genjutsuOffense: stat, genjutsuDefense: stat,
                ninjutsuOffense: stat, ninjutsuDefense: stat,
                strength: stat, speed: stat, intelligence: stat, willpower: stat,
            },
            jutsu: [{ id: 'chapter-two-test-strike', name: 'Measured Strike', type: 'Taijutsu', ap: 40, range: 1, effectPower: 18 }],
            armorRawDR: 0.7,
        },
    };
}

function encounter(floor: TowerFloor, seed = 71) {
    return buildTowerEncounter({
        floor,
        squad: [hero()],
        runId: `chapter-two-${floor.id}-${seed}`,
        seed,
        partySize: 4,
        now: 1,
    });
}

describe('Story Tower Chapter 2 authored behavior', () => {
    it('ships five sequential Stormglass floors with distinct combat compositions', () => {
        const chapter = FLOOR_CATALOG.filter(floor => floor.chapter === 2);
        assert.deepEqual(chapter.map(floor => floor.id), [11, 12, 13, 14, 15]);
        assert.deepEqual(chapter.map(floor => floor.objective), [
            'defeat-all', 'break-objective', 'protect-npc', 'defeat-all', 'kill-adds-first',
        ]);
        assert.equal(new Set(chapter.map(floor => floor.artKey)).size, chapter.length);
        assert.equal(new Set(chapter.map(floor => JSON.stringify({
            waves: floor.enemies.map(pod => [pod.aiId, pod.count, pod.spawnRound ?? 1]),
            field: floor.fieldRule,
            objects: floor.boardObjects,
            ring: floor.closingRing,
        }))).size, chapter.length, 'no floor is a renamed encounter clone');
    });

    it('gives each new faction role a distinct authored tactical kit', () => {
        const contracts = [
            ['stormglass-lancer', 'skirmisher', 'stormglass-lancer', 'Push'],
            ['stormglass-marksman', 'artillery', 'stormglass-marksman', 'Lag'],
            ['stormglass-bastion', 'vanguard', 'stormglass-bastion', 'Barrier'],
            ['stormglass-weaver', 'controller', 'stormglass-weaver', 'Elemental Seal'],
        ] as const;
        for (const [id, role, visual, signature] of contracts) {
            const template = getEnemyTemplate(id);
            assert.equal(template.role, role, `${id} role`);
            assert.equal(template.visual, visual, `${id} visual contract`);
            assert.ok((template.jutsu ?? []).some(jutsu => (jutsu.tags as Array<{ name?: string }> | undefined)?.some(tag => tag.name === signature)), `${id} carries ${signature}`);
        }
        for (const id of ['boss-thunder-archivist', 'boss-stormglass-regent']) {
            const boss = getEnemyTemplate(id);
            assert.equal(boss.role, 'boss');
            assert.equal(boss.boss, true);
            assert.ok((boss.jutsu?.length ?? 0) >= 3, `${id} has a multi-technique kit`);
        }
    });

    it('F11 deploys the breach as three real waves on rounds 1, 2, and 4', () => {
        const floor = getFloor(11)!;
        const session = encounter(floor);
        assert.equal(session.actors.filter(actor => actor.side === 'enemy').length, 4);
        assert.deepEqual(session.pendingEnemyWaves?.map(wave => [wave.round, wave.actors.length]), [[2, 3], [4, 2]]);

        session.round = 2;
        startRound(session);
        assert.equal(session.actors.filter(actor => actor.character.visual === 'stormglass-marksman').length, 3);
        assert.deepEqual(session.pendingEnemyWaves?.map(wave => wave.round), [4]);

        session.round = 4;
        startRound(session);
        assert.equal(session.actors.filter(actor => actor.character.visual === 'stormglass-weaver').length, 2);
        assert.equal(session.pendingEnemyWaves, undefined);
    });

    it('F12 clears by breaking all three Archive seals while its living boss remains', () => {
        const floor = getFloor(12)!;
        const session = encounter(floor);
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        assert.deepEqual(session.phaseState.pendingPhases, [75, 50, 25]);
        assert.equal(boss.character.mechanic, 'bulwark');
        assert.equal(boss.character.aiTargetMode, 'support');

        boss.hp = Math.floor(boss.maxHp * 0.24);
        checkTowerWinner(session, floor);
        assert.equal(session.winner, 'squad');
        assert.ok(boss.hp > 0, 'break-objective does not secretly require a kill');
        assert.deepEqual(session.phaseState.triggeredPhases, [75, 50, 25]);
        assert.deepEqual(session.objectiveState.breakStagesCompleted, 3);
    });

    it('F13 seals a passive Scout and four reinforcement timings into the hold', () => {
        const floor = getFloor(13)!;
        const session = encounter(floor);
        const scout = session.actors.find(actor => actor.side === 'npc')!;
        assert.equal(scout.character.visual, 'tower-scout');
        assert.equal(scout.ai, true);
        assert.deepEqual(session.pendingEnemyWaves?.map(wave => wave.round), [2, 4, 6, 8]);
        assert.equal(session.objectiveState.kind, 'protect-npc');
        assert.equal(floor.roundBudget, 10);
    });

    it('F14 closes its outer galleries and exposes the central Prism Shrine', () => {
        const floor = getFloor(14)!;
        const session = encounter(floor);
        assert.equal(session.map.boardObjects?.some(object => object.kind === 'shrine' && object.label === 'Prism Shrine'), true);
        session.round = floor.closingRing!.fromRound! + 1;
        startRound(session);
        assert.ok((session.map.nextRoundHazardTiles?.length ?? 0) > 0, 'closing ring is telegraphed when the collapse begins');
        assert.deepEqual((session.pendingEnemyWaves ?? []).map(wave => wave.round), [], 'all authored F14 waves have deployed by the collapse');
    });

    it('F15 re-locks its add barrier when the Regent summons a phase court', () => {
        const floor = getFloor(15)!;
        const session = encounter(floor);
        startRound(session);
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        for (const actor of session.actors) if (actor.side === 'enemy' && actor.id !== boss.id) actor.hp = 0;
        checkTowerWinner(session, floor);
        assert.equal(session.objectiveState.bossUnlocked, true, 'initial retainers lower the Crown Barrier');

        const heroActor = session.actors.find(actor => actor.side === 'squad')!;
        heroActor.pos = towerNeighbors(boss.pos, session.map.width, session.map.height)[0]!;
        boss.hp = Math.floor(boss.maxHp * 0.69);
        session.turnQueue = [heroActor.id, boss.id];
        session.activeIndex = 0;
        session.activeAp = 100;
        session.actionsThisTurn = 0;
        const action = applyAction(session, floor, { actorId: heroActor.id, type: 'jutsu', jutsuId: 'chapter-two-test-strike', targetId: boss.id }, makeRng(91));
        assert.equal(action.applied, true);
        assert.deepEqual(session.phaseState.triggeredPhases, [70]);
        assert.equal(session.actors.filter(actor => actor.id.startsWith('add-') && actor.hp > 0).length, 2);
        assert.equal(session.objectiveState.bossUnlocked, false, 'phase court restores the add gate');
        assert.equal(session.objectiveState.addsRemaining, 2);
        assert.ok(boss.shield > 0, 'the same phase raises its authored Aegis');
    });

    it('F15 cannot skip its phase courts through lethal round-end arena damage', () => {
        const floor = getFloor(15)!;
        const session = encounter(floor, 17);
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        const heroActor = session.actors.find(actor => actor.side === 'squad')!;
        for (const actor of session.actors) {
            if (actor.side === 'enemy' && actor.id !== boss.id) actor.hp = 0;
        }

        // Seed 17 previously reproduced both defects: an erupting round-2 vent killed the
        // unlocked Regent before phase processing, and one of the resulting phase pillars
        // could occupy that same vent tile. Drive the ordinary round-end pipeline so the
        // regression covers the real hazard/phase/objective ordering rather than a helper.
        const vent = session.map.dynamicHazards?.[0]?.tiles[0];
        assert.equal(typeof vent, 'number');
        boss.pos = vent!;
        boss.hp = 1;
        session.round = 2;
        session.turnQueue = [heroActor.id];
        session.activeIndex = 0;
        session.activeAp = 100;
        session.actionsThisTurn = 0;

        endTurn(session, floor);

        assert.equal(boss.hp, 0, 'the neutral geyser remains lethal');
        assert.equal(session.status, 'active', 'phase adds keep the encounter open after the boss falls');
        assert.equal(session.winner, null);
        assert.deepEqual(session.phaseState.triggeredPhases, [70, 40]);
        assert.deepEqual(session.phaseState.pendingPhases, []);
        assert.equal(session.actors.filter(actor => actor.id.startsWith('add-') && actor.hp > 0).length, 4);
        assert.equal(session.objectiveState.bossUnlocked, false);
        assert.equal(session.objectiveState.addsRemaining, 4);

        const geyserTiles = new Set((session.map.dynamicHazards ?? []).flatMap(hazard => hazard.tiles));
        assert.deepEqual(session.map.blockedTiles.filter(tile => geyserTiles.has(tile)), [],
            'phase-created terrain must not bury recurring hazard telegraphs');
    });

    it('F15 phase terrain preserves an already-telegraphed Regent slam', () => {
        const floor = getFloor(15)!;
        const session = encounter(floor, 37);
        session.round = 2;
        startRound(session);
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        const telegraphed = new Set(session.bossStrike?.tiles ?? []);
        assert.ok(telegraphed.size > 0, 'round 2 primes the authored slam');

        boss.hp = Math.floor(boss.maxHp * 0.69);
        checkTowerWinner(session, floor);

        assert.deepEqual(session.phaseState.triggeredPhases, [70]);
        assert.deepEqual(session.map.blockedTiles.filter(tile => telegraphed.has(tile)), [],
            'the slam footprint stays traversable and truthful through a phase transition');
    });

    it('F15 phase terrain cannot overwrite or wall against a live Barrier', () => {
        const floor = getFloor(15)!;
        const session = encounter(floor, 15);
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        const guards = session.actors.filter(actor => actor.side === 'enemy' && actor.id !== boss.id).slice(0, 2);
        const barrierTiles = [100, 200];
        guards.forEach((guard, index) => guard.statuses.push({
            name: 'Barrier', source: 'tower-grid:qa-regression', rounds: 2,
            amount: barrierTiles[index], kind: 'positive', activeRound: session.round,
        }));
        const before = new Set(session.map.blockedTiles);

        boss.hp = Math.floor(boss.maxHp * 0.69);
        checkTowerWinner(session, floor);

        const phasePillars = session.map.blockedTiles.filter(tile => !before.has(tile));
        assert.ok(phasePillars.length > 0, 'the phase still reshapes the arena');
        assert.deepEqual(phasePillars.filter(tile => barrierTiles.includes(tile)), [],
            'temporary walls are not converted into permanent terrain');
        assert.equal(phasePillars.some(tile => towerNeighbors(tile, session.map.width, session.map.height)
            .some(neighbor => barrierTiles.includes(neighbor))), false,
        'phase terrain cannot combine with a live Barrier into a touching wall');
    });
});
