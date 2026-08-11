import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { compensateConfirmedMissingTowerEntry } from './_entry-recovery.js';
import { reserveTowerDirectEntry } from './_party-entry.js';
import {
    battleLockKey,
    claimTowerBattleLeases,
    recoverConfirmedMissingTowerBattleLease,
    TOWER_BATTLE_PUBLICATION_GRACE_MS,
} from './_battle-lease.js';
import type { TowerKv, TowerLock } from './_tower-store.js';

const lock: TowerLock = async (_key, fn) => fn();

function character() {
    return {
        name: 'Host',
        ryo: 5_000,
        dailyBattleDate: '2027-01-15',
        dailyBattleFloors: 3,
        battleTowerClearedFloors: [] as number[],
    };
}

async function seedDirectReservation(kv: TowerKv, runId: string) {
    const initial = character();
    const reserved = reserveTowerDirectEntry({
        character: initial,
        runId,
        day: initial.dailyBattleDate,
        floorId: 5,
        now: 1_000,
    });
    assert.equal(reserved.ok, true);
    if (!reserved.ok) throw new Error('reservation failed');
    await kv.set('save:host', { _saveVersion: 1, character: reserved.character });
    return { initial, reserved };
}

describe('Tower confirmed-missing entry compensation', () => {
    it('restores a direct Story debit exactly once before deleting its crash lease', async () => {
        let now = 1_000;
        const kv = _makeMemoryKv() as unknown as TowerKv;
        const { initial } = await seedDirectReservation(kv, 'tower-direct-missing');
        await claimTowerBattleLeases({ runId: 'tower-direct-missing', members: ['host'] }, { kv, lock, now: () => now });
        now += TOWER_BATTLE_PUBLICATION_GRACE_MS + 1;
        const recovery = await recoverConfirmedMissingTowerBattleLease('tower-direct-missing', 'host', {
            kv,
            lock,
            now: () => now,
            beforeConfirmedMissingRelease: async () => {
                await compensateConfirmedMissingTowerEntry({ hostSlug: 'host', runId: 'tower-direct-missing' }, { kv, lock, now: () => now });
            },
        });
        assert.deepEqual(recovery, { released: true, pending: false });
        assert.equal(await kv.get(battleLockKey('host')), null);
        const save = await kv.get<{ _saveVersion: number; character: ReturnType<typeof character> }>('save:host');
        assert.equal(save?.character.ryo, initial.ryo);
        assert.equal(save?.character.dailyBattleFloors, initial.dailyBattleFloors);
        const version = save?._saveVersion;
        assert.deepEqual(await compensateConfirmedMissingTowerEntry({
            hostSlug: 'host', runId: 'tower-direct-missing',
        }, { kv, lock, now: () => now }), { found: true, changed: false });
        assert.equal((await kv.get<{ _saveVersion: number }>('save:host'))?._saveVersion, version);
    });

    it('preserves the exact lease when compensation is uncertain', async () => {
        let now = 1_000;
        const kv = _makeMemoryKv() as unknown as TowerKv;
        await claimTowerBattleLeases({ runId: 'tower-compensation-error', members: ['host'] }, { kv, lock, now: () => now });
        now += TOWER_BATTLE_PUBLICATION_GRACE_MS + 1;
        await assert.rejects(() => recoverConfirmedMissingTowerBattleLease('tower-compensation-error', 'host', {
            kv,
            lock,
            now: () => now,
            beforeConfirmedMissingRelease: async () => { throw new Error('save unavailable'); },
        }), /save unavailable/);
        assert.equal((await kv.get<{ battleId: string }>(battleLockKey('host')))?.battleId, 'tower-compensation-error');
    });

    it('recovers a commit-then-throw reservation through its durable receipt', async () => {
        const kv = _makeMemoryKv() as unknown as TowerKv;
        const initial = character();
        await kv.set('save:host', { _saveVersion: 1, character: initial });
        const reserved = reserveTowerDirectEntry({
            character: initial, runId: 'tower-forwarded-entry', day: initial.dailyBattleDate, floorId: 5, now: 1_000,
        });
        assert.equal(reserved.ok, true);
        if (!reserved.ok) return;
        const baseSet = kv.set.bind(kv);
        await assert.rejects(async () => {
            await baseSet('save:host', { _saveVersion: 2, character: reserved.character });
            throw new Error('acknowledgement lost');
        }, /acknowledgement lost/);
        assert.deepEqual(await compensateConfirmedMissingTowerEntry({
            hostSlug: 'host', runId: 'tower-forwarded-entry',
        }, { kv, lock, now: () => 2_000 }), { found: true, changed: true });
        const save = await kv.get<{ character: ReturnType<typeof character> }>('save:host');
        assert.equal(save?.character.ryo, initial.ryo);
        assert.equal(save?.character.dailyBattleFloors, initial.dailyBattleFloors);
    });

    it('wires ambiguous writes and both missing-run recovery routes to the receipt saga', () => {
        const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
        const start = source('api/towers/start.ts');
        const attempted = start.indexOf('reservationWriteAttempted = true');
        const write = start.indexOf('await writeSaveProjected', attempted);
        const uncertain = start.indexOf('if (reservationWriteAttempted) publicationInconclusive = true', write);
        const cleanup = start.indexOf('!publicationInconclusive', uncertain);
        assert.ok(attempted > 0 && write > attempted && uncertain > write && cleanup > uncertain);
        for (const file of ['api/towers/state.ts', 'api/towers/my-run.ts']) {
            const text = source(file);
            assert.match(text, /beforeConfirmedMissingRelease:[\s\S]{0,240}compensateConfirmedMissingTowerEntry/, file);
        }
    });
});
