import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSharedWarfrontSetup } from './challenge.js';
import { DEFAULT_WARFRONT_AUTHORED_SETUP } from '../pet/_warfront-setup.js';

const legacy = {
    stance: 'balanced',
    doctrine: 'none',
    buyPolicy: 'balanced',
};

test('legacy PvP plans receive one deterministic complete authored setup', () => {
    const parsed = parseSharedWarfrontSetup(legacy);
    assert.deepEqual(parsed, { ...legacy, ...DEFAULT_WARFRONT_AUTHORED_SETUP });
    assert.notEqual(parsed, legacy, 'the private commitment must be a canonical server projection');
});

test('PvP authored values are strictly allowlisted and deployments are permutations', () => {
    const complete = { ...legacy, ...DEFAULT_WARFRONT_AUTHORED_SETUP };
    assert.deepEqual(parseSharedWarfrontSetup(complete), complete);
    for (const forged of [
        { ...complete, deployment: ['top', 'top', 'bottom', 'flex'] },
        { ...complete, buildPackage: 'instant-win' },
        { ...complete, coachOrder: 'read-seed' },
        { ...complete, objectiveTechnique: 'always-steal' },
        { ...complete, counterstrike: 'rewind' },
    ]) assert.equal(parseSharedWarfrontSetup(forged), null);
});

test('acceptance durably stores and returns the sealed pair without publishing it to the realtime inbox', () => {
    const source = readFileSync(join(process.cwd(), 'api', 'player', 'challenge.ts'), 'utf8');
    const acceptedPair = source.indexOf('challengerWarfrontSetup: secret.setup');
    const recoveryStored = source.indexOf('challenge: safeRecord', acceptedPair);
    const opaque = source.indexOf('acceptedArenaInboxNotice(safeChallenge', recoveryStored);
    const stored = source.indexOf('const updated = [...deduped, inboxChallenge]', opaque);
    const returned = source.indexOf('challenge: safeChallenge', stored);
    assert.ok(acceptedPair >= 0 && recoveryStored > acceptedPair && opaque > recoveryStored && stored > opaque && returned > stored,
        'full authored pair must stay in participant recovery/POST while realtime receives only an opaque notice');
    assert.match(source, /const responderSetup = parseSharedWarfrontSetup\(challengeRecord\.responderWarfrontSetup\)/);
    assert.match(source, /const setup = parseSharedWarfrontSetup\(challengeRecord\.challengerWarfrontSetup\)/);
});
