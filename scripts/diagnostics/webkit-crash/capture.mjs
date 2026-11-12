import { StringDecoder } from 'node:string_decoder';

import projection from './project.cjs';
export const browserEvent = projection.browserEvent;

export function safeEvent(value) {
  if (!value || typeof value !== 'object') return { kind: 'omitted-debug' };
  const base = Number.isSafeInteger(value.emitterPid) && value.emitterPid > 0 ? { emitterPid: value.emitterPid } : {};
  const pid = Number.isSafeInteger(value.pid) && value.pid > 0 ? { pid: value.pid } : {};
  if (['projection-installed','projection-unavailable','omitted-debug'].includes(value.kind)) return { ...base, kind: value.kind };
  if (value.kind === 'launched' && pid.pid) return { ...base, kind:'launched', ...pid };
  if (value.kind === 'process-exit' && (value.exitCode === null || Number.isSafeInteger(value.exitCode)) && (value.signal === null || /^SIG[A-Z0-9]{1,16}$/.test(value.signal))) return { ...base, ...pid, kind:'process-exit', exitCode:value.exitCode, signal:value.signal };
  if (value.kind === 'native-signature' && Array.isArray(value.signatures)) {
    const allowed = ['egl-destroy-sync-provider','egl-destroy-image-provider','egl-bad-alloc','egl-bad-context','egl-not-initialized','segmentation-fault','abort','out-of-memory','assertion','SIGSEGV','SIGABRT','SIGKILL','SIGBUS'];
    const signatures = [...new Set(value.signatures.filter(x => allowed.includes(x)))];
    if (signatures.length) return { ...base, ...pid, kind:'native-signature', signatures };
  }
  return { kind:'omitted-debug' };
}

export function boundedWriter(write, maxBytes = 1_048_576) {
  const counts = { written: 0, bytes: 0, omitted: 0, errors: 0 };
  return {
    counts,
    emit(value) {
      const line = JSON.stringify(value) + '\n';
      const bytes = Buffer.byteLength(line);
      if (counts.bytes + bytes > maxBytes) { counts.omitted++; return; }
      try { write(line); counts.bytes += bytes; counts.written++; } catch { counts.errors++; }
    },
  };
}

// No raw debug record reaches either output. Long lines are discarded without
// retaining their tail, so a split launch command cannot leak arguments.
export function lineFilter({ diagnostic, ordinary, maxLineBytes = 16_384 }) {
  const decoder = new StringDecoder('utf8');
  let pending = '', dropping = false, forwarding = false;
  const counts = { omittedDebug: 0, oversizedLines: 0, ordinaryLines: 0 };
  const line = (value) => {
    let event = null;
    if (value.startsWith('[webkit-crash-debug] ')) {
      try { event = safeEvent(JSON.parse(value.slice(21))); } catch { counts.omittedDebug++; return; }
    } else event = browserEvent(value);
    if (event) {
      if (event.kind === 'omitted-debug') counts.omittedDebug++;
      else diagnostic(event);
    } else { ordinary(value + '\n'); counts.ordinaryLines++; }
  };
  const feed = (value) => {
    for (const part of value.split(/(?<=\n)/)) {
      const ended = part.endsWith('\n');
      if (forwarding) ordinary(part);
      else if (!dropping) {
        if (Buffer.byteLength(pending) + Buffer.byteLength(part) > maxLineBytes) {
          if ((pending + part).includes('pw:browser') || (pending + part).startsWith('[webkit-crash-debug]')) { dropping = true; counts.oversizedLines++; }
          else { ordinary(pending + part); forwarding = true; }
          pending = '';
        } else pending += part;
      }
      if (ended) {
        if (forwarding) counts.ordinaryLines++;
        else if (!dropping) line(pending.slice(0, -1).replace(/\r$/, ''));
        pending = ''; dropping = false; forwarding = false;
      }
    }
  };
  return { counts, push: (chunk) => feed(decoder.write(chunk)), end() { feed(decoder.end()); if (pending && !dropping) line(pending); pending = ''; } };
}

export function exitOutcome(code, signal, signals = {}) {
  return Number.isInteger(code) ? code : signal ? 128 + (signals[signal] ?? 1) : 1;
}

export function numericFields(text, allowed) {
  const result = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_]+):?\s+(\d+)(?:\s+kB)?$/.exec(line.trim());
    if (m && allowed.includes(m[1])) result[m[1]] = Number(m[2]);
  }
  return result;
}

export function ownProcesses(text, rootPid, limit = 50) {
  const rows = text.trim().split('\n').map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+([A-Za-z+<NslL]+)\s*$/.exec(line);
    return m ? { pid: +m[1], ppid: +m[2], comm: m[3], cpu: +m[4], rssKiB: +m[5], state: m[6] } : null;
  }).filter(Boolean);
  const owned = new Set([rootPid]);
  for (let changed = true; changed;) { changed = false; for (const row of rows) if (owned.has(row.ppid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; } }
  const eligible = rows.filter(row => owned.has(row.pid) && /^(node|npm|MiniBrowser|WebKit\w*|WebProcess|NetworkProcess|WPE\w*|Xvfb)$/.test(row.comm));
  return { processes: eligible.slice(0, limit), omitted: Math.max(0, eligible.length - limit) };
}
