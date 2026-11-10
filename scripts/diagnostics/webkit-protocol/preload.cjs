'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createProjector, MAX_INPUT } = require('./project.cjs');
const CORE_HASH = '9393fa79e1c67c74edc26b610d65a4f7ed73d345a762465cc88340a33a2454ac';
const MAX_FILES = 64, SEGMENT = 1024 * 1024, TARGET_MAX = 2 * SEGMENT;
// Must precede loading coreBundle: DEBUG_FILE installs an independent raw sink.
delete process.env.DEBUG_FILE;
delete process.env.DEBUG;
process.env.MAX_LOG_LENGTH = String(MAX_INPUT);
const root = process.env.PW_CAPTURE_ROOT, core = process.env.PW_CAPTURE_CORE;
const deadline = Number(process.env.PW_CAPTURE_DEADLINE);
if (!root || !core || !Number.isFinite(deadline)) throw new Error('Capture configuration missing');
if (createHash('sha256').update(fs.readFileSync(core)).digest('hex') !== CORE_HASH) throw new Error('Capture dependency fingerprint mismatch');
const logger = require(core).utils.debugLogger;
if (typeof logger.log !== 'function' || typeof logger.isEnabled !== 'function') throw new Error('Capture logger boundary missing');
const projector = createProjector();
let directory, fd, allocated = false, segment = 0, segmentBytes = 0, seq = 0;
let dropped = 0, timeDropped = 0, writeFailed = false, overwrittenBytes = 0;
let targetFd, targetBytes = 0, targetDropped = 0, targetUntil = 0;
const segmentSizes = [0, 0];
let queue = '', queueBytes = 0;
function allocate() {
  if (allocated) return;
  allocated = true;
  for (let slot = 0; slot < MAX_FILES; slot++) {
    try {
      directory = path.join(root, `capture-${slot}`);
      fs.mkdirSync(directory, { mode: 0o700 });
      fd = fs.openSync(path.join(directory, 'tail-0.jsonl'), 'w', 0o600);
      return;
    } catch (error) { if (error.code !== 'EEXIST') { writeFailed = true; break; } }
  }
  directory = undefined;
}
function flush() {
  if (!queue || fd === undefined) return;
  try { fs.writeSync(fd, queue); } catch { writeFailed = true; }
  queue = ''; queueBytes = 0;
}
function record(event) {
  allocate();
  if (fd === undefined || writeFailed) { dropped++; return; }
  const line = JSON.stringify({ unixMs: Date.now(), monoMs: performance.now(), pid: process.pid, seq: ++seq, ...event }) + '\n';
  const length = Buffer.byteLength(line);
  if (length > 8192) { dropped++; return; }
  if (segmentBytes + length > SEGMENT) {
    flush();
    try {
      fs.closeSync(fd);
      segment = 1 - segment;
      overwrittenBytes += segmentSizes[segment];
      segmentSizes[segment] = 0;
      fd = fs.openSync(path.join(directory, `tail-${segment}.jsonl`), 'w', 0o600);
      segmentBytes = 0;
    } catch { writeFailed = true; dropped++; return; }
  }
  segmentBytes += length; segmentSizes[segment] = segmentBytes;
  queue += line; queueBytes += length;
  if (queueBytes >= 32768) flush();
  if (targetFd !== undefined && Date.now() <= targetUntil) {
    if (targetBytes + length <= TARGET_MAX) {
      try { fs.writeSync(targetFd, line); targetBytes += length; } catch { writeFailed = true; }
    } else targetDropped++;
  }
}
function log(name, message) {
  if (name !== 'protocol' && name !== 'browser') return;
  allocate();
  if (Date.now() > deadline) { timeDropped++; return; }
  const reasons = ['malformed', 'oversized', 'upstreamTruncated', 'nestedOmitted', 'invalidId', 'browserOmitted'];
  const before = reasons.map(reason => projector.stats[reason]);
  const event = projector.input(name, message);
  if (event) record(event);
  reasons.forEach((reason, index) => {
    if (projector.stats[reason] > before[index]) record({ kind: 'omission', reason, count: projector.stats[reason] - before[index] });
  });
}
function pendingMarker(message) {
  if (Date.now() > deadline || targetFd !== undefined || typeof message !== 'string' || message.length > 16384 || !message.startsWith('[pending-click] ')) return;
  try {
    const value = JSON.parse(message.slice(16));
    if (value.event !== 'pending' || !['snare-pass', 'choose-attacker', 'attack-target'].includes(value.stage) || value.project !== 'webkit-mobile' ||
        value.viewport?.width !== 1366 || value.viewport?.height !== 768 || value.retry !== 0) return;
    allocate(); flush();
    if (!directory || writeFailed) return;
    // Retain the latest 512 KiB of already projected records, leaving 1.5 MiB for
    // query/callback requests, replies and teardown over the next 90 seconds.
    let tail = '';
    for (const index of [1 - segment, segment]) {
      const file = path.join(directory, `tail-${index}.jsonl`);
      if (fs.existsSync(file)) tail += fs.readFileSync(file, 'utf8');
    }
    if (Buffer.byteLength(tail) > SEGMENT / 2) {
      const buffer = Buffer.from(tail).subarray(-SEGMENT / 2);
      tail = buffer.subarray(buffer.indexOf(10) + 1).toString('utf8');
    }
    targetFd = fs.openSync(path.join(directory, 'pending-target.jsonl'), 'wx', 0o600);
    fs.writeSync(targetFd, tail); targetBytes = Buffer.byteLength(tail);
    targetUntil = Date.now() + 90_000;
    record({ kind: 'pending-marker', stage: value.stage, project: 'webkit-mobile', width: 1366, height: 768, retry: 0 });
  } catch { dropped++; }
}
// Read-only observation of the EXISTING helper marker. Forward the same call;
// never persist its original object, locator, moves, DOM values or error text.
const originalInfo = console.info;
console.info = function (...args) { pendingMarker(args[0]); return originalInfo.apply(this, args); };
// This boundary runs BEFORE debug output reaches worker IPC/reporters.
logger.log = log;
logger.isEnabled = name => name === 'protocol' || name === 'browser';
const timer = setInterval(flush, 1000); timer.unref();
process.on('exit', () => {
  if (!allocated) return;
  flush();
  const summary = JSON.stringify({ kind: 'summary', pid: process.pid, ...projector.stats, seq, segment,
    segmentSizes, overwrittenBytes, dropped, timeDropped, targetBytes, targetDropped,
    writeFailed, slotMissing: fd === undefined }) + '\n';
  if (directory) {
    try {
      fs.writeFileSync(path.join(directory, 'summary.json'), summary, { mode: 0o600 });
      if (fd !== undefined) fs.closeSync(fd);
      if (targetFd !== undefined) fs.closeSync(targetFd);
    } catch { process.stderr.write('[safe-capture] summary-write-failed\n'); }
  } else process.stderr.write('[safe-capture] ' + summary);
});
