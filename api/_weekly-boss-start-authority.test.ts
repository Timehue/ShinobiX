import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { mutatePlayerSave } from './save/_mutate-player-save.js';
import { appendSettlementReceipt } from './_settlement-receipts.js';
import {
    WEEKLY_BOSS_START_SETTLEMENTS_FIELD,
    chargeWeeklyBossStart,
    finalizeWeeklyBossStart,
    type WeeklyBossStartSeal,
} from './_weekly-boss-start-authority.js';

const NOW = 1_800_000_000_000;

function seal(runId: string): WeeklyBossStartSeal {
    return {
        runId,
        playerName: 'Alice',
        weekKey: '2027-W03',
        aiId: 'ashen-dragon',
        bossStartedAt: NOW - 10_000,
        createdAt: NOW,
        recoverUntil: NOW + 2 * 60 * 60 * 1_000,
    };
}

function harness(initial: Record<string, unknown>) {
    let character = structuredClone(initial);
    let version = 1;
    let failure: 'before' | 'after' | null = null;
    const mutateSave: typeof mutatePlayerSave = async (_name, mutate) => {
        const decision = await mutate({
            playerName: 'Alice',
            saveKey: 'save:Alice',
            record: { character, _saveVersion: version },
            character,
        });
        if (!decision.ok) return decision;
        if (decision.write !== false) {
            if (failure === 'before') {
                failure = null;
                throw new Error('injected-weekly-save-precommit');
            }
            character = structuredClone(decision.character);
            version += 1;
        }
        const result = {
            ok: true as const,
            value: decision.value,
            record: { character, _saveVersion: version },
            character: structuredClone(character),
            _saveVersion: version,
        };
        if (failure === 'after') {
            failure = null;
            throw new Error('injected-weekly-save-commit-ack');
        }
        return result;
    };
    return {
        mutateSave,
        get character() { return character; },
        failBefore() { failure = 'before'; },
        failAfter() { failure = 'after'; },
    };
}

