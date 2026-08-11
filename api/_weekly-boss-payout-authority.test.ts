import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { mutatePlayerSave } from './save/_mutate-player-save.js';
import {
    WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD,
    acknowledgeWeeklyBossPayout,
    creditWeeklyBossPayout,
    type WeeklyBossPayout,
} from './_weekly-boss-payout-authority.js';

const NOW = 1_800_000_000_000;

function payout(weekKey = '2027-W03'): WeeklyBossPayout {
    return {
        playerName: 'Alice',
        weekKey,
        bossStartedAt: NOW - 10_000,
        aiId: `boss-${weekKey}`,
        ryo: 500,
        gotCore: true,
        gotKey: true,
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
                throw new Error('injected-weekly-payout-precommit');
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
            throw new Error('injected-weekly-payout-commit-ack');
        }
        return result;
    };
    return {
        mutateSave,
        get character() { return character; },
        set character(value: Record<string, unknown>) { character = structuredClone(value); },
        failBefore() { failure = 'before'; },
        failAfter() { failure = 'after'; },
    };
}

describe('Weekly Boss payout authority', () => {
    it('survives commit acknowledgement loss and shared receipt eviction without paying twice', async () => {
        const save = harness({
            name: 'Alice',
            ryo: 100,
            unspentStats: 0,
            inventory: [],
            weeklyBossKills: {},
            serverSettlementReceipts: [],
        });
        save.failAfter();
        await assert.rejects(
            creditWeeklyBossPayout(payout(), { mutateSave: save.mutateSave, now: () => NOW }),
            /commit-ack/,
        );
        assert.equal(save.character.ryo, 600);
        assert.equal(save.character.unspentStats, 10);

        save.character = {
            ...save.character,
            serverSettlementReceipts: Array.from({ length: 80 }, (_, index) => ({
                requestId: `unrelated_${String(index).padStart(16, '0')}`,
                fingerprint: `unrelated-${index}`,
                value: { index },
                settledAt: NOW + index + 1,
            })),
        };
        const replay = await creditWeeklyBossPayout(payout(), { mutateSave: save.mutateSave, now: () => NOW + 100 });
        assert.equal(replay.ok && replay.replayed, true);
        assert.equal(save.character.ryo, 600);
        assert.equal(save.character.unspentStats, 10);
        assert.equal((save.character.inventory as string[]).filter((id) => id === 'weekly-boss-core').length, 1);
    });

    it('migrates exact old payout proof after its generic receipt was evicted', async () => {
        const paid = payout('2027-W04');
        const requestId = `weeklyboss_${createHash('sha256').update(`${paid.weekKey}:${paid.playerName}`).digest('hex').slice(0, 32)}`;
        const save = harness({
            name: 'Alice',
            ryo: 600,
            unspentStats: 10,
            inventory: ['weekly-boss-core', 'dungeon-key'],
            weeklyBossKills: { [paid.weekKey]: paid.aiId },
            serverSettlementReceipts: Array.from({ length: 80 }, (_, index) => ({
                requestId: `evictor_${String(index).padStart(16, '0')}`,
                fingerprint: `evictor-${index}`,
                value: { index },
                settledAt: NOW + index,
            })).filter((entry) => entry.requestId !== requestId),
        });
        const migrated = await creditWeeklyBossPayout(paid, {
            mutateSave: save.mutateSave,
            now: () => NOW + 1_000,
            migrationOnly: true,
        });
        assert.equal(migrated.ok && migrated.migratedLegacy, true);
        assert.equal(save.character.ryo, 600);
        assert.equal(save.character.unspentStats, 10);
        assert.equal((save.character[WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD] as unknown[]).length, 1);
    });

    it('promotes a rolling v1 week marker to the exact v2 spawn without repaying', async () => {
        const paid = payout('2027-W08');
        const legacyFingerprint = createHash('sha256').update(JSON.stringify({
            version: 1,
            playerName: paid.playerName.toLowerCase(),
            weekKey: paid.weekKey,
            aiId: paid.aiId,
            ryo: paid.ryo,
            gotCore: paid.gotCore,
            gotKey: paid.gotKey,
            statPoints: 10,
        })).digest('hex');
        const save = harness({
            name: 'Alice',
            ryo: 500,
            unspentStats: 10,
            inventory: ['weekly-boss-core', 'dungeon-key'],
            weeklyBossKills: { [paid.weekKey]: paid.aiId },
            [WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD]: [{
                version: 1,
                weekKey: paid.weekKey,
                aiId: paid.aiId,
                fingerprint: legacyFingerprint,
                ryo: paid.ryo,
                gotCore: paid.gotCore,
                gotKey: paid.gotKey,
                creditedAt: NOW - 100,
                recoverUntil: NOW + 10_000,
            }],
        });
        const migrated = await creditWeeklyBossPayout(paid, {
            mutateSave: save.mutateSave,
            now: () => NOW,
        });
        assert.equal(migrated.ok && migrated.replayed, true);
        assert.equal(migrated.ok && migrated.migratedLegacy, true);
        assert.equal(save.character.ryo, 500);
        const marker = (save.character[WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD] as Array<{
            version: number; weekKey: string; bossStartedAt: number; fingerprint: string;
        }>)[0]!;
        assert.equal(marker.version, 2);
        assert.equal(marker.weekKey, paid.weekKey);
        assert.equal(marker.bossStartedAt, paid.bossStartedAt);
        assert.notEqual(marker.fingerprint, legacyFingerprint);
    });

    it('never evicts an unacknowledged payout while acknowledged history churns', async () => {
        const save = harness({ name: 'Alice', ryo: 0, unspentStats: 0, inventory: [], weeklyBossKills: {} });
        const pending = payout('2027-W01');
        assert.equal((await creditWeeklyBossPayout(pending, { mutateSave: save.mutateSave, now: () => NOW })).ok, true);
        for (let index = 2; index <= 70; index += 1) {
            const next = payout(`2027-W${String(index).padStart(2, '0')}`);
            const credited = await creditWeeklyBossPayout(next, {
                mutateSave: save.mutateSave,
                now: () => NOW + index * 10,
            });
            assert.equal(credited.ok, true);
            const acknowledged = await acknowledgeWeeklyBossPayout(next, {
                mutateSave: save.mutateSave,
                now: () => NOW + index * 10 + 1,
            });
            assert.equal(acknowledged.ok, true);
        }
        const markers = save.character[WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD] as Array<{
            weekKey: string;
            bossAcknowledgedAt?: number;
        }>;
        assert.ok(markers.some((marker) => marker.weekKey === pending.weekKey && marker.bossAcknowledgedAt === undefined));
        assert.ok(markers.length <= 64);
    });

    it('keeps every live pending payout when acknowledging a history above the soft cap', async () => {
        const save = harness({ name: 'Alice', ryo: 0, unspentStats: 0, inventory: [], weeklyBossKills: {} });
        const pending: WeeklyBossPayout[] = [];
        for (let index = 1; index <= 66; index += 1) {
            const next = payout(`2028-W${String(index).padStart(2, '0')}`);
            pending.push(next);
            assert.equal((await creditWeeklyBossPayout(next, {
                mutateSave: save.mutateSave,
                now: () => NOW + index,
            })).ok, true);
        }
        assert.equal((await acknowledgeWeeklyBossPayout(pending[65]!, {
            mutateSave: save.mutateSave,
            now: () => NOW + 100,
        })).ok, true);
        const markers = save.character[WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD] as Array<{
            weekKey: string;
            bossAcknowledgedAt?: number;
        }>;
        assert.equal(markers.length, 66);
        for (const expected of pending.slice(0, 65)) {
            assert.ok(markers.some((marker) => marker.weekKey === expected.weekKey && marker.bossAcknowledgedAt === undefined));
        }
    });

    it('does not mutate rewards on a precommit failure', async () => {
        const save = harness({ name: 'Alice', ryo: 100, unspentStats: 0, inventory: [], weeklyBossKills: {} });
        save.failBefore();
        await assert.rejects(
            creditWeeklyBossPayout(payout('2027-W05'), { mutateSave: save.mutateSave, now: () => NOW }),
            /precommit/,
        );
        assert.equal(save.character.ryo, 100);
        assert.equal(save.character[WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD], undefined);
    });

    it('reconciliation cannot turn a boss-only acknowledgement into a fresh payout', async () => {
        const save = harness({ name: 'Alice', ryo: 100, unspentStats: 0, inventory: [], weeklyBossKills: {} });
        const rejected = await creditWeeklyBossPayout(payout('2027-W06'), {
            mutateSave: save.mutateSave,
            now: () => NOW,
            migrationOnly: true,
        });
        assert.equal(rejected.ok, false);
        assert.equal(save.character.ryo, 100);
        assert.equal(save.character.unspentStats, 0);
        assert.equal(save.character[WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD], undefined);
    });

    it('binds payout replay to the exact spawn and rejects same-week successor confusion', async () => {
        const save = harness({ name: 'Alice', ryo: 0, unspentStats: 0, inventory: [], weeklyBossKills: {} });
        const first = payout('2027-W07');
        assert.equal((await creditWeeklyBossPayout(first, { mutateSave: save.mutateSave, now: () => NOW })).ok, true);
        const successor = { ...first, bossStartedAt: first.bossStartedAt + 1, aiId: first.aiId };
        const conflict = await creditWeeklyBossPayout(successor, { mutateSave: save.mutateSave, now: () => NOW + 1 });
        assert.equal(conflict.ok, false);
        if (!conflict.ok) assert.match(conflict.error, /another spawn/);
        assert.equal(save.character.ryo, 500);
        assert.equal((save.character[WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD] as unknown[]).length, 1);
    });
});
