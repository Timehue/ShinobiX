import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
    advanceQueuedJutsuRyoTraining,
    cancelQueuedJutsuRyoTraining,
    jutsuRyoTrainingDuration,
    jutsuSealTrainingCost,
    queueJutsuRyoTraining,
    queueJutsuSealTraining,
    settleJutsuRyoTraining,
    startJutsuSealTraining,
    type ServerJutsuTraining,
} from './_jutsu-ryo.js';

const jonin = (level: number, extra: Record<string, unknown> = {}) => ({
    level: 50, ryo: 100_000, honorSeals: 500, jutsuMastery: [{ jutsuId: 'fireball', level, xp: 0 }], ...extra,
});
const levelOf = (character: Record<string, unknown>, jutsuId = 'fireball') =>
    (character.jutsuMastery as Array<{ jutsuId: string; level: number }>).find((row) => row.jutsuId === jutsuId)?.level;

describe('Honor Seal lessons (Lv 30→40)', () => {
    test('are timed like the ryo lesson at that level, debit Seals up front, and grant nothing early', () => {
        const started = startJutsuSealTraining(jonin(30), 'fireball', 'Fireball', 'seal-token', 1_000, 0);
        assert.equal(started.ok, true);
        if (!started.ok) return;
        assert.equal(started.character.honorSeals, 480, '30→31 costs 20 Seals');
        assert.equal(started.character.ryo, 100_000, 'no ryo is charged');
        assert.equal(levelOf(started.character), 30, 'the level is not granted at purchase');
        assert.equal(started.active.currency, 'honorSeals');
        assert.equal(started.active.endsAt - started.active.startedAt, jutsuRyoTrainingDuration(30, 0));
        assert.equal(started.active.endsAt - started.active.startedAt, 30 * 60_000);

        assert.equal(settleJutsuRyoTraining(started.character, started.active, 'complete', 1_000 + 60_000).ok, false,
            'cannot complete before the timer ends');
        const done = settleJutsuRyoTraining(started.character, started.active, 'complete', started.active.endsAt);
        assert.equal(done.ok, true);
        if (!done.ok) return;
        assert.equal(levelOf(done.character), 31, 'lands above the ryo cap of 30');
    });

    test('honour training bonuses and war morale exactly as ryo lessons do', () => {
        const started = startJutsuSealTraining(jonin(33), 'fireball', 'Fireball', 't', 0, 20, 1.2);
        assert.equal(started.ok, true);
        if (!started.ok) return;
        assert.equal(started.active.endsAt, jutsuRyoTrainingDuration(33, 20, 1.2));
    });

    test('refuse below Lv 30, at the Lv 40 ceiling, above the rank cap, and without enough Seals', () => {
        const reason = (character: Record<string, unknown>) => {
            const result = startJutsuSealTraining(character, 'fireball', 'Fireball', 't', 0, 0);
            return result.ok ? 'ok' : result.reason;
        };
        assert.equal(reason(jonin(29)), 'seal-training-below-level-30');
        assert.equal(reason(jonin(40)), 'jutsu-at-seal-training-cap');
        assert.equal(reason(jonin(30, { level: 30 })), 'jutsu-at-seal-training-cap', 'a Chunin is capped at 30');
        assert.equal(reason(jonin(39, { honorSeals: 64 })), 'not-enough-honor-seals');
        assert.equal(reason(jonin(39, { honorSeals: 65 })), 'ok');
    });

    test('keep the Vanguard discounts', () => {
        assert.equal(jutsuSealTrainingCost(30, {}), 20);
        assert.equal(jutsuSealTrainingCost(30, { profession: 'vanguard', professionRank: 8 }), 18);
    });

    test('share the two lesson slots with ryo lessons and chain on the same jutsu', () => {
        const active: ServerJutsuTraining = { serverToken: 'a', jutsuId: 'fireball', label: 'Fireball', fromLevel: 30, toLevel: 31,
            ryoCost: 0, currency: 'honorSeals', sealCost: 20, startedAt: 0, endsAt: 100 };
        const queued = queueJutsuSealTraining(jonin(30, { honorSeals: 480 }), active, 'fireball', 'Fireball', 'q', 0);
        assert.equal(queued.ok, true);
        if (!queued.ok) return;
        assert.equal(queued.active.next?.fromLevel, 31, 'the queued lesson continues from the active one');
        assert.equal(queued.character.honorSeals, 455);
        const full = queueJutsuSealTraining(queued.character, queued.active, 'fireball', 'Fireball', 'q2', 0);
        assert.equal(full.ok ? 'ok' : full.reason, 'jutsu-training-queue-full', 'still only two lessons at a time');
        const ryoBehind = queueJutsuRyoTraining(jonin(30), active, 'fireball', 'Fireball', 'r', 0);
        assert.equal(ryoBehind.ok ? 'ok' : ryoBehind.reason, 'jutsu-at-training-cap', 'ryo cannot train past 30');

        const advanced = advanceQueuedJutsuRyoTraining(queued.character, queued.active, 100 + queued.active.next!.durationMs);
        assert.equal(levelOf(advanced.character), 32, 'both Seal lessons land, each above the ryo cap');
        assert.equal(advanced.active, null);
    });

    test('refund in Seals: half for a cancelled active lesson, all of a queued one', () => {
        const started = startJutsuSealTraining(jonin(34), 'fireball', 'Fireball', 't', 0, 0);
        assert.equal(started.ok, true);
        if (!started.ok) return;
        const cost = jutsuSealTrainingCost(34, {});
        const cancelled = settleJutsuRyoTraining(started.character, started.active, 'cancel', 10);
        assert.equal(cancelled.ok, true);
        if (!cancelled.ok) return;
        assert.equal(cancelled.character.honorSeals, 500 - cost + Math.floor(cost / 2));
        assert.equal(cancelled.character.ryo, 100_000);

        const queued = queueJutsuSealTraining(started.character, started.active, 'fireball', 'Fireball', 'q', 0);
        assert.equal(queued.ok, true);
        if (!queued.ok) return;
        const dequeued = cancelQueuedJutsuRyoTraining(queued.character, queued.active);
        assert.equal(dequeued.ok, true);
        if (!dequeued.ok) return;
        assert.equal(dequeued.character.honorSeals, started.character.honorSeals);
    });

    test('cancelling the active lesson refunds a queued one in full instead of dropping it', () => {
        const started = startJutsuSealTraining(jonin(30), 'fireball', 'Fireball', 't', 0, 0);
        assert.equal(started.ok, true);
        if (!started.ok) return;
        const queued = queueJutsuSealTraining(started.character, started.active, 'fireball', 'Fireball', 'q', 0);
        assert.equal(queued.ok, true);
        if (!queued.ok) return;
        assert.equal(queued.character.honorSeals, 500 - 20 - 25);
        const cancelled = settleJutsuRyoTraining(queued.character, queued.active, 'cancel', 10);
        assert.equal(cancelled.ok, true);
        if (!cancelled.ok) return;
        assert.equal(cancelled.active, null);
        assert.equal(cancelled.character.honorSeals, 500 - 20 + 10, 'half of the active lesson, all of the queued one');
    });

    test('an old lesson record with no currency still settles as a ryo lesson', () => {
        const legacy: ServerJutsuTraining = { serverToken: 'l', jutsuId: 'fireball', label: 'Fireball', fromLevel: 29, toLevel: 30, ryoCost: 30_800, startedAt: 0, endsAt: 1 };
        const done = settleJutsuRyoTraining(jonin(29), legacy, 'complete', 1);
        assert.equal(done.ok && levelOf(done.character), 30);
        const refunded = settleJutsuRyoTraining(jonin(29), legacy, 'cancel', 0);
        assert.equal(refunded.ok && refunded.character.ryo, 100_000 + 15_400);
    });
});
