import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeTowerTactics, primeTowerSignature, resolveTowerSignature, recordTowerKnockouts } from './_combat-tactics.js';
import { createTowerSession, type TowerActor } from './_tower-session.js';
import { applyAction, pickAiAction } from './_engine.js';
import { getFloor } from './_floor-catalog.js';
import { buildTowerEncounter } from './_encounter.js';
import { filledDiskTiles } from '../combat-core/aoe.js';
import { isTowerActionType } from './_action-types.js';

function actor(id: string, side: TowerActor['side'], pos: number): TowerActor {
    return { id, name:id, side, pos, ai:side==='enemy', ownerSlug:side==='squad'?'rill':null, hp:1000,maxHp:1000,chakra:100,maxChakra:100,stamina:100,maxStamina:100,shield:0,statuses:[],cooldowns:{},character:{ specialty:'Taijutsu',stats:{},mechanic:'enrage' } };
}
export function tacticsFixture() {
    const s=createTowerSession({towerId:'celestial',runId:'tactics-test',floor:1,seed:42,partySize:1,now:1000,map:{width:16,height:10,blockedTiles:[],hazardTiles:[],objectiveTiles:[]},actors:[actor('sq','squad',34),actor('boss','enemy',38)],bossId:'boss',objectiveKind:'defeat-all'});
    initializeTowerTactics(s); s.round=2; s.turnQueue=['sq','boss'];s.activeIndex=0;s.activeAp=100; return s;
}
test('charge locks a deterministic lane and colliding with a pillar breaks guard',()=>{
    const probe=tacticsFixture(); primeTowerSignature(probe);
    assert.ok(probe.bossStrike!.tiles.includes(34));
    const pillar=probe.bossStrike!.tiles[0]; const s=tacticsFixture(); s.map.blockedTiles=[pillar]; primeTowerSignature(s);
    assert.deepEqual(s.bossStrike!.tiles,[pillar]);s.actors[1].shield=100;
    resolveTowerSignature(s);
    assert.equal(s.map.blockedTiles.length,0);assert.equal(s.towerTactics!.chargeBaits,1);assert.equal(s.actors[1].shield,0);
    assert.ok(s.actors[1].statuses.some(status=>status.name==='Stun'&&status.activeRound===3));
    resolveTowerSignature(s);assert.equal(s.towerTactics!.chargeBaits,1);
});
test('mark stays on its original ground; avoiding it exposes the boss',()=>{
    const s=tacticsFixture();s.towerTactics!.signature='marked-strike';primeTowerSignature(s);
    const tiles=[...s.bossStrike!.tiles];s.actors[0].pos=159;
    assert.deepEqual(s.bossStrike!.tiles,tiles);resolveTowerSignature(s);
    assert.equal(s.towerTactics!.avoidedStrikes,1);
    assert.ok(s.actors[1].statuses.some(status=>status.source==='Missed signature'));
});
test('dead or displaced bosses cannot execute a sealed charge',()=>{
    for(const dead of [true,false]) {const s=tacticsFixture();primeTowerSignature(s);if(dead)s.actors[1].hp=0;else s.actors[1].pos=90;resolveTowerSignature(s);assert.equal(s.bossStrike,undefined);assert.equal(s.towerTactics!.avoidedStrikes,0);}
});
test('a player push cancels a charge immediately while preserving independent hazard warnings', () => {
    const s = tacticsFixture();
    s.actors[0].pos = 36;
    s.actors[0].character.jutsu = [{ id: 'push', name: 'Push', type: 'Taijutsu', ap: 40, range: 3, effectPower: 10, tags: [{ name: 'Push' }] }];
    s.map.dynamicHazards = [{ kind: 'geyser', tiles: [120], pct: 5, everyRounds: 2, firstRound: 2 }];
    primeTowerSignature(s);
    s.map.nextRoundHazardTiles = [...s.bossStrike!.tiles, 120];
    const bossPosition = s.actors[1].pos;
    assert.equal(applyAction(s, getFloor(1)!, { actorId: 'sq', type: 'jutsu', jutsuId: 'push', targetId: 'boss' }, () => .5).applied, true);
    assert.notEqual(s.actors[1].pos, bossPosition);
    assert.equal(s.bossStrike, undefined);
    assert.equal(s.towerTactics!.telegraph, undefined);
    assert.deepEqual(s.map.nextRoundHazardTiles, [120]);
    assert.equal(s.towerTactics!.avoidedStrikes, 0, 'interruption is not an evasion');
});
test('disruption consumes AP exactly once, disables the pylon and cancels the warning',()=>{
    const s=tacticsFixture();s.map.features=[{kind:'pylon',tiles:[35,36],element:'Fire',weakenElement:'Wind',percent:25,label:'Fire pylon'}];primeTowerSignature(s);
    s.map.nextRoundHazardTiles=[35];
    const action={actorId:'sq',type:'disrupt',tile:35} as const;
    assert.equal(applyAction(s,getFloor(1)!,action,()=>.5).applied,true);
    assert.equal(s.map.nextRoundHazardTiles,undefined);assert.equal(s.activeAp,60);assert.equal(s.actionsThisTurn,1);assert.equal(s.map.features[0].percent,0);assert.equal(s.bossStrike,undefined);
    assert.equal(applyAction(s,getFloor(1)!,action,()=>.5).applied,false);assert.equal(s.activeAp,60);
    assert.ok(s.actors[1].statuses.some(status=>status.source==='Pylon disruption'));
});
test('disruption rejects distance, missing opt-in and insufficient AP without spending',()=>{
    for(const mode of ['distance','legacy','ap','limit']) {const s=tacticsFixture();s.map.features=[{kind:'pylon',tiles:[35],element:'Fire',weakenElement:'Wind',percent:25}];if(mode==='distance')s.actors[0].pos=159;if(mode==='legacy')delete s.towerTactics;if(mode==='ap')s.activeAp=39;if(mode==='limit')s.actionsThisTurn=5;const ap=s.activeAp;assert.equal(applyAction(s,getFloor(1)!,{actorId:'sq',type:'disrupt',tile:35},()=>.5).applied,false,mode);assert.equal(s.activeAp,ap);}
});
test('controller restoration is bounded, cooldown limited, and inaccessible as a client action',()=>{
    const s=tacticsFixture();const healer=actor('healer','enemy',39);healer.character.combatRole='controller';s.actors.push(healer);s.actors[1].hp=200;s.turnQueue=['healer'];s.activeIndex=0;
    const action=pickAiAction(s,healer,()=>.5);assert.equal(action.type,'support');
    assert.equal(applyAction(s,getFloor(1)!,action,()=>.5).applied,true);assert.equal(s.actors[1].hp,280);assert.equal(s.activeAp,40);
    s.activeAp=100;assert.equal(applyAction(s,getFloor(1)!,action,()=>.5).applied,false);assert.equal(isTowerActionType('support'),false);assert.equal(isTowerActionType('disrupt'),true);
});
test('knockout evidence survives revival and ignores expired pets',()=>{
    const s=tacticsFixture();s.actors[0].hp=0;const pet=actor('pet','squad',1);pet.character.companion=true;pet.hp=0;s.actors.push(pet);recordTowerKnockouts(s);s.actors[0].hp=100;recordTowerKnockouts(s);assert.deepEqual(s.towerTactics!.squadKnockouts,['sq']);
});
test('public formations are deterministic, legal, and leave embedded modes unchanged',()=>{
    const floor=getFloor(6)!;const args={floor,runId:'formation',seed:51,partySize:1,now:1000,squad:[{id:'sq',name:'Rill',ownerSlug:'rill',ai:false,character:{maxHp:1000}}]};
    const s=buildTowerEncounter(args);assert.ok(s.towerTactics);assert.deepEqual(s,buildTowerEncounter(args));
    assert.equal(new Set(s.actors.map(a=>a.pos)).size,s.actors.length);
    for(const a of s.actors)assert.ok(!s.map.blockedTiles.includes(a.pos));
    for(const over of [{embedFloor:true},{towerId:'mission'},{towerId:'tower-pvp'}])assert.equal(buildTowerEncounter({...args,...over}).towerTactics,undefined);
});

