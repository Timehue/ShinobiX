import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearHollowGateTilesMarker } from './_hollow-gate-tiles-marker.js';

/*
 * 2026-11-06, live: a rift card ambush settled, the client never sent its
 * battle-lock resolve, and the `hollowGateTiles` marker held the player "in
 * battle" (no travel) after the dive ended until its one-hour expiry. The
 * server now retires that marker itself when the card match settles or the
 * run ends.
 */

function store(initial?: unknown) {
    const values = new Map<string, unknown>();
    if (initial !== undefined) values.set('battle-lock:caius', initial);
    return {
        values,
        async get<T>(key: string) { return (values.get(key) as T | undefined) ?? null; },
        async delIfEqual(key: string, expected: unknown) {
            if (JSON.stringify(values.get(key)) !== JSON.stringify(expected)) return false;
            values.delete(key);
            return true;
        },
    };
}

const marker = { kind: 'hollowGateTiles', screen: 'hollowGateTiles', battleId: 'c71c45b77ddf43088a3fa019c5a4b2dc', startedAt: 1 };

describe('clearHollowGateTilesMarker', () => {
    it('removes a rift card marker', async () => {
        const kv = store(marker);
        assert.equal(await clearHollowGateTilesMarker('Caius', kv), true);
        assert.equal(kv.values.has('battle-lock:caius'), false);
    });

    it('never touches a Tower lease or another screen\'s marker under the same key', async () => {
        for (const other of [
            { kind: 'battleTowers', screen: 'battleTowers', battleId: 'run-1', startedAt: 1, meta: { runId: 'run-1' } },
            { kind: 'storyBoss', screen: 'storyHall', battleId: 'b-1', startedAt: 1 },
        ]) {
            const kv = store(other);
            assert.equal(await clearHollowGateTilesMarker('caius', kv), false);
            assert.deepEqual(kv.values.get('battle-lock:caius'), other);
        }
    });

    it('does nothing when no marker exists, and never throws', async () => {
        assert.equal(await clearHollowGateTilesMarker('caius', store()), false);
        const broken = { async get(): Promise<never> { throw new Error('kv down'); }, async delIfEqual() { return false; } };
        assert.equal(await clearHollowGateTilesMarker('caius', broken), false);
    });

    it('deletes only the exact marker it read', async () => {
        const kv = store(marker);
        const racing = {
            ...kv,
            async get<T>(key: string) {
                const read = await kv.get<T>(key);
                // A new marker lands between the read and the delete.
                kv.values.set(key, { ...marker, battleId: 'newer' });
                return read;
            },
        };
        assert.equal(await clearHollowGateTilesMarker('caius', racing), false);
        assert.equal((kv.values.get('battle-lock:caius') as { battleId: string }).battleId, 'newer');
    });

    it('both run-ending routes call it', () => {
        const read = (file: string) => readFileSync(join(process.cwd(), 'api', 'hollow-gate', file), 'utf8');
        assert.match(read('card-settle.ts'), /if \(result\.status === 200\) await clearHollowGateTilesMarker\(playerName\);/);
        assert.match(read('settle.ts'), /await clearHollowGateTilesMarker\(playerName\);/);
    });
});
