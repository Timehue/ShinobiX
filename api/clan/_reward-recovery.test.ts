import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'clan-recovery-memory-only';
delete process.env.SESSION_SECRET;
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let mission: Handler;
let exchange: Handler;
let originalSet: typeof kv.set;
let originalCas: typeof kv.compareSet;
const realNow = Date.now;
const clanKey = 'save:clan-recoveryclan';
const playerKey = 'save:recoverymember';
const clanName = 'Recovery Clan';
const playerName = 'recoverymember';
let time = new Date('2026-09-14T12:00:00Z').getTime();
const requestId = (suffix = 'a') => `cex-${time}-${suffix.repeat(32)}`;

before(async () => {
 ({kv} = await import('../_storage.js'));
 mission = (await import('./mission/claim.js')).default as unknown as Handler;
 exchange = (await import('./exchange/purchase.js')).default as unknown as Handler;
 originalSet = kv.set.bind(kv);
 originalCas = kv.compareSet.bind(kv);
});
beforeEach(async () => {
 kv.set = originalSet; kv.compareSet = originalCas;
 time = new Date('2026-09-14T12:00:00Z').getTime();
 Date.now = () => time;
 for (const key of await kv.keys('*')) await kv.del(key);
 await kv.set(clanKey, {name: clanName, level: 25, xp: 0, treasury: {ryo: 1000, warSupply: 10}, members: [{name: playerName, battleContrib: 20}]});
 await kv.set(playerKey, {_saveVersion: 1, character: {name: playerName, clan: clanName, clanPoints: 4000}});
});
afterEach(() => {kv.set = originalSet; kv.compareSet = originalCas; Date.now = realNow;});

async function post(handler: Handler, body: Record<string, unknown>) {
 const output = {status: 200, body: {} as Record<string, any>};
 const res = {setHeader() {return res;}, status(n: number) {output.status=n; return res;}, json(body: Record<string, any>) {output.body=body; return res;}, end() {return res;}};
 await handler({method:'POST', body:{playerName, clan:clanName, ...body}, query:{}, headers:{'x-admin-password':process.env.ADMIN_PASSWORD}, socket:{remoteAddress:'127.0.0.89'}} as never, res as never);
 return output;
}
async function state() {
 return {clan: await kv.get<Record<string, any>>(clanKey), player: await kv.get<Record<string, any>>(playerKey)};
}
function interruptWrite(keyToFail: string, boundary: 'before' | 'after') {
 let hit=false;
 kv.set = async (key, value, options) => {
  if (key !== keyToFail || hit) return originalSet(key,value,options);
  hit=true;
  if (boundary === 'after') await originalSet(key,value,options);
  throw new Error(`injected ${boundary} write`);
 };
 kv.compareSet = async (key, expected, value, options) => {
  if (key !== keyToFail || hit) return originalCas(key,expected,value,options);
  hit=true;
  if (boundary === 'after') await originalCas(key,expected,value,options);
  throw new Error(`injected ${boundary} CAS acknowledgement`);
 };
 return () => {assert(hit, 'fault must reach the intended boundary'); kv.set=originalSet; kv.compareSet=originalCas;};
}

test('mission resumes a new-protocol interruption before shared credit, once', async () => {
 const restore=interruptWrite(clanKey,'before');
 const first=await post(mission,{missionKey:'battle'}); restore();
 assert(first.status >= 500);
 assert.equal((await state()).player!.character.clanPoints,4000, 'no personal credit before shared proof');
 time += 61_000;
 const retry=await post(mission,{missionKey:'battle'});
 assert.equal(retry.status,200);
 const paid=await state();
 assert.equal(paid.clan!.treasury.ryo,3500);
 assert(paid.clan!.xp > 0);
 assert.equal(paid.player!.character.clanPoints,4065);
 await post(mission,{missionKey:'battle'});
 assert.deepEqual(await state(),paid);
});

test('mission lost shared-write acknowledgement never credits the clan twice', async () => {
 const restore=interruptWrite(clanKey,'after');
 await post(mission,{missionKey:'battle'}); restore();
 time += 61_000;
 assert.equal((await post(mission,{missionKey:'battle'})).status,200);
 assert.equal((await state()).clan!.treasury.ryo,3500);
 assert.equal((await state()).player!.character.clanPoints,4065);
});

test('historical pending mission receipts cannot authorize another shared or personal grant', async () => {
 const {clanPointWeekKey}=await import('../_clan-points.js');
 const week=clanPointWeekKey(new Date(time));
 await kv.set(`clan:mission-claimed:recoveryclan:${week}:battle`, {version:4, state:'pending', ownerId:'old-owner', fingerprint:`clan-mission:recoveryclan:${week}:battle`, createdAt:time-120_000, leaseExpiresAt:time-60_000});
 const before=await state();
 const out=await post(mission,{missionKey:'battle'});
 assert(out.status >= 400, 'ambiguous old pending must not claim success');
 assert.deepEqual(await state(),before);
});

