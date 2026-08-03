import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * Step 3d prerequisite: /api/missions/ai-fight-start must return the sealed
 * SESSION alongside the runId.
 *
 * The client's server-combat screen (MissionArenaFight) takes `initialSession`
 * as a REQUIRED prop, so a runId alone cannot mount it — which is why
 * api/story/boss-start.ts has always returned { ok, runId, session }. Without
 * this the whole client half of the migration is blocked.
 *
 * A source-level contract test, in the spirit of server-routes.test.ts: the
 * handler needs live auth + KV to exercise end to end, but the regressions that
 * matter here are structural — dropping `session` from the response, or letting
 * `runId` and `session` diverge so the client sees one without the other.
 */

const root = (() => {
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
        if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'api'))) return dir;
        const up = dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    return process.cwd();
})();
const src = () => readFileSync(join(root, 'api/missions/ai-fight-start.ts'), 'utf8');

describe('ai-fight-start response contract (step 3d prerequisite)', () => {
    it('returns the sealed session alongside runId', () => {
        assert.ok(
            /runId: record\.runId, session: sealed\.session/.test(src()),
            'the response no longer carries the sealed session — MissionArenaFight cannot mount without it',
        );
    });

    it('emits runId and session TOGETHER or not at all', () => {
        // The client treats "no runId" as "play it locally". A response with a
        // runId but no session would route it to the server screen and then fail
        // to mount — worse than either state on its own.
        assert.ok(
            /\.\.\.\(record\.runId && sealed \? \{[^}]*\} : \{\}\)/.test(src()),
            'runId and session must be spread under ONE combined condition',
        );
    });

    it('still degrades to the local path rather than failing the fight', () => {
        // The seal is best-effort by design: an unknown opponent or a storage
        // error must leave the player able to start the fight they can start
        // today. If this helper ever starts throwing, the fight breaks instead.
        const text = src();
        assert.ok(/return undefined;/.test(text), 'the seal helper no longer degrades to undefined');
        assert.ok(
            /catch \(err\)[\s\S]{0,200}return undefined;/.test(text),
            'a sealing failure must be caught and degrade, not propagate',
        );
    });

    it('the token still carries the runId, so one token = one battle lifecycle', () => {
        assert.ok(/battleKind: body\.battleKind,\s*\n\s*runId,/.test(src()), 'the token record lost its runId');
    });

    it('scaling is still derived server-side, never from body.opponentLevel', () => {
        const text = src();
        assert.ok(/resolveAiFightScaling\(\{/.test(text), 'step 3c scaling is no longer applied');
        // opponentLevel may still be recorded on the TOKEN, but must never reach
        // the encounter builder.
        const sealFn = text.slice(text.indexOf('async function sealAiFightEncounter'), text.indexOf('export default'));
        // Strip comments first — this file EXPLAINS the rule in prose, and a
        // naive scan would match the explanation instead of the code.
        const code = sealFn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        assert.ok(
            !/opponentLevel/.test(code),
            'body.opponentLevel must never reach the encounter — a client-chosen level is a client-chosen difficulty',
        );
    });
});
