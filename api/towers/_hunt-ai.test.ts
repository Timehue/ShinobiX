import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makePveEngineTestSession } from './_pve-engine-test-fixture.js';
import { applyAction, pickAiAction } from './_engine.js';
import { HUNT_AI_POLICY, HUNT_REACTIVE_POLICY, huntHoldsBurst } from './_hunt-ai.js';
import { huntFixture } from '../../scripts/test-fixtures/hunt-shrine.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';

function fixture(level=20,rank='C') {
    const s=makePveEngineTestSession({enemyLevel:level,playerMaxHp:10000});
    s.towerId='hunt';s.round=3;s.turnQueue=['boss','player'];s.activeIndex=0;s.activeAp=100;
    const enemy=s.actors[1]!,player=s.actors[0]!;
    enemy.character.huntAiPolicy=HUNT_AI_POLICY;enemy.character.huntRank=rank;
    enemy.pos=33;player.pos=62;
    return {s,enemy,player};
}

test('last affordable ranged cast beats waiting and does not spend AP in a preview',()=>{
    const {s,enemy}=fixture(20,'D');
    enemy.character.jutsu=[{id:'ranged',name:'Ranged',type:'Taijutsu',target:'OPPONENT',ap:60,range:10,effectPower:1,cooldown:7}];
    enemy.character.jutsuMastery=[{jutsuId:'ranged',level:20}];
    const before=structuredClone(s);
    const action=pickAiAction(s,enemy,()=>.5);
    assert.deepEqual(action,{actorId:enemy.id,type:'jutsu',jutsuId:'ranged',targetId:'player'});
    assert.deepEqual(s,before);
    assert.ok(applyAction(s,s.encounterFloor!,action,()=>.5).applied);
    assert.equal(s.activeAp,40);
});

test('hunt zero-damage utility is useful and cooldown/resource/seal gates remain authoritative',()=>{
    const {s,enemy,player}=fixture();player.pos=34;
    enemy.character.jutsu=[{id:'afflict',name:'Afflict',type:'Any',element:'Fire',target:'OPPONENT',ap:40,range:4,effectPower:0,cooldown:7,
        chakraCost:20,tags:[{name:'Increase Damage Taken',percent:30},{name:'Ignition',percent:30}]}];
    const action=pickAiAction(s,enemy,()=>.5);
    assert.equal(action.type,'jutsu');
    assert.ok(applyAction(s,s.encounterFloor!,action,()=>.5).applied);
    assert.ok(player.statuses.some(t=>t.name==='Ignition'));
    const again=pickAiAction(s,enemy,()=>.5);
    assert.notEqual(again.type,'jutsu');
    enemy.cooldowns={};enemy.chakra=0;s.activeAp=100;s.actionsThisTurn=0;
    assert.notEqual(pickAiAction(s,enemy,()=>.5).type,'jutsu');
    enemy.chakra=500;enemy.statuses.push({name:'Elemental Seal',kind:'negative',rounds:2,activeRound:s.round,source:'test'});
    const sealed=pickAiAction(s,enemy,()=>.5);
    assert.ok(sealed.type!=='jutsu','a sealed technique is never repeatedly selected');
});

test('rank timing matches the visible warning and protects low-level D contracts',()=>{
    for(const level of [1,15,17,30,31,50,100]) for(const mission of ['hunt-wild-boar','hunt-frost-wolf']) {
        const s=huntFixture(level,mission),b=s.huntCombat!.battle,e=b.actors.find(a=>a.side==='enemy')!;
        const warning=b.log.find(l=>l.includes('Heavy techniques begin'))!;
        const round=Number(warning.match(/round (\d+)/)![1]);
        for(let r=1;r<=3;r++) {b.round=r;assert.equal(huntHoldsBurst(b,e),r<round);}
        if(level<=30) assert.equal(round,3);
    }
});

test('hunt chooser retains authored HP conditions and cannot affect public Tower actors',()=>{
    const {s,enemy}=fixture();
    const emergency={id:'emergency',name:'Emergency',type:'Taijutsu',target:'OPPONENT',ap:60,range:10,effectPower:36,aiHpBelowPct:30,tags:[]};
    enemy.character.jutsu=[emergency];
    assert.notEqual(pickAiAction(s,enemy,()=>.5).type,'jutsu');
    delete (emergency as Partial<typeof emergency>).aiHpBelowPct;
    assert.equal(pickAiAction(s,enemy,()=>.5).type,'jutsu','the same useful cast is selected without its HP restriction');
    s.towerId='public-tower';
    const sealed=pickAiAction(s,enemy,()=>.5);
    delete enemy.character.huntAiPolicy;
    assert.deepEqual(pickAiAction(s,enemy,()=>.5),sealed);
});

