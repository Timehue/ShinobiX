import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { academySparEnemyTemplate } from './story/_academy-spar.js';
import { storyBossEnemyTemplate } from './story/_authoritative-story-combat.js';
import { FIRST_FIGHT_MISSION_KITS, missionEnemyTemplate, missionEnvironment } from './_authoritative-pve.js';
import { combatMissionByKey } from './missions/_mission-catalog.js';
import { buildSoloPveAiEncounter } from './solo-pve/_ai-encounter.js';
import { applySoloPveAction, runSoloPveAiUntilPlayer } from './solo-pve/_engine.js';
import { validateServerAiRules } from './combat-core/ai-authoring.js';
import { hexDistance, hexNeighbors } from './combat-core/grid.js';
import { JUTSU_CATALOG } from './pvp/_jutsu-catalog.js';
import type { SoloPveAction, SoloPveSession } from './solo-pve/_session.js';

/*
 * The first authored fights of a brand-new shinobi, played through the live
 * Solo-PvE engine (docs/first-five-fights-onboarding.md):
 *
 *   1. Academy spar       — the dummy survives one cheap action, not two.
 *   2. E-Rank Drill       — holds at four tiles, hexes the player's strikes.
 *   3. Story chapter 1    — opens braced (shield) and never leaves its post.
 *   4. D-Rank Errand      — its net poisons the player before its heavy cast.
 *
 * Each case pins the ONE thing the encounter exists to show, plus the two
 * promises every onboarding fight makes: a fresh level-1 kit wins with naive
 * play, and a player who only Waits is never killed from full HP inside the
 * easy band's protection window. Numbers here were measured against the
 * engine, not chosen — a formula change that moves them should be looked at.
 */

const NOW = 1_780_000_000_000;

/** The client's createCharacter grant (lib/create-character.ts), after the
 *  Academy beats: Flicker learned and equipped, both starter items worn. */
function rookieSave(level = 1, bloodline: 'ashen-eyes' | 'iron-fang' = 'ashen-eyes'): Record<string, unknown> {
    const kits = {
        'ashen-eyes': ['ashen-eyes-blood-gaze', 'ashen-eyes-crimson-hall', 'ashen-eyes-hematoma-veil', 'ashen-eyes-vein-mirror'],
        'iron-fang': ['iron-fang-ferrous-crash', 'iron-fang-steel-maw', 'iron-fang-anvil-breath', 'iron-fang-magnet-knuckle'],
    } as const;
    const jutsuIds = kits[bloodline];
    const base = 10;
    // maxHpForLevel / maxChakraForLevel mirrors for the levels used here.
    const maxHp = { 1: 500, 4: 800, 5: 900 }[level] ?? 500;
    return {
        character: {
            name: 'Rookie', village: 'Stormveil Village', specialty: 'Genjutsu', bloodline: bloodline === 'ashen-eyes' ? 'Ashen Eyes' : 'Iron Fang',
            level, rankTitle: 'Academy Student', xp: 0, ryo: 100, unspentStats: 0, elements: [],
            stats: {
                strength: base, speed: base, intelligence: base, willpower: base,
                taijutsuOffense: base, taijutsuDefense: base, bukijutsuOffense: base, bukijutsuDefense: base,
                ninjutsuOffense: base, ninjutsuDefense: base, genjutsuOffense: base, genjutsuDefense: base,
            },
            hp: maxHp, maxHp, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
            onboardingStep: 'done',
            inventory: ['rustfang-kunai', 'shinobi-vest'], itemStacks: [], pets: [],
            equipment: { hand: 'rustfang-kunai', body: 'shinobi-vest' },
            jutsuMastery: [...jutsuIds, 'starter-universal-flicker'].map((jutsuId) => ({ jutsuId, level: 1, xp: 0 })),
            equippedJutsuIds: [jutsuIds[0], jutsuIds[1], jutsuIds[2], 'starter-universal-flicker'],
        },
        savedBloodlines: [], creatorJutsus: [], creatorItems: [],
    };
}

/** The express e2e fixture (e2e-live/solo-pve-express.spec.ts seedAccount)
 *  as the server actually fights it: stats 10, Flicker only, no gear worn, and
 *  the level-1 pools the first-save baseline normalizes it to (500 HP,
 *  1,000 chakra/stamina) rather than the 100s the seed request carries. */
