import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

test('Profile publishes a small avatar and Make Model moderates its private detail', async t => {
    Object.assign(process.env,{NODE_ENV:'test', SHINOBIX_QA_MEMORY_KV:'1', SESSION_SECRET:'local-profile-detail-secret',
        AVATAR_MODEL_PROFILE_DETAIL_ENABLED:'1', AVATAR_MODEL_CREATION_ENABLED:'1', AVATAR_MODEL_READ_DAILY_LIMIT:'6',
        AVATAR_MODEL_READ_PLAYER_DAILY_LIMIT:'6', AVATAR_MODEL_R2_ACCOUNT_ID:'a'.repeat(32),
        AVATAR_MODEL_R2_PRIVATE_BUCKET:'test-private', AVATAR_MODEL_R2_ACCESS_KEY_ID:'test-id', AVATAR_MODEL_R2_SECRET_ACCESS_KEY:'test-secret'});
    const {kv} = await import('../_storage.js');
    const {issuePlayerToken} = await import('../_auth.js');
    const {perImageKey} = await import('../images.js');
    const {matchingProfileDetail,eraseProfileDetail,profileDigest} = await import('./_profile-detail.js');
    const {checkPlayerPortrait} = await import('./read.js');
    const {admitModelJob,issueModelRead} = await import('./_admission.js');
    const upload = (await import('./profile-portrait.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const owner = 'silverreed';
    await kv.set('save:'+owner,{character:{name:'Silver Reed',patreon:{active:true,source:'promo',tier:'supporter'}}});
    const objects = new Map<string,Buffer>();
    let failPut = false;
    t.mock.method(globalThis,'fetch',async (input: string,init:RequestInit) => {
        const path = new URL(input).pathname;
        assert.match(path,/^\/test-private\/avatar-model\/private\/profile-detail\/[a-f0-9]{64}$/);
        if (init.method === 'PUT') {
            if (failPut) return new Response(null,{status:503});
            objects.set(path,Buffer.from(await (init.body as Blob).arrayBuffer()));
        }
        if (init.method === 'DELETE') objects.delete(path);
        return new Response(init.method === 'GET' ? new Uint8Array(objects.get(path)!) : null);
    });
    async function send(bytes: Buffer, player=owner) {
        let status=0, result:{image?:string}={};
        const res={setHeader(){},status(s:number){status=s;return res;},json(body:typeof result){result=body;return res;},end(){return res;}};
        await upload({method:'POST',headers:{'x-player-token':issuePlayerToken(player)},query:{},
            body:{image:'data:image/webp;base64,'+bytes.toString('base64')}} as never,res as never);
        return {status,...result};
    }
    const portrait = (color:string)=>sharp({create:{width:1024,height:640,channels:3,background:color}}).webp().toBuffer();
    const a=await portrait('#783d76'), b=await portrait('#956c43'), c=await portrait('#24376f');
    assert.equal((await send(a,'another')).status,403);
    assert.equal((await send(Buffer.from('invalid'))).status,400);
    const first=await send(a);
    assert.equal(first.status,200);
    assert.equal(await kv.get(perImageKey('avatar:silver reed')),first.image);
    const publicBytes=Buffer.from(first.image!.split(',')[1],'base64');
    const thumb=profileDigest(publicBytes);
    assert.equal((await sharp(publicBytes).metadata()).width,256);
    assert.deepEqual(await matchingProfileDetail(owner,thumb),a);
    assert.equal(await matchingProfileDetail('another',thumb),null);
    let moderated=false;
    await checkPlayerPortrait(owner,{
        moderate:async bytes=>{assert.deepEqual(bytes,a);moderated=true;return null;},
        read:async()=>{throw Error('Moderation declined');},seal:async()=>{throw Error('Unexpected seal');},
    });
    assert.ok(moderated);
    const token=await issueModelRead({slug:owner,sourceSha256:profileDigest(a),profileSha256:thumb,masterSha256:'d'.repeat(64),
        pipelineVersion:'local',kitVersion:'local',summary:'Local fixture',path:'A',revision:0,expiresAt:Date.now()+30000});
    failPut=true;
    assert.equal((await send(b)).status,500);
    assert.equal(await kv.get(perImageKey('avatar:silver reed')),first.image);
    assert.deepEqual(await matchingProfileDetail(owner,thumb),a);
    failPut=false;
    assert.equal((await send(b)).status,200);
    assert.deepEqual(await admitModelJob(owner,token,'local-request',{recognition:{model:'local-vision-fixture',poolSha256:'9'.repeat(64)},enabled:true,dailyLimit:2,
        providers:(['modal','openai'] as const).map(provider=>({provider,cycle:'review',limitMicros:6,perAttemptMicros:1}))}),{error:'read-expired'});
    assert.equal((await send(c)).status,200);
    assert.equal(objects.size,2);
    const sheet=Buffer.from('verified clothing sheet');
    const descriptor=Buffer.from(JSON.stringify({templateSha256:'c'.repeat(64),fit:{style:'hooded-jacket'}}));
    const ready=await checkPlayerPortrait(owner,{
        moderate:async bytes=>{assert.deepEqual(bytes,c);return profileDigest(bytes);},
        read:async(_operation,source,bytes)=>{
            assert.deepEqual(bytes,c);
            return {status:'accepted',pipelineVersion:'e'.repeat(64),descriptor:descriptor.toString('base64'),
                sheet:sheet.toString('base64'),receipt:{declined:null,style:'hooded-jacket',sourceSha256:source,
                    fittedMasterSha256:profileDigest(descriptor),sheetSha256:profileDigest(sheet)}};
        },seal:async(read,bytes)=>{
            assert.deepEqual(bytes,c);
            assert.equal(read.sourceSha256,profileDigest(c));
            const publicImage=await kv.get<string>(perImageKey('avatar:silver reed'));
            assert.equal(read.profileSha256,profileDigest(Buffer.from(publicImage!.split(',')[1],'base64')));
            return issueModelRead(read);
        },
    });
    assert.ok(ready.readToken);
    const admission=await admitModelJob(owner,ready.readToken,'current-request',{recognition:{model:'local-vision-fixture',poolSha256:'9'.repeat(64)},enabled:true,dailyLimit:2,
        providers:(['modal','openai'] as const).map(provider=>({provider,cycle:'review',limitMicros:6,perAttemptMicros:1}))});
    assert.ok('jobId' in admission);
    const job=await kv.get<{sourceSha256:string;sourceKey:string}>('avatar-model:job:'+admission.jobId);
    assert.equal(job?.sourceKey,'avatar-model/private/portraits/'+profileDigest(c));
    await eraseProfileDetail(owner);
    assert.equal(objects.size,0);
    assert.equal(await kv.get('avatar-model:profile-detail:'+owner),null);
});