test('new mission receipt keeps personal credit once even after the display history is full', async () => {
 assert.equal((await post(mission,{missionKey:'battle'})).status,200);
 const saved=(await state()).player!;
 saved.character.clanPointHistory=Array.from({length:30},(_,i)=>({id:`later-${i}`,ts:time,amount:1}));
 await kv.set(playerKey,saved);
 const before=await state();
 assert.equal((await post(mission,{missionKey:'battle'})).status,200);
 assert.deepEqual(await state(),before);
});

for (const boundary of ['before','after'] as const) {
 test(`Exchange recovers ${boundary} clan credit without refunding an uncertain debit`, async () => {
  const id=requestId();
  const restore=interruptWrite(clanKey,boundary);
  await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id}); restore();
  assert.equal((await state()).player!.character.clanPoints,2250, 'a thrown acknowledgement is not refund proof');
  const retry=await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id});
  assert.equal(retry.status,200);
  const paid=await state();
  assert.equal(paid.clan!.treasury.warSupply,1510);
  assert.equal(paid.player!.character.clanPoints,2250);
  assert.equal(retry.body._saveVersion,paid.player!._saveVersion);
  const again=await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id});
  assert.equal(again.status,200);
  assert.deepEqual(await state(),paid);
 });
}

test('Exchange exact retry and two genuine purchases retain their distinct identity', async () => {
 const id=requestId();
 assert.equal((await post(exchange,{itemId:'warSupplyGrant',requestId:id})).status,200);
 assert.equal((await post(exchange,{itemId:'warSupplyGrant',requestId:id})).status,200);
 assert.equal((await state()).clan!.treasury.warSupply,510);
 assert.equal((await post(exchange,{itemId:'warSupplyGrant',requestId:requestId('b')})).status,200);
 assert.equal((await state()).clan!.treasury.warSupply,1010);
 assert.equal((await state()).player!.character.clanPoints,2500);
});

test('Exchange rejects reusing an intent for another item or clan', async () => {
 const id=requestId();
 assert.equal((await post(exchange,{itemId:'warSupplyGrant',requestId:id})).status,200);
 const before=await state();
 assert.equal((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id})).status,409);
 assert((await post(exchange,{itemId:'warSupplyGrant',requestId:id,clan:'Other Clan'})).status >= 400);
 assert.deepEqual(await state(),before);
});

test('Exchange still serves legacy callers without a request ID', async () => {
 assert.equal((await post(exchange,{itemId:'warSupplyGrant'})).status,200);
 assert.equal((await post(exchange,{itemId:'warSupplyGrant'})).status,200);
 assert.equal((await state()).clan!.treasury.warSupply,1010);
});

for (const boundary of ['before','after'] as const) test(`Exchange resumes ${boundary} its player debit`,async()=>{
 const id=requestId();
 const restore=interruptWrite(playerKey,boundary);
 await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id}); restore();
 assert.equal((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id})).status,200);
 assert.equal((await state()).player!.character.clanPoints,2250);
 assert.equal((await state()).clan!.treasury.warSupply,1510);
});

test('simultaneous Exchange retries settle once',async()=>{
 const body={itemId:'warSupplyGrant',requestId:requestId()};
 const results=await Promise.all([post(exchange,body),post(exchange,body),post(exchange,body)]);
 assert(results.every(result=>result.status===200));
 assert.equal((await state()).player!.character.clanPoints,3250);
 assert.equal((await state()).clan!.treasury.warSupply,510);
});

test('a suspended Exchange writer cannot overwrite a successor after its lock expires',{timeout:10000},async()=>{
 const body={itemId:'warSupplyGrant',requestId:requestId()};
 let release!:()=>void;
 let announce!:()=>void;
 const resumed=new Promise<void>(resolve=>{release=resolve;});
 const paused=new Promise<void>(resolve=>{announce=resolve;});
 let hit=false;
 kv.compareSet=async(key,expected,value,options)=>{
  if(key===playerKey&&!hit){hit=true;announce();await resumed;}
  return originalCas(key,expected,value,options);
 };
 const first=post(exchange,body);
 await paused;
 time+=6000;
 let second;
 try {second=await post(exchange,body);} finally {release();}
 assert.equal(second.status,200);
 assert.equal((await first).status,200);
 assert.equal((await state()).player!.character.clanPoints,3250);
 assert.equal((await state()).clan!.treasury.warSupply,510);
});

