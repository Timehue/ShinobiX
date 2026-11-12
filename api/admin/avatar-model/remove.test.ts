import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';

async function fixture(name:string, state='render') {
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1',ENABLE_SECTOR_MODEL_DISPLAY:'1',
        SESSION_SECRET:'player-model-removal-test-session-secret',ADMIN_SESSION_SECRET:'admin-model-removal-separate-session-secret'});
    const {kv}=await import('../../_storage.js');
    const auth=await import('../../_auth.js');
    const handler=(await import('./remove.js')).default as unknown as (req:never,res:never)=>Promise<unknown>;
    const equip=(await import('../../avatar-model/equip.js')).default as unknown as typeof handler;
    const owner='removal'+name, prefix='avatar-model:',id=createHash('sha256').update(owner).digest('hex').slice(0,32);
    const accountId=randomUUID();
    await kv.set(prefix+'owner:'+accountId,{owner,id:accountId,state:'active',createdAt:1});
    const ref={assetId:id,version:'2'.repeat(64)},jobId='removal-active-'+name;
    const input={slug:owner,assetId:id,expectedVersion:ref.version,reason:'The generated outfit is unsuitable.',idempotencyKey:'remove-'+name};
    const asset={...ref,owner,accountId,status:'ready',sourceSha256:'3'.repeat(64),masterSha256:'4'.repeat(64),jobId:'finished-'+name};
    const job={slug:owner,accountId,state,monthKey:'2026-11',attempt:state==='queued'?0:1,assetId:'5'.repeat(32),revision:0,
        sourceSha256:'3'.repeat(64),masterSha256:'4'.repeat(64),reserved:[{provider:'modal',cycle:name,micros:300}],
        ...(state==='validate'?{finishedCall:'fc-finished',delivery:{...ref,bytes:100,objects:3},publishingAt:Date.now()}: {})};
    await kv.set('save:'+owner,{_saveVersion:1,character:{name:owner,level:10,ryo:100,bankRyo:0,fateShards:2,playerModel:ref,playerModelOwnerId:accountId}});
    await kv.set(prefix+'asset:'+id,asset);await kv.set(prefix+'revision:'+owner,0);
    await kv.set(prefix+'active:'+owner,jobId);await kv.set(prefix+'job:'+jobId,job);
    await kv.set(prefix+'slot:'+owner+':2026-11',{jobId,reservedAt:42});
    await kv.set(prefix+'budget:modal:'+name,{spentMicros:0,reservedMicros:300});
    await kv.set(prefix+'dispatch',state==='validate'?[]:[jobId]);await kv.set(prefix+'publish',state==='validate'?[jobId]:[]);
    await kv.del(prefix+'cleanup');
    const call=async(target:typeof handler,body:unknown,headers:Record<string,string>={})=>{
        let status=0;let json:Record<string,unknown>={};
        const response={setHeader(){},status(code:number){status=code;return response;},json(value:typeof json){json=value;},end(){}};
        await target({method:'POST',body,query:{},headers,socket:{remoteAddress:'127.0.0.1'}} as never,response as never);
        return {status,json};
    };
    const admin={'x-admin-token':auth.issueAdminToken('full')!};
    const content={'x-admin-token':auth.issueAdminToken('content')!};
    const player={'x-player-token':auth.issuePlayerToken(owner)!};
    return {kv,prefix,owner,id,ref,jobId,input,asset,job,admin,content,player,
        remove:(body:unknown=input,headers:Record<string,string>=admin)=>call(handler,body,headers),
        equip:()=>call(equip,{assetId:id},player)};
}

test('only verified full admins can revoke a current owned model with a reason',async()=>{
    const f=await fixture('auth');
    const credentials:Record<string,string>[]=[{},f.content,f.player,{'x-admin-token':'forged','x-player-token':f.player['x-player-token']}];
    for(const headers of credentials)
        assert.equal((await f.remove(f.input,headers)).status,403);
    for(const input of [{...f.input,actor:'admin:full'},{...f.input,reason:''},{...f.input,expectedVersion:'0'.repeat(64)},
        {...f.input,slug:'somebodyelse'}]) assert.ok([400,404,409].includes((await f.remove(input)).status));
    assert.equal((await f.kv.get<{status:string}>(f.prefix+'asset:'+f.id))?.status,'ready');
    assert.equal(await f.kv.get(f.prefix+'revision:'+f.owner),0);
    assert.equal(await f.kv.get(f.prefix+'cleanup'),null);
    assert.equal((await f.remove('{invalid-json')).status,400);
});

