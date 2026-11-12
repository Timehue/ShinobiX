import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ProviderReservation } from './_admission.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

async function costumeFixture() {
    const folder=process.env.AVATAR_MODEL_TEST_COSTUME;
    if (folder) {
        const [portrait,screened,sheet,painted,art]=await Promise.all(
            ['portrait.webp','screened.json','screened.png','fitted-master.json','candidate.png'].map(file=>readFile(join(folder,file))));
        return {portrait,screened,sheet,painted,art};
    }
    const portrait=Buffer.from('fixture portrait'), sheet=Buffer.from('screened garment'), art=Buffer.from('painted garment');
    const descriptor={version:1,templateSha256:'a'.repeat(64),fit:{template:'masked-collar-template.json',declined:null,
        style:'masked-pointed-ear-collar',sheetSha256:hash(sheet),sourceSha256:hash(portrait)}};
    return {portrait,sheet,art,screened:Buffer.from(JSON.stringify(descriptor)),painted:Buffer.from(JSON.stringify({
        ...descriptor,fit:{...descriptor.fit,sheetSha256:hash(art),paintingSha256:'b'.repeat(64)}}))};
}

test('confirmed jobs paint once, bind the replacement to the screened rig and render every style from it',async t=>{
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1',AVATAR_MODEL_CREATION_ENABLED:'1',
        AVATAR_MODEL_READ_DAILY_LIMIT:'3',AVATAR_MODEL_READ_PLAYER_DAILY_LIMIT:'1',AVATAR_MODEL_PAINTED_COSTUMES_ENABLED:'1',
        AVATAR_MODEL_R2_ACCOUNT_ID:'a'.repeat(32),AVATAR_MODEL_R2_PRIVATE_BUCKET:'test-private',
        AVATAR_MODEL_R2_ACCESS_KEY_ID:'fixture',AVATAR_MODEL_R2_SECRET_ACCESS_KEY:'fixture'});
    const {kv}=await import('../_storage.js');
    const {perImageKey}=await import('../images.js');
    const {admitModelJob}=await import('./_admission.js');
    const {checkPlayerPortrait}=await import('./read.js');
    const {advanceSpriteJob}=await import('./_dispatch.js');
    const {sealModelRead,storePaintedFit,readPrivateModelFile}=await import('./_private-files.js');
    const {portrait,screened,sheet,painted,art}=await costumeFixture();
    const {fit,templateSha256}=JSON.parse(screened.toString());
    const owner='paint-job-owner', prefix='avatar-model:';
    const files=new Map<string,Buffer>();
    t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
        const key=new URL(url).pathname;
        assert.ok(key.startsWith('/test-private/avatar-model/private/'));
        if(init.method==='PUT') {
            files.set(key,Buffer.from(await (init.body as Blob).arrayBuffer()));
            return new Response(null,{status:200});
        }
        return new Response(new Uint8Array(files.get(key)!));
    });
    await kv.set('save:'+owner,{character:{patreon:{active:true,source:'promo',tier:'supporter'}}});
    await kv.set(perImageKey('avatar:'+owner),'data:image/webp;base64,'+portrait.toString('base64'));
    const check=(paintedTemplate?:string)=>checkPlayerPortrait(owner,{moderate:async()=>hash(portrait),seal:sealModelRead,
        read:async()=>({status:'accepted',paintedCostumes:true,paintedTemplate,pipelineVersion:'1'.repeat(64),descriptor:screened.toString('base64'),
            sheet:sheet.toString('base64'),receipt:{style:fit.style,declined:null,sourceSha256:hash(portrait),
                fittedMasterSha256:hash(screened),sheetSha256:hash(sheet)}})});
    if (fit.template==='masked-collar-template.json') {
        await assert.rejects(check(),/Costume worker release unavailable/);
        assert.deepEqual(await kv.keys(prefix+'slot:*'),[]);
    }
    const screenedResult=await check(fit.template);
    assert.ok(screenedResult.readToken);
    const providers:ProviderReservation[]=[{provider:'modal',cycle:'cycle',limitMicros:30,perAttemptMicros:10}];
    const policy={enabled:true,dailyLimit:1,recognition:{model:'local-vision-fixture',poolSha256:'9'.repeat(64)},providers};
    const confirm=()=>admitModelJob(owner,screenedResult.readToken!,screenedResult.readToken!,policy);
    assert.deepEqual(await confirm(),{error:'budget'});
    assert.deepEqual(await kv.keys(prefix+'slot:*'),[]);
    providers.push({...providers[0],provider:'openai'});
    const job=await confirm(); assert.ok('jobId' in job);
    assert.deepEqual(await confirm(),job);
    const stages:string[]=[];
    let reviewed=0;
    let stores=0;
    const closure={moderate:async(data:Buffer)=>{assert.deepEqual(data,art); reviewed++; return hash(data);},
        store:async(meta:Buffer,pixels:Buffer,context:Parameters<typeof storePaintedFit>[2])=>{
            if (++stores===1) throw new Error('storage interrupted');
            return storePaintedFit(meta,pixels,context);
        }};
    const run:NonNullable<Parameters<typeof advanceSpriteJob>[2]>=async request=>{
        if (!request.callId) stages.push(request.stage);
        if (request.stage==='paint') {
            assert.equal(request.masterSha256,hash(screened));
            if (!request.callId) {
                assert.equal(request.portrait,portrait.toString('base64'));
                return {status:'pending',callId:'fc-art'};
            }
            return {status:'complete',callId:'fc-art',sheet:art.toString('base64'),descriptor:painted.toString('base64')};
        }
        assert.equal(request.masterSha256,hash(painted));
        assert.equal(request.descriptor,painted.toString('base64'));
        assert.equal(request.sheet,art.toString('base64'));
        return {status:'complete',callId:'fc-'+request.stage,movement:'f'.repeat(64)};
    };
    const tick=()=>advanceSpriteJob(job.jobId,policy,run,readPrivateModelFile,closure);
    await tick();
    await assert.rejects(tick(),/storage interrupted/);
    for(let n=0;n<4;n++) await tick();
    assert.equal(reviewed,1); assert.deepEqual(stages,['paint','A','B','C']);
    const saved=await kv.get<{originalMasterSha256:string;masterKey:string}>(prefix+'job:'+job.jobId);
    assert.equal(saved?.originalMasterSha256,hash(screened));
    assert.equal(saved.masterKey,'avatar-model/private/masters/'+hash(painted));
    assert.equal(JSON.parse(painted.toString()).templateSha256,templateSha256);
    assert.equal((await kv.keys(prefix+'slot:*')).length,1);
});

