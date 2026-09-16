import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AMBIGUOUS_ACTION_MESSAGE } from './ambiguous-action';
import { mutateJutsuRyoTraining } from './jutsu-ryo-api';
import { friendlyJutsuTrainingError, jutsuHallNoticeTitle, trainingResponseError } from './training-feedback';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('training failure feedback', () => {
    it('retains actionable confirmed rejections', () => {
        for (const status of [400, 401, 403, 404, 409, 422, 429]) {
            assert.equal(trainingResponseError(status, 'Not enough stamina.', 'Training was rejected.'), 'Not enough stamina.');
            assert.equal(trainingResponseError(status, undefined, 'Training was rejected.'), 'Training was rejected.');
        }
    });

    it('does not assert failure for malformed success, request timeout, or server errors', () => {
        for (const status of [200, 204, 408, 500, 502, 503, 504]) {
            assert.equal(trainingResponseError(status, 'Could not save training.', 'Training was rejected.'), AMBIGUOUS_ACTION_MESSAGE);
        }
    });

    it('uses neutral failure headings and preserves success and information headings', () => {
        assert.equal(jutsuHallNoticeTitle('error'), 'Training needs attention');
        assert.equal(jutsuHallNoticeTitle('success'), 'Hall updated');
        assert.equal(jutsuHallNoticeTitle('info'), 'Training note');
        assert.equal(friendlyJutsuTrainingError('Your save is being updated. Retrying is safe.'), 'Your save is being updated. Retrying is safe.');
    });
});

describe('jutsu mutation results presented by the hall', () => {
    const uncertainCases = [
        { name: 'lost network replies', calls: 2, response: () => { throw new TypeError('Failed to fetch'); } },
        { name: 'malformed successful reply', calls: 1, response: () => new Response('not-json', { status: 200 }) },
        { name: 'successful reply missing the character', calls: 1, response: () => new Response('{}', { status: 200 }) },
        { name: 'exhausted generic server-busy replies', calls: 2, response: () => new Response('{}', { status: 503 }) },
        { name: 'server failure with misleading custom text', calls: 2, response: () => new Response(JSON.stringify({ error: 'Could not save training. Please retry.' }), { status: 503 }) },
        { name: 'request timeout with custom text', calls: 2, response: () => new Response(JSON.stringify({ error: 'Training was not saved.' }), { status: 408 }) },
    ];
    for (const scenario of uncertainCases) {
        it(`${scenario.name} asks for reconciliation without changing request identity`, async () => {
            const bodies: string[] = [];
            globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
                bodies.push(String(init?.body));
                return scenario.response();
            }) as typeof fetch;
            const result = await mutateJutsuRyoTraining('feedback-test', 'start', { jutsuId: 'starter-nin-fire-1' });
            assert.equal(result.character, undefined);
            assert.equal(friendlyJutsuTrainingError(result.error), AMBIGUOUS_ACTION_MESSAGE);
            assert.equal(jutsuHallNoticeTitle('error'), 'Training needs attention');
            assert.equal(bodies.length, scenario.calls);
            assert.equal(new Set(bodies).size, 1, 'existing retries must keep the same request body and operation ID');
        });
    }

    it('a confirmed rejection still explains the actual requirement', async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'not-enough-ryo' }), { status: 409 })) as typeof fetch;
        const result = await mutateJutsuRyoTraining('feedback-test', 'start', { jutsuId: 'starter-nin-fire-1' });
        assert.equal(friendlyJutsuTrainingError(result.error), 'You do not have enough ryo for that lesson.');
    });
});
