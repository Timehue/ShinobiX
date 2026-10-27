import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeCharacterSave } from './[name].js';
import { BATTLE_FLOOR_FEE, debitTowerStoryEntry } from '../towers/_entry-fee.js';

const day = '2026-10-27';
const storedSave = () => ({ character: {
    name: 'TowerClearOwnership', level: 30, ryo: 50_000,
    battleTowerBestFloor: 3, battleTowerRating: 500, battleTowerClearedFloors: [1, 2, 3],
    battleTowerClaimedRewards: ['floor-1', 'floor-2', 'floor-3'],
    dailyBattleDate: day, dailyBattleFloors: 3,
} });

function withBothLedgerModes(run: () => void) {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    try {
        for (const mode of ['0', '1']) {
            process.env.STRICT_RAW_SAVE_LEDGER = mode;
            run();
        }
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
}

test('ordinary saves cannot erase, replace, omit or forge confirmed Tower clears', () => {
    withBothLedgerModes(() => {
        for (const cleared of [[], [1], [1, 2, 3, 4, 15], undefined, null, 'all']) {
            const stored = storedSave();
            const incoming = { character: { ...stored.character, battleTowerClearedFloors: cleared, battleTowerClaimedRewards: [] } };
            const output = sanitizeCharacterSave(incoming, stored).character as Record<string, unknown>;
            assert.deepEqual(output.battleTowerClearedFloors, [1, 2, 3], `incoming=${JSON.stringify(cleared)}`);
            assert.deepEqual(output.battleTowerClaimedRewards, ['floor-1', 'floor-2', 'floor-3']);
            assert.deepEqual(stored.character.battleTowerClearedFloors, [1, 2, 3], 'sanitization leaves the stored source unchanged');
        }
    });
});

test('first saves and legacy saves without confirmed clears cannot invent free Story replays', () => {
    withBothLedgerModes(() => {
        for (const existing of [null, { character: { name: 'TowerClearOwnership', level: 30, ryo: 50_000 } }]) {
            const output = sanitizeCharacterSave({ character: { ...storedSave().character, battleTowerClearedFloors: [1, 15] } }, existing);
            assert.equal((output.character as Record<string, unknown>).battleTowerClearedFloors, undefined);
        }
    });
});

test('malformed ordinary saves cannot erase confirmed Tower best floor or rating', () => {
    withBothLedgerModes(() => {
        for (const value of ['bad', {}, [1, 2], null, undefined, -1, 999_999]) {
            const stored = storedSave();
            const incoming = { character: { ...stored.character, battleTowerBestFloor: value, battleTowerRating: value } };
            const output = sanitizeCharacterSave(incoming, stored).character as Record<string, unknown>;
            assert.equal(output.battleTowerBestFloor, 3, `best floor with input=${JSON.stringify(value)}`);
            assert.equal(output.battleTowerRating, 500, `rating with input=${JSON.stringify(value)}`);
            assert.deepEqual(output.battleTowerClearedFloors, [1, 2, 3]);
            assert.deepEqual(output.battleTowerClaimedRewards, ['floor-1', 'floor-2', 'floor-3']);
            assert.equal(stored.character.battleTowerBestFloor, 3);
            assert.equal(stored.character.battleTowerRating, 500);
        }
    });
});

test('stale or forged autosaves cannot change the authoritative Story entry charge', () => {
    withBothLedgerModes(() => {
        const stored = storedSave();
        const stale = sanitizeCharacterSave({ character: { ...stored.character, battleTowerClearedFloors: [] } }, stored).character as Record<string, unknown>;
        const replay = debitTowerStoryEntry(stale, day, 3);
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        assert.equal(replay.charged, 0, 'an already confirmed clear remains a free replay');
        assert.equal(replay.counted, false);

        const forged = sanitizeCharacterSave({ character: { ...stored.character, battleTowerClearedFloors: [1, 2, 3, 4] } }, stored).character as Record<string, unknown>;
        const fresh = debitTowerStoryEntry(forged, day, 4);
        assert.equal(fresh.ok, true);
        if (!fresh.ok) return;
        assert.equal(fresh.charged, BATTLE_FLOOR_FEE, 'a forged clear cannot bypass the normal entry fee');
        assert.equal(fresh.counted, true);
        assert.equal(fresh.replayFree, false);
        assert.equal(fresh.character.ryo, 50_000 - BATTLE_FLOOR_FEE);
    });
});
