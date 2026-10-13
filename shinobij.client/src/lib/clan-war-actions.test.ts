import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {cwQueueAction,cwDeclareWar,cwChallengeAction,cwListWars,sharedClanWarCache} from './clan-war-api.js';
import {readPendingEconomyIntent} from './economy-request-intent.js';

function installStorage(t:TestContext) {
    const rows=new Map<string,string>();
    const storage={getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>rows.set(key,value),removeItem:(key:string)=>rows.delete(key)};
    for(const key of ['sessionStorage','localStorage','window']) {
        const original=Object.getOwnPropertyDescriptor(globalThis,key);
        Object.defineProperty(globalThis,key,{value:key==='window'?{setTimeout,clearTimeout}:storage,configurable:true});
        t.after(()=>{if(original)Object.defineProperty(globalThis,key,original);else Reflect.deleteProperty(globalThis,key);});
    }
    return storage;
}

test('an account switch during action-code loading sends no queue, declaration or challenge request',async t=>{
    const storage=installStorage(t);
    let requests=0;
    t.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('No request should reach the server.');});
    for(const action of [
        ()=>cwQueueAction({warId:'rivalry',action:'join',mode:'pvp1v1'}),
        ()=>cwDeclareWar('Ember','alice'),
        ()=>cwChallengeAction({warId:'rivalry',action:'accept',challengeId:'match'}),
    ]) {
        storage.setItem('shinobix:activePlayer','alice');
        const result=action();
        storage.setItem('shinobix:activePlayer','bob');
        const response=await result;
        assert.equal(response.ok,false);
        assert.match(response.error??'',/signed-in player changed/);
    }
    assert.equal(requests,0);
});

test('a lazily loaded pool declaration retains its paid request id until a final response',async t=>{
    const storage=installStorage(t);
    storage.setItem('shinobix:activePlayer','alice');
    const bodies:Array<{requestId:string;funding:string;toClan:string}>=[];
    t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(bodies.length===1?{error:'pending'}:{war:{id:'rivalry'}}),{
            status:bodies.length===1?503:200,headers:{'Content-Type':'application/json'},
        });
    });
    assert.equal((await cwDeclareWar('Ember','alice','pool')).ok,false);
    assert.ok(readPendingEconomyIntent('clan-war-declare',['alice','ember','pool']));
    assert.equal((await cwDeclareWar('Ember','alice','pool')).ok,true);
    assert.equal(bodies.length,2);
    assert.equal(bodies[0].requestId,bodies[1].requestId);
    assert.equal(bodies[0].funding,'pool');
    assert.equal(readPendingEconomyIntent('clan-war-declare',['alice','ember','pool']),null);
});

test('war-list polls coalesce per viewer and a late former-account reply cannot replace the current cache',{timeout:5000},async t=>{
    const storage=installStorage(t);
    storage.setItem('shinobix:activePlayer','alice');
    let finishFirst!:(value:Response)=>void,finishSecond!:(value:Response)=>void;
    let startFirst!:()=>void,startSecond!:()=>void;
    const firstAnswer=new Promise<Response>(resolve=>finishFirst=resolve),secondAnswer=new Promise<Response>(resolve=>finishSecond=resolve);
    const firstStarted=new Promise<void>(resolve=>startFirst=resolve),secondStarted=new Promise<void>(resolve=>startSecond=resolve);
    let requests=0;
    t.mock.method(globalThis,'fetch',async()=>{
        requests++;
        if(requests===1){startFirst();return firstAnswer;}
        startSecond();return secondAnswer;
    });
    const first=cwListWars(),duplicate=cwListWars();
    await firstStarted;
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(requests,1);
    storage.setItem('shinobix:activePlayer','bob');
    const next=cwListWars();
    await secondStarted;
    finishSecond(new Response(JSON.stringify({wars:[{id:'bob-war',updatedAt:10}]})));
    assert.deepEqual((await next).map(war=>war.id),['bob-war']);
    finishFirst(new Response(JSON.stringify({wars:[{id:'alice-war',updatedAt:20}]})));
    assert.deepEqual(await first,[]);
    assert.deepEqual(await duplicate,[]);
    assert.deepEqual(Object.keys(sharedClanWarCache),['bob-war']);
    assert.equal(requests,2);
});
