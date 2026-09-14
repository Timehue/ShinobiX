import assert from 'node:assert/strict';
import {afterEach, beforeEach, test} from 'node:test';
import {pendingClanExchangeIntent, readPendingClanExchangeIntent} from './clan-exchange-intent';
import {paidPendingClanExchangeRequests, recoverPaidClanExchangePurchase} from './clan-exchange-recovery';

const originalFetch = globalThis.fetch;
const originalAlert = globalThis.alert;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
let alerts: string[];
let sequence = 0;
beforeEach(() => {
    const entries = new Map<string,string>();
    Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value),removeItem:(key:string)=>entries.delete(key)}});
    alerts=[];
    globalThis.alert = message => { alerts.push(String(message)); };
});
afterEach(() => {
    globalThis.fetch=originalFetch;
    globalThis.alert=originalAlert;
    if(originalStorage) Object.defineProperty(globalThis,'sessionStorage',originalStorage);
    else Reflect.deleteProperty(globalThis,'sessionStorage');
});
function paid() {
    const name=`Recovery${++sequence}`;
    const clan='Shadow Cell';
    const itemId='greaterWarSupplyGrant';
    const intent=pendingClanExchangeIntent(name,clan,itemId);
    const receipt={requestId:intent.requestId,clanSlug:'shadowcell',proofToken:'server-bound',item:{id:itemId}};
    return {name,clan,itemId,intent,receipt,character:{name,clanExchangeSettlements:[receipt]}};
}

test('an intent restored from session storage keeps its in-memory fallback',()=>{
    const name=`Restored${++sequence}`;
    const id=`cex-${Date.now()}-${'b'.repeat(32)}`;
    sessionStorage.setItem(`shinobix.clan-exchange:${JSON.stringify([name.toLowerCase(),'shadow cell','warSupplyGrant'])}`,id);
    assert.equal(readPendingClanExchangeIntent(name,'Shadow Cell','warSupplyGrant')?.requestId,id);
    Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw new Error('Storage unavailable');}});
    const retained=pendingClanExchangeIntent(name,'Shadow Cell','warSupplyGrant');
    assert.equal(retained.requestId,id);
    retained.complete();
});

test('a manual retry persists its fallback intent once session storage becomes available',()=>{
    const name=`StorageReturns${++sequence}`;
    const available=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage')!;
    Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw new Error('Storage unavailable');}});
    const original=pendingClanExchangeIntent(name,'Shadow Cell','warSupplyGrant');
    Object.defineProperty(globalThis,'sessionStorage',available);
    const retry=pendingClanExchangeIntent(name,'Shadow Cell','warSupplyGrant');
    assert.equal(retry.requestId,original.requestId);
    assert.equal(sessionStorage.getItem(`shinobix.clan-exchange:${JSON.stringify([name.toLowerCase(),'shadow cell','warSupplyGrant'])}`),original.requestId);
    retry.complete();
});

test('only a matching saved debit and retained intent are eligible for automatic recovery',()=>{
    const p=paid();
    assert.deepEqual(paidPendingClanExchangeRequests(p.character,p.clan),[{itemId:p.itemId,requestId:p.intent.requestId}]);
    for (const receipt of [null,{}, {...p.receipt,requestId:'other'}, {...p.receipt,clanSlug:'other'}, {...p.receipt,proofToken:''}, {...p.receipt,item:{id:'smallRyoPouch'}}]) {
        assert.deepEqual(paidPendingClanExchangeRequests({name:p.name,clanExchangeSettlements:[receipt]},p.clan),[]);
    }
    assert.deepEqual(paidPendingClanExchangeRequests({name:p.name},p.clan),[]);
    assert.deepEqual(paidPendingClanExchangeRequests({name:p.name,clanExchangeSettlements:{}},p.clan),[]);
    assert.deepEqual(paidPendingClanExchangeRequests(p.character,'Another Clan'),[]);
    p.intent.complete();
    assert.deepEqual(paidPendingClanExchangeRequests(p.character,p.clan),[]);
});

test('background recovery reuses one request across concurrent mounts and clears it after success',async()=>{
    const p=paid();
    let calls=0;
    let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    globalThis.fetch=async(_url,init)=>{
        calls++;
        assert.deepEqual(JSON.parse(String(init?.body)),{playerName:p.name,clan:p.clan,itemId:p.itemId,requestId:p.intent.requestId});
        await held;
        return new Response(JSON.stringify({ok:true,character:p.character,_saveVersion:4}));
    };
    const a=recoverPaidClanExchangePurchase(p.name,p.clan,p.itemId,p.intent.requestId);
    const b=recoverPaidClanExchangePurchase(p.name,p.clan,p.itemId,p.intent.requestId);
    assert.equal(calls,1);
    release();
    assert((await a)?._saveVersion===4);
    assert((await b)?._saveVersion===4);
    assert.equal(readPendingClanExchangeIntent(p.name,p.clan,p.itemId),null);
    assert.equal(await recoverPaidClanExchangePurchase(p.name,p.clan,p.itemId,p.intent.requestId),null);
    assert.equal(calls,1);
    assert.deepEqual(alerts,[]);
});

test('network or server failure stays quiet and retains the paid intent for reconnect',async()=>{
    const p=paid();
    for (const response of ['network','server','malformed']) {
        globalThis.fetch=async()=>{
            if(response==='network') throw new Error('offline');
            return new Response(response==='server'?JSON.stringify({error:'Retry later'}):'{}',{status:response==='server'?500:200});
        };
        assert.equal(await recoverPaidClanExchangePurchase(p.name,p.clan,p.itemId,p.intent.requestId),null);
        assert.equal(readPendingClanExchangeIntent(p.name,p.clan,p.itemId)?.requestId,p.intent.requestId);
    }
    assert.deepEqual(alerts,[]);
});

test('expired recovery cannot mint a new intent or become a fresh purchase',async()=>{
    const p=paid();
    let calls=0;
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'Expired',code:'REQUEST_EXPIRED'}),{status:409});};
    assert.equal(await recoverPaidClanExchangePurchase(p.name,p.clan,p.itemId,p.intent.requestId),null);
    assert.equal(readPendingClanExchangeIntent(p.name,p.clan,p.itemId),null);
    assert.equal(await recoverPaidClanExchangePurchase(p.name,p.clan,p.itemId,p.intent.requestId),null);
    assert.equal(calls,1);
    assert.deepEqual(alerts,[]);
});

test('a delayed recovery never substitutes a newer purchase intent',async()=>{
    const p=paid();
    p.intent.complete();
    const newer=pendingClanExchangeIntent(p.name,p.clan,p.itemId);
    globalThis.fetch=async()=>{assert.fail('must not send a different intent');};
    assert.equal(await recoverPaidClanExchangePurchase(p.name,p.clan,p.itemId,p.intent.requestId),null);
    assert.equal(readPendingClanExchangeIntent(p.name,p.clan,p.itemId)?.requestId,newer.requestId);
    newer.complete();
});
