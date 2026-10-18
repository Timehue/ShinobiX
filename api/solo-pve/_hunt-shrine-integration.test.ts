import assert from 'node:assert/strict';
import { test } from 'node:test';
import { huntFixture, shrineFixture } from '../../scripts/test-fixtures/hunt-shrine.js';
import { attachHuntCombat } from './_hunt-combat.js';
import { readSoloPveSession, writeSoloPveSession, type SoloPveKv } from './_store.js';
import { executeSoloPveAction, type SoloPveLock } from './_action-service.js';
import { HUNT_AI_POLICY } from '../towers/_hunt-ai.js';
import { SHRINE_AI_POLICY } from './_ai-turn-policy.js';
import type { SoloPveSession } from './_session.js';

function jsonStore(): SoloPveKv {
    const rows=new Map<string,string>();
    return {
        get:async <T>(key:string)=>rows.has(key)?JSON.parse(rows.get(key)!) as T:null,
        set:async(key,value)=>{rows.set(key,JSON.stringify(value));return true;},
        del:async(key)=>rows.delete(key),
        hset:async()=>true,
    };
}
const telemetry={kv:{set:async()=>null} as never,record:()=>{}};

test('hunt formation routing is sealed on every live/pending actor and survives storage restore',async()=>{
    for(const level of [5,17,30,31,100]) for(const kind of ['single','pack','waves'] as const) {
        const s=huntFixture(level,'hunt-ash-lizard');
        delete s.huntCombat;
        attachHuntCombat(s,{kind:kind==='single'?'hunt-target':'hunt-pack',sourceId:'hunt-ash-lizard',missionId:'hunt-ash-lizard',
            huntRunId:'formation-check',sector:40,stage:0,displayName:'Ash Lizard',
            huntFormation:{version:1,kind,count:kind==='single'?1:3}});
        const kv=jsonStore();
        await writeSoloPveSession(s,{kv,telemetry});
        const restored=(await readSoloPveSession(s.sessionId,{kv}))!;
        const b=restored.huntCombat!.battle;
        const enemies=[...b.actors,...(b.pendingEnemyWaves??[]).flatMap(w=>w.actors)].filter(a=>a.side==='enemy');
        assert.equal(enemies.length,kind==='single'?1:3);
        for(const e of enemies) assert.equal(e.character.huntAiPolicy,kind==='pack'&&level<=30?undefined:HUNT_AI_POLICY);
        if(kind==='pack'&&level<=30) assert.match(b.log.join('\n'),/Heavy techniques begin on round 3/);
        assert.deepEqual(restored.huntCombat,JSON.parse(JSON.stringify(s.huntCombat)));
        assert.deepEqual(restored.enemy.character.jutsuMastery,s.enemy.character.jutsuMastery);
    }
});

test('restored shrine budget and policy persist through authoritative action, write and token replay',async()=>{
    const s=shrineFixture(50,'battle');
    s.shrineAi!.healsUsed=1;s.shrineAi!.lastSupportRound=5;s.round=6;
    s.enemy.hp=1;
    const kv=jsonStore();
    await writeSoloPveSession(s,{kv,telemetry});
    const command={sessionId:s.sessionId,ownerSlug:s.ownerSlug,expectedVersion:s.version,
        moveToken:'restored-shrine-001',action:{type:'wait' as const}};
    const deps={read:(id:string)=>readSoloPveSession(id,{kv}),write:(next:SoloPveSession)=>writeSoloPveSession(next,{kv,telemetry}),
        lock:(async(_key,fn)=>fn()) as SoloPveLock,now:()=>1001,telemetry};
    const result=await executeSoloPveAction(command,deps);
    assert.equal(result.status,200);assert.equal(result.body.applied,true);
    const restored=(await readSoloPveSession(s.sessionId,{kv}))!;
    assert.equal(restored.enemy.character.aiTurnPolicy,SHRINE_AI_POLICY);
    assert.equal(restored.shrineAi!.healsUsed,1);
    assert.equal(restored.shrineAi!.lastSupportRound,5);
    assert.ok(!restored.events.some(e=>e.actor==='enemy' && e.action==='basicHeal'));
    const replay=await executeSoloPveAction(command,deps);
    assert.equal(replay.body.duplicate,true);
    assert.deepEqual((await readSoloPveSession(s.sessionId,{kv}))!.shrineAi,restored.shrineAi);
    assert.equal((await readSoloPveSession(s.sessionId,{kv}))!.version,restored.version);
});

test('reading old unsealed hunt/shrine sessions never retrofits a stronger runner or resets combat',async()=>{
    for(const s of [huntFixture(17,'hunt-frost-wolf',false,true),shrineFixture(100,'elite',false,true)]) {
        const kv=jsonStore();
        await writeSoloPveSession(s,{kv,telemetry});
        const restored=await readSoloPveSession(s.sessionId,{kv});
        assert.deepEqual(restored,JSON.parse(JSON.stringify(s)));
        if(restored!.huntCombat) assert.ok(restored!.huntCombat.battle.actors.every(a=>a.character.huntAiPolicy!==HUNT_AI_POLICY));
        else {assert.equal(restored!.shrineAi,undefined);assert.equal(restored!.enemy.character.aiTurnPolicy,undefined);}
    }
});