for (const phases of [0, 1, 2]) test(`charge phase ${phases} seals its target and cadence`, () => {
    const s = tacticsFixture();
    s.actors.push(actor('far', 'squad', 32));
    s.phaseState.triggeredPhases = [60,30].slice(0, phases);
    primeTowerSignature(s);
    assert.equal(s.towerTactics!.telegraph!.targetId, phases ? 'far' : 'sq');
    const sealed = structuredClone(s.bossStrike);
    s.phaseState.triggeredPhases = [60,30];
    primeTowerSignature(s);
    assert.deepEqual(s.bossStrike, sealed, 'phase changes cannot retarget an announced strike');
    resolveTowerSignature(s); s.bossStrike = undefined;
    s.round = 3; primeTowerSignature(s); assert.equal(s.bossStrike, undefined);
    s.round = 4; primeTowerSignature(s); assert.ok(s.bossStrike, 'final phase cadence is two rounds');
});

test('later marks seal two separate areas and commanders gain crossfire', () => {
    for (const signature of ['marked-strike', 'commander'] as const) {
        const s = tacticsFixture(); s.towerTactics!.signature = signature;
        s.actors.push(actor('far', 'squad', 140));
        s.phaseState.triggeredPhases = [60,30];
        primeTowerSignature(s);
        assert.ok(s.bossStrike!.tiles.includes(34));
        assert.ok(s.bossStrike!.tiles.includes(140));
        assert.equal(new Set(s.bossStrike!.tiles).size, s.bossStrike!.tiles.length);
        s.actors[0].pos = 100; s.actors[2].pos = 159;
        assert.ok(s.bossStrike!.tiles.includes(34), 'marks remain on their announced ground');
    }
});

