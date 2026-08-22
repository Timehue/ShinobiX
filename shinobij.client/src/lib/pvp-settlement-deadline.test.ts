import { strict as assert } from 'node:assert';
import test from 'node:test';
import { settlementDeadlineMs } from './pvp-settlement-deadline';

const PER_STAGE = 12_000;
const CEILING = 30_000;
const at = (elapsed: number) => settlementDeadlineMs({ startedAt: 0, now: elapsed, perStageMs: PER_STAGE, ceilingMs: CEILING });

test('a fresh stage gets its full budget while the phase has room', () => {
    assert.equal(at(0), PER_STAGE);
    assert.equal(at(12_000), PER_STAGE);
    assert.equal(at(17_999), PER_STAGE);
});

test('the phase ceiling clips the last stage instead of granting a fourth full budget', () => {
    // Three stages have burned 24s of a 30s phase; the next may only have 6s,
    // not another 12s. This is what keeps a wedged completion under ~30s rather
    // than the ~48s that four independent 12s budgets would allow.
    assert.equal(at(24_000), 6_000);
    assert.equal(at(29_500), 500);
});

test('an already-overrun phase yields no further grace', () => {
    assert.equal(at(30_000), 0);
    assert.equal(at(45_000), 0);
    assert.equal(at(Number.MAX_SAFE_INTEGER), 0);
});

test('the ceiling, not the stage budget, bounds the worst case', () => {
    // Walk the renewal loop the caller actually performs: arm, wait the full
    // grant, renew. The total must converge on the ceiling.
    let elapsed = 0;
    for (let stage = 0; stage < 10; stage++) elapsed += at(elapsed);
    assert.equal(elapsed, CEILING, 'renewing until exhaustion must total exactly the phase ceiling');
});

test('a stage budget longer than the ceiling never exceeds the ceiling', () => {
    assert.equal(settlementDeadlineMs({ startedAt: 0, now: 0, perStageMs: 60_000, ceilingMs: 30_000 }), 30_000);
});