describe('Weekly Boss start authority', () => {
    it('recovers save failures without double stamina and ignores shared receipt churn', async () => {
        const sharedReceipts = Array.from({ length: 80 }, (_, index) => ({
            requestId: `shared_${String(index).padStart(16, '0')}`,
            fingerprint: `shared-${index}`,
            value: { index },
            settledAt: NOW + index,
        }));
        const save = harness({ name: 'Alice', stamina: 100, serverSettlementReceipts: sharedReceipts });
        save.failBefore();
        await assert.rejects(
            chargeWeeklyBossStart(seal('weekly-precommit'), { mutateSave: save.mutateSave, now: () => NOW }),
            /precommit/,
        );
        assert.equal(save.character.stamina, 100);
        const afterPrecommit = await chargeWeeklyBossStart(seal('weekly-precommit'), { mutateSave: save.mutateSave, now: () => NOW });
        assert.equal(afterPrecommit.ok, true);
        assert.equal(save.character.stamina, 80);

        save.failAfter();
        await assert.rejects(
            chargeWeeklyBossStart(seal('weekly-commit-ack'), { mutateSave: save.mutateSave, now: () => NOW + 1 }),
            /commit-ack/,
        );
        assert.equal(save.character.stamina, 60);
        const recovered = await chargeWeeklyBossStart(seal('weekly-commit-ack'), { mutateSave: save.mutateSave, now: () => NOW + 2 });
        assert.equal(recovered.ok && recovered.replayed, true);
        assert.equal(save.character.stamina, 60);
        const compatibilityReceipts = save.character.serverSettlementReceipts as Array<{ requestId: string }>;
        assert.equal(compatibilityReceipts.length, 50);
        assert.ok(compatibilityReceipts.some((receipt) => receipt.requestId === 'weekly-start-weekly-commit-ack'));
    });

    it('preserves an unresolved run marker beyond the 64-entry soft history cap', async () => {
        const save = harness({ name: 'Alice', stamina: 2_000, serverSettlementReceipts: [] });
        const pendingSeal = seal('weekly-pending-original');
        const charged = await chargeWeeklyBossStart(pendingSeal, { mutateSave: save.mutateSave, now: () => NOW });
        assert.equal(charged.ok, true);
        for (let index = 0; index < 65; index += 1) {
            const churnSeal = seal(`weekly-churn-${String(index).padStart(3, '0')}`);
            const next = await chargeWeeklyBossStart(churnSeal, {
                mutateSave: save.mutateSave,
                now: () => NOW + 100 + index,
            });
            assert.equal(next.ok, true);
            const finalized = await finalizeWeeklyBossStart(churnSeal, {
                mutateSave: save.mutateSave,
                now: () => NOW + 1_000 + index,
            });
            assert.equal(finalized.ok, true);
        }
        const pending = (save.character[WEEKLY_BOSS_START_SETTLEMENTS_FIELD] as Array<{
            runId: string;
            recoverUntil: number;
            readyAt?: number;
        }>).find((entry) => entry.runId === pendingSeal.runId);
        assert.ok(pending);
        assert.equal(pending.readyAt, undefined);
        assert.equal(pending.recoverUntil, pendingSeal.recoverUntil);

        const staminaBeforeRetry = Number(save.character.stamina);
        const replay = await chargeWeeklyBossStart(pendingSeal, { mutateSave: save.mutateSave, now: () => NOW + 2_000 });
        assert.equal(replay.ok && replay.replayed, true);
        assert.equal(save.character.stamina, staminaBeforeRetry);
        const finalized = await finalizeWeeklyBossStart(pendingSeal, { mutateSave: save.mutateSave, now: () => NOW + 2_001 });
        assert.equal(finalized.ok, true);
    });

    it('promotes the exact pre-cutover start receipt without a second stamina debit', async () => {
        const oldSeal = seal('weekly-legacy-ready');
        const legacy = appendSettlementReceipt({ name: 'Alice', stamina: 80 }, [], {
            requestId: `weekly-start-${oldSeal.runId}`,
            fingerprint: `${oldSeal.weekKey}:${oldSeal.aiId}:${oldSeal.bossStartedAt}`,
            value: { kind: 'weekly-boss-start', stamina: 20 },
            settledAt: NOW - 100,
        });
        const save = harness(legacy);
        const charged = await chargeWeeklyBossStart(oldSeal, { mutateSave: save.mutateSave, now: () => NOW });
        assert.equal(charged.ok && charged.replayed, true);
        assert.equal(save.character.stamina, 80);
        const finalized = await finalizeWeeklyBossStart(oldSeal, { mutateSave: save.mutateSave, now: () => NOW + 1 });
        assert.equal(finalized.ok, true);
        assert.equal(save.character.stamina, 80);
        const marker = (save.character[WEEKLY_BOSS_START_SETTLEMENTS_FIELD] as Array<{ readyAt?: number }>)[0];
        assert.ok(Number(marker?.readyAt) > 0);
    });

    it('finalizing one start never evicts other live pending starts above the soft cap', async () => {
        const save = harness({ name: 'Alice', stamina: 2_000 });
        const pending = Array.from({ length: 66 }, (_, index) => seal(`weekly-many-pending-${String(index).padStart(3, '0')}`));
        for (let index = 0; index < pending.length; index += 1) {
            assert.equal((await chargeWeeklyBossStart(pending[index]!, {
                mutateSave: save.mutateSave,
                now: () => NOW + index,
            })).ok, true);
        }
        assert.equal((await finalizeWeeklyBossStart(pending[65]!, {
            mutateSave: save.mutateSave,
            now: () => NOW + 100,
        })).ok, true);
        const markers = save.character[WEEKLY_BOSS_START_SETTLEMENTS_FIELD] as Array<{ runId: string; readyAt?: number }>;
        assert.equal(markers.length, 66);
        for (const expected of pending.slice(0, 65)) {
            assert.ok(markers.some((marker) => marker.runId === expected.runId && marker.readyAt === undefined));
        }
    });
});
