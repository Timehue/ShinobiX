import test from 'node:test';
import assert from 'node:assert/strict';
import { hexDistance, hexNeighbors } from '../combat-core/grid.js';
import { aiGapCloserLandingTile, isDamagingAiGapCloser } from '../combat-core/ai-mobility.js';
import { resolvePveGapClosingJutsu, withPveGapClosingJutsu, teachPveGapClosingJutsu } from '../_ai-opponent-loadout.js';
import type { AdminCombatContent } from '../_admin-content.js';
import type { CombatJutsu } from '../combat-core/types.js';
import type { PvpFighter } from '../pvp/session.js';
import { buildSoloPveAiEncounter } from './_ai-encounter.js';
import { createSoloPveSession } from './_session.js';
import { runSoloPveAiUntilPlayer } from './_engine.js';
import { STANDARD_PVE_AI_POLICY } from './_ai-turn-policy.js';
import { makePveEngineTestSession } from '../towers/_pve-engine-test-fixture.js';
import { applyAction, pickAiAction } from '../towers/_engine.js';
import { HUNT_AI_POLICY } from '../towers/_hunt-ai.js';
import { buildTowerEncounter } from '../towers/_encounter.js';
import { getFloor } from '../towers/_floor-catalog.js';
import { buildWorldBossTeamEncounter } from '../world-boss-event/_encounter.js';
import { storyBossEnemyTemplate } from '../story/_authoritative-story-combat.js';
import { attachStoryTwinCombat } from '../story/_twin-combat.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import { equipPveAiItems, pveAiItemCharges } from '../combat-core/ai-items.js';

const AMBUSH: CombatJutsu = { id: 'published-ambush', name: 'Ambush', type: 'Taijutsu', element: 'Fire',
    target: 'EMPTY_GROUND', method: 'AOE_CIRCLE', ap: 60, range: 5, effectPower: 40,
    cooldown: 3, chakraCost: 50, staminaCost: 25, tags: [{ name: 'Move' }, { name: 'Wound', percent: 10 }] };
const BLITZ: CombatJutsu = { ...AMBUSH, id: 'published-blitz', name: 'Blitz', range: 4 };
const FLICKER = resolveAiProfileJutsu(['starter-universal-flicker'])[0]!;
const admin: AdminCombatContent = { jutsu: new Map([AMBUSH, BLITZ].map(j => [j.id, { ...j }])), items: new Map() };

function fighter(name: string, pos: number, kit: CombatJutsu[] = []): PvpFighter {
    return { name, pos, hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        shield: 0, statuses: [], character: { name, level: 20, specialty: 'Taijutsu', stats: { taijutsuOffense: 1000, taijutsuDefense: 500 },
            jutsu: structuredClone(kit), jutsuMastery: kit.map(j => ({ jutsuId: j.id, level: 20 })) } };
}
function positionAtDistance(from: number, distance: number, width: number, height: number): number {
    return Array.from({ length: width * height }, (_, i) => i).find(i => hexDistance(from, i, width) === distance)!;
}

test('new NPCs learn the current published movement strikes without dropping their signature or changing costs', () => {
    const session = buildSoloPveAiEncounter({ sessionId: 'mobility-seal', playerName: 'player', now: 1800000000000,
        save: { character: { name: 'Player', level: 60, maxHp: 10000, hp: 10000, equipment: {}, inventory: [] } },
        profile: { id: 'gap-dummy', name: 'Rival', level: 60, pveDifficulty: 'standard', hp: 10000, stats: {}, jutsuIds: [] },
        admin, difficultyMode: false });
    const kit = session.enemy.character.jutsu as CombatJutsu[];
    assert.equal(kit.length, 4, 'the fallback signature survives alongside Ambush, Blitz and Flicker');
    for (const original of [AMBUSH, BLITZ]) {
        const sealed = kit.find(j => j.id === original.id)!;
        for (const key of ['ap', 'range', 'effectPower', 'cooldown', 'chakraCost', 'staminaCost'] as const) assert.equal(sealed[key], original[key], key);
        assert.deepEqual(sealed.tags, original.tags);
        assert.ok((session.enemy.character.jutsuMastery as Array<{ jutsuId: string }>).some(j => j.jutsuId === original.id));
    }
    assert.ok(!(session.player.character.jutsu as CombatJutsu[]).some(j => j.id === BLITZ.id), 'the player receives no free techniques');
});

test('a republished Overload ID and pure movement are never mistaken for Blitz damage', () => {
    const published: AdminCombatContent = { jutsu: new Map([
        ['starter-universal-blitz', { ...BLITZ, id: 'starter-universal-blitz', name: 'Overload', target: 'SELF', tags: [{ name: 'Increase Damage Given', percent: 30 }] }],
        ['fake-ambush', { ...AMBUSH, id: 'fake-ambush', method: 'SINGLE', tags: [{ name: 'Move' }] }],
    ]), items: new Map() };
    assert.deepEqual(resolvePveGapClosingJutsu(published), []);
    assert.deepEqual(resolvePveGapClosingJutsu(), []);
    assert.equal(isDamagingAiGapCloser({ ...BLITZ, ap: 40, isUtility: true }), false);
    assert.equal(withPveGapClosingJutsu([AMBUSH], [AMBUSH, BLITZ]).length, 3);
    assert.equal(withPveGapClosingJutsu([BLITZ], [{ ...BLITZ, id: 'other-blitz' }]).length, 2, 'duplicate names must not create a second cooldown');
});

