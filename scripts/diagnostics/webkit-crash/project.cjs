const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
function browserEvent(raw) {
  const line = raw.replace(ANSI, '');
  if (!/\bpw:browser\b/.test(line)) return null;
  const pid = /\[pid=(\d+)\]/.exec(line)?.[1];
  const base = pid ? { pid: Number(pid) } : {};
  const launch = /<launched> pid=(\d+)\b/.exec(line);
  if (launch) return { kind: 'launched', pid: Number(launch[1]) };
  const exit = /<process did exit: exitCode=(null|-?\d+), signal=(null|SIG[A-Z0-9]+)>/.exec(line);
  if (exit) return { ...base, kind: 'process-exit', exitCode: exit[1] === 'null' ? null : Number(exit[1]), signal: exit[2] === 'null' ? null : exit[2] };
  const signatures = [];
  for (const [name, pattern] of [
    ['egl-destroy-sync-provider', /No provider of eglDestroySync found/i],
    ['egl-destroy-image-provider', /No provider of eglDestroyImage found/i],
    ['egl-bad-alloc', /\bEGL_BAD_ALLOC\b/], ['egl-bad-context', /\bEGL_BAD_CONTEXT\b/],
    ['egl-not-initialized', /\bEGL_NOT_INITIALIZED\b/],
    ['segmentation-fault', /Segmentation fault/i], ['abort', /\bAborted\b/],
    ['out-of-memory', /out of memory|oom-kill|oom_kill/i],
    ['assertion', /assertion.*failed|assertion failure|ASSERTION FAILED/i],
  ]) if (pattern.test(line)) signatures.push(name);
  for (const signal of ['SIGSEGV', 'SIGABRT', 'SIGKILL', 'SIGBUS']) if (new RegExp(`\\b${signal}\\b`).test(line)) signatures.push(signal);
  return signatures.length ? { ...base, kind: 'native-signature', signatures } : { kind: 'omitted-debug' };
}

module.exports = { browserEvent };
