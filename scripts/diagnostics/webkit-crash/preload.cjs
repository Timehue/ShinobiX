'use strict';
// Project the installed Playwright debug emitter BEFORE output framing. The
// emitter receives a complete formatted event, even when it contains newlines
// or format arguments. Ordinary stderr is not intercepted or rewritten.
const { format } = require('node:util');
const { dirname, join } = require('node:path');
const { browserEvent } = require('./project.cjs');
const write = event => process.stderr.write('[webkit-crash-debug] ' + JSON.stringify({ emitterPid: process.pid, ...event }) + '\n');
try {
  const core = require.resolve('playwright-core', { paths: [join(process.cwd(), 'shinobij.client'), process.cwd()] });
  const debug = require(join(dirname(core), 'lib/utilsBundle.js')).debug;
  if (typeof debug !== 'function' || typeof debug.log !== 'function') throw new Error('unsupported');
  const original = debug.log;
  debug.log = function (...args) {
    if (this.namespace !== 'pw:browser') return original.apply(this, args);
    write(browserEvent(format(...args)) ?? { kind: 'omitted-debug' });
  };
  write({ kind: 'projection-installed' });
} catch {
  // Fail closed before this Node process can run browser code. Exit 78 is a
  // diagnostic setup failure, not a test result.
  write({ kind: 'projection-unavailable' });
  process.exit(78);
}