test('revocation clears self and peer presence, cancels the job, keeps the slot and audits once',async()=>{
    const f=await fixture('atomic');
    const key='save:'+f.owner;
    const saved=(await f.kv.get<{character:Record<string,unknown>}>(key))!;
    const second={assetId:'6'.repeat(32),version:'7'.repeat(64)};
    await f.kv.set(key,{...saved,character:{...saved.character,playerModelSlots:[f.ref,second]}});
    const {onlineStore}=await import('../../_realtime/online-store.js');
    const {offlineNoticesKey,parseOfflineNotices}=await import('../../player/_offline-notices.js');
    onlineStore.upsert({name:f.owner,sector:1,character:null,restoredPlayerModel:f.ref});
    const replies=await Promise.all([f.remove(),f.remove()]);
    assert.deepEqual(replies.map(r=>r.status),[200,200]);
    assert.deepEqual(replies.map(r=>r.json.replayed).sort(),[false,true]);
    const updated=(await f.kv.get<{character:Record<string,unknown>}>(key))!.character;
    assert.equal(updated.playerModel,undefined);
    assert.deepEqual(updated.playerModelSlots,[null,second]);
    assert.equal((await f.kv.get<{character:{ryo:number}}>('save:'+f.owner))?.character.ryo,100);
    assert.equal(onlineStore.get(f.owner)?.playerModel,undefined);
    assert.equal((await f.kv.get<{status:string}>(f.prefix+'asset:'+f.id))?.status,'revoked');
    assert.equal(await f.kv.get(f.prefix+'revision:'+f.owner),1);
    assert.equal((await f.kv.get<{state:string}>(f.prefix+'job:'+f.jobId))?.state,'cancelled');
    assert.equal(await f.kv.get(f.prefix+'active:'+f.owner),null);
    assert.ok((await f.kv.get<{usedAt:number}>(f.prefix+'slot:'+f.owner+':2026-11'))?.usedAt);
    assert.deepEqual(await f.kv.get(f.prefix+'dispatch'),[]);
    assert.deepEqual(await f.kv.get(f.prefix+'cleanup'),[f.id]);
    const removed=await f.kv.get<{removalReceipt:string}>(f.prefix+'asset:'+f.id);
    const audit=await f.kv.get<{actor:string;before:unknown;after:unknown}>(removed!.removalReceipt);
    assert.equal(audit?.actor,'admin:full');assert.deepEqual(audit.before,f.ref);assert.equal(audit.after,null);
    const snapshot=await f.kv.get('save:'+f.owner);
    assert.equal((await f.remove()).json.replayed,true);
    const notices=parseOfflineNotices(await f.kv.get(offlineNoticesKey(f.owner)));
    assert.equal(notices.length,1,'replaying removal cannot queue a second notice');
    assert.equal(notices[0].kind,'world-model-removed');
    assert.equal(notices[0].modelAccountId,f.asset.accountId);
    assert.equal(JSON.stringify(notices).includes(f.input.reason),false);
    assert.deepEqual(await f.kv.get('save:'+f.owner),snapshot);
    assert.equal((await f.remove({...f.input,reason:'A different reason.'})).status,409);
    assert.equal((await f.equip()).status,404);
    assert.deepEqual(await f.kv.get(f.prefix+'budget:modal:atomic'),{spentMicros:0,reservedMicros:300});
    const {endModelJob}=await import('../../avatar-model/_settlement.js');
    assert.equal(await endModelJob(f.jobId,f.owner,'moderator-removed'),'cancelled');
    assert.ok((await f.kv.get<{usedAt:number}>(f.prefix+'slot:'+f.owner+':2026-11'))?.usedAt);
    const cleanup=await f.kv.get<Record<string,unknown>>(f.prefix+'cleanup:'+f.id);
    await f.kv.set(f.prefix+'cleanup:'+f.id,{...cleanup,state:'complete'});
    assert.equal((await f.remove()).json.cleanupPending,false);
});

test('removal of an unclaimed job releases unused costs without returning the monthly slot',async()=>{
    const f=await fixture('unclaimed','queued');
    assert.equal((await f.remove()).status,200);
    assert.deepEqual(await f.kv.get(f.prefix+'budget:modal:unclaimed'),{spentMicros:0,reservedMicros:0});
    assert.deepEqual((await f.kv.get<{reserved:unknown[]}>(f.prefix+'job:'+f.jobId))?.reserved,[]);
    assert.ok((await f.kv.get<{usedAt:number}>(f.prefix+'slot:'+f.owner+':2026-11'))?.usedAt);
});

test('a late publication and concurrent equip cannot restore a revoked asset',async()=>{
    const f=await fixture('late','validate');
    const results=await Promise.all([f.remove(),f.equip()]);
    assert.equal(results[0].status,200);assert.ok([200,404].includes(results[1].status));
    const {publishSpriteJob}=await import('../../avatar-model/_dispatch.js');
    await publishSpriteJob(f.jobId,async()=>{throw Error('cancelled provider result cannot publish');});
    assert.equal((await f.kv.get<{status:string}>(f.prefix+'asset:'+f.id))?.status,'revoked');
    assert.equal((await f.kv.get<{character:{playerModel:unknown}}>('save:'+f.owner))?.character.playerModel,undefined);
    assert.deepEqual(await f.kv.get(f.prefix+'publish'),[]);
    const cleanup=await f.kv.get<{nextAttemptAt:number;createdAt:number}>(f.prefix+'cleanup:'+f.id);
    assert.equal(cleanup!.nextAttemptAt-cleanup!.createdAt,15*60_000);
});

test('a lost authority compare-and-set commits no partial revocation or audit',async t=>{
    const f=await fixture('collision');
    const batch=f.kv.compareSetMany!.bind(f.kv);
    t.mock.method(f.kv as typeof f.kv & {compareSetMany:typeof batch},'compareSetMany',async(ops:Parameters<typeof batch>[0])=>{
        if(ops.some(op=>op.key===f.prefix+'asset:'+f.id)) return false;
        return batch(ops);
    });
    assert.equal((await f.remove()).status,409);
    assert.equal((await f.kv.get<{status:string}>(f.prefix+'asset:'+f.id))?.status,'ready');
    assert.equal(await f.kv.get(f.prefix+'revision:'+f.owner),0);
    assert.equal(await f.kv.get(f.prefix+'active:'+f.owner),f.jobId);
    assert.equal(await f.kv.get(f.prefix+'cleanup:'+f.id),null);
    assert.equal(await f.kv.get('offline-notices:'+f.owner),null);
    assert.deepEqual((await f.kv.get<{character:{playerModel:unknown}}>('save:'+f.owner))?.character.playerModel,f.ref);
});
