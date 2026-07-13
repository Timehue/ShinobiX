import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { settleJutsuRyoTraining, startJutsuRyoTraining } from './_jutsu-ryo.js';

describe('server jutsu ryo training', () => {
    it('grants level one free then debits the canonical paid cost', () => {
        const free = startJutsuRyoTraining({ level: 30, ryo: 20_000, jutsuMastery: [] }, 'fireball', 'Fireball', 'tok', 1, 0);
        assert.equal(free.ok, true); if (!free.ok) return;
        assert.equal(((free.character as Record<string, unknown>).jutsuMastery as any[])[0].level, 1);
        const paid = startJutsuRyoTraining(free.character, 'fireball', 'Fireball', 'tok2', 10, 0);
        assert.equal(paid.ok, true); if (!paid.ok) return;
        assert.equal(paid.cost, 3000); assert.equal((paid.character as Record<string, unknown>).ryo, 17_000);
    });
    it('time-gates completion and derives cancellation/finish wallet mutations from the sealed session', () => {
        const active = { serverToken: 'tok', jutsuId: 'fireball', label: 'Fireball', fromLevel: 1, toLevel: 2, ryoCost: 3000, startedAt: 0, endsAt: 600_000 };
        const char = { level: 30, ryo: 10_000, jutsuMastery: [{ jutsuId: 'fireball', level: 1, xp: 0 }] };
        assert.equal(settleJutsuRyoTraining(char, active, 'complete', 1)?.ok, false);
        const cancelled = settleJutsuRyoTraining(char, active, 'cancel', 1); assert.equal(cancelled.ok, true); if (cancelled.ok) assert.equal((cancelled.character as Record<string, unknown>).ryo, 11_500);
        const finished = settleJutsuRyoTraining(char, active, 'finish', 60_000); assert.equal(finished.ok, true); if (finished.ok) { assert.equal((finished.character as Record<string, unknown>).ryo, 5_500); assert.equal(((finished.character as Record<string, unknown>).jutsuMastery as any[])[0].level, 2); }
    });
});
