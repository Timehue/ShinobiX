import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { readFile, statfs } from 'node:fs/promises';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { boundedWriter, lineFilter, exitOutcome, numericFields, ownProcesses } from './capture.mjs';

const directory = '.ci-evidence/webkit-crash';
mkdirSync(directory, { recursive: true });
const startedAt = new Date().toISOString();
const failures = [];
const recordFailure = (operation) => { if (failures.length < 30) failures.push({ operation, at: new Date().toISOString() }); };
const writer = boundedWriter(line => appendFileSync(`${directory}/events.jsonl`, line));
const emit = (value) => writer.emit({ at: new Date().toISOString(), ...value });
const preload = fileURLToPath(new URL('./preload.cjs', import.meta.url));
const child = spawn('npm', ['run', 'test:e2e', '--prefix', 'shinobij.client', '--', '--shard=4/12'], {
  cwd: process.cwd(), env: { ...process.env, DEBUG: 'pw:browser', DEBUG_FILE: '', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(preload)}`.trim() }, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(process.stdout);
const filter = lineFilter({ diagnostic: event => { if (event.kind === 'projection-unavailable') recordFailure('debug-projection'); emit(event); }, ordinary: line => process.stderr.write(line) });
child.stderr.on('data', chunk => filter.push(chunk));
child.stderr.on('end', () => filter.end());
const run = promisify(execFile);
let sampling = false, samples = 0, stopped = false;
async function sample() {
  if (sampling || stopped || samples >= 360) return;
  sampling = true; samples++;
  const result = { kind: 'resources', sample: samples };
  for (const [key, file, fields] of [
    ['memoryKiB', '/proc/meminfo', ['MemTotal','MemFree','MemAvailable','SwapTotal','SwapFree']],
    ['cgroupEvents', '/sys/fs/cgroup/memory.events', ['low','high','max','oom','oom_kill','oom_group_kill']],
  ]) {
    try { result[key] = numericFields(await readFile(file, 'utf8'), fields); } catch { recordFailure(key); }
  }
  try { result.load = (await readFile('/proc/loadavg', 'utf8')).split(' ').slice(0, 3).map(Number); } catch { recordFailure('load'); }
  try { const s = await statfs('/dev/shm'); result.sharedMemory = { totalBytes: s.blocks * s.bsize, availableBytes: s.bavail * s.bsize }; } catch { recordFailure('shared-memory'); }
  try {
    const { stdout } = await run('ps', ['-eo', 'pid=,ppid=,comm=,pcpu=,rss=,stat='], { timeout: 1500, maxBuffer: 512 * 1024 });
    result.owned = ownProcesses(stdout, child.pid);
  } catch { recordFailure('process-sample'); }
  if (!stopped) emit(result); sampling = false;
}
const timer = setInterval(() => void sample().catch(() => { sampling = false; recordFailure('sample'); }), 5000);
timer.unref();
void sample().catch(() => { sampling = false; recordFailure('sample'); });
const forward = signal => { if (!stopped) child.kill(signal); };
const sigint = () => forward('SIGINT'), sigterm = () => forward('SIGTERM');
process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
child.on('error', () => recordFailure('child-spawn'));
child.on('close', (code, signal) => {
  stopped = true; clearInterval(timer);
  process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
  const outcome = exitOutcome(code, signal, constants.signals);
  const summary = { startedAt, finishedAt: new Date().toISOString(), command: 'npm run test:e2e --prefix shinobij.client -- --shard=4/12', code, signal,
    exitCode: outcome, samples, samplingInFlightAtClose: sampling, sampleLimit: 360, capture: writer.counts, filter: filter.counts, captureFailures: failures };
  try { writeFileSync(`${directory}/summary.json`, JSON.stringify(summary, null, 2) + '\n'); } catch { process.stderr.write('Diagnostic summary could not be written.\n'); }
  process.stdout.write(`[webkit-crash-capture] ${JSON.stringify(summary)}\n`);
  // Instrumentation never turns a failing test into a pass, or substitutes a
  // diagnostic result for the unchanged suite's exit status.
  process.exitCode = outcome;
});