test('invalid newer catalog drafts cannot crowd a valid published movement strike out of NPC teaching', () => {
    const drafts=Array.from({length:14},(_,i)=>({...AMBUSH,id:`draft-${i}`,updatedAt:100+i,method:'SINGLE',tags:[]}));
    const catalog:AdminCombatContent={jutsu:new Map([...drafts,AMBUSH,BLITZ].map(j=>[j.id,j])),items:new Map()};
    assert.deepEqual(resolvePveGapClosingJutsu(catalog).map(j=>j.id),[AMBUSH.id,BLITZ.id]);
});

test('scripted teaching fights keep their original kit and ordinary beginner NPCs still learn the new tactics',()=>{
    const signature={...AMBUSH,id:'teaching-strike',name:'Teaching strike',target:'OPPONENT',method:'SINGLE',range:4,tags:[]};
    for(const kind of['academy-spar','mission','story-boss','generic-ai']as const){
        const scripted=kind!=='generic-ai';
        const rules=scripted&&kind!=='academy-spar'?[{condition:'always',value:0,action:'end_turn'},{condition:'always',value:0,action:'use_basic_attack'}]:[];
        const s=buildSoloPveAiEncounter({sessionId:`teaching-${kind}`,playerName:'player',now:1800000000000,
            save:{character:{name:'Player',level:5,maxHp:1000,hp:1000,equipment:{},inventory:[]}},
            profile:{id:'teaching-profile',name:'Instructor',level:5,hp:1000,stats:{},jutsu:[signature],rules},
            admin,encounter:{kind,id:'teaching'}});
        const kit=s.enemy.character.jutsu as CombatJutsu[];
        assert.ok(kit.some(j=>j.id===signature.id));
        assert.equal(kit.some(j=>j.id===AMBUSH.id),!scripted);
        assert.equal(kit.some(j=>j.id===BLITZ.id),!scripted);
        assert.equal(kit.some(j=>j.id===FLICKER.id),!scripted);
        assert.equal(Array.isArray(s.enemy.character.inventory),!scripted);
    }
});

test('boss supplementation leaves existing mastery, signatures, stats and resource values intact', () => {
    const summonTemplate = { jutsu: [{ ...AMBUSH, id: 'add-hit', name: 'Add Hit' }] };
    const character: Record<string, unknown> = { stats: { taijutsuOffense: 1234 }, maxChakra: 500, summonTemplate,
        jutsu: [{ ...AMBUSH, id: 'signature', name: 'Signature' }], jutsuMastery: [{ jutsuId: 'signature', level: 30 }] };
    const before = structuredClone(character);
    teachPveGapClosingJutsu(character, [BLITZ]);
    teachPveGapClosingJutsu(character, [BLITZ]);
    assert.deepEqual(character.stats, before.stats);
    assert.equal(character.maxChakra, before.maxChakra);
    assert.deepEqual((character.jutsu as CombatJutsu[])[0], (before.jutsu as CombatJutsu[])[0]);
    assert.deepEqual(character.jutsuMastery, [{ jutsuId: 'signature', level: 30 }, { jutsuId: BLITZ.id, level: 30 }, { jutsuId: FLICKER.id, level: 30 }]);
    assert.equal(((character.summonTemplate as { jutsu: CombatJutsu[] }).jutsu).length, 3);
    assert.equal(summonTemplate.jutsu.length, 1, 'teaching summons must not mutate the shared enemy template');
});

for (const reason of ['cooldown', 'chakra', 'stamina', 'ap', 'blocked', 'sealed', 'actions'] as const) test(`Solo AI respects ${reason} when considering a gap-closing strike`, () => {
    const session = createSoloPveSession({ sessionId: `blocked-${reason}`, ownerSlug: 'player', now: 1800000000000,
        encounter: { kind: 'generic-ai', id: 'gap' }, player: fighter('Player', 62),
        enemy: fighter('Rival', positionAtDistance(62, 6, 12, 10), [BLITZ]), difficultyEnemyLevel: 20 });
    session.activeSide = 'enemy'; session.enemy.character.aiTurnPolicy = STANDARD_PVE_AI_POLICY;
    if (reason === 'cooldown') session.cooldowns.enemy[BLITZ.id] = 2;
    if (reason === 'chakra') session.enemy.chakra = 0;
    if (reason === 'stamina') session.enemy.stamina = 0;
    if (reason === 'ap') session.ap.enemy = 59;
    if (reason === 'blocked') session.environment.blockedTiles = hexNeighbors(session.player.pos);
    if (reason === 'sealed') session.enemy.statuses = [{ name: 'Elemental Seal', kind: 'negative', rounds: 3, activeRound: 1 }];
    if (reason === 'actions') session.actionsThisTurn = 5;
    const hp = session.player.hp;
    runSoloPveAiUntilPlayer(session);
    if (reason !== 'blocked') assert.ok(!session.events.some(event => event.actor === 'enemy' && event.actionId === BLITZ.id), 'never issue a prohibited cast');
    assert.ok(!session.events.some(event => event.actor === 'enemy' && event.action === 'move'), 'no paid basic walking within six hexes');
    assert.equal(session.player.hp, hp);
    assert.ok(session.ap.enemy >= 0);
});

