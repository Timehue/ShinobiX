import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shrineFixture, simulateBalance, huntFixture } from '../../scripts/test-fixtures/hunt-shrine.js';
import { shrinePlannerApplies, SHRINE_AI_POLICY } from './_ai-turn-policy.js';
import { runSoloPveAiUntilPlayer } from './_engine.js';

test('shrine policy is explicitly sealed, rollback-safe and cannot select another host',()=>{
    assert.ok(shrinePlannerApplies({policy:SHRINE_AI_POLICY,kind:'hollow-gate',env:{}}));
    for(const kind of ['world-ai','generic-ai','weekly-boss','village-war-garrison','pvp'])
        assert.equal(shrinePlannerApplies({policy:SHRINE_AI_POLICY,kind,env:{}}),false);
    assert.equal(shrinePlannerApplies({policy:SHRINE_AI_POLICY,kind:'hollow-gate',env:{DISABLE_PVE_AI_PLANNER:'1'}}),false);
    assert.equal(shrinePlannerApplies({policy:undefined,kind:'hollow-gate',env:{}}),false);
    for(const kind of ['battle','elite','boss'] as const) {
        const s=shrineFixture(100,kind);
        assert.equal(s.enemy.character.aiTurnPolicy,SHRINE_AI_POLICY);
        assert.equal(s.shrineAi!.healLimit,kind==='battle'?1:2);
        assert.match(s.log.join('\n'),/Basic Heal.*support technique/);
    }
});

test('shrine heals have a lifetime budget, defense has a recovery round, and clones retain both',()=>{
    const original=shrineFixture(100,'elite');
    original.enemy.character.jutsu=[];
    original.enemy.pos=0;original.player.pos=119;
    original.enemy.hp=1;
    original.activeSide='enemy';original.ap.enemy=100;
    runSoloPveAiUntilPlayer(original);
    assert.equal(original.shrineAi!.healsUsed,1);
    const supportRound=original.shrineAi!.lastSupportRound!;
    for(const round of [supportRound+1,supportRound+3,supportRound+6]) {
        original.round=round;original.activeSide='enemy';original.ap.enemy=100;original.actionsThisTurn=0;
        original.cooldowns.enemy={};original.enemy.hp=1;
        runSoloPveAiUntilPlayer(original);
        assert.equal(original.shrineAi!.healsUsed,round===supportRound+1?1:2);
    }
    assert.deepEqual(structuredClone(original).shrineAi,original.shrineAi);
});

test('a legal shrine finisher beats healing and uses no additional AP',()=>{
    const s=shrineFixture(100,'battle');
    s.enemy.pos=62;s.player.pos=63;s.player.hp=1;s.enemy.hp=Math.floor(s.enemy.maxHp*.2);
    s.activeSide='enemy';s.ap.enemy=100;s.actionsThisTurn=0;
    runSoloPveAiUntilPlayer(s);
    assert.equal(s.winner,'enemy');
    assert.equal(s.shrineAi!.healsUsed,0);
    assert.ok(s.ap.enemy>=0);
});

test('pure Absorb/Reflect defense yields the following round to offense',()=>{
    const s=shrineFixture(100,'elite');
    const support={id:'ward',name:'Ward',type:'Any',target:'SELF',ap:40,range:4,effectPower:0,cooldown:0,tags:[{name:'Absorb',percent:60},{name:'Reflect',percent:60}]};
    const hit={id:'hit',name:'Hit',type:'Taijutsu',target:'OPPONENT',ap:60,range:10,effectPower:36,cooldown:0,tags:[]};
    s.enemy.character.jutsu=[support];s.enemy.character.jutsuMastery=[{jutsuId:'ward',level:50},{jutsuId:'hit',level:50}];
    s.shrineAi!.healsUsed=s.shrineAi!.healLimit;
    s.activeSide='enemy';s.ap.enemy=100;s.actionsThisTurn=0;
    runSoloPveAiUntilPlayer(s);
    const round=s.shrineAi!.lastSupportRound!;
    assert.ok(Number.isFinite(round));
    assert.ok(s.enemy.statuses.some(t=>t.name==='Absorb'));
    s.enemy.character.jutsu=[support,hit];s.enemy.statuses=[];s.cooldowns.enemy={};
    s.round=round+1;s.activeSide='enemy';s.ap.enemy=100;s.actionsThisTurn=0;
    const seq=s.eventSeq;
    runSoloPveAiUntilPlayer(s);
    const events=s.events.filter(e=>e.seq>seq && e.actor==='enemy');
    assert.ok(events.some(e=>e.actionId==='hit'));
    assert.ok(!events.some(e=>e.actionId==='ward'));
    assert.equal(s.shrineAi!.lastSupportRound,round);
    s.enemy.character.jutsu=[support];s.enemy.statuses=[];s.cooldowns.enemy={};
    s.round=round+2;s.activeSide='enemy';s.ap.enemy=100;s.actionsThisTurn=0;
    runSoloPveAiUntilPlayer(s);
    assert.equal(s.shrineAi!.lastSupportRound,round+2);
});

test('balance comparisons seal identical HP, stats, mastery, EP and resources at low/mid/high levels',()=>{
    for(const level of [5,17,50,100]) for(const sustain of [false,true]) {
        for(const kind of ['battle','elite','boss'] as const) {
            const old=shrineFixture(level,kind,sustain,true),current=shrineFixture(level,kind,sustain);
            const strip=(s:typeof old)=>{const e=structuredClone(s.enemy);delete e.character.aiTurnPolicy;return e;};
            assert.deepEqual(strip(old),strip(current),'chooser adds no scaling or mastery');
            assert.deepEqual(old.player,current.player);
        }
        for(const mission of ['hunt-wild-boar','hunt-frost-wolf']) {
            const old=huntFixture(level,mission,sustain,true),current=huntFixture(level,mission,sustain);
            assert.equal(old.enemy.maxHp,current.enemy.maxHp);
            assert.deepEqual(old.enemy.character.jutsu,current.enemy.character.jutsu);
            assert.deepEqual(old.enemy.character.jutsuMastery,current.enemy.character.jutsuMastery);
        }
    }
});

test('representative full battles terminate deterministically under both policies',()=>{
    for(const level of [5,50,100]) for(const sustain of [false,true]) for(const legacy of [false,true]) {
        const s=shrineFixture(level,'battle',sustain,legacy);
        const result=simulateBalance(s,sustain);
        assert.deepEqual(simulateBalance(s,sustain),result);
        assert.notEqual(result.outcome,null);
        assert.ok(result.actions<240);
        if(!legacy) assert.ok(result.enemyHeals<=1);
    }
});
