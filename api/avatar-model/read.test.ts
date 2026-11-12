import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { modelCreationFixture } from './_creation-config.fixture.js';

test('one saved portrait flows through screening, monthly admission, background publication and equip', async t => {
    Object.assign(process.env, modelCreationFixture, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1',
        SESSION_SECRET: 'local-portrait-screen-test-session-secret' });
    const { kv } = await import('../_storage.js');
    const { perImageKey } = await import('../images.js');
    const { checkPlayerPortrait, default: handler } = await import('./read.js');
    const readHandler = handler as unknown as (req: never, res: never) => Promise<unknown>;
    const { issuePlayerToken } = await import('../_auth.js');
    const { moderateModelPortrait, modelModalEnvironment } = await import('./_read-provider.js');
    const { admitModelJob, modelCreationPolicy } = await import('./_admission.js');
    const { sealModelRead } = await import('./_private-files.js');
    const { advanceSpriteJob, publishSpriteJob } = await import('./_dispatch.js');
    const source = await sharp({create:{width:32,height:32,channels:3,background:'#abc'}}).png().toBuffer();
    const image = 'data:image/png;base64,' + source.toString('base64');
    const sha = (b:Buffer)=>createHash('sha256').update(b).digest('hex');
    const sheet = Buffer.from('verified worker sheet');
    const descriptor = Buffer.from(JSON.stringify({ version:1, templateSha256:'d'.repeat(64),
        fit:{style:'hooded-jacket', sourceSha256:sha(source), sheetSha256:sha(sheet), declined:null} }));
    let flagged = true, calls = 0, reads = 0;
    const privateObjects = new Map<string, Uint8Array>();
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
        const parsed = new URL(url);
        if (parsed.hostname === modelCreationFixture.AVATAR_MODEL_R2_ACCOUNT_ID + '.r2.cloudflarestorage.com') {
            const path = parsed.pathname;
            assert.match(path, /^\/test-avatar-private\/avatar-model\/private\/(portraits|masters|sheets)\/[a-f0-9]{64}$/);
            if (init.method === 'PUT') {
                assert.equal(new Headers(init.headers).get('if-none-match'), '*');
                if (privateObjects.has(path)) return new Response(null, {status:412});
                privateObjects.set(path, new Uint8Array(await (init.body as Blob).arrayBuffer()));
                return new Response(null, {status:200});
            }
            assert.equal(init.method, 'GET');
            const bytes = privateObjects.get(path);
            return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, {status:404});
        }
        assert.equal(url, 'https://api.openai.com/v1/moderations');
        assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + modelCreationFixture.AVATAR_MODEL_OPENAI_API_KEY);
        const payload = JSON.parse(String(init.body));
        const frame = Buffer.from(payload.input[0].image_url.url.split(',')[1], 'base64');
        assert.equal((await sharp(frame).metadata()).width,32);
        calls++;
        return Response.json({results:[{flagged}]});
    });
    const operations = new Set<string>();
    const ports = { moderate:moderateModelPortrait, seal:sealModelRead, read:async(operation:string, digest:string, raw:Buffer) => {
        reads++;
        operations.add(operation);
        assert.equal(digest,sha(source)); assert.deepEqual(raw,source);
        if (reads === 1) return {status:'pending' as const};
        return {status:'accepted' as const, pipelineVersion:'e'.repeat(64), descriptor:descriptor.toString('base64'),
            sheet:sheet.toString('base64'), receipt:{declined:null, sourceSha256:digest, style:'hooded-jacket',
                fittedMasterSha256:sha(descriptor), sheetSha256:sha(sheet)}};
    }};
    const policy = modelCreationPolicy();
    async function prepare(owner:string, displayName = owner) {
        await kv.set('save:'+owner,{character:{name:displayName,patreon:{active:true,source:'promo',tier:'supporter'}}});
        await kv.set(perImageKey('avatar:'+displayName.toLowerCase()),image);
    }
    assert.equal((await checkPlayerPortrait('visitor',ports)).error,'entitlement');
    await prepare('declined'); await prepare('accepted','Ac Cepted');
    let status = 0;
    let body: unknown;
    const res = { setHeader() {}, status(code: number) { status = code; return res; }, json(value: unknown) { body = value; } };
    for (const name of ['AVATAR_MODEL_R2_PUBLIC_SECRET_ACCESS_KEY', 'AVATAR_MODEL_OPENAI_API_KEY', 'AVATAR_MODEL_MODAL_TOKEN_SECRET'] as const) {
        delete process.env[name];
        await readHandler({ method: 'POST', body: {}, headers: { 'x-player-token': issuePlayerToken('accepted') } } as never, res as never);
        assert.deepEqual({ status, body }, { status: 503, body: { error: 'disabled' } });
        process.env[name] = modelCreationFixture[name];
    }
    assert.equal(calls, 0);
    assert.deepEqual(await kv.keys('avatar-model:read-day:*'), []);
    process.env.MODAL_TOKEN_ID = 'unrelated-token-id';
    process.env.MODAL_OAUTH_REFRESH_TOKEN = 'unrelated-oauth-token';
    const workerEnv = modelModalEnvironment();
    assert.equal(workerEnv.MODAL_TOKEN_ID, modelCreationFixture.AVATAR_MODEL_MODAL_TOKEN_ID);
    assert.equal(workerEnv.MODAL_TOKEN_SECRET, modelCreationFixture.AVATAR_MODEL_MODAL_TOKEN_SECRET);
    assert.equal(workerEnv.MODAL_OAUTH_REFRESH_TOKEN, undefined);
    assert.equal(process.env.MODAL_TOKEN_ID, 'unrelated-token-id');
    assert.equal((await checkPlayerPortrait('declined',ports)).state,'declined');
    assert.equal((await checkPlayerPortrait('declined',ports)).state,'declined');
    assert.equal(calls,1); assert.equal(reads,0);
    assert.deepEqual(await kv.keys('avatar-model:slot:*'),[]);
    flagged=false;
    assert.equal((await checkPlayerPortrait('accepted',ports)).state,'pending');
    const accepted = await checkPlayerPortrait('accepted',ports);
    assert.ok(accepted.readToken);
    assert.deepEqual(await checkPlayerPortrait('accepted',ports),accepted);
    assert.equal(calls,2); assert.equal(reads,2); assert.equal(operations.size,1);
    assert.deepEqual(await kv.keys('avatar-model:slot:*'),[]);
    const changed = 'data:image/png;base64,'+Buffer.from('different portrait').toString('base64');
    await kv.set(perImageKey('avatar:accepted'),image);
    await kv.set(perImageKey('avatar:ac cepted'),changed);
    assert.equal((await checkPlayerPortrait('accepted',ports)).error,'limit');
    assert.deepEqual(await admitModelJob('accepted',accepted.readToken,accepted.readToken,policy),{error:'read-expired'});
    await kv.set(perImageKey('avatar:ac cepted'),image);
    const jobs = (await import('./jobs.js')).default as unknown as typeof readHandler;
    const readToken = accepted.readToken;
    await jobs({method:'POST', headers:{'x-player-token':issuePlayerToken('accepted')},
        body:{readToken,idempotencyKey:readToken}} as never,res as never);
    assert.equal(status,202);
    const result = body as {jobId:string};
    assert.ok(result.jobId);
    assert.deepEqual(await admitModelJob('accepted',accepted.readToken,accepted.readToken,policy),result);
    assert.equal((await checkPlayerPortrait('accepted',ports)).error,'quota');
    assert.equal((await kv.keys('avatar-model:slot:*')).length,1);
    assert.equal(privateObjects.size,3);

    const library = (await import('./models.js')).default as unknown as typeof readHandler;
    const equip = (await import('./equip.js')).default as unknown as typeof readHandler;
    const openLibrary = async () => {
        await library({method:'GET',headers:{'x-player-token':issuePlayerToken('accepted')},query:{}} as never,res as never);
        assert.equal(status,200);
        return body as {models:{assetId:string;version:string;month:string}[];pending?:{id:string;state:string}};
    };
    const queued = await openLibrary();
    assert.equal(queued.pending?.id,result.jobId);
    assert.equal(queued.pending?.state,'queued');
    assert.deepEqual(queued.models,[]);

    const stages:string[] = [], version = 'f'.repeat(64), movement = '7'.repeat(64);
    // No player request is needed between dispatch and publication.
    for (let tick=0;tick<10;tick++) await advanceSpriteJob(result.jobId,policy,async request=>{
        const {stage,assetId,recognition} = request;
        const callId = 'fc-' + stage;
        if (!request.callId) {
            stages.push(stage);
            assert.deepEqual(Buffer.from(request.descriptor!,'base64'),descriptor);
            if (stage==='A' || stage==='B' || stage==='C') assert.deepEqual(Buffer.from(request.sheet!,'base64'),sheet);
            if (stage==='recognize') assert.deepEqual(Buffer.from(request.portrait!,'base64'),source);
            return {status:'pending',callId};
        }
        if (stage==='recognize') return {status:'complete',callId,recognitionReceipt:{
            version:1,challengeSha256:'1'.repeat(64),replySha256:'2'.repeat(64),correct:8,rounds:8,passed:true,
            target:{assetId,version,sourceSha256:sha(source)},model:recognition!.model,
            responseId:'resp_staging_fixture',usage:{input_tokens:100,output_tokens:10,total_tokens:110},
            masterSha256:sha(descriptor),poolSha256:recognition!.poolSha256,nonce:recognition!.nonce}};
        if (stage==='finish') return {status:'complete',callId,model:{assetId,version,objects:317,bytes:5432100}};
        return {status:'complete',callId,movement};
    });
    assert.deepEqual(stages,['A','B','C','finish','recognize']);
    assert.deepEqual(await kv.get('avatar-model:publish'),[result.jobId]);
    await publishSpriteJob(result.jobId,async request=>({status:'complete',callId:request.callId!,model:request.model}));
    const ready = await openLibrary();
    assert.equal(ready.pending,undefined);
    assert.equal(ready.models.length,1);
    const {assetId} = ready.models[0];
    assert.equal(ready.models[0].version,version);
    await equip({method:'POST',headers:{'x-player-token':issuePlayerToken('accepted')},query:{},
        body:{assetId}} as never,res as never);
    assert.equal(status,200);
    assert.deepEqual((body as {playerModel:unknown}).playerModel,{assetId,version});
    assert.deepEqual((await kv.get<{character:{playerModel:unknown}}>('save:accepted'))?.character.playerModel,{assetId,version});
});
