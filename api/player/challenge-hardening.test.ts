import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WF_MAX_SECONDS } from '../_pet-sim/pet-warfront-sim.js';
import { _shouldCache } from '../_storage.js';
import { ARENA_MATCH_RECOVERY_TTL_SECONDS, validateChallengeShape } from './challenge.js';

const valid = {
    id: '36bce711-40b3-4fe0-bc5c-a83f1aeef772',
    fromName: 'kakashi',
    toName: 'gai',
    challenger: { ignored: 'server replaces this' },
    createdAt: Date.now(),
    mode: 'clanWarPet',
    arenaMatch: true,
    arenaSize: 4,
    challengerTeamIds: ['a', 'b', 'c', 'd'],
};

test('challenge schema rejects unknown fields and unbounded collection amplification', () => {
    assert.equal(validateChallengeShape(valid), null);
    assert.match(validateChallengeShape({ ...valid, arbitrary5MbBlob: 'x' }) ?? '', /Unsupported challenge field/);
    assert.match(validateChallengeShape({ ...valid, challengerTeamIds: ['a', 'b', 'c', 'd', 'e'] }) ?? '', /challengerTeamIds/);
    assert.match(validateChallengeShape({ ...valid, challengerJutsus: Array(17).fill({}) }) ?? '', /jutsu loadout/);
    assert.match(validateChallengeShape({ ...valid, mode: 'instant-admin-win' }) ?? '', /mode/);
    assert.match(validateChallengeShape({ ...valid, challengerTeamIds: ['a'.repeat(200)] }) ?? '', /challengerTeamIds/);
    assert.match(validateChallengeShape({ ...valid, accepted: 'yes' }) ?? '', /accepted/);
    assert.match(validateChallengeShape({ ...valid, challengerWarfrontSetup: {
        stance: 'balanced', doctrine: 'none', buyPolicy: 'balanced', oversizedNestedBlob: 'x',
    } }) ?? '', /challengerWarfrontSetup/);
});

test('accepted Arena recovery outlives regulation and is never process-cached', () => {
    assert.ok(ARENA_MATCH_RECOVERY_TTL_SECONDS > WF_MAX_SECONDS,
        'a participant must be able to recover after the entire regulation clock');
    assert.equal(_shouldCache('arena-match-recovery:match-id'), false);
    assert.equal(_shouldCache('arena-challenge-setup:match-id'), false);
    assert.equal(_shouldCache('challenge-terminal:player:match-id'), false);
    assert.equal(_shouldCache('pvp:pvp-session-id'), false);
});

test('challenge delivery is parser-bounded, rate-limited, participant-only, and fail-closed', () => {
    const bodyLimits = readFileSync(join(process.cwd(), 'api', '_body-limits.ts'), 'utf8');
    const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    const source = readFileSync(join(process.cwd(), 'api', 'player', 'challenge.ts'), 'utf8');
    assert.match(bodyLimits, /player\\\/challenge[\s\S]*'challenge'/,
        'challenge requests need their own parser class');
    assert.match(server, /jsonChallenge = express\.json\(\{ limit: '512kb' \}\)/,
        'multi-megabyte bodies must be rejected before parsing');
    assert.match(server, /urlEncodedChallenge = express\.urlencoded\(\{ extended: true, limit: '512kb' \}\)/,
        'content-type switching must not regain the generic five-megabyte parser');
    assert.match(source, /player-challenge-write[\s\S]*strict: true/,
        'writes need durable account and IP budgets');
    assert.match(source, /Only the accepted match participants may recover this reveal/);
    assert.match(source, /const updated = \[\.\.\.deduped, inboxChallenge\][\s\S]*\{ failClosed: true \}/,
        'terminal inbox writes must never fall through unlocked');
    assert.match(source, /acceptedArenaInboxNotice[\s\S]*recoveryRequired: true[\s\S]*const inboxChallenge/,
        'accepted Arena inboxes must carry only an opaque recovery wake-up');
    assert.match(source, /referencedChallengerPetIds[\s\S]*selectedPets[\s\S]*projectChallengerCharacter\(authoritativeChallenger\)/,
        'notices must contain only selected, server-sourced pets');
});