test('a scripted mission still uses its newly learned movement strike for a distant opener', () => {
    const session = createSoloPveSession({ sessionId: 'mission-gap', ownerSlug: 'player', now: 1800000000000,
        encounter: { kind: 'mission', id: 'gap' }, player: fighter('Player', 62),
        enemy: fighter('Rival', positionAtDistance(62, 6, 12, 10), [BLITZ, FLICKER]), difficultyEnemyLevel: 20 });
    session.activeSide = 'enemy'; session.enemy.character.missionTactics = true;
    session.enemy.character.aiRules = [{ id: 'old-step', condition: 'always', value: 0, action: 'move_towards_opponent' }];
    runSoloPveAiUntilPlayer(session);
    assert.ok(session.events.some(event => event.actor === 'enemy' && event.actionId === BLITZ.id));
    assert.ok(session.player.hp < session.player.maxHp);
});

for (const sealed of [false, true]) for (const distance of [5, 6]) for (const jutsu of [AMBUSH, BLITZ, { ...BLITZ, range: 3 }]) {
    if (distance > jutsu.range! + 2) continue; // Two steps plus a 60-AP cast cannot fit in one turn.
    test(`Solo PvE ${sealed ? 'planner' : 'legacy'} can go first from ${distance} hexes using ${jutsu.name}`, () => {
        const session = createSoloPveSession({ sessionId: 'opening-gap', ownerSlug: 'player', now: 1800000000000,
            encounter: { kind: 'generic-ai', id: 'gap' }, player: fighter('Player', 62),
            enemy: fighter('Rival', positionAtDistance(62, distance, 12, 10), [jutsu, FLICKER]), difficultyEnemyLevel: 20 });
        if (sealed) session.enemy.character.aiTurnPolicy = STANDARD_PVE_AI_POLICY;
        session.activeSide = 'enemy';
        const before = structuredClone(session);
        runSoloPveAiUntilPlayer(session);
        assert.ok(session.player.hp < before.player.hp, 'the opening turn must actually damage the player');
        const hit = session.events.find(e => e.actor === 'enemy' && e.actionId === jutsu.id)!;
        assert.ok(hit);
        assert.equal(hexDistance(hit.after.enemy.pos, hit.after.player.pos), 1);
        assert.equal(hit.before.enemy.chakra - hit.after.enemy.chakra, jutsu.chakraCost);
        assert.equal(hit.before.enemy.stamina - hit.after.enemy.stamina, jutsu.staminaCost);
        assert.ok(session.cooldowns.enemy[jutsu.id] > 0);
        assert.ok(session.ap.enemy >= 0);
        assert.ok(!session.events.some(e => e.actor === 'enemy' && e.action === 'move'), 'use a movement skill rather than basic walking');
        if (distance === jutsu.range! + 2) assert.equal(session.events.find(e => e.actor === 'enemy')!.actionId, FLICKER.id, 'Flicker first, then use the paid impact');
    });
}

for (const hunt of [false, true]) for (const distance of [5, 6]) for (const range of [3, 4]) {
    if (distance > range + 2) continue;
    test(`${hunt ? 'Hunt' : 'Tower'} AI closes ${distance}-hex openings with range ${range} paid damage`, () => {
    const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
    const enemy = s.actors[1]!, player = s.actors[0]!;
    s.round = 1; s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 100;
    player.pos = 26; enemy.pos = positionAtDistance(player.pos, distance, 8, 8);
    enemy.character.jutsu = [{ ...structuredClone(BLITZ), range }, structuredClone(FLICKER)]; enemy.character.jutsuMastery = [{ jutsuId: BLITZ.id, level: 20 }];
    if (hunt) { s.towerId = 'hunt'; enemy.character.huntAiPolicy = HUNT_AI_POLICY; enemy.character.huntRank = 'D'; }
    const before = structuredClone(s);
    for (let i = 0; i < 2 && player.hp === before.actors[0]!.hp; i++) {
        const pick = pickAiAction(s, enemy, () => .5);
        assert.notEqual(pick.type, 'move');
        assert.ok(applyAction(s, s.encounterFloor!, pick, () => .5).applied, JSON.stringify(pick));
    }
    assert.ok(player.hp < before.actors[0]!.hp);
    assert.equal(hexDistance(enemy.pos, player.pos, 8), 1);
    assert.equal(before.actors[1]!.chakra - enemy.chakra, BLITZ.chakraCost! + (distance === range + 2 ? FLICKER.chakraCost! : 0));
    assert.equal(enemy.cooldowns[BLITZ.id], BLITZ.cooldown);
    assert.equal(s.activeAp, distance === range + 2 ? 20 : 40);
});
}

