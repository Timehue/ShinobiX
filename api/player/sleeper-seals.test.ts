import { before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let computeSleeperSeals: typeof import('./sleeper-kill.js').computeSleeperSeals;
before(async () => {
    ({ computeSleeperSeals } = await import('./sleeper-kill.js'));
});

// A per-target counter is keyed by the loser's slug. A slug that names an
// Object.prototype member used to read the inherited function, so the cap math
// went NaN and the KO priced NaN Honor Seals past the per-target cap.
test('a sleeper named after an Object.prototype member prices finite seals inside the cap', () => {
    const winner = { profession: 'vanguard', professionRank: 1, level: 30, dailyHonorSealsByTarget: {} };
    for (const slug of ['constructor', '__proto__', 'tostring']) {
        const grant = computeSleeperSeals(winner, { level: 30 }, slug);
        assert.ok(grant, slug);
        assert.ok(Number.isFinite(grant!.seals) && grant!.seals > 0, `${slug}: seals ${grant!.seals}`);
        assert.ok(Object.hasOwn(grant!.nextByTarget, slug), `${slug}: the counter records an own entry`);
        assert.ok(Number.isFinite(grant!.nextByTarget[slug]), `${slug}: counter ${grant!.nextByTarget[slug]}`);
    }
});
