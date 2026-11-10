import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { createProjector, MAX_INPUT } from './project.cjs';
import { childEnvironment, runChild } from './run.mjs';
const require = createRequire(import.meta.url);
const secret = 'FAKE_SECRET_CANARY_do_not_persist_7a13';
const send = x => 'SEND \u25ba ' + JSON.stringify(x);
const recv = x => '\u25c0 RECV ' + JSON.stringify(x);

test('strict projection never emits params, values, URLs, headers or arbitrary ID text', () => {
  const p = createProjector();
  const output = p.input('protocol', send({ id: 21, method: 'Runtime.callFunctionOn', pageProxyId: secret,
    params: { objectId: secret, contextId: secret, arguments: [{ objectId: secret }, {}, {}, { value: `() => '${secret}'` }],
      url: `https://example.invalid/?token=${secret}`, headers: { authorization: secret }, password: secret },
    error: { message: secret }, unknown: secret }));
  const text = JSON.stringify(output);
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes('example.invalid'));
  assert.equal(output.id, 21);
  assert.equal(output.pageProxyId, output.objectId);
  assert.equal(output.errorPresent, true);
  assert.match(output.code.fingerprint, /^[a-f0-9]{24}$/);
  assert.ok(p.stats.omittedFields > 0);
});

test('nested WebKit send/reply and contexts retain safe correlation and structure', () => {
  const p = createProjector();
  const request = p.input('protocol', send({ id: 11, pageProxyId: 'page', method: 'Target.sendMessageToTarget',
    params: { targetId: 'target', message: JSON.stringify({ id: 10, method: 'Runtime.evaluate', params: { contextId: 7, expression: secret } }) } }));
  const reply = p.input('protocol', recv({ method: 'Target.dispatchMessageFromTarget', pageProxyId: 'page', params: {
    targetId: 'target', message: JSON.stringify({ id: 10, result: { wasThrown: false, result: { objectId: 'handle', type: 'object', subtype: 'array', value: secret } } }) } }));
  assert.equal(request.inner.id, reply.inner.id);
  assert.equal(request.targetId, reply.targetId);
  assert.equal(reply.inner.response, true);
  assert.equal(reply.inner.resultSubtype, 'array');
  assert.ok(!JSON.stringify(reply).includes(secret));
  const context = p.input('protocol', recv({ method: 'Runtime.executionContextCreated', params: { context: { id: 7, type: 'normal', name: secret, frameId: 'frame' } } }));
  assert.equal(context.createdContext, request.inner.contextId);
  assert.equal(context.world, 'main');
});

test('malformed, oversized, truncated, unknown and hostile numeric fields fail closed', () => {
  const p = createProjector();
  assert.equal(p.input('protocol', `SEND \u25ba {${secret}`), null);
  assert.equal(p.input('protocol', 'x'.repeat(MAX_INPUT + 1)), null);
  assert.equal(p.input('protocol', 'SEND \u25ba { <<<<<( LOG TRUNCATED )>>>>> }'), null);
  const item = p.input('protocol', send({ id: secret, method: secret, params: { url: secret }, result: { result: { type: secret } } }));
  assert.deepEqual(item, { kind: 'protocol', direction: 'send', method: 'omitted', response: false, errorPresent: false });
  assert.equal(p.stats.malformed, 1);
  assert.equal(p.stats.oversized, 1);
  assert.equal(p.stats.upstreamTruncated, 1);
  assert.equal(p.stats.invalidId, 1);
});

test('browser projection admits only exact lifecycle grammar', () => {
  const p = createProjector();
  for (const line of [`<launching> ${secret}`, `[pid=12][err] ${secret}`, `<launched> pid=12 ${secret}`, secret]) assert.equal(p.input('browser', line), null);
  assert.deepEqual(p.input('browser', '<launched> pid=12'), { kind: 'browser', event: 'launched', browserPid: 12 });
  assert.equal(p.input('browser', '[pid=12] <process did exit: exitCode=null, signal=SIGKILL>').signal, 'SIGKILL');
  assert.equal(p.stats.browserOmitted, 4);
});

