import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/*
 * scripts/load-soak.mjs boots the real server and runs the moment it is
 * imported, so its port contract is pinned on the source. The behaviour of the
 * port probe itself is covered by scripts/lib/free-port.test.mjs.
 *
 * CI / concurrency-smoke failed on a PR it had nothing to do with: the soak
 * always booted on 41988, inside Linux's ephemeral range (32768-60999), and an
 * outbound connection on the runner held that port, so the server died with
 * EADDRINUSE before the soak measured anything.
 */
const source = readFileSync('scripts/load-soak.mjs', 'utf8');

test('the soak has no fixed default port: an unset --port asks the OS for a free one', () => {
    const fallback = source.match(/numArg\('port', ([\d_]+)\)/);
    assert.ok(fallback, "load-soak.mjs must read --port through numArg('port', <fallback>)");
    assert.equal(Number(fallback[1].replace(/_/g, '')), 0, 'the fallback must mean "no port requested", not a fixed port');
    assert.match(source, /import \{ freePort \} from '\.\/lib\/free-port\.mjs';/);
    assert.match(source, /PORT = REQUESTED_PORT \|\| await freePort\(\);/, 'an unset --port must take a port the OS reports free');
});

test('a boot that loses its port retries on another, and nothing else is retried', () => {
    const boot = source.slice(source.indexOf('async function bootHealthyServer'), source.indexOf('async function main'));
    assert.ok(boot.length > 0, 'load-soak.mjs boots its server through bootHealthyServer');
    assert.match(boot, /const attempts = REQUESTED_PORT \? 1 : \d+;/, 'an explicit --port gets exactly one attempt');
    assert.match(boot, /attempt < attempts && \/EADDRINUSE\/\.test\(output\)/, 'only a lost port is retried');
    assert.match(boot, /\[soak\] server never became healthy/, 'any other boot failure still reports as before');
});