function fixtureSave(hp: number): Record<string, unknown> {
    const base = 10;
    return {
        character: {
            name: 'Fixture', village: 'Ember', specialty: 'Ninjutsu', bloodline: 'None', level: 1, rankTitle: 'Academy Student', xp: 0, ryo: 100, unspentStats: 20,
            stats: {
                strength: base, speed: base, intelligence: base, willpower: base,
                taijutsuOffense: base, taijutsuDefense: base, bukijutsuOffense: base, bukijutsuDefense: base,
                ninjutsuOffense: base, ninjutsuDefense: base, genjutsuOffense: base, genjutsuDefense: base,
            },
            hp, maxHp: 500, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, onboardingStep: 'done',
            inventory: ['rustfang-kunai', 'shinobi-vest'], itemStacks: [], equipment: {}, pets: [],
            jutsuMastery: [{ jutsuId: 'starter-universal-flicker', level: 1, xp: 0 }],
            equippedJutsuIds: ['starter-universal-flicker'],
        },
        savedBloodlines: [], creatorJutsus: [], creatorItems: [],
    };
}

function spar(save = rookieSave()): SoloPveSession {
    return buildSoloPveAiEncounter({
        sessionId: 'first-fight-spar', playerName: 'rookie', save, now: NOW, admin: null,
        profile: academySparEnemyTemplate(null), difficultyMode: 'STORY',
        encounter: { kind: 'academy-spar', id: 'academy-spar-dummy', sourceId: 'academy-spar-dummy', bindingId: 'first-fight-spar' },
        environment: { biome: 'central' },
    });
}

function mission(key: 'combat-e-drill' | 'combat-d-errand', save: Record<string, unknown>): SoloPveSession {
    const def = combatMissionByKey(key)!;
    const env = missionEnvironment(def.key);
    return buildSoloPveAiEncounter({
        sessionId: `first-fight-${key}`, playerName: 'rookie', save, now: NOW, admin: null,
        profile: { ...missionEnemyTemplate(def), id: def.aiProfileId }, difficultyMode: 'MISSION',
        encounter: { kind: 'mission', id: def.key, sourceId: def.aiProfileId, bindingId: `first-fight-${key}` },
        environment: { biome: env.biome, weatherPositiveElement: env.weather?.positiveElement, weatherNegativeElement: env.weather?.negativeElement },
    });
}

function chapterOne(save = rookieSave(4)): SoloPveSession {
    return buildSoloPveAiEncounter({
        sessionId: 'first-fight-chapter', playerName: 'rookie', save, now: NOW, admin: null,
        profile: storyBossEnemyTemplate({ village: 'Stormveil Village', progressIndex: 0 }), difficultyMode: 'STORY',
        encounter: { kind: 'story-boss', id: 'Stormveil Village:0', sourceId: 'story-ai-stormveil-village-4', bindingId: 'first-fight-chapter' },
        environment: { biome: 'forest' },
    });
}

function act(session: SoloPveSession, action: SoloPveAction): { session: SoloPveSession; applied: boolean } {
    const result = applySoloPveAction(session, action);
    return { session: result.session, applied: result.applied };
}

function stepToward(session: SoloPveSession): number {
    return hexNeighbors(session.player.pos)
        .filter((tile) => tile !== session.enemy.pos && !session.environment.blockedTiles.includes(tile))
        .sort((a, b) => hexDistance(a, session.enemy.pos) - hexDistance(b, session.enemy.pos) || a - b)[0]!;
}

/** "Press the biggest button": heavy jutsu in range, else attack, else kunai, else walk. */
function naiveTurn(session: SoloPveSession): SoloPveSession {
    let s = session;
    for (let guard = 0; guard < 8 && s.status === 'active' && s.activeSide === 'player'; guard += 1) {
        const distance = hexDistance(s.player.pos, s.enemy.pos);
        const jutsu = (s.player.character.jutsu as Array<{ id: string; ap?: number; effectPower?: number; range?: number; tags?: Array<{ name: string }> }>)
            .filter((j) => (s.cooldowns.player[j.id] ?? 0) <= 0 && Number(j.effectPower ?? 0) > 1 && !(j.tags ?? []).some((t) => t.name === 'Move'))
            .sort((a, b) => Number(b.ap ?? 0) - Number(a.ap ?? 0))
            .find((j) => s.ap.player >= Number(j.ap ?? 0) && distance <= Number(j.range ?? 4));
        let next: { session: SoloPveSession; applied: boolean };
        if (jutsu) next = act(s, { type: 'jutsu', jutsuId: jutsu.id });
        else if (distance <= 1 && s.ap.player >= 40) next = act(s, { type: 'basicAttack' });
        // Namespaced 'weapon:<id>' (api/solo-pve/_engine.ts) — never the bare id.
        else if (distance <= 4 && s.ap.player >= 40 && (s.cooldowns.player['weapon:rustfang-kunai'] ?? 0) <= 0) next = act(s, { type: 'weapon', itemId: 'rustfang-kunai' });
        else if (distance > 1 && s.ap.player >= 30) next = act(s, { type: 'move', tile: stepToward(s) });
        else next = act(s, { type: 'wait' });
        s = next.applied ? next.session : act(s, { type: 'wait' }).session;
    }
    return s;
}

