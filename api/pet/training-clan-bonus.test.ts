import assert from 'node:assert/strict';
import {before, test} from 'node:test';
process.env.NODE_ENV='test';
process.env.SHINOBIX_QA_MEMORY_KV='1';
process.env.ADMIN_PASSWORD='pet-training-bonus-memory-only';
delete process.env.SESSION_SECRET;
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let migration: number;
before(async()=>{
 ({kv}=await import('../_storage.js'));
 handler=(await import('./progress.js')).default as unknown as typeof handler;
 migration=(await import('./_owned-pet.js')).PET_BREEDING_MIGRATION_VERSION;
});
async function training(benefits: Record<string, unknown>, petPatch: Record<string, unknown>={}, action='start-training') {
 const now=Date.now();
 const character={name:'bonuspet',level:50,petBreedingMigrationVersion:migration,pets:[{id:'bonus-pet',name:'Fang',rarity:'standard',level:20,maxLevel:100,xp:0,happiness:100,happinessDay:Math.floor(now/86_400_000),hp:500,attack:40,defense:40,speed:40,jutsus:[],...petPatch}],activePetId:'bonus-pet',...benefits};
 await kv.set('save:bonuspet',{_saveVersion:1,character});
 let status=200;
 const res={setHeader(){return res;},status(n:number){status=n;return res;},json(){return res;},end(){return res;}};
 await handler({method:'POST',body:{playerName:'bonuspet',petId:'bonus-pet',action,focus:'bond',durationMs:14_400_000},query:{},headers:{'x-admin-password':process.env.ADMIN_PASSWORD},socket:{remoteAddress:'127.0.0.88'}} as never,res as never);
 return {status,record:await kv.get<Record<string,any>>('save:bonuspet')};
}
for (const [label, benefits, expected] of [
 ['baseline',{},460],
 ['Pet Den 50',{clan:'Bonus Clan',clanUpgradeLevels:{petDen:50}},529],
 ['Pet Yard 50',{villageUpgrades:{petYard:50}},Math.round(400 * 1.15 * 1.125)],
 ['both bonuses',{clan:'Bonus Clan',clanUpgradeLevels:{petDen:50},villageUpgrades:{petYard:50}},Math.round(400 * 1.15 * 1.275)],
 ['stale nonmember mirror',{clanUpgradeLevels:{petDen:50}},460],
 ['capped levels',{clan:'Bonus Clan',clanUpgradeLevels:{petDen:500},villageUpgrades:{petYard:500}},Math.round(400 * 1.15 * 1.275)],
] as const) test(`new training applies ${label} without changing its duration`,async()=>{
 const {status,record}=await training(benefits);
 assert.equal(status,200);
 assert.equal(record!.character.pets[0].training.sealedXp,expected);
 assert.equal(record!.character.pets[0].training.durationMs,14_400_000);
});
test('bonuses add to mastery before Loyal and happiness multiplication',async()=>{
 const {status,record}=await training({clan:'Bonus Clan',clanUpgradeLevels:{petDen:50},villageUpgrades:{petYard:50},profession:'petTamer',masterySpec:{'train-xp':3}},{trait:'Loyal'});
 assert.equal(status,200);
 assert.equal(record!.character.pets[0].training.sealedXp,1004);
});
test('finishing an existing session pays its sealed amount without recalculation',async()=>{
 const {status,record}=await training({clan:'Bonus Clan',clanUpgradeLevels:{petDen:50},villageUpgrades:{petYard:50}},{training:{type:'bond',startedAt:Date.now()-20_000,endsAt:Date.now()-1_000,durationMs:900_000,sealedXp:123}},'complete-training');
 assert.equal(status,200);
 assert.equal(record!.character.pets[0].xp,123);
 assert.equal(record!.character.pets[0].training,undefined);
});