test('Tower creation teaches only enemies, including scheduled waves', () => {
    const floor = getFloor(8)!;
    const params = { floor, squad: [{ id: 'player', ownerSlug: 'player', name: 'Player', ai: false, character: fighter('Player', 62).character }],
        runId: 'tower-mobility', seed: 42, partySize: 1, now: 1800000000000 };
    const baseline = buildTowerEncounter(params);
    const session = buildTowerEncounter({ ...params, gapClosingJutsu: [AMBUSH, BLITZ] });
    const all = [...session.actors, ...(session.pendingEnemyWaves ?? []).flatMap(w => w.actors)];
    assert.ok(all.some(a => !session.actors.includes(a)), 'fixture must cover scheduled reinforcements');
    for (const actor of all) {
        const kit = actor.character.jutsu as CombatJutsu[];
        assert.equal(kit.some(j => j.id === BLITZ.id), actor.side === 'enemy');
        const original = [...baseline.actors, ...(baseline.pendingEnemyWaves ?? []).flatMap(w => w.actors)].find(a => a.id === actor.id)!;
        assert.deepEqual(actor.character.stats, original.character.stats);
        assert.equal(actor.maxHp, original.maxHp);
    }
});

test('narrative groups and story twins retain the learned movement strikes in each actor kit', () => {
    for (const twins of [false, true]) {
        const profile = twins ? storyBossEnemyTemplate({ village: 'Stormveil Village', progressIndex: 4 })
            : { id: 'road-ai-black-bridge', name: 'Bridge Raiders', level: 50, hp: 20000, stats: {}, jutsuIds: [] };
        const session = buildSoloPveAiEncounter({ sessionId: `group-gap-${twins}`, playerName: 'player', now: 1800000000000,
            save: { character: { name: 'Player', village: 'Stormveil Village', level: 50, maxHp: 10000, hp: 10000, equipment: {}, inventory: [] } },
            profile, admin, difficultyMode: false,
            encounter: { kind: twins ? 'story-boss' : 'generic-ai', id: profile.id, sourceId: profile.id } });
        if (twins) attachStoryTwinCombat(session);
        const enemies = session.huntCombat!.battle.actors.filter(actor => actor.side === 'enemy');
        assert.ok(enemies.length >= 2);
        for (const id of ['thrown-shuriken','item-attack-pill','item-defense-pill','item-smoke-bomb']) {
            assert.equal(enemies.reduce((total,actor)=>total+(actor.itemCharges?.[id]??0),0),1,'splitting a legacy enemy must not multiply its finite item budget');
        }
        for (const enemy of enemies) for (const move of [AMBUSH, BLITZ]) {
            assert.ok((enemy.character.jutsu as CombatJutsu[]).some(j => j.id === move.id));
        }
    }
});

test('cooperative boss normalization cannot overwrite the learned moves or change stats because of them', () => {
    const input = { event: { eventId: 'gap-event', bossId: 'hollow-beast' as const, bossName: 'Test Boss', hp: 100000, hpMax: 100000 },
        matchId: 'gap-match', runId: 'gap-boss', seed: 42, now: 1800000000000,
        squad: [{ id: 'player', ownerSlug: 'player', name: 'Player', ai: false, character: fighter('Player', 62).character }] };
    const baseline = buildWorldBossTeamEncounter(input);
    const session = buildWorldBossTeamEncounter({ ...input, gapClosingJutsu: [AMBUSH, BLITZ] });
    for (const enemy of session.actors.filter(actor => actor.side === 'enemy')) {
        const original = baseline.actors.find(actor => actor.id === enemy.id)!;
        assert.deepEqual(enemy.character.stats, original.character.stats);
        assert.equal(enemy.maxHp, original.maxHp);
        for (const move of [AMBUSH, BLITZ]) {
            const learned = (enemy.character.jutsu as CombatJutsu[]).find(j => j.id === move.id)!;
            assert.equal(learned.chakraCost, move.chakraCost);
            assert.equal(learned.cooldown, move.cooldown);
            assert.ok((enemy.character.jutsuMastery as Array<{ jutsuId: string }>).some(m => m.jutsuId === move.id));
        }
    }
});

for (const planner of [false, true]) test(`Solo ${planner ? 'planner' : 'legacy'} spends the final 20 AP on its own shuriken after two attacks`, () => {
    const session = createSoloPveSession({ sessionId: 'item-finish', ownerSlug: 'player', now: 1800000000000,
        encounter: { kind: 'generic-ai', id: 'items' }, player: fighter('Player', 62),
        enemy: fighter('Rival', hexNeighbors(62)[0]!), itemCharges: { 'thrown-shuriken': 7 } });
    equipPveAiItems(session.enemy.character);
    if (planner) session.enemy.character.aiTurnPolicy = STANDARD_PVE_AI_POLICY;
    session.activeSide = 'enemy';
    const originalPlayerCharges = structuredClone(session.itemCharges);
    runSoloPveAiUntilPlayer(session);
    const actions = session.events.filter(e => e.actor === 'enemy');
    assert.equal(actions.filter(e => e.action === 'basicAttack').length, 2);
    assert.equal(actions.at(-1)?.actionId, 'thrown-shuriken');
    assert.equal(actions.at(-1)?.after.ap.enemy, 0);
    assert.ok(!(session.enemy.character.inventory as string[]).includes('thrown-shuriken'));
    assert.deepEqual(session.itemCharges, originalPlayerCharges);
    assert.deepEqual(session.itemsUsed, {}, 'NPC use must never debit player settlement');
});