test('a rejected generated costume returns the slot and never enters animation',async()=>{
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'});
    const {kv}=await import('../_storage.js');
    const {perImageKey}=await import('../images.js');
    const {issueModelRead,admitModelJob}=await import('./_admission.js');
    const {advanceSpriteJob}=await import('./_dispatch.js');
    const {portrait,screened,painted,art}=await costumeFixture();
    const {templateSha256}=JSON.parse(screened.toString());
    const policy={enabled:true,dailyLimit:20,recognition:{model:'local-vision-fixture',poolSha256:'9'.repeat(64)},providers:(['modal','openai'] as const).map(provider=>({
        provider,cycle:'rejected',limitMicros:300,perAttemptMicros:10}))};
    for(const failure of ['wrong-rig','moderation','damaged','incomplete','lost']) {
        const owner='rejected-'+failure;
        await kv.set('save:'+owner,{character:{patreon:{active:true,source:'promo',tier:'supporter'}}});
        await kv.set(perImageKey('avatar:'+owner),'data:image/webp;base64,'+portrait.toString('base64'));
        const token=await issueModelRead({slug:owner,sourceSha256:hash(portrait),masterSha256:hash(screened),
            path:'A',kitVersion:templateSha256,pipelineVersion:'review',summary:'Field coat',paintCostume:true,
            revision:0,expiresAt:Date.now()+60000});
        const job=await admitModelJob(owner,token,token,policy); assert.ok('jobId' in job);
        let submissions=0,moderations=0;
        const descriptor=failure==='wrong-rig' ? Buffer.from(JSON.stringify({...JSON.parse(painted.toString()),templateSha256:'0'.repeat(64)})) : painted;
        const tick=()=>advanceSpriteJob(job.jobId,policy,async request=>{
            assert.equal(request.stage,'paint'); submissions++;
            if (failure==='lost') return {status:'unknown'};
            if (failure==='damaged') return {status:'invalid-art',callId:'fc-art'};
            if (failure==='incomplete') return {status:'complete',callId:'fc-art'};
            return {status:'complete',callId:'fc-art',descriptor:descriptor.toString('base64'),sheet:art.toString('base64')};
        },async kind=>kind==='portraits' ? portrait : screened,{moderate:async()=>{moderations++; return null;},
            store:async()=>{throw Error('rejected art reached private storage');}});
        await tick();
        if (failure==='lost') {
            const key='avatar-model:job:'+job.jobId;
            const waiting=await kv.get<{unknownSince:number;state:string}>(key);
            assert.equal(waiting?.state,'render'); assert.ok(waiting.unknownSince>0);
            await tick();
            assert.deepEqual(await kv.get(key),waiting);
            await kv.set(key,{...waiting,unknownSince:waiting.unknownSince-6*60*60_000});
            await tick();
        }
        await tick();
        assert.equal(submissions,failure==='lost'?3:1); assert.equal(moderations,failure==='moderation'?1:0);
        const saved=await kv.get<{state:string;monthKey:string;errorCode:string}>('avatar-model:job:'+job.jobId);
        assert.equal(saved?.state,'failed'); assert.equal(saved.errorCode,failure==='lost'?'provider-outage':'output-validation');
        assert.equal(await kv.get('avatar-model:slot:'+owner+':'+saved.monthKey),null);
    }
});
