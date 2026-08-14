import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAiFightTokenRecord } from './_ai-fight-token.js';
import {
    AI_FIGHT_REWARD_SETTLEMENTS_FIELD,
    aiFightDailyCounterKey,
    aiFightDailyReservationKey,
    aiFightRedemptionFingerprint,
    aiFightSavedDailyCounts,
    commitAiFightRedemptionAuthority,
    inspectAiFightRedemptionAuthority,
    mirrorAiFightDailyCountMonotonic,
    readAiFightLegacyDailyCount,
    reserveAiFightDailyOrdinal,
    type AiFightRedemption,
} from './_ai-fight-redemption-authority.js';
import type { KvLike } from '../_storage.js';

const NOW = 1_800_000_000_000;
const DATE = '2027-01-15';

function authorityParams(token: string, paysReward: boolean, reservedDailyCount?: number) {
    const tokenData = createAiFightTokenRecord('Alice', token, NOW - 1_000, {
        sessionRuntime: 'solo-pve',
        sessionId: `session-${token}`,
        baseXp: 100,
        baseRyo: 75,
        battleKind: paysReward ? 'mission' : 'practice',
    });
    const claim = { xp: 100, ryo: 75 };
    return {
        tokenData,
        inspect: (character: Record<string, unknown>) => {
            const savedDailyCount = aiFightSavedDailyCounts(character)[DATE] ?? 0;
            return inspectAiFightRedemptionAuthority({
                character,
                token,
                fingerprint: aiFightRedemptionFingerprint({
                    playerName: 'Alice',
                    token,
                    tokenData,
                    sessionId: `session-${token}`,
                    outcome: paysReward ? 'win' : 'loss',
                    battleKind: paysReward ? 'mission' : 'practice',
                    claim,
                }),
                mintedAt: tokenData.mintedAt,
                now: NOW,
                date: DATE,
                paysReward,
                reservedDailyCount: paysReward ? (reservedDailyCount ?? savedDailyCount + 1) : undefined,
            });
        },
    };
}

function commit(
    character: Record<string, unknown>,
    token: string,
    paysReward: boolean,
    reservedDailyCount?: number,
): Record<string, unknown> {
    const inspected = authorityParams(token, paysReward, reservedDailyCount).inspect(character);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.ok && inspected.replayed, false);
    if (!inspected.ok || inspected.replayed) return character;
    const redemption: AiFightRedemption = {
        token,
        xp: paysReward ? 100 : 0,
        ryo: paysReward ? 75 : 0,
        capped: false,
        dailyCount: inspected.dailyCount,
    };
    return commitAiFightRedemptionAuthority(character, inspected, redemption);
}