for (const planner of [false, true]) test(`Solo ${planner ? 'planner' : 'legacy'} can pair Flicker with two 40-AP attacks`, () => {
    const session = createSoloPveSession({ sessionId: 'flicker-double', ownerSlug: 'player', now: 1800000000000,
        encounter: { kind: 'generic-ai', id: 'double' }, player: fighter('Player', 62),
        enemy: fighter('Rival', positionAtDistance(62, 6, 12, 10), [FLICKER]) });
    equipPveAiItems(session.enemy.character);
    if (planner) session.enemy.character.aiTurnPolicy = STANDARD_PVE_AI_POLICY;
    session.activeSide = 'enemy';
    runSoloPveAiUntilPlayer(session);
    const actions = session.events.filter(e => e.actor === 'enemy');
    assert.equal(actions[0]?.actionId, FLICKER.id);
    assert.equal(actions.filter(e => e.action === 'basicAttack').length, 2);
    assert.equal(actions.at(-1)?.after.ap.enemy, 0);
    assert.ok(actions.every(e => e.action !== 'move'));
});

for (const tower of [false, true]) for (const mode of ['attack', 'defense', 'smoke'] as const) test(`${tower ? 'Tower' : 'Solo'} uses a useful ${mode} item for spare AP`, () => {
    const expected = `item-${mode === 'smoke' ? 'smoke-bomb' : `${mode}-pill`}`;
    if (tower) {
        const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
        const enemy = s.actors[1]!, player = s.actors[0]!;
        s.round = 1; s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 20;
        player.pos = 26; enemy.pos = positionAtDistance(player.pos, 5, 8, 8);
        equipPveAiItems(enemy.character); enemy.itemCharges = pveAiItemCharges(enemy.character);
        enemy.hp = mode === 'smoke' ? enemy.maxHp * .2 : mode === 'defense' ? enemy.maxHp * .5 : enemy.maxHp;
        if(mode==='smoke')enemy.character.jutsu=[{...AMBUSH,id:'recovery',name:'Recovery',target:'SELF',method:'SINGLE',tags:[{name:'Heal',percent:20}]}];
        const action = pickAiAction(s, enemy, () => .5);
        assert.equal(action.type, 'item');
        assert.equal('itemId' in action && action.itemId, expected);
        assert.ok(applyAction(s, s.encounterFloor!, action, () => .5).applied);
        assert.equal(enemy.itemCharges[expected], 0);
        assert.equal(enemy.itemsUsed?.[expected], 1);
        assert.equal(s.activeAp, 0);
        assert.ok(enemy.statuses.some(status => status.source === expected && status.activeRound === 2));
    } else {
        const session = createSoloPveSession({ sessionId: 'tactical-item', ownerSlug: 'player', now: 1800000000000,
            encounter: { kind: 'generic-ai', id: 'items' }, player: fighter('Player', 62),
            enemy: fighter('Rival', positionAtDistance(62, 5, 12, 10)) });
        equipPveAiItems(session.enemy.character); session.activeSide = 'enemy'; session.ap.enemy = 20;
        session.enemy.hp = mode === 'smoke' ? 2000 : mode === 'defense' ? 5000 : 10000;
        runSoloPveAiUntilPlayer(session);
        assert.equal(session.events.find(e => e.actor === 'enemy')?.actionId, expected);
        assert.ok(!(session.enemy.character.inventory as string[]).includes(expected));
        assert.deepEqual(session.itemsUsed, {});
    }
});

for(const tower of[false,true])test(`${tower?'Tower':'Solo'} preserves a smoke bomb when recovery is unavailable`,()=>{
    if(tower){
        const s=makePveEngineTestSession({enemyLevel:20,playerMaxHp:10000}),enemy=s.actors[1]!,player=s.actors[0]!;
        s.turnQueue=[enemy.id,player.id];s.activeIndex=0;s.activeAp=20;enemy.hp=enemy.maxHp*.2;
        enemy.character.jutsu=[];equipPveAiItems(enemy.character);enemy.itemCharges=pveAiItemCharges(enemy.character);
        const action=pickAiAction(s,enemy,()=>.5);
        assert.notEqual('itemId'in action&&action.itemId,'item-smoke-bomb');
    }else{
        const s=createSoloPveSession({sessionId:'no-recovery',ownerSlug:'player',now:1800000000000,
            encounter:{kind:'generic-ai',id:'items'},player:fighter('Player',62),enemy:fighter('Rival',positionAtDistance(62,5,12,10))});
        equipPveAiItems(s.enemy.character);s.enemy.hp=2000;s.activeSide='enemy';s.ap.enemy=20;s.cooldowns.enemy.basicHeal=8;
        runSoloPveAiUntilPlayer(s);
        assert.ok((s.enemy.character.inventory as string[]).includes('item-smoke-bomb'));
        assert.ok(!s.events.some(e=>e.actor==='enemy'&&e.actionId==='item-smoke-bomb'));
    }
});