/** The express e2e loop (e2e-live/solo-pve-express.spec.ts playToTerminal). */
function expressTurn(session: SoloPveSession): SoloPveSession {
    let s = session;
    for (let guard = 0; guard < 8 && s.status === 'active' && s.activeSide === 'player'; guard += 1) {
        const adjacent = hexDistance(s.player.pos, s.enemy.pos) <= 1;
        const next = act(s, adjacent ? { type: 'basicAttack' } : { type: 'move', tile: stepToward(s) });
        s = next.applied ? next.session : act(s, { type: 'wait' }).session;
    }
    return s;
}

function play(session: SoloPveSession, turn: (s: SoloPveSession) => SoloPveSession, maxRounds = 12): SoloPveSession {
    let s = session;
    for (let guard = 0; guard < maxRounds && s.status === 'active'; guard += 1) s = turn(s);
    return s;
}

function waitRounds(session: SoloPveSession, rounds: number): SoloPveSession {
    let s = session;
    for (let i = 0; i < rounds && s.status === 'active'; i += 1) s = act(s, { type: 'wait' }).session;
    return s;
}

function names(statuses: Array<{ name: string }>): string[] {
    return statuses.map((status) => status.name);
}

describe('first fights: the authored kits resolve and validate', () => {
    it('every kit jutsu is a real starter-catalog technique and every program validates', () => {
        for (const [key, kit] of Object.entries(FIRST_FIGHT_MISSION_KITS)) {
            for (const id of kit.jutsuIds) assert.ok(JUTSU_CATALOG[id], `${key}: ${id} must exist in the server jutsu catalog`);
            const program = validateServerAiRules(kit.rules, kit.jutsuIds);
            assert.ok(program.ok, `${key}: ${JSON.stringify(program.issues)}`);
        }
        const chapter = storyBossEnemyTemplate({ village: 'Stormveil Village', progressIndex: 0 });
        assert.ok(chapter.jutsuIds && chapter.jutsuIds.length === 2, 'chapter 1 carries an authored kit');
        for (const id of chapter.jutsuIds ?? []) assert.ok(JUTSU_CATALOG[id], `${id} must exist in the server jutsu catalog`);
        assert.ok(validateServerAiRules(chapter.rules, chapter.jutsuIds ?? []).ok);
        // Later story chapters keep their existing generic signature.
        assert.equal(storyBossEnemyTemplate({ village: 'Stormveil Village', progressIndex: 1 }).jutsuIds, undefined);
        assert.equal(storyBossEnemyTemplate({ village: 'Stormveil Village', progressIndex: 1 }).jutsu?.[0]?.id, 'story-1-signature');
    });

    it('kit enemies can afford their moves (the generic pool could not)', () => {
        for (const key of ['combat-e-drill', 'combat-d-errand'] as const) {
            const enemy = mission(key, rookieSave()).enemy;
            const costs = (enemy.character.jutsu as Array<{ chakraCost?: number; staminaCost?: number }>)
                .map((j) => Math.max(Number(j.chakraCost ?? 0), Number(j.staminaCost ?? 0)));
            assert.ok(Math.max(...costs) > 0 && Math.max(...costs) <= Math.min(enemy.maxChakra, enemy.maxStamina), `${key} pool covers its heaviest cast`);
        }
    });
});