test('code roles distinguish selector, callback and probe without preserving code', () => {
  const p = createProjector();
  for (const [code, role] of [['function callMatchedElements(){injected.querySelectorAll()}', 'selector-dispatch'],
    ['() => ({matchState:1,centerHit:1})', 'pending-snapshot'], ['() => { utilityWorldRafProven; "frames-and-timer"; }', 'pending-raf-probe']]) {
    const result = p.input('protocol', send({ id: 1, method: 'Runtime.callFunctionOn', params: { arguments: [{}, {}, {}, { value: code + secret }] } }));
    assert.equal(result.code.role, role);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('child env excludes credentials/debug while preserving harness CI and runtime paths', () => {
  const env = childEnvironment({ CI: 'true', PATH: 'path', HOME: 'home', GITHUB_TOKEN: secret, NODE_OPTIONS: secret,
    DEBUG_FILE: secret, SECRET_KEY: secret, VITE_BUILD_COMMIT: 'sha', DISPLAY: ':99' });
  assert.deepEqual(env, { PATH: 'path', HOME: 'home', CI: 'true', VITE_BUILD_COMMIT: 'sha', DISPLAY: ':99' });
});

test('preload protects child pipes, records replies, preserves nonzero exit and bounded truncation', async () => {
  const root = process.cwd();
  // The CI workflow runs from the pinned source root, not from .diagnostic.
  const core = join(root, 'shinobij.client/node_modules/playwright-core/lib/coreBundle.js');
  require(core);
  const captureRoot = mkdtempSync(join(tmpdir(), 'safe-protocol-test-'));
  let output = '';
  const stream = new PassThrough(); stream.on('data', data => { output += data; });
  const script = `const logger=require(${JSON.stringify(core)}).utils.debugLogger;
    logger.log('protocol',${JSON.stringify(send({ id: 3, method: 'Runtime.evaluate', params: { expression: secret } }))});
    logger.log('protocol',${JSON.stringify(recv({ id: 3, result: { result: { value: secret, type: 'string' } } }))});
    logger.log('browser',${JSON.stringify('<launching> ' + secret)});
    logger.log('protocol','SEND \u25ba '+ 'x'.repeat(1048577));
    console.log('ordinary-output'); process.exitCode=7;`;
  const result = await runChild(process.execPath, ['-e', script], { sourceRoot: root, captureRoot, stdout: stream, stderr: stream });
  assert.equal(result.code, 7);
  assert.equal(output.trim(), 'ordinary-output');
  const text = readdirSync(captureRoot, { recursive: true, withFileTypes: true }).filter(x => x.isFile()).map(x => readFileSync(join(x.parentPath, x.name), 'utf8')).join('');
  assert.ok(!text.includes(secret));
  assert.match(text, /"oversized":1/);
  assert.match(text, /"response":true/);
});

test('capture deadline drops diagnostics without changing the child outcome or draining', async () => {
  const root = process.cwd();
  const core = join(root, 'shinobij.client/node_modules/playwright-core/lib/coreBundle.js');
  const captureRoot = mkdtempSync(join(tmpdir(), 'safe-protocol-deadline-'));
  const stream = new PassThrough(); stream.resume();
  const result = await runChild(process.execPath, ['-e', `require(${JSON.stringify(core)}).utils.debugLogger.log('protocol', ${JSON.stringify(send({ id: 1, method: 'Runtime.enable' }))}); console.log('drained'); process.exitCode=9;`], {
    sourceRoot: root, captureRoot, deadline: 0, stdout: stream, stderr: stream,
  });
  assert.equal(result.code, 9);
  const text = readdirSync(captureRoot, { recursive: true, withFileTypes: true }).filter(x => x.isFile()).map(x => readFileSync(join(x.parentPath, x.name), 'utf8')).join('');
  assert.match(text, /"timeDropped":1/);
});

test('tail rotates but preserves one late pending window and explicit loss metadata', async () => {
  const root = process.cwd();
  const core = join(root, 'shinobij.client/node_modules/playwright-core/lib/coreBundle.js');
  const captureRoot = mkdtempSync(join(tmpdir(), 'safe-protocol-ring-'));
  const stream = new PassThrough(); let output = '';
  stream.on('data', chunk => { output += chunk; });
  const marker = '[pending-click] ' + JSON.stringify({ event: 'pending', stage: 'choose-attacker', project: 'webkit-mobile', viewport: { width: 1366, height: 768 }, retry: 0 });
  const code = `const logger=require(${JSON.stringify(core)}).utils.debugLogger;
    for(let id=0;id<16000;id++) logger.log('protocol','SEND \u25ba '+JSON.stringify({id,method:'Runtime.evaluate',params:{expression:'1'}}));
    console.info(${JSON.stringify(marker)});
    for(let id=16000;id<24000;id++) logger.log('protocol','\u25c0 RECV '+JSON.stringify({id,result:{}}));
    console.info(${JSON.stringify(marker)});
    logger.log('protocol','SEND \u25ba {malformed'); process.exitCode=11;`;
  const result = await runChild(process.execPath, ['-e', code], { sourceRoot: root, captureRoot, stdout: stream, stderr: stream });
  assert.equal(result.code, 11);
  assert.equal(output.trim(), marker + '\n' + marker);
  const files = readdirSync(captureRoot, { recursive: true, withFileTypes: true }).filter(x => x.isFile()).map(x => join(x.parentPath, x.name));
  const summary = JSON.parse(readFileSync(files.find(x => x.endsWith('summary.json')), 'utf8'));
  assert.ok(summary.overwrittenBytes > 0);
  assert.ok(summary.segmentSizes.every(x => x <= 1024 * 1024));
  assert.ok(summary.targetBytes <= 2 * 1024 * 1024);
  assert.equal(files.filter(x => x.endsWith('pending-target.jsonl')).length, 1);
  const retained = readFileSync(files.find(x => x.endsWith('pending-target.jsonl')), 'utf8');
  assert.match(retained, /"kind":"pending-marker"/);
  assert.equal(retained.split('"kind":"pending-marker"').length - 1, 1);
  const tail = files.filter(x => /tail-[01]\.jsonl$/.test(x)).map(x => readFileSync(x, 'utf8')).join('');
  assert.match(tail, /"kind":"omission","reason":"malformed"/);
});

test('status-write failure does not change the child exit code', async () => {
  const captureRoot = mkdtempSync(join(tmpdir(), 'safe-protocol-status-'));
  const stream = new PassThrough(); let output = ''; stream.on('data', chunk => { output += chunk; });
  const result = await runChild(process.execPath, ['-e', `require('fs').mkdirSync(require('path').join(process.env.PW_CAPTURE_ROOT,'child-status.json')); process.exitCode=17;`], {
    sourceRoot: process.cwd(), captureRoot, stdout: stream, stderr: stream,
  });
  assert.equal(result.code, 17);
  assert.match(output, /status-write-failed/);
});

test('capture allocation failure leaves console behavior and child failure unchanged', async () => {
  const captureRoot = mkdtempSync(join(tmpdir(), 'safe-protocol-slots-'));
  const core = join(process.cwd(), 'shinobij.client/node_modules/playwright-core/lib/coreBundle.js');
  const stream = new PassThrough(); let output = ''; stream.on('data', chunk => { output += chunk; });
  const marker = '[pending-click] ' + JSON.stringify({ event: 'pending', stage: 'snare-pass', project: 'webkit-mobile', viewport: { width: 1366, height: 768 }, retry: 0 });
  const code = `const fs=require('fs'),path=require('path'); for(let i=0;i<64;i++) fs.mkdirSync(path.join(process.env.PW_CAPTURE_ROOT,'capture-'+i));
    require(${JSON.stringify(core)}).utils.debugLogger.log('browser','<launched> pid=1');
    if(console.info(${JSON.stringify(marker)})!==undefined) process.exitCode=99; else process.exitCode=19;`;
  const result = await runChild(process.execPath, ['-e', code], { sourceRoot: process.cwd(), captureRoot, stdout: stream, stderr: stream });
  assert.equal(result.code, 19);
  assert.ok(output.startsWith(marker));
  assert.match(output, /"slotMissing":true/);
});

test('a timed-out child retains its nonzero timeout exit', async () => {
  const captureRoot = mkdtempSync(join(tmpdir(), 'safe-protocol-timeout-'));
  const stream = new PassThrough(); stream.resume();
  const result = await runChild(process.execPath, ['-e', 'setTimeout(()=>process.exit(124),40)'], {
    sourceRoot: process.cwd(), captureRoot, stdout: stream, stderr: stream,
  });
  assert.equal(result.code, 124);
});

test('POSIX signal outcome is retained', { skip: process.platform === 'win32' }, async () => {
  const captureRoot = mkdtempSync(join(tmpdir(), 'safe-protocol-signal-'));
  const stream = new PassThrough(); stream.resume();
  const result = await runChild(process.execPath, ['-e', "setTimeout(()=>process.kill(process.pid,'SIGTERM'),40)"], {
    sourceRoot: process.cwd(), captureRoot, stdout: stream, stderr: stream,
  });
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(result.code, null);
});