for(const affliction of['Wound','Drain','Poison'])test(`NPC smoke does not postpone a loss while ${affliction} keeps hurting it`,()=>{
    const s=createSoloPveSession({sessionId:'ongoing-smoke-risk',ownerSlug:'player',now:1800000000000,
        encounter:{kind:'generic-ai',id:'items'},player:fighter('Player',62),enemy:fighter('Rival',positionAtDistance(62,5,12,10))});
    equipPveAiItems(s.enemy.character);s.enemy.hp=2000;s.activeSide='enemy';s.ap.enemy=20;
    s.enemy.statuses=[{name:affliction,rounds:2,percent:20,kind:'negative',activeRound:2}];
    runSoloPveAiUntilPlayer(s);
    assert.ok((s.enemy.character.inventory as string[]).includes('item-smoke-bomb'));
    assert.ok(!s.events.some(e=>e.actor==='enemy'&&e.actionId==='item-smoke-bomb'));
});

for(const tower of[false,true])test(`${tower?'Tower':'Solo'} spends an otherwise dry forty AP preparing useful pills during smoke`,()=>{
    const smoke={name:'Decrease Damage Given',source:'item-smoke-bomb',rounds:1,percent:100,kind:'negative' as const,activeRound:1};
    if(tower){
        const s=makePveEngineTestSession({enemyLevel:20,playerMaxHp:10000}),enemy=s.actors[1]!,player=s.actors[0]!;
        s.round=1;s.turnQueue=[enemy.id,player.id];s.activeIndex=0;s.activeAp=40;
        enemy.hp=enemy.maxHp*.2;enemy.character.jutsu=[];enemy.statuses=[smoke];
        equipPveAiItems(enemy.character);enemy.itemCharges=pveAiItemCharges(enemy.character);
        for(const id of['item-defense-pill','item-attack-pill']){
            const action=pickAiAction(s,enemy,()=>.5);
            assert.equal('itemId'in action&&action.itemId,id);
            assert.ok(applyAction(s,s.encounterFloor!,action,()=>.5).applied);
        }
        assert.equal(s.activeAp,0);
    }else{
        const s=createSoloPveSession({sessionId:'smoke-preparation',ownerSlug:'player',now:1800000000000,
            encounter:{kind:'generic-ai',id:'items'},player:fighter('Player',62),enemy:fighter('Rival',positionAtDistance(62,5,12,10))});
        equipPveAiItems(s.enemy.character);s.enemy.hp=2000;s.enemy.statuses=[smoke];s.activeSide='enemy';s.ap.enemy=40;s.cooldowns.enemy.basicHeal=8;
        runSoloPveAiUntilPlayer(s);
        assert.deepEqual(s.events.filter(e=>e.actor==='enemy').map(e=>e.actionId),['item-defense-pill','item-attack-pill']);
    }
});

test('Tower never refills spent NPC supplies or gives an AFK player NPC item decisions', () => {
    const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
    const enemy = s.actors[1]!, player = s.actors[0]!;
    s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 20;
    equipPveAiItems(enemy.character); enemy.itemCharges = Object.fromEntries(Object.keys(pveAiItemCharges(enemy.character)).map(id => [id, 0]));
    assert.equal(pickAiAction(s, enemy, () => .5).type, 'wait');
    enemy.itemCharges = pveAiItemCharges(enemy.character); enemy.ownerSlug = 'human';
    assert.notEqual(pickAiAction(s, enemy, () => .5).type, 'item');
});

test('NPC shuriken timing respects active smoke without discarding a hit before pending smoke starts', () => {
    for (const activeRound of [1, 2]) {
        const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
        const enemy = s.actors[1]!, player = s.actors[0]!;
        s.round = 1; s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 20;
        player.pos = 26; enemy.pos = positionAtDistance(player.pos, 3, 8, 8);
        equipPveAiItems(enemy.character); enemy.itemCharges = pveAiItemCharges(enemy.character);
        enemy.statuses = [{ name: 'Decrease Damage Given', source: 'item-smoke-bomb', rounds: 1, percent: 100, kind: 'negative', activeRound }];
        const before = player.hp, action = pickAiAction(s, enemy, () => .5);
        assert.equal(action.type === 'weapon', activeRound === 2);
        assert.ok(applyAction(s, s.encounterFloor!, action, () => .5).applied);
        assert.equal(player.hp < before, activeRound === 2);
    }
});

test('a beginner hunt keeps a damaging opening follow-up without a second hit chain', () => {
    const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
    const enemy = s.actors[1]!, player = s.actors[0]!;
    s.towerId = 'hunt'; enemy.character.huntAiPolicy = HUNT_AI_POLICY; enemy.character.huntRank = 'D';
    s.round = 1; s.turnQueue = [enemy.id,player.id]; s.activeIndex = 0; s.activeAp = 100;
    player.pos = 26; enemy.pos = positionAtDistance(player.pos,6,8,8);
    enemy.character.jutsu = [structuredClone(FLICKER)];
    let hits = 0;
    for (let i=0;i<5;i++) {
        const action = pickAiAction(s,enemy,()=>.5), hp = player.hp;
        if (action.type === 'wait') break;
        assert.notEqual(action.type,'move');
        assert.ok(applyAction(s,s.encounterFloor!,action,()=>.5).applied);
        if (player.hp < hp) hits++;
    }
    assert.equal(hits,1);
    assert.ok(player.hp < player.maxHp);
});

