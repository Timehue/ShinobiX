import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { runChild } from './run.mjs';
const require = createRequire(import.meta.url);
const root = process.cwd();
const parent = resolve(root, '.ci-evidence/webkit-protocol-local');
mkdirSync(parent, { recursive: true });
const output = mkdtempSync(join(parent, 'browser-smoke-'));
const core = resolve(root, 'shinobij.client/node_modules/playwright-core/lib/coreBundle.js');
const testEntry = resolve(root, 'shinobij.client/node_modules/@playwright/test/index.js');
const cli = resolve(root, 'shinobij.client/node_modules/@playwright/test/cli.js');
const canary = 'FAKE_PROTOCOL_SMOKE_CANARY_69e13c';
const captureRoot = join(output, 'capture');
const rawFile = join(output, 'forbidden-debug-file.txt');
// Two tests on two actual Playwright workers verify startup/preload/IPC wiring.
const spec = `const {test,expect}=require(${JSON.stringify(testEntry)});
const logger=require(${JSON.stringify(core)}).utils.debugLogger;
const canary=Buffer.from(${JSON.stringify(Buffer.from(canary).toString('hex'))},'hex').toString();
for(const number of [1,2]) test('safe worker '+number,async({page})=>{
  logger.log('protocol','SEND '+String.fromCharCode(0x25ba)+' '+JSON.stringify({id:900000+number,method:'Runtime.evaluate',params:{expression:canary,url:'https://example.invalid/?secret='+canary}}));
  logger.log('browser','<launching> '+canary);
  await page.setContent('<button>safe button</button>');
  await page.getByRole('button').click();
  console.info('[pending-click] '+JSON.stringify({event:'pending',stage:'snare-pass',project:'webkit-mobile',viewport:{width:1366,height:768},retry:0}));
  const snapshot=await page.getByRole('button').evaluateAll(elements=>({matchState:elements.length,centerHit:true}));
  expect(snapshot.matchState).toBe(1);
  await page.evaluate(()=>({utilityWorldRafProven:false,done:'frames-and-timer'}));
});`;
writeFileSync(join(output, 'smoke.spec.cjs'), spec);
writeFileSync(join(output, 'playwright.config.cjs'), `module.exports={testDir:${JSON.stringify(output)},testMatch:'smoke.spec.cjs',fullyParallel:true,workers:2,retries:0,timeout:30000,reporter:[['line'],['html',{outputFolder:${JSON.stringify(join(output, 'report'))},open:'never'}],['json',{outputFile:${JSON.stringify(join(output, 'results.json'))}}]],outputDir:${JSON.stringify(join(output, 'results'))},use:{browserName:'webkit',headless:true,trace:'on'}};`);
const stream = new PassThrough(); let childOutput = '';
stream.on('data', data => { childOutput += data; });
const result = await runChild(process.execPath, [cli, 'test', '--config', join(output, 'playwright.config.cjs')], {
  sourceRoot: root, captureRoot, env: { ...process.env, DEBUG: 'pw:*', DEBUG_FILE: rawFile }, stdout: stream, stderr: stream,
});
writeFileSync(join(output, 'child.log'), childOutput);
assert.equal(result.code, 0, childOutput.slice(-5000));
assert.equal(existsSync(rawFile), false, 'DEBUG_FILE must not be opened');
assert.ok(!childOutput.includes(canary), 'logger canary reached child pipe');
const files = readdirSync(output, { recursive: true, withFileTypes: true }).filter(x => x.isFile()).map(x => join(x.parentPath, x.name));
const { ZipFile } = require(core).utils;
let scanned = 0, zipEntries = 0;
for (const file of files) {
  // Fixture source contains fake inputs intentionally; it is not a retained output.
  if (file.endsWith('smoke.spec.cjs') || file.endsWith('playwright.config.cjs')) continue;
  const data = readFileSync(file);
  assert.ok(!data.includes(Buffer.from(canary)), 'canary persisted in output'); scanned++;
  if (file.endsWith('.zip')) {
    const zip = new ZipFile(file);
    for (const name of await zip.entries()) {
      const data = await zip.read(name);
      assert.ok(!data.includes(Buffer.from(canary)), 'canary persisted in ZIP entry'); zipEntries++;
    }
    zip.close();
  }
}
const records = files.filter(x => x.endsWith('.jsonl') && x.includes('capture')).flatMap(file => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
const all = records.flatMap(x => x.inner ? [x, x.inner] : [x]);
for (const id of [900001, 900002]) assert.ok(all.some(x => x.id === id && x.method === 'Runtime.evaluate' && x.code?.role === 'other'), 'synthetic canary protocol input was not recognized');
const roles = new Set(all.map(x => x.code?.role).filter(Boolean));
for (const role of ['selector-dispatch', 'actionability', 'pending-snapshot', 'pending-raf-probe']) assert.ok(roles.has(role), 'real missing role: ' + role);
assert.ok(all.some(x => x.selectorArray), 'missing selector-array dispatch');
assert.ok(all.some(x => x.createdContext && x.world === 'main'), 'missing main-world context creation');
assert.equal(new Set(records.filter(x => x.kind === 'pending-marker').map(x => x.pid)).size, 2, 'both workers must retain pending markers');
for (const event of records.filter(x => x.inner?.code?.role === 'pending-snapshot')) {
  assert.ok(records.some(reply => reply.pid === event.pid && reply.targetId === event.targetId && reply.inner?.id === event.inner.id && reply.inner.response), 'snapshot reply not correlated');
}
const summary = { result, scanned, zipEntries, workers: [...new Set(records.map(x => x.pid))].length, roles: [...roles].sort(), canaryAbsent: true, debugFileAbsent: true };
writeFileSync(join(output, 'verification.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ output, ...summary }));
