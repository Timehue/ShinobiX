import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { settleVitalsRegen } from '../_elapsed-state.js';
import { settleIdleRecovery } from './_mutate-player-save.js';

/*
 * settleIdleRecovery is mutatePlayerSave's idle-recovery settle for a writer
 * that reads through its own store. A battle lock excludes the recovery, with
 * one exception: the lock a writer has just taken to BEGIN its own battle (a
 * Tower entry fee is charged under the run's lease). The time before that lock
 * began was idle, so it settles the recovery up to the lock's start and no
 * further.
 */

const PLAYER = 'idlesettler';
const LOCK_KEY = `battle-lock:${PLAYER}`;
const mine = (lock: unknown) => (lock as { battleId?: unknown } | null)?.battleId === 'my-run';

function tired(at: number) {
    return {
        _saveVersion: 1,
        _saveAt: at,
        _regenAt: at,
        character: { hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 },
    };
}

describe('settleIdleRecovery', () => {
    it('settles every whole tick up to now when no battle holds the player', async () => {
        const store = _makeMemoryKv();
        const at = Date.now() - 30_000;
        const out = await settleIdleRecovery(store, PLAYER, tired(at));
        assert.equal(out.regen.excluded, false);
        assert.ok(Number(out.character.hp) >= 40, `hp ${out.character.hp}`);
        assert.ok(out.regen.cursor >= at + 29_000, `cursor ${out.regen.cursor}`);
        assert.equal((out.regen.cursor - at) % 1_000, 0, 'whole ticks from the stored cursor');
    });

    it('credits nothing while another battle holds the player', async () => {
        const store = _makeMemoryKv();
        const at = Date.now() - 30_000;
        await store.set(LOCK_KEY, { battleId: 'someone-elses-fight', startedAt: at + 5_000 });
        const out = await settleIdleRecovery(store, PLAYER, tired(at), { ownBattleLock: mine });
        assert.equal(out.regen.excluded, true);
        assert.equal(out.character.hp, 10);
    });

    it('settles up to where its own battle lock began, and never past it', async () => {
        const store = _makeMemoryKv();
        const at = Date.now() - 30_000;
        const lockStart = at + 20_000;
        await store.set(LOCK_KEY, { battleId: 'my-run', startedAt: lockStart });
        const out = await settleIdleRecovery(store, PLAYER, tired(at), { ownBattleLock: mine });
        assert.equal(out.regen.excluded, false);
        assert.equal(out.regen.cursor, lockStart, 'twenty idle seconds, then the battle');
        const upToLock = settleVitalsRegen(tired(at), { now: lockStart, battleLocked: false });
        assert.deepEqual(
            [out.character.hp, out.character.chakra, out.character.stamina],
            [upToLock.record.character.hp, upToLock.record.character.chakra, upToLock.record.character.stamina],
            'exactly the recovery of the idle time before the lock',
        );
        const upToNow = await settleIdleRecovery(_makeMemoryKv(), PLAYER, tired(at));
        assert.ok(Number(out.character.stamina) < Number(upToNow.character.stamina), 'the battle time is not idle time');
    });

    it('excludes a lock of its own that has no usable start', async () => {
        const store = _makeMemoryKv();
        const at = Date.now() - 30_000;
        await store.set(LOCK_KEY, { battleId: 'my-run', startedAt: 'soon' });
        const out = await settleIdleRecovery(store, PLAYER, tired(at), { ownBattleLock: mine });
        assert.equal(out.regen.excluded, true);
        assert.equal(out.character.hp, 10);
    });
});