for (const planner of [false,true]) for (const themed of [false,true]) test(`Solo ${planner?'planner':'legacy'} ${themed?'themed ':''}Flicker keeps a ready ranged technique at its real reach`, () => {
    const ranged: CombatJutsu={...AMBUSH,id:'ranged-followup',name:'Ranged follow-up',target:'OPPONENT',method:'SINGLE',range:4,tags:[]};
    const s=createSoloPveSession({sessionId:'ranged-spacing',ownerSlug:'player',now:1800000000000,
        encounter:{kind:'generic-ai',id:'ranged'},player:fighter('Player',62),
        enemy:fighter('Rival',positionAtDistance(62,6,12,10),[ranged,{...FLICKER,name:themed?'Moonlit Step':FLICKER.name}]),difficultyEnemyLevel:20});
    equipPveAiItems(s.enemy.character);s.activeSide='enemy';
    if(themed)s.enemy.character.inventory=[];
    if(planner)s.enemy.character.aiTurnPolicy=STANDARD_PVE_AI_POLICY;
    runSoloPveAiUntilPlayer(s);
    const actions=s.events.filter(e=>e.actor==='enemy');
    assert.equal(actions[0]?.actionId,FLICKER.id);
    assert.equal(hexDistance(actions[0]!.after.enemy.pos,actions[0]!.after.player.pos),4);
    assert.equal(actions[1]?.actionId,ranged.id);
    assert.ok(s.player.hp<s.player.maxHp);
    assert.equal(s.enemy.pos,actions[0]!.after.enemy.pos);
});

test('Tower Flicker enters a ready ranged technique reach rather than manufacturing melee chains',()=>{
    const s=makePveEngineTestSession({enemyLevel:20,playerMaxHp:10000});
    const enemy=s.actors[1]!,player=s.actors[0]!;
    s.round=1;s.turnQueue=[enemy.id,player.id];s.activeIndex=0;s.activeAp=100;
    player.pos=26;enemy.pos=positionAtDistance(player.pos,6,8,8);
    const ranged={...AMBUSH,id:'ranged-followup',name:'Ranged follow-up',target:'OPPONENT',method:'SINGLE',range:4,tags:[]};
    enemy.character.jutsu=[ranged,{...FLICKER,name:'Ranger Step'}];
    const movement=pickAiAction(s,enemy,()=>.5);
    assert.equal(movement.type,'jutsu');
    assert.equal('jutsuId' in movement&&movement.jutsuId,FLICKER.id);
    assert.ok(applyAction(s,s.encounterFloor!,movement,()=>.5).applied);
    assert.equal(hexDistance(enemy.pos,player.pos,8),4);
    const attack=pickAiAction(s,enemy,()=>.5);
    assert.equal('jutsuId' in attack&&attack.jutsuId,ranged.id);
    assert.ok(applyAction(s,s.encounterFloor!,attack,()=>.5).applied);
    assert.ok(player.hp<player.maxHp);
});

for (const planner of [false, true]) test(`Solo ${planner ? 'planner' : 'legacy'} completes Flicker plus its funded hit against a buffed target`, () => {
    const hit: CombatJutsu = { ...AMBUSH, id: 'funded-hit', target: 'OPPONENT', method: 'SINGLE', range: 4, tags: [] };
    const s = createSoloPveSession({ sessionId: 'funded-spacing', ownerSlug: 'player', now: 1800000000000,
        encounter: { kind: 'generic-ai', id: 'funded' }, player: fighter('Player', 62),
        enemy: fighter('Rival', positionAtDistance(62, 6, 12, 10), [hit, FLICKER]), difficultyEnemyLevel: 75 });
    s.enemy.character.level = 75;
    s.player.statuses = ['Increase Damage Given', 'Absorb', 'Reflect'].map(name => ({
        name, percent: 15, rounds: 3, activeRound: 1, kind: 'positive' as const,
    }));
    equipPveAiItems(s.enemy.character); s.activeSide = 'enemy';
    if (planner) s.enemy.character.aiTurnPolicy = STANDARD_PVE_AI_POLICY;
    runSoloPveAiUntilPlayer(s);
    const actions = s.events.filter(event => event.actor === 'enemy');
    assert.equal(actions[0]?.actionId, FLICKER.id);
    assert.equal(actions[1]?.actionId, hit.id);
    assert.ok(s.player.hp < s.player.maxHp);
});

test('Tower mobility does not land inside known hazards when no safe approach exists', () => {
    for (const movement of [FLICKER, AMBUSH]) {
        const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
        const enemy = s.actors[1]!, player = s.actors[0]!;
        s.round = 3; s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 100;
        player.pos = 26; enemy.pos = positionAtDistance(player.pos, 4, 8, 8);
        const ranged = { ...AMBUSH, id: 'safe-followup', name: 'Ranged follow-up', target: 'OPPONENT', method: 'SINGLE', range: 2, tags: [] };
        enemy.character.jutsu = [movement, ranged];
        s.map.features = [{ kind: 'hazard', percent: 10, tiles: Array.from({ length: 64 }, (_, tile) => tile).filter(tile => tile !== enemy.pos) }];
        const action = pickAiAction(s, enemy, () => .5);
        assert.ok(action.type !== 'jutsu' || action.jutsuId !== movement.id, 'movement must use the same hazard awareness as walking');
    }
});