describe('AI-fight redemption authority', () => {
    it('preserves a live winning-token receipt through more than 100 loss receipts', () => {
        const winningToken = 'WinningToken0001';
        let character: Record<string, unknown> = commit({}, winningToken, true);
        for (let index = 0; index < 101; index += 1) {
            character = commit(character, `LossToken${String(index).padStart(4, '0')}`, false);
        }
        const manifest = character[AI_FIGHT_REWARD_SETTLEMENTS_FIELD] as {
            receipts: Array<{ token: string; expiresAt: number }>;
        };
        assert.equal(manifest.receipts.length, 102);
        assert.ok(manifest.receipts.every((entry) => entry.expiresAt > NOW));
        assert.ok(manifest.receipts.some((entry) => entry.token === winningToken));

        const replay = authorityParams(winningToken, true).inspect(character);
        assert.equal(replay.ok, true);
        assert.equal(replay.ok && replay.replayed, true);
        if (replay.ok && replay.replayed) {
            assert.deepEqual(replay.redemption, {
                token: winningToken,
                xp: 100,
                ryo: 75,
                capped: false,
                dailyCount: 1,
            });
        }
    });

    it('does not burn the daily count on a precommit failure and recovers a committed save acknowledgement loss', () => {
        let character: Record<string, unknown> = { ryo: 0 };
        const redeem = (token: string, failure: 'before' | 'after' | 'none') => {
            const inspected = authorityParams(token, true).inspect(character);
            assert.equal(inspected.ok, true);
            if (!inspected.ok) return null;
            if (inspected.replayed) return inspected.redemption;
            const redemption: AiFightRedemption = {
                token,
                xp: 100,
                ryo: 75,
                capped: false,
                dailyCount: inspected.dailyCount,
            };
            const next = commitAiFightRedemptionAuthority(
                { ...character, ryo: Number(character.ryo ?? 0) + redemption.ryo },
                inspected,
                redemption,
            );
            if (failure === 'before') throw new Error('injected-save-precommit-failure');
            character = next;
            if (failure === 'after') throw new Error('injected-save-commit-ack-loss');
            return redemption;
        };

        assert.throws(() => redeem('PrecommitToken001', 'before'), /precommit/);
        assert.equal(character.ryo, 0);
        const precommitRetry = redeem('PrecommitToken001', 'none');
        assert.equal(precommitRetry?.dailyCount, 1);
        assert.equal(character.ryo, 75);

        assert.throws(() => redeem('CommitAckToken001', 'after'), /commit-ack/);
        assert.equal(character.ryo, 150);
        const commitRetry = redeem('CommitAckToken001', 'none');
        assert.equal(commitRetry?.dailyCount, 2);
        assert.equal(character.ryo, 150, 'marker replay cannot pay or increment twice');

        const third = authorityParams('ReservedCounterToken1', true, 8).inspect({});
        assert.equal(third.ok, true);
        if (third.ok && !third.replayed) assert.equal(third.dailyCount, 8, 'the exact mixed-worker reservation owns the ordinal');
    });

    it('reserves after a racing legacy INCR so old and new workers cannot share an ordinal', async () => {
        const counterKey = aiFightDailyCounterKey('Alice', DATE);
        const reservationKey = aiFightDailyReservationKey('Alice', 'MixedWorkerToken01');
        const values = new Map<string, unknown>([[counterKey, 7]]);
        let injectLegacyIncrement = true;
        const store: Pick<KvLike, 'get' | 'compareSet'> = {
            async get<T>(key: string) { return (values.get(key) ?? null) as T; },
            async compareSet(key, expected, next) {
                const current = values.get(key) ?? null;
                assert.deepEqual(current, expected);
                if (key === counterKey && injectLegacyIncrement) {
                    injectLegacyIncrement = false;
                    values.set(key, 8); // old worker atomically claims ordinal 8
                    return false;
                }
                values.set(key, next);
                return true;
            },
        };

        const reserved = await reserveAiFightDailyOrdinal(store, {
            playerName: 'Alice',
            token: 'MixedWorkerToken01',
            mintedAt: NOW - 1_000,
            requestedDate: DATE,
            minimumDailyCounts: { [DATE]: 7 },
            ttlSeconds: 60,
        });
        assert.deepEqual(reserved, { date: DATE, dailyCount: 9, counterKey });
        assert.equal(values.get(counterKey), 9);
        assert.deepEqual(values.get(reservationKey), {
            version: 1,
            playerName: 'alice',
            token: 'MixedWorkerToken01',
            mintedAt: NOW - 1_000,
            date: DATE,
            state: 'committed',
            dailyCount: 9,
        });

        const retry = await reserveAiFightDailyOrdinal(store, {
            playerName: 'Alice',
            token: 'MixedWorkerToken01',
            mintedAt: NOW - 1_000,
            requestedDate: '2027-01-16',
            minimumDailyCounts: { [DATE]: 9 },
            ttlSeconds: 60,
        });
        assert.deepEqual(retry, reserved, 'retry is pinned to the exact original day and ordinal');
        assert.equal(values.get(counterKey), 9);
    });

    it('requires exact reservation evidence after a lost counter acknowledgement', async () => {
        const counterKey = aiFightDailyCounterKey('Alice', DATE);
        const values = new Map<string, unknown>([[counterKey, 0]]);
        let loseCounterAck = true;
        const store: Pick<KvLike, 'get' | 'compareSet'> = {
            async get<T>(key: string) { return (values.get(key) ?? null) as T; },
            async compareSet(key, expected, next) {
                const current = values.get(key) ?? null;
                if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
                values.set(key, next);
                if (key === counterKey && loseCounterAck) {
                    loseCounterAck = false;
                    throw new Error('injected-counter-commit-ack-loss');
                }
                return true;
            },
        };

        const reserved = await reserveAiFightDailyOrdinal(store, {
            playerName: 'Alice',
            token: 'CounterAckLossToken1',
            mintedAt: NOW - 1_000,
            requestedDate: DATE,
            ttlSeconds: 60,
        });
        assert.equal(reserved.dailyCount, 2, 'ambiguous ordinal 1 is burned, never inferred from scalar readback');
        assert.equal(values.get(counterKey), 2);
        assert.deepEqual(await reserveAiFightDailyOrdinal(store, {
            playerName: 'Alice',
            token: 'CounterAckLossToken1',
            mintedAt: NOW - 1_000,
            requestedDate: DATE,
            ttlSeconds: 60,
        }), reserved, 'only the exact committed reservation is retry evidence');
        assert.equal(values.get(counterKey), 2);
    });

    it('mirrors the legacy counter with exact CAS max across races and ambiguous acknowledgements', async () => {
        let value: unknown = 4;
        let mode: 'race-higher' | 'commit-throw' | 'fulfilled-null' | null = 'race-higher';
        const store: Pick<KvLike, 'get' | 'compareSet'> = {
            async get<T>() { return value as T; },
            async compareSet(_key, expected, next) {
                if (mode === 'race-higher') {
                    mode = null;
                    value = 9; // old rolling worker INCRs after our read
                    return false;
                }
                if (mode === 'commit-throw') {
                    mode = null;
                    assert.deepEqual(value, expected);
                    value = next;
                    throw new Error('injected-counter-ack-loss');
                }
                if (mode === 'fulfilled-null') {
                    mode = null;
                    assert.deepEqual(value, expected);
                    value = next;
                    return null as never;
                }
                if (!Object.is(value, expected)) return false;
                value = next;
                return true;
            },
        };

        assert.equal(await mirrorAiFightDailyCountMonotonic(store, 'counter', 6, 60), 9);
        assert.equal(value, 9, 'a stale mirror never regresses a racing legacy INCR');

        value = 3;
        mode = 'commit-throw';
        assert.equal(await mirrorAiFightDailyCountMonotonic(store, 'counter', 7, 60), 7);
        assert.equal(value, 7);

        value = 2;
        mode = 'fulfilled-null';
        assert.equal(await mirrorAiFightDailyCountMonotonic(store, 'counter', 8, 60), 8);
        assert.equal(value, 8);
    });

    it('fails closed on a malformed legacy counter instead of overwriting it', async () => {
        const store = {
            async get() { return { corrupt: true }; },
            async compareSet() { throw new Error('must-not-write'); },
        } as Pick<KvLike, 'get' | 'compareSet'>;
        await assert.rejects(
            mirrorAiFightDailyCountMonotonic(store, 'counter', 3, 60),
            /counter-invalid/,
        );
        await assert.rejects(
            readAiFightLegacyDailyCount(store, 'counter'),
            /counter-invalid/,
        );
    });
});
