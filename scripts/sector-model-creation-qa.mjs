// Boot the compiled game against local provider doubles and an audited player package.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.SHINOBIX_QA_MEMORY_KV, '1');
assert.equal(process.env.DISABLE_SCHEDULED_JOBS, '1');
const { modelCreationFixture } = await import('../dist/api/avatar-model/_creation-config.fixture.js');
const { DISABLE_SCHEDULED_JOBS: scheduled, ...settings } = modelCreationFixture;
const reservations = JSON.parse(settings.AVATAR_MODEL_RESERVATIONS_JSON);
for (const provider of reservations.providers) provider.limitMicros *= 3;
Object.assign(process.env, settings, {
    AVATAR_MODEL_PROFILE_DETAIL_ENABLED: '0',
    AVATAR_MODEL_PAINTED_COSTUMES_ENABLED: '0',
    AVATAR_MODEL_RESERVATIONS_JSON: JSON.stringify(reservations),
});

const packageRoot = resolve(process.env.SECTOR_MODEL_CREATION_QA);
const portrait = await readFile(resolve(process.env.SECTOR_MODEL_CREATION_PORTRAIT));
const evidence = resolve(process.env.SECTOR_MODEL_CREATION_EVIDENCE);
await mkdir(evidence, { recursive: true });
const sha = data => createHash('sha256').update(data).digest('hex');
const source = sha(portrait);
const descriptor = await readFile(join(packageRoot, 'fitted-master.json'));
const sheet = await readFile(join(packageRoot, 'candidate.png'));
const fit = JSON.parse(descriptor).fit;
const baked = JSON.parse(await readFile(join(packageRoot, 'result.json')));
assert.equal(fit.sourceSha256, source);
assert.equal(fit.sheetSha256, sha(sheet));
const { assetId: fixtureAsset, version } = baked.gameModel;
assert.match(fixtureAsset, /^[a-f0-9]{32}$/);
assert.match(version, /^[a-f0-9]{64}$/);
const art = join(packageRoot, 'sector-models', 'players', fixtureAsset);
let byteCount = 0;
async function readObject(file, extension) {
    assert.match(file, new RegExp(`^[a-f0-9]{64}\\.${extension}$`));
    const bytes = await readFile(join(art, file));
    assert.equal(sha(bytes), file.split('.')[0]);
    byteCount += bytes.length;
    return bytes;
}
const manifest = JSON.parse(await readObject(version + '.json', 'json'));
assert.equal(manifest.portraitSha256, source);
const indexes = new Set(Object.values(manifest.styles).flat());
const pages = new Set();
for (const file of indexes) {
    const bank = JSON.parse(gunzipSync(await readObject(file, 'gz')));
    for (const page of Object.values(bank.pages)) pages.add(page.file);
}
for (const file of pages) await readObject(file, '264');
if (manifest.battleSprite) await readObject(manifest.battleSprite, 'webp');
const objectCount = 1 + indexes.size + pages.size + Number(Boolean(manifest.battleSprite));
const master = sha(descriptor);
const raster = await sharp(portrait, { page: Math.floor(((await sharp(portrait).metadata()).pages ?? 1) / 2) })
    .autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const frameHash = createHash('sha256').update(raster.info.width + 'x' + raster.info.height + ':').update(raster.data).digest('hex');

const originalFetch = globalThis.fetch;
const objects = new Map();
const privateHost = settings.AVATAR_MODEL_R2_ACCOUNT_ID + '.r2.cloudflarestorage.com';
globalThis.fetch = async (input, options) => {
    const url = new URL(input.url ?? input);
    if (url.href === 'https://api.openai.com/v1/moderations') {
        const frame = JSON.parse(options.body).input[0].image_url.url;
        const bytes = Buffer.from(frame.split(',')[1], 'base64');
        assert.deepEqual(await sharp(bytes).raw().toBuffer(), raster.data);
        return Response.json({ results: [{ flagged: false }] });
    }
    if (url.hostname === privateHost) {
        assert.match(url.pathname, /^\/test-avatar-private\/avatar-model\/private\/(portraits|masters|sheets)\/[a-f0-9]{64}$/);
        if (options.method === 'PUT') {
            assert.equal(new Headers(options.headers).get('if-none-match'), '*');
            if (objects.has(url.pathname)) return new Response(null, { status: 412 });
            const data = Buffer.from(await options.body.arrayBuffer());
            assert.equal(sha(data), url.pathname.split('/').at(-1));
            objects.set(url.pathname, data);
            return new Response(null);
        }
        assert.equal(options.method, 'GET');
        const bytes = objects.get(url.pathname);
        return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
    }
    assert.ok(url.hostname === '127.0.0.1' || url.hostname === 'localhost', 'Unexpected outbound request in local QA');
    return originalFetch(input, options);
};

