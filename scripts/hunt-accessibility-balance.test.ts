import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocatedStatPoints, earnedForLevel } from '../api/_xp-engine.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../api/combat-core/formulas.js';
import type { SoloPveJutsu } from '../api/solo-pve/_session.js';
import { saveFor, encounter, type Build } from './test-fixtures/hunt-accessibility.js';
import { simulateBalance } from './test-fixtures/hunt-shrine.js';

test('accessibility fixtures conserve actual earned points and raw rank/mastery caps',()=>{
    for(const level of [15,16,17,18,20,30,31,50]) for(const build of ['balanced-nin','focused-nin','focused-gen','matched-gen-six'] as Build[]) {
        if(build==='matched-gen-six'&&level>20) continue;
        for(const developing of [false,true]) {
            const s=saveFor(level,build,'reinforced',developing);
            assert.equal(allocatedStatPoints(s.character.stats),earnedForLevel(level));
            assert.ok(Object.values(s.character.stats).every(n=>n<=statCapForLevel(level)));
            assert.ok(s.character.jutsuMastery.every(m=>m.level<=jutsuLevelCapForLevel(level)));
            if(build==='matched-gen-six') {assert.equal(s.character.stats.intelligence,640);assert.equal(s.character.stats.genjutsuOffense,570);}
        }
    }
});

test('accessible standard gear hydrates actual armor and no-sustain skills without catalog overrides',()=>{
    const s=encounter(17,'matched-gen-six','hunt-frost-wolf',1,false,'reinforced');
    assert.equal(s.player.character.armorRawDR,.15);
    const kit=s.player.character.jutsu as SoloPveJutsu[];
    assert.equal(kit.filter(j=>Number(j.effectPower)>1).length,6);
    assert.ok(kit.every(j=>Array.isArray(j.tags)&&j.tags.every(t=>!['Heal','Siphon','Lifesteal','Absorb','Reflect','Shield'].includes(t.name))));
});

test('ordinary C-rank unlock keeps breathing room across the level16 boundary with legal non-sustain builds',()=>{
    for(const level of [15,16,17,18]) for(const seed of [1,7,42]) for(const choices of [{},{openingDebuff:true,reverseDamage:true}]) {
        const s=encounter(level,'matched-gen-six','hunt-frost-wolf',seed,false,'reinforced');
        const result=simulateBalance(s,false,choices);
        assert.equal(result.outcome,'win',`${level}/${seed}/${JSON.stringify(choices)}`);
        assert.ok(result.endHp>=s.player.maxHp*.1,'ordinary unlock is not a one-hit-away fixed-rotation win');
    }
});

test('visible counterplay takes a legal finisher before universal recovery',()=>{
    const s=encounter(17,'matched-gen-six','hunt-frost-wolf',1,false,'reinforced');
    const b=s.huntCombat!.battle;
    const p=b.actors.find(a=>a.side==='squad')!,e=b.actors.find(a=>a.side==='enemy')!;
    p.hp=10;e.hp=1;e.shield=0;e.pos=p.pos+1;
    const result=simulateBalance(s,false,{useCounters:true,openingDebuff:true,reverseDamage:true});
    assert.equal(result.outcome,'win');assert.equal(result.actions,1);assert.equal(result.endHp,10);
});

test('developing ordinary builds retain level20 hunt access using visible legal counters',()=>{
    for(const level of [17,20]) for(const build of ['balanced-nin','focused-nin','matched-gen-six'] as const) for(const seed of [1,7,42]) {
        const current=encounter(level,build,'hunt-frost-wolf',seed,false,'reinforced',true);
        const result=simulateBalance(current,false,{openingDebuff:true,reverseDamage:true,useCounters:true});
        assert.equal(result.outcome,'win',`${level}/${build}/${seed}`);
        assert.ok(result.rounds<=30);
        assert.ok(result.playerCounters!.clear>0,'the visible shield has a legal, accessible counter');
    }
});
