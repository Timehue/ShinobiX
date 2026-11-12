import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmdirSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
import { browserEvent, boundedWriter, lineFilter, exitOutcome, numericFields, ownProcesses, safeEvent } from './capture.mjs';

test('launch projects only PID, never args or multiline credentials', () => {
  assert.deepEqual(browserEvent('pw:browser <launched> pid=42 token=SECRET\nhttps://private.invalid/?key=SECRET'), { kind:'launched',pid:42 });
  assert.deepEqual(browserEvent('pw:browser <launching> /some/path --password SECRET'), {kind:'omitted-debug'});
});
test('native signatures are fixed labels, not raw error text', () => {
  assert.deepEqual(browserEvent('pw:browser [pid=51][err] No provider of eglDestroySync found. https://private.invalid SECRET'), {pid:51,kind:'native-signature',signatures:['egl-destroy-sync-provider']});
  assert.deepEqual(browserEvent('pw:browser [pid=51][err] SIGSEGV private/path'), {pid:51,kind:'native-signature',signatures:['SIGSEGV']});
});
test('process exit preserves numeric/null outcomes only', () => {
  assert.deepEqual(browserEvent('pw:browser [pid=2] <process did exit: exitCode=null, signal=SIGABRT> SECRET'),{pid:2,kind:'process-exit',exitCode:null,signal:'SIGABRT'});
  assert.equal(browserEvent('ordinary error'),null);
});
test('bounded output records omitted count and write errors', () => {
  const rows=[]; const w=boundedWriter(x=>rows.push(x),10);w.emit({x:1});w.emit({x:2});
  assert.equal(rows.length,1);assert.equal(w.counts.omitted,1);assert.equal(w.counts.bytes,8);
  const bad=boundedWriter(()=>{throw Error('private error')});bad.emit({x:1});assert.equal(bad.counts.errors,1);assert.equal(bad.counts.written,0);
});
test('line framing survives chunks and discards oversized entire lines', () => {
  const diagnostics=[],ordinary=[];const f=lineFilter({diagnostic:x=>diagnostics.push(x),ordinary:x=>ordinary.push(x),maxLineBytes:80});
  f.push(Buffer.from('[webkit-crash-debug] {"kind":"laun'));f.push(Buffer.from('ched","pid":3}\nordinary error\n'));
  f.push(Buffer.from('pw:browser '+ 'SECRET'.repeat(30)));f.push(Buffer.from('more SECRET\nnext\n'));f.end();
  assert.deepEqual(diagnostics,[{kind:'launched',pid:3}]);assert.deepEqual(ordinary,['ordinary error\n','next\n']);assert.equal(f.counts.oversizedLines,1);
});
test('installed Playwright emitter projects multiline and formatted debug events before output', () => {
  const preload=fileURLToPath(new URL('./preload.cjs',import.meta.url));
  const script=`const path=require('node:path'); const core=require.resolve('playwright-core',{paths:[path.join(process.cwd(),'shinobij.client'),process.cwd()]}); const debug=require(path.join(path.dirname(core),'lib/utilsBundle.js')).debug('pw:browser'); debug('<launching> %s\\npassword=%s','https://private.invalid','SECRET'); process.stderr.write('ordinary error\\n'); debug('[pid=5][err] No provider of eglDestroyImage found. %s','SECRET');`;
  const cwd=mkdtempSync(join(tmpdir(),'webkit-crash-client-'));
  const client=join(cwd,'shinobij.client'), modules=join(client,'node_modules'), link=join(modules,'playwright-core');
  mkdirSync(client);mkdirSync(modules);
  const core=require.resolve('playwright-core',{paths:[join(process.cwd(),'shinobij.client'),process.cwd()]});
  symlinkSync(dirname(core),link,'dir');
  try {
    const r=spawnSync(process.execPath,['--require',preload,'-e',script],{cwd,encoding:'utf8',env:{...process.env,NODE_PATH:'',DEBUG:'pw:browser',DEBUG_FILE:''}});
    assert.equal(r.status,0);assert.ok(!r.stderr.includes('SECRET'));assert.ok(!r.stderr.includes('private.invalid'));assert.match(r.stderr,/ordinary error/);assert.match(r.stderr,/egl-destroy-image-provider/);assert.match(r.stderr,/projection-installed/);
  } finally {unlinkSync(link);rmdirSync(modules);rmdirSync(client);rmdirSync(cwd);}

});
test('exit status does not promote failures to success', () => {
  assert.equal(exitOutcome(0,null),0);assert.equal(exitOutcome(7,null),7);assert.equal(exitOutcome(null,'SIGTERM',{SIGTERM:15}),143);assert.equal(exitOutcome(null,null),1);
});
test('numeric fields whitelist telemetry, excluding payloads', () => {
  assert.deepEqual(numericFields('MemFree: 20 kB\nsecret: 999\noom_kill 2\nMemAvailable: SECRET',['MemFree','MemAvailable','oom_kill']),{MemFree:20,oom_kill:2});
});
test('process sampling includes own descendants only and caps rows', () => {
  const ps='1 0 node 1.0 100 S\n2 1 npm 2.0 200 S\n3 2 WebKitWebProces 3.0 300 Sl\n4 0 node 4.0 400 S\n5 2 secret-command 1.0 500 S';
  const result=ownProcesses(ps,2,1);assert.deepEqual(result.processes,[{pid:2,ppid:1,comm:'npm',cpu:2,rssKiB:200,state:'S'}]);assert.equal(result.omitted,1);
});