test('ordinary easy hunts telegraph Flicker and allow its opening follow-up attacks',()=>{
    let s=huntFixture(20,'hunt-frost-wolf');
    const initialHp=s.player.hp;
    const e=s.huntCombat!.battle.actors.find(a=>a.side==='enemy')!,initialPos=e.pos;
    assert.match(s.log.join('\n'),/Flicker can close the gap and enable follow-up attacks/);
    let next=applySoloPveAction(s,{type:'huntAction',action:{type:'wait'}});
    assert.ok(next.applied);s=next.session;
    assert.ok(s.player.hp<initialHp,'Flicker preserves enough AP to attack during the opening round');
    assert.notEqual(s.huntCombat!.battle.actors.find(a=>a.side==='enemy')!.pos,initialPos);
    next=applySoloPveAction(s,{type:'huntAction',action:{type:'wait'}});
    assert.ok(next.applied);s=next.session;
    assert.ok(s.player.hp<initialHp,'ordinary pressure resumes after the preparation round');
});

test('new lone C+ retaliation uses visible HP on round two and the real legal resolver',()=>{
    const {s,enemy,player}=fixture(20,'C');
    enemy.character.huntReactivePolicy=HUNT_REACTIVE_POLICY;
    enemy.character.jutsu=[{id:'response',name:'Response',type:'Taijutsu',target:'OPPONENT',ap:60,range:10,effectPower:36,cooldown:7,chakraCost:20}];
    enemy.character.jutsuMastery=[{jutsuId:'response',level:20}];
    s.round=2;enemy.hp=Math.floor(enemy.maxHp*.75);
    assert.equal(huntHoldsBurst(s,enemy),false);
    const before=structuredClone(s),action=pickAiAction(s,enemy,()=>.5);
    assert.equal(action.type,'jutsu');assert.deepEqual(s,before);
    const chakra=enemy.chakra;
    assert.ok(applyAction(s,s.encounterFloor!,action,()=>.5).applied);
    assert.equal(s.activeAp,40);assert.equal(enemy.chakra,chakra-20);
    assert.ok(player.hp<before.actors[0]!.hp);
    s.activeAp=100;s.actionsThisTurn=0;
    assert.notEqual(pickAiAction(s,enemy,()=>.5).type,'jutsu','cooldown remains authoritative');
});

test('retaliation never advances healthy, opening, beginner, D-rank, legacy or formation burst clocks',()=>{
    for(const scenario of ['healthy','opening','beginner-enemy','beginner-player','D','legacy','pack','waves']) {
        const {s,enemy,player}=fixture(20,'C');
        s.round=2;enemy.hp=Math.floor(enemy.maxHp*.75);
        enemy.character.huntReactivePolicy=HUNT_REACTIVE_POLICY;
        if(scenario==='healthy') enemy.hp=Math.floor(enemy.maxHp*.75)+1;
        if(scenario==='opening') s.round=1;
        if(scenario==='beginner-enemy') enemy.character.level=15;
        if(scenario==='beginner-player') player.character.level=15;
        if(scenario==='D') enemy.character.huntRank='D';
        if(scenario==='legacy') delete enemy.character.huntReactivePolicy;
        if(scenario==='pack') s.actors.push({...structuredClone(enemy),id:'packmate'});
        if(scenario==='waves') s.pendingEnemyWaves=[{round:1,afterClear:true,actors:[{...structuredClone(enemy),id:'wave'}]}];
        assert.equal(huntHoldsBurst(s,enemy),true,scenario);
    }
    const current=huntFixture(17,'hunt-frost-wolf'),b=current.huntCombat!.battle;
    assert.equal(b.actors.find(a=>a.side==='enemy')!.character.huntReactivePolicy,HUNT_REACTIVE_POLICY);
    assert.match(b.log.join('\n'),/round 2 at 75% HP or below/);
    for(const level of [5,15,31,100]) assert.equal(huntFixture(level,'hunt-frost-wolf').huntCombat!.battle.actors.find(a=>a.side==='enemy')!.character.huntReactivePolicy,undefined);
    assert.equal(huntFixture(17,'hunt-wild-boar').huntCombat!.battle.actors.find(a=>a.side==='enemy')!.character.huntReactivePolicy,undefined);
});