const operations = new Map();
const published = new Set();
function replyFor(script, request) {
    assert.equal(request.sourceSha256, source);
    if (script === 'dispatch_read.py') {
        assert.deepEqual(Buffer.from(request.portrait, 'base64'), portrait);
        assert.equal(request.frameHash, frameHash);
        return { status: 'accepted', pipelineVersion: sha(Buffer.from('local-intake')), receipt: {
            sourceSha256: source, fittedMasterSha256: master, sheetSha256: sha(sheet), style: fit.style, declined: null,
        }, descriptor: descriptor.toString('base64'), sheet: sheet.toString('base64') };
    }
    assert.equal(script, 'dispatch_stage.py');
    assert.equal(request.masterSha256, master);
    assert.match(request.assetId, /^[a-f0-9]{32}$/);
    assert.equal(request.attempt, 1);
    const { stage, assetId } = request;
    const stages = operations.get(assetId) ?? [];
    const model = { assetId, version, objects: objectCount, bytes: byteCount };
    if (stage === 'publish') {
        assert.deepEqual(stages, ['A', 'B', 'C', 'finish', 'recognize']);
        assert.deepEqual(request.model, model);
        assert.equal(request.callId, 'fc-finish' + assetId);
        assert.ok(!published.has(assetId), 'Publication ran twice');
        published.add(assetId);
        return { status: 'complete', callId: request.callId, model };
    }
    const callId = 'fc-' + stage + assetId;
    if (!request.callId) {
        assert.equal(stage, ['A', 'B', 'C', 'finish', 'recognize'][stages.length]);
        assert.deepEqual(Buffer.from(request.descriptor, 'base64'), descriptor);
        if (stage === 'recognize') assert.deepEqual(Buffer.from(request.portrait, 'base64'), portrait);
        else if (stage !== 'finish') assert.deepEqual(Buffer.from(request.sheet, 'base64'), sheet);
        operations.set(assetId, [...stages, stage]);
        return { status: 'pending', callId };
    }
    assert.equal(request.callId, callId);
    if (stage === 'finish') return { status: 'complete', callId, model };
    if (stage === 'recognize') {
        assert.deepEqual(request.model, model);
        return { status: 'complete', callId, recognitionReceipt: {
            version: 1, challengeSha256: '1'.repeat(64), replySha256: '2'.repeat(64),
            correct: 8, rounds: 8, passed: true, target: { assetId, version, sourceSha256: source },
            model: request.recognition.model, responseId: 'resp_local_fixture',
            usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
            masterSha256: master, poolSha256: request.recognition.poolSha256, nonce: request.recognition.nonce,
        } };
    }
    return { status: 'complete', callId, movement: sha(Buffer.from('local-motion')) };
}

const childProcess = createRequire(import.meta.url)('node:child_process');
const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
    if (command !== settings.AVATAR_MODEL_MODAL_PYTHON) return spawn(command, args, options);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough() });
    let request = '';
    child.stdin.setEncoding('utf8').on('data', chunk => { request += chunk; });
    child.stdin.on('end', () => {
        try {
            child.stdout.end(JSON.stringify(replyFor(basename(args[0]), JSON.parse(request))));
            child.emit('close', 0);
        } catch (error) {
            console.error('[model creation QA]', error);
            child.emit('error', error);
        }
    });
    return child;
};
syncBuiltinESMExports();

const { kv } = await import('../dist/api/_storage.js');
const { tickSpriteDispatch } = await import('../dist/api/avatar-model/_dispatch.js');
await import('../dist/server.js');
const health = await fetch('http://127.0.0.1:' + process.env.PORT + '/health');
assert.ok(health.ok);
process.env.DISABLE_SCHEDULED_JOBS = scheduled;

// The game dispatcher progresses on its own while the browser is closed.
const seen = new Map();
const recorded = new Set();
async function tick() {
    const ids = await kv.get('avatar-model:dispatch') ?? [];
    for (const id of ids) if (!seen.has(id)) seen.set(id, Date.now());
    if (ids.every(id => Date.now() - seen.get(id) > 2000)) await tickSpriteDispatch();
    for (const id of seen.keys()) {
        if (recorded.has(id)) continue;
        const job = await kv.get('avatar-model:job:' + id);
        if (job?.state !== 'ready') continue;
        assert.ok(published.has(job.assetId));
        assert.deepEqual(operations.get(job.assetId), ['A', 'B', 'C', 'finish', 'recognize']);
        assert.equal((await kv.get('avatar-model:slot:' + job.slug + ':' + job.monthKey)).jobId, id);
        await writeFile(join(evidence, id + '.json'), JSON.stringify({
            assetId: job.assetId, version, endedAt: job.endedAt, stages: operations.get(job.assetId),
        }));
        recorded.add(id);
    }
}
function schedule() {
    setTimeout(() => {
        void tick().then(schedule, error => {
            console.error('[model creation QA]', error);
            process.exit(1);
        });
    }, 200).unref();
}
schedule();