test('projected records discard all unknown fields and signatures', () => {
  assert.deepEqual(safeEvent({kind:'launched',pid:2,password:'SECRET',url:'https://private.invalid'}),{kind:'launched',pid:2});
  assert.deepEqual(safeEvent({kind:'native-signature',signatures:['SIGSEGV','SECRET']}),{kind:'native-signature',signatures:['SIGSEGV']});
  assert.deepEqual(safeEvent({kind:'unknown',message:'SECRET'}),{kind:'omitted-debug'});
});
test('every split of a safe framed event retains only metadata beside ordinary stderr', () => {
  const line='[webkit-crash-debug] '+JSON.stringify({kind:'launched',pid:5,secret:'SECRET',url:'https://private.invalid'})+'\n';
  for(let i=1;i<line.length;i++){
    const ds=[],os=[];const f=lineFilter({diagnostic:x=>ds.push(x),ordinary:x=>os.push(x)});
    f.push(Buffer.from('ordinary before\n'+line.slice(0,i)));f.push(Buffer.from(line.slice(i)+'ordinary after\n'));f.end();
    assert.deepEqual(ds,[{kind:'launched',pid:5}]);assert.deepEqual(os,['ordinary before\n','ordinary after\n']);
  }
});

test('long ordinary stderr remains intact rather than being capped as debug data', () => {
  const os=[];const f=lineFilter({diagnostic:()=>assert.fail(),ordinary:x=>os.push(x),maxLineBytes:20});
  const text='ordinary '+ 'x'.repeat(100)+'\n';
  f.push(Buffer.from(text.slice(0,30)));f.push(Buffer.from(text.slice(30)));f.end();
  assert.equal(os.join(''),text);assert.equal(f.counts.oversizedLines,0);
});

test('unavailable projection aborts before unredacted code can execute', () => {
  const cwd=mkdtempSync(join(tmpdir(),'webkit-crash-test-'));
  try {
    const preload=fileURLToPath(new URL('./preload.cjs',import.meta.url));
    const r=spawnSync(process.execPath,['--require',preload,'-e',`process.stderr.write('pw:browser <launching> SECRET\\n');`],{cwd,encoding:'utf8',env:{...process.env,NODE_PATH:'',DEBUG:'pw:browser',DEBUG_FILE:''}});
    assert.equal(r.status,78);assert.match(r.stderr,/projection-unavailable/);assert.ok(!r.stderr.includes('SECRET'));assert.ok(!r.stderr.includes('<launching>'));
  } finally { rmdirSync(cwd); }
});