describe('fight 1: the Academy spar dummy', () => {
    it('survives one cheap action and falls to the second, and still dies to one heavy cast', () => {
        const s0 = spar();
        assert.ok(s0.enemy.maxHp <= 400 && s0.enemy.maxHp >= 250, `banded dummy HP ${s0.enemy.maxHp}`);
        const adjacent = { ...s0, player: { ...s0.player, pos: hexNeighbors(s0.enemy.pos)[0]! } };
        const afterAttack = act(adjacent, { type: 'basicAttack' }).session;
        assert.ok(afterAttack.enemy.hp > 0, 'a single Basic Attack (40 AP) leaves the dummy standing');
        assert.equal(act(afterAttack, { type: 'basicAttack' }).session.status, 'done', 'a second cheap action finishes it');
        const heavy = act(adjacent, { type: 'jutsu', jutsuId: 'ashen-eyes-blood-gaze' }).session;
        assert.equal(heavy.status, 'done');
        assert.equal(heavy.winner, 'player', 'one 60 AP bloodline jutsu still ends the spar');
    });

    it('is won by the onboarding walk-and-punch loop before the dummy ever swings', () => {
        const terminal = play(spar(), expressTurn);
        assert.equal(terminal.winner, 'player');
        assert.equal(terminal.player.hp, terminal.player.maxHp, 'the dummy spent its first turn walking, not hitting');
    });
});

describe('fight 2: the E-Rank Drill partner holds the yard at range', () => {
    it('closes to four tiles, hexes the player, and stops — no melee unless approached', () => {
        const start = mission('combat-e-drill', rookieSave());
        assert.equal(start.enemy.name, 'Academy Sparring Partner');
        assert.equal(start.enemy.maxHp, 600, 'x0.75 easy band on the authored 800');
        // From seven tiles its whole first turn is the walk to four; the opener
        // lands on its second turn (a player who closes the gap first sees it on
        // the first).
        const afterEnemy = act(start, { type: 'wait' }).session;
        assert.equal(afterEnemy.round, 2);
        assert.equal(hexDistance(afterEnemy.player.pos, afterEnemy.enemy.pos), 4, 'it parks at its casting range');
        const hexed = act(afterEnemy, { type: 'wait' }).session;
        assert.ok(names(hexed.player.statuses).includes('Decrease Damage Given'), 'the 40 AP opener marks the player');
        assert.equal(hexed.player.hp, hexed.player.maxHp, 'nothing hit the player');
        // A player who keeps waiting eats exactly one capped heavy cast at round 3, then quiet.
        const passive = waitRounds(start, 8);
        assert.equal(passive.status, 'active');
        assert.ok(passive.player.hp >= passive.player.maxHp * 0.8, `passive rookie keeps most HP (${passive.player.hp})`);
    });

    it('is won by a naive rookie in about three rounds and by the express fixture on basic attacks', () => {
        const rookie = play(mission('combat-e-drill', rookieSave()), naiveTurn);
        assert.equal(rookie.winner, 'player');
        assert.ok(rookie.round >= 2 && rookie.round <= 4, `rookie rounds ${rookie.round}`);
        const fixture = play(mission('combat-e-drill', fixtureSave(450)), expressTurn, 30);
        assert.equal(fixture.winner, 'player', 'the 450/500 express fixture still wins on Basic Attack alone');
        assert.ok(fixture.player.hp >= 100 && fixture.player.hp < fixture.player.maxHp, `fixture ends with margin (${fixture.player.hp})`);
        // And the old 20 HP seed is exactly why the fixture had to move: below the
        // easy band's 25% mercy line, the walk-in punch is lethal.
        assert.equal(play(mission('combat-e-drill', fixtureSave(20)), expressTurn, 30).winner, 'enemy');
    });
});