test('Exchange retry across weekly rollover uses the original debit and permits a genuinely new weekly purchase',async()=>{
 const id=requestId();
 const restore=interruptWrite(clanKey,'before');
 await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id}); restore();
 time+=8*86_400_000;
 assert.equal((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id})).status,200);
 assert.equal((await state()).player!.character.clanPoints,2250);
 assert.equal((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:requestId('b')})).status,200);
 assert.equal((await state()).clan!.treasury.warSupply,3010);
 assert.equal((await state()).player!.character.clanPoints,500);
});

test('expired and future Exchange request identities cannot authorize value',async()=>{
 const before=await state();
 for(const stamp of [time-91*86_400_000,time+120_000]){
  const out=await post(exchange,{itemId:'warSupplyGrant',requestId:`cex-${stamp}-${'d'.repeat(32)}`});
  assert(out.status>=400);
 }
 assert.deepEqual(await state(),before);
});

test('Exchange ignores forged price and reward fields and rejects a wrong actor before debit',async()=>{
 assert.equal((await post(exchange,{itemId:'warSupplyGrant',requestId:requestId(),cost:0,amount:999999,reward:{kind:'treasury',amount:999999}})).status,200);
 assert.equal((await state()).player!.character.clanPoints,3250);
 assert.equal((await state()).clan!.treasury.warSupply,510);
 assert.equal((await post(exchange,{playerName:'missingplayer',itemId:'warSupplyGrant',requestId:requestId('b')})).status,404);
});

test('a legacy Exchange caller resumes an interrupted debit without a new charge',async()=>{
 const restore=interruptWrite(clanKey,'before');
 await post(exchange,{itemId:'greaterWarSupplyGrant'}); restore();
 assert.equal((await post(exchange,{itemId:'greaterWarSupplyGrant'})).status,200);
 assert.equal((await state()).player!.character.clanPoints,2250);
 assert.equal((await state()).clan!.treasury.warSupply,1510);
});

test('mission point interruption retries the sealed contributor set even after contributions change',async()=>{
 const restore=interruptWrite(playerKey,'before');
 assert((await post(mission,{missionKey:'battle'})).status>=500); restore();
 const clan=(await state()).clan!;
 clan.members[0].battleContrib=0;
 await kv.set(clanKey,clan);
 assert.equal((await post(mission,{missionKey:'battle'})).status,200);
 assert.equal((await state()).player!.character.clanPoints,4065);
 assert.equal((await state()).clan!.treasury.ryo,3500);
});

test('new weekly mission claims remain distinct from prior-week receipts',async()=>{
 assert.equal((await post(mission,{missionKey:'battle'})).status,200);
 time+=7*86_400_000;
 assert.equal((await post(mission,{missionKey:'battle'})).status,200);
 assert.equal((await state()).player!.character.clanPoints,4130);
 assert.equal((await state()).clan!.treasury.ryo,6000);
});

test('a clan mission proof pre-seeded before the new field was protected cannot mint personal points',async()=>{
 const clan=(await state()).clan!;
 clan.clanMissionSettlements=[{key:'clan:mission-claimed:recoveryclan:2026-W38:battle',fingerprint:'clan-mission:recoveryclan:2026-W38:battle',weekKey:'2026-W38',missionKey:'battle',createdAt:time,clanXp:450,treasury:{ryo:2500},pointAmount:40,pointMembers:[playerName]}];
 await kv.set(clanKey,clan);
 const before=await state();
 assert((await post(mission,{missionKey:'battle'})).status>=400);
 assert.deepEqual(await state(),before);
});

test('a pre-seeded Exchange debit field without a server-minted journal cannot authorize treasury credit',async()=>{
 const {settlementFingerprint,settlementTransactionId}=await import('../_durable-settlement.js');
 const {CLAN_EXCHANGE_ITEMS}=await import('./_exchange.js');
 const id=requestId();
 const player=(await state()).player!;
 player.character.clanExchangeSettlements=[{requestId:id,transactionId:settlementTransactionId('clan-exchange',`${playerName}:${id}`),fingerprint:settlementFingerprint({playerName,clanSlug:'recoveryclan',itemId:'greaterWarSupplyGrant'}),clanSlug:'recoveryclan',createdAt:time,item:CLAN_EXCHANGE_ITEMS.find(item=>item.id==='greaterWarSupplyGrant'),purchaseCount:1,remaining:0}];
 await kv.set(playerKey,player);
 const before=await state();
 assert((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:id})).status>=400);
 assert.deepEqual(await state(),before);
});

test('an interrupted Exchange reservation revalidates the actual debit week without stranding future purchases',async()=>{
 const oldId=requestId();
 const restore=interruptWrite(playerKey,'before');
 assert((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:oldId})).status>=500); restore();
 assert.equal((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:requestId('b')})).status,200);
 assert.equal((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:oldId})).status,409);
 time+=7*86_400_000;
 assert.equal((await post(exchange,{itemId:'greaterWarSupplyGrant',requestId:oldId})).status,200);
 assert.equal((await state()).player!.character.clanPoints,500);
 assert.equal((await state()).clan!.treasury.warSupply,3010);
});