test('legacy tactics retain the original nearest-target three-round pattern', () => {
    const s = tacticsFixture(); s.towerTactics!.version = 1; s.phaseState.triggeredPhases = [60,30];
    s.actors.push(actor('far','squad',32)); primeTowerSignature(s);
    assert.equal(s.towerTactics!.telegraph!.targetId,'sq');
    resolveTowerSignature(s); s.bossStrike=undefined; s.round=4; primeTowerSignature(s);
    assert.equal(s.bossStrike,undefined);
    s.towerTactics!.signature='commander'; assert.equal(primeTowerSignature(s),false);
});

test('allied AI escapes a two-step mark before using an available attack', () => {
    const s=tacticsFixture(); const ally=s.actors[0]; ally.ai=true;
    ally.character.jutsu=[{id:'shot',type:'Ninjutsu',ap:40,range:10,effectPower:20}];
    const danger=[...filledDiskTiles(ally.pos,1,s.map.width,s.map.height)];
    s.map.nextRoundHazardTiles=danger;
    for(let i=0;i<2;i++) {
        const action=pickAiAction(s,ally,()=>.5); assert.equal(action.type,'move');
        assert.equal(applyAction(s,getFloor(1)!,action,()=>.5).applied,true);
    }
    assert.equal(danger.includes(ally.pos),false);
    assert.equal(s.activeAp,40);
    assert.equal(pickAiAction(s,ally,()=>.5).type,'jutsu');
});

test('allied AI does not waste its turn on an unaffordable escape or a sealed exit', () => {
    for (const blocked of [false,true]) {
        const s=tacticsFixture(); const ally=s.actors[0]; ally.ai=true;
        ally.character.jutsu=[{id:'shot',type:'Ninjutsu',ap:40,range:10,effectPower:20}];
        s.map.nextRoundHazardTiles=[...filledDiskTiles(ally.pos,1,s.map.width,s.map.height)];
        if(blocked) s.map.blockedTiles=s.map.nextRoundHazardTiles.filter(tile=>tile!==ally.pos);
        else s.activeAp=40;
        assert.equal(pickAiAction(s,ally,()=>.5).type,'jutsu');
    }
});