test('Tower uses an available ground attack before spending AP on Flicker', () => {
    const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
    const enemy = s.actors[1]!, player = s.actors[0]!;
    s.round = 3; s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 100;
    player.pos = 26; enemy.pos = positionAtDistance(player.pos, 4, 8, 8);
    const ground = { ...AMBUSH, id: 'authored-zone', tags: [{ name: 'Drain', percent: 5 }], effectPower: 0 };
    enemy.character.jutsu = [FLICKER, ground];
    const action = pickAiAction(s, enemy, () => .5);
    assert.equal(action.type, 'jutsu');
    assert.equal('jutsuId' in action && action.jutsuId, ground.id);
    assert.ok(applyAction(s, s.encounterFloor!, action, () => .5).applied);
});

test('Tower completes its funded Flicker attack before discretionary Clear', () => {
    const s = makePveEngineTestSession({ enemyLevel: 75, playerMaxHp: 10000 });
    const enemy = s.actors[1]!, player = s.actors[0]!;
    s.round = 3; s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 100;
    player.pos = 26; enemy.pos = positionAtDistance(player.pos, 6, 8, 8);
    player.shield = 2000;
    player.statuses = [{ name: 'Increase Damage Given', percent: 25, rounds: 3, activeRound: 1, kind: 'positive' }];
    const hit = { ...AMBUSH, id: 'funded-followup', target: 'OPPONENT', method: 'SINGLE', range: 4, tags: [] };
    enemy.character.jutsu = [FLICKER, hit];
    const move = pickAiAction(s, enemy, () => .5);
    assert.equal('jutsuId' in move && move.jutsuId, FLICKER.id);
    assert.ok(applyAction(s, s.encounterFloor!, move, () => .5).applied);
    const followup = pickAiAction(s, enemy, () => .5);
    assert.equal('jutsuId' in followup && followup.jutsuId, hit.id);
    assert.ok(applyAction(s, s.encounterFloor!, followup, () => .5).applied);
    assert.equal(s.activeAp, 20);
});

test('a Tower vanguard keeps nearby artillery covered without paid walking inside six hexes', () => {
    const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
    const enemy = s.actors[1]!, player = s.actors[0]!;
    s.towerId = 'celestial';
    s.towerTactics = { version: 2, disruptedPylons: [], chargeBaits: 0, avoidedStrikes: 0, squadKnockouts: [] };
    s.round = 3; s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 100;
    player.pos = 26; enemy.pos = positionAtDistance(player.pos, 4, 8, 8);
    enemy.character.combatRole = 'vanguard'; enemy.character.jutsu = [FLICKER];
    const ally = structuredClone(enemy);
    ally.id = 'protected-artillery'; ally.pos = hexNeighbors(enemy.pos, 8, 8).find(tile => tile !== player.pos)!;
    ally.character.combatRole = 'artillery';
    s.actors.push(ally);
    const action = pickAiAction(s, enemy, () => .5);
    assert.equal(action.type, 'wait');
    assert.equal(s.activeAp, 100);
});

test('a Tower guard searches covered damaging landings instead of rejecting the first uncovered choice', () => {
    const s = makePveEngineTestSession({ enemyLevel: 20, playerMaxHp: 10000 });
    const enemy = s.actors[1]!, player = s.actors[0]!;
    s.towerId = 'celestial';
    s.towerTactics = { version: 2, disruptedPylons: [], chargeBaits: 0, avoidedStrikes: 0, squadKnockouts: [] };
    s.round = 3; s.turnQueue = [enemy.id, player.id]; s.activeIndex = 0; s.activeAp = 100;
    player.pos = 26; enemy.pos = positionAtDistance(player.pos, 4, 8, 8);
    enemy.character.combatRole = 'vanguard'; enemy.character.jutsu = [AMBUSH];
    const guardTile = Array.from({ length: 64 }, (_, tile) => tile).find(tile => {
        if ([enemy.pos, player.pos].includes(tile)) return false;
        const first = aiGapCloserLandingTile({ jutsu: AMBUSH, from: enemy.pos, target: player.pos,
            width: 8, height: 8, blocked: landing => [tile, player.pos, enemy.pos].includes(landing) });
        return first !== undefined && hexDistance(first, tile, 8) > 1
            && hexNeighbors(player.pos, 8, 8).some(landing => landing !== tile && landing !== enemy.pos
                && hexDistance(landing, tile, 8) <= 1 && hexDistance(landing, enemy.pos, 8) <= 5);
    });
    assert.notEqual(guardTile, undefined);
    const ally = structuredClone(enemy);
    ally.id = 'protected-artillery'; ally.pos = guardTile!; ally.character.combatRole = 'artillery';
    s.actors.push(ally);
    const action = pickAiAction(s, enemy, () => .5);
    assert.equal(action.type, 'jutsu');
    assert.equal('jutsuId' in action && action.jutsuId, AMBUSH.id);
    assert.ok('tile' in action && hexDistance(action.tile!, ally.pos, 8) <= 1);
    assert.ok(applyAction(s, s.encounterFloor!, action, () => .5).applied);
});