describe('fight 3: the chapter-1 guardian braces, then closes to casting range', () => {
    it('opens with a shield and Absorb on its very first turn, before it walks', () => {
        const start = chapterOne();
        assert.equal(start.enemy.maxHp, 390, 'x0.75 easy band on the authored 520 (under the chapter-2 template)');
        const afterEnemy = act(start, { type: 'wait' }).session;
        assert.ok(afterEnemy.enemy.shield > 200, `a real shield (${afterEnemy.enemy.shield})`);
        assert.ok(names(afterEnemy.enemy.statuses).includes('Absorb'));
        assert.ok(hexDistance(afterEnemy.player.pos, afterEnemy.enemy.pos) < 7, 'and it has started closing the distance');
        // A player who only Waits still gets a fight, not a stalemate against a
        // rooted enemy: it parks at four tiles and lands one capped heavy cast.
        const passive = waitRounds(start, 8);
        assert.equal(passive.status, 'active');
        assert.equal(hexDistance(passive.player.pos, passive.enemy.pos), 4, 'it holds at casting range');
        assert.ok(passive.player.hp < passive.player.maxHp && passive.player.hp >= passive.player.maxHp * 0.75, `one capped cast landed (${passive.player.hp})`);
    });

    it('a heavy cast into the fresh shield is mostly wasted; chip-then-commit is the efficient line', () => {
        const braced = act(chapterOne(), { type: 'wait' }).session;
        const inRange = { ...braced, player: { ...braced.player, pos: hexNeighbors(braced.enemy.pos)[0]! } };
        const heavyFirst = act(inRange, { type: 'jutsu', jutsuId: 'ashen-eyes-blood-gaze' }).session;
        const heavyHpLoss = inRange.enemy.hp - heavyFirst.enemy.hp;
        assert.ok(heavyHpLoss < inRange.enemy.maxHp * 0.3, `the shield ate most of the 60 (only ${heavyHpLoss} reached HP)`);
        const chip = act(inRange, { type: 'weapon', itemId: 'rustfang-kunai' }).session;
        assert.ok(chip.enemy.shield < inRange.enemy.shield, 'a 40 AP kunai throw breaks into the guard');
    });

    it('is won by a naive level-4 rookie in a few rounds', () => {
        const terminal = play(chapterOne(), naiveTurn);
        assert.equal(terminal.winner, 'player');
        assert.ok(terminal.round >= 2 && terminal.round <= 5, `rounds ${terminal.round}`);
    });
});

describe('fight 4: the Mist Sentinel nets the player', () => {
    it('poisons the player with its opener, and Cleanse clears it', () => {
        const start = mission('combat-d-errand', rookieSave(5));
        assert.equal(start.enemy.name, 'Mist Sentinel');
        assert.equal(start.enemy.maxHp, 1050, 'x0.75 easy band on the authored 1400');
        // First enemy turn is the walk to four tiles; the net lands on the second.
        const netted = act(act(start, { type: 'wait' }).session, { type: 'wait' }).session;
        assert.ok(names(netted.player.statuses).includes('Poison'), 'the net poisons');
        // Under combatResourcesV2 poison taxes the player's own heavy cast.
        const inRange = { ...netted, player: { ...netted.player, pos: hexNeighbors(netted.enemy.pos)[0]! } };
        const cast = act(inRange, { type: 'jutsu', jutsuId: 'ashen-eyes-blood-gaze' }).session;
        assert.ok(cast.player.hp < inRange.player.hp, 'a heavy cast while poisoned costs HP');
        const cleansed = act(inRange, { type: 'cleanse' }).session;
        assert.ok(!names(cleansed.player.statuses.filter((st) => (st.activeRound ?? 0) <= cleansed.round)).includes('Poison'), 'Cleanse removes it');
        assert.equal(cleansed.player.hp, inRange.player.hp, 'Cleanse costs AP, not HP or chakra');
    });

    it('is won by a naive level-5 rookie and cannot kill a passive one from full HP', () => {
        const terminal = play(mission('combat-d-errand', rookieSave(5)), naiveTurn);
        assert.equal(terminal.winner, 'player');
        assert.ok(terminal.round >= 2 && terminal.round <= 5, `rounds ${terminal.round}`);
        const passive = waitRounds(mission('combat-d-errand', rookieSave(5)), 8);
        assert.equal(passive.status, 'active');
        assert.ok(passive.player.hp >= passive.player.maxHp * 0.75, `passive rookie keeps most HP (${passive.player.hp})`);
    });
});

describe('every bloodline gets the same lessons', () => {
    it('an Iron Fang rookie also beats the Drill and the guardian naively', () => {
        assert.equal(play(mission('combat-e-drill', rookieSave(1, 'iron-fang')), naiveTurn).winner, 'player');
        assert.equal(play(chapterOne(rookieSave(4, 'iron-fang')), naiveTurn).winner, 'player');
    });

    it('the enemy turn runner honours the hold: no wandering into melee on its own', () => {
        const start = mission('combat-e-drill', rookieSave());
        const s = structuredClone(start);
        s.activeSide = 'enemy';
        runSoloPveAiUntilPlayer(s);
        assert.ok(hexDistance(s.player.pos, s.enemy.pos) >= 4, 'the partner never walks past casting range');
    });
});
