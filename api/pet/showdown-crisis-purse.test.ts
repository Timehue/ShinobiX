import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

/*
 * The L80 world crisis companion front pays the same side-mode purse as the
 * shinobi front (owner amendment A7): 0.5 x A(L) per active minute of a WON
 * deployment, once, receipted in the save. The showdown is server-simulated,
 * so its own createdAt and circuitFinishedAt are the fight's clock.
 */
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

const SRC = readFileSync(join(process.cwd(), 'api', 'pet', 'showdown.ts'), 'utf8');
const PLAYER = 'crisiscompanion';
const MINUTE = 60_000;

let kv: typeof import('../_storage.js').kv;
let purses: typeof import('../_activity-purse.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    purses = await import('../_activity-purse.js');
    await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, level: 80, ryo: 1_000 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

describe('L80 crisis companion-front purse', () => {
    it('the finishing turn credits the crisis80 purse on a win only, from the session clock', () => {
        const at = SRC.indexOf("if (crisisBinding?.crisisId === WORLD_CRISIS_80_ID && session.outcome) {");
        assert.ok(at > 0, 'the finishing-turn crisis block exists');
        const block = SRC.slice(at, SRC.indexOf('if (firstPactBinding && session.outcome)', at));
        assert.match(block, /const purse = session\.outcome === 'win'\s*\?\s*await creditActivityPurse\(\{/);
        assert.match(block, /mode: 'crisis80'/);
        assert.match(block, /outcomeId: `showdown:\$\{session\.sessionId\}`/);
        assert.match(block, /minutes: activityPurseMinutes\(session\.createdAt, session\.circuitFinishedAt\)/);
        // A conceded bout is a loss and must never reach the purse.
        const concedeAt = SRC.indexOf('const crisisBinding = bindings.worldCrisis80;');
        const concedeEnd = SRC.indexOf('const firstPactBinding = bindings.firstPact;', concedeAt);
        assert.ok(concedeAt > 0 && concedeEnd > concedeAt && concedeEnd < at, 'the concede branch precedes the finishing turn');
        assert.match(SRC.slice(concedeAt, concedeEnd), /outcome: 'loss'/);
        assert.doesNotMatch(SRC.slice(concedeAt, concedeEnd), /creditActivityPurse/);
    });

    it('a re-posted finishing turn answers with the same purse and pays once', async () => {
        const createdAt = Date.now() - 6 * MINUTE;
        const minutes = purses.activityPurseMinutes(createdAt, createdAt + 6 * MINUTE);
        const credit = () => purses.creditActivityPurse({
            mode: 'crisis80', playerSlug: PLAYER, outcomeId: 'showdown:crisis-session-1', startedAt: createdAt, minutes,
        });
        const first = await credit();
        const expected = purses.activityPurseRyo('crisis80', 80, minutes);
        assert.ok(expected > 0);
        assert.equal(first.ryo, expected);
        assert.equal(first.reason, undefined);
        const replay = await credit();
        assert.equal(replay.ryo, expected);
        assert.equal(replay.reason, 'already-paid');
        const save = await kv.get<{ character: { ryo: number } }>(`save:${PLAYER}`);
        assert.equal(save?.character.ryo, 1_000 + expected, 'paid exactly once');
    });
});