for(const tamper of ['token','reward'] as const) test(`Exchange refuses a ${tamper} mismatch against its private reservation`,async()=>{
 const id=requestId();
 const restore=interruptWrite(clanKey,'before');
 await post(exchange,{itemId:'warSupplyGrant',requestId:id}); restore();
 const player=(await state()).player!;
 const proof=player.character.clanExchangeSettlements[0];
 if(tamper==='token') proof.proofToken='invented-token';
 else proof.item.reward.amount=999999;
 await kv.set(playerKey,player);
 const before=await state();
 assert((await post(exchange,{itemId:'warSupplyGrant',requestId:id})).status>=400);
 assert.deepEqual(await state(),before);
});

for(const boundary of ['before','after'] as const) test(`Exchange recovers ${boundary} its final journal write without another debit or credit`,async()=>{
 const {durableSettlementKey,settlementTransactionId}=await import('../_durable-settlement.js');
 const id=requestId();
 const key=durableSettlementKey(settlementTransactionId('clan-exchange',`${playerName}:${id}`));
 let hit=false;
 kv.set=async(k,value,opts)=>{
  if(k!==key||(value as {state?:string})?.state!=='completed'||hit)return originalSet(k,value,opts);
  hit=true;
  if(boundary==='after')await originalSet(k,value,opts);
  throw new Error('injected final journal acknowledgement');
 };
 assert((await post(exchange,{itemId:'warSupplyGrant',requestId:id})).status>=500);
 assert(hit);kv.set=originalSet;
 const paid=await state();
 assert.equal((await post(exchange,{itemId:'warSupplyGrant',requestId:id})).status,200);
 assert.deepEqual(await state(),paid);
});

test('mission refuses a mismatched server owner before personal credit',async()=>{
 const restore=interruptWrite(playerKey,'before');
 await post(mission,{missionKey:'battle'});restore();
 const clan=(await state()).clan!;
 clan.clanMissionSettlements[0].ownerId='invented-owner';
 await kv.set(clanKey,clan);
 const before=await state();
 assert((await post(mission,{missionKey:'battle'})).status>=400);
 assert.deepEqual(await state(),before);
});

for(const boundary of ['before','after'] as const) test(`mission recovers ${boundary} its private reservation write`,async()=>{
 const key='clan:mission-claimed:recoveryclan:2026-W38:battle';
 const restore=interruptWrite(key,boundary);
 await post(mission,{missionKey:'battle'});restore();
 time+=61_000;
 assert.equal((await post(mission,{missionKey:'battle'})).status,200);
 assert.equal((await state()).clan!.treasury.ryo,3500);
 assert.equal((await state()).player!.character.clanPoints,4065);
});

for(const boundary of ['before','after'] as const) test(`mission recovers ${boundary} its final receipt commit`,async()=>{
 const key='clan:mission-claimed:recoveryclan:2026-W38:battle';
 let hit=false;
 kv.set=async(k,value,opts)=>{
  if(k!==key||(value as {state?:string})?.state!=='committed'||hit)return originalSet(k,value,opts);
  hit=true;
  if(boundary==='after')await originalSet(k,value,opts);
  throw new Error('injected final mission acknowledgement');
 };
 await post(mission,{missionKey:'battle'});
 assert(hit);kv.set=originalSet;
 const paid=await state();
 assert.equal((await post(mission,{missionKey:'battle'})).status,200);
 assert.deepEqual(await state(),paid);
});

test('simultaneous mission retries do not duplicate shared or personal value',async()=>{
 const results=await Promise.all([post(mission,{missionKey:'battle'}),post(mission,{missionKey:'battle'}),post(mission,{missionKey:'battle'})]);
 assert(results.every(result=>result.status===200));
 assert.equal((await state()).clan!.treasury.ryo,3500);
 assert.equal((await state()).player!.character.clanPoints,4065);
});

test('mission CAS fences a suspended shared writer after both lock and active receipt lease expire',{timeout:10000},async()=>{
 let release!:()=>void;
 let announce!:()=>void;
 const resumed=new Promise<void>(resolve=>{release=resolve;});
 const paused=new Promise<void>(resolve=>{announce=resolve;});
 let hit=false;
 kv.compareSet=async(key,expected,value,options)=>{
  if(key===clanKey&&!hit){hit=true;announce();await resumed;}
  return originalCas(key,expected,value,options);
 };
 const first=post(mission,{missionKey:'battle'});
 await paused;
 time+=61_000;
 let second;
 try {second=await post(mission,{missionKey:'battle'});} finally {release();}
 assert.equal(second.status,200);
 assert.equal((await first).status,200);
 assert.equal((await state()).clan!.treasury.ryo,3500);
 assert.equal((await state()).player!.character.clanPoints,4065);
});
