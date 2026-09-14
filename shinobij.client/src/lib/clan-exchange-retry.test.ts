import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {postClanExchangePurchase} from './player-api';
import {noteServerTime, resetServerClock} from './server-clock';

const originalFetch = globalThis.fetch;
const originalAlert = globalThis.alert;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', {configurable:true, value:{getItem:(key:string)=>entries.get(key) ?? null, setItem:(key:string,value:string)=>entries.set(key,value), removeItem:(key:string)=>entries.delete(key)}});
    globalThis.alert = () => undefined;
});
afterEach(() => {
    resetServerClock();
    globalThis.fetch = originalFetch;
    globalThis.alert = originalAlert;
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});
const success = () => new Response(JSON.stringify({ok:true, character:{name:'Retry'}, item:{id:'warSupplyGrant'}, purchaseCount:1, remaining:1, _saveVersion:2}), {status:200});

test('a lost Exchange response retains its intent; a later genuine purchase gets a new one', async () => {
    const requests: Array<Record<string,unknown>> = [];
    globalThis.fetch = async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string,unknown>);
        if (requests.length === 1) throw new Error('response lost');
        return success();
    };
    assert.equal(await postClanExchangePurchase('Retry','Retry Clan','warSupplyGrant'),null);
    assert(await postClanExchangePurchase('Retry','Retry Clan','warSupplyGrant'));
    assert(await postClanExchangePurchase('Retry','Retry Clan','warSupplyGrant'));
    assert.match(String(requests[0].requestId), /^cex-\d{13}-[a-f0-9]{32}$/);
    assert.equal(requests[1].requestId,requests[0].requestId);
    assert.notEqual(requests[2].requestId,requests[0].requestId);
});

test('ambiguous malformed success keeps the same treasury intent on retry', async () => {
    const ids: unknown[]=[];
    globalThis.fetch=async (_url,init)=>{
        ids.push((JSON.parse(String(init?.body)) as Record<string,unknown>).requestId);
        return ids.length===1 ? new Response('{}',{status:200}) : success();
    };
    assert.equal(await postClanExchangePurchase('Malformed','Retry Clan','warSupplyGrant'),null);
    assert(await postClanExchangePurchase('Malformed','Retry Clan','warSupplyGrant'));
    assert.equal(typeof ids[0],'string');
    assert.equal(ids[0],ids[1]);
});

test('personal-only Exchange purchases keep their existing request shape', async () => {
    let request: Record<string,unknown>={};
    globalThis.fetch=async (_url,init)=>{request=JSON.parse(String(init?.body)) as Record<string,unknown>;return success();};
    assert(await postClanExchangePurchase('Personal','Retry Clan','smallRyoPouch'));
    assert.deepEqual(request,{playerName:'Personal',clan:'Retry Clan',itemId:'smallRyoPouch'});
});

test('Exchange uses the established server clock when the player clock is ahead',async()=>{
    const serverStamp=Date.now()-180_000;
    noteServerTime(serverStamp);
    let id='';
    globalThis.fetch=async(_url,init)=>{id=JSON.parse(String(init?.body)).requestId;return success();};
    assert(await postClanExchangePurchase('Clock','Retry Clan','warSupplyGrant'));
    assert(Math.abs(Number(id.split('-')[1])-serverStamp)<1000);
});
