import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { onlineStore } from '../_realtime/online-store.js';
import { battleStateKey, noteBattleStarted, publishBattleProjection, resetRecentBattleStartsForTests } from '../_realtime/battle-projection.js';
import { battleLockKey, claimTowerBattleLeases, releaseTowerBattleLeases } from './_battle-lease.js';
import type { TowerKv, TowerLock } from './_tower-store.js';

const member = 'tower-retirement-retry';
const oldRun = 'tower-terminal-old';
const newRun = 'tower-active-new';
const lock: TowerLock = async (_key, fn) => fn();
const projection = (sessionId: string) => ({ kind: 'tower' as const, sessionId, startedAt: 10, expiresAt: 9999999999999 });

afterEach(() => { onlineStore.remove(member); resetRecentBattleStartsForTests(); });

async function terminalFixture() {
    const kv = _makeMemoryKv();
    onlineStore.upsert({ name: member, sector: 20, character: null });
    await claimTowerBattleLeases({ runId: oldRun, members: [member] }, { kv, lock, now: () => 10 });
    // The prior terminal attempt committed its domain lease deletion, but lost
    // its outer lease before retiring the retained battle projection.
    await kv.del(battleLockKey(member));
    return kv;
}

it('a terminal retry retires matching projection and presence after domain lease deletion', async () => {
    const kv = await terminalFixture();
    await releaseTowerBattleLeases(oldRun, [member], { kv, lock });
    assert.equal(await kv.get(battleStateKey(member)), null);
    assert.equal(Boolean(onlineStore.get(member)?.inBattle), false);
    await releaseTowerBattleLeases(oldRun, [member], { kv, lock });
    assert.equal(await kv.get(battleStateKey(member)), null);
});

it('a terminal retry keeps a replacement published between its advisory read and retirement', async () => {
    const kv = await terminalFixture();
    let raced = false;
    const racing: TowerKv = { ...kv, async get<T>(key: string) {
        const value = await kv.get<T>(key);
        if (!raced && key === battleStateKey(member)) {
            raced = true;
            await publishBattleProjection(kv, member, projection(newRun), 60);
            noteBattleStarted(member, 10);
        }
        return value;
    } };
    await releaseTowerBattleLeases(oldRun, [member], { kv: racing, lock });
    assert.equal(raced, true);
    assert.equal((await kv.get<{ sessionId: string }>(battleStateKey(member)))?.sessionId, newRun);
    assert.equal(onlineStore.get(member)?.inBattle, true);
});

it('a terminal retry keeps a new same-tick start after projection CAS and before acknowledgement', async () => {
    const kv = await terminalFixture();
    noteBattleStarted(member, 10);
    let raced = false;
    const racing: TowerKv = { ...kv, async delIfEqual(key, expected) {
        const deleted = await kv.delIfEqual(key, expected);
        if (deleted && key === battleStateKey(member)) {
            raced = true;
            await publishBattleProjection(kv, member, projection(newRun), 60);
            noteBattleStarted(member, 10);
        }
        return deleted;
    } };
    await releaseTowerBattleLeases(oldRun, [member], { kv: racing, lock });
    assert.equal(raced, true);
    assert.equal((await kv.get<{ sessionId: string }>(battleStateKey(member)))?.sessionId, newRun);
    assert.equal(onlineStore.get(member)?.inBattle, true);
});

it('a failed projection cleanup stays retryable without reviving or deleting any domain lease', async () => {
    const kv = await terminalFixture();
    const failing: TowerKv = { ...kv, async delIfEqual() { throw new Error('injected outer lease loss'); } };
    await releaseTowerBattleLeases(oldRun, [member], { kv: failing, lock });
    assert.equal(await kv.get(battleLockKey(member)), null);
    assert.equal((await kv.get<{ sessionId: string }>(battleStateKey(member)))?.sessionId, oldRun);
    assert.equal(onlineStore.get(member)?.inBattle, true);
    await releaseTowerBattleLeases(oldRun, [member], { kv, lock });
    assert.equal(await kv.get(battleLockKey(member)), null);
    assert.equal(await kv.get(battleStateKey(member)), null);
    assert.equal(Boolean(onlineStore.get(member)?.inBattle), false);
});
