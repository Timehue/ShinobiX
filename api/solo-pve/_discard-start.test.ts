process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    assertKvLockContext,
    currentKvLockContext,
    poisonKvLockContext,
    withKvLeaseContext,
} from '../_kv-lock-context.js';
import { discardFailedStart } from './_discard-start.js';

/*
 * 2026-11-06, live: ai-fight-start wrote a solo-pve session, then a poisoned
 * lock context made its next write and its catch-block cleanup both throw. The
 * fight stayed live with no pointer to resume it, so the player was held "in
 * battle" (no travel) until it lapsed 30 minutes later.
 *
 * The fake store enforces the lock context the way the real Postgres store
 * does (api/_storage.ts fencedPg). The in-memory QA store does not.
 */

function fencedStore(initial: Record<string, unknown> = {}) {
    const values = new Map<string, unknown>(Object.entries(initial));
    return {
        values,
        async get<T>(key: string) { assertKvLockContext(); return (values.get(key) as T | undefined) ?? null; },
        async set(key: string, value: unknown) { assertKvLockContext(); values.set(key, value); return 'OK'; },
        async del(...keys: string[]) { assertKvLockContext(); for (const key of keys) values.delete(key); return keys.length; },
        async delIfEqual(key: string, expected: unknown) {
            assertKvLockContext();
            if (JSON.stringify(values.get(key)) !== JSON.stringify(expected)) return false;
            values.delete(key);
            return true;
        },
    };
}

const projection = (sessionId: string) => ({ version: 1, kind: 'solo-pve', sessionId, startedAt: 1, expiresAt: 9_999_999_999_999 });

describe('discardFailedStart', () => {
    it('undoes the whole start even when the start lock context is poisoned', async () => {
        const pointer = { playerName: 'caius', token: 't1', sessionId: 'aifight-new' };
        const store = fencedStore({
            'solo-pve:aifight-new': { sessionId: 'aifight-new' },
            'ai-fight-token:caius:t1': { token: 't1' },
            'ai-fight-active:caius': pointer,
            'battle-state:caius': projection('aifight-new'),
        });
        const ended: string[] = [];
        let plainDelete: unknown = null;
        await withKvLeaseContext('lock:ai-fight-start:caius', 'owner-1', async () => {
            poisonKvLockContext(currentKvLockContext()!, new Error('A completed lock callback cannot perform detached storage operations.'));
            // The old cleanup: a plain delete through the poisoned context.
            plainDelete = await store.del('solo-pve:aifight-new').catch((error: unknown) => error);
            await discardFailedStart({
                playerName: 'caius',
                sessionId: 'aifight-new',
                keys: ['ai-fight-token:caius:t1'],
                ifEqual: [{ key: 'ai-fight-active:caius', value: pointer }],
            }, { store, noteEnded: (name) => { ended.push(name); } });
        });
        assert.ok(plainDelete instanceof Error, 'the fake must refuse a write through a poisoned context, like the real store');
        assert.deepEqual([...store.values.keys()], [], 'session, token, pointer and projection are all gone');
        assert.deepEqual(ended, ['caius'], 'the in-memory "in battle" flag is cleared with the projection');
    });

    it('never removes another fight\'s pointer or projection', async () => {
        const newer = { playerName: 'caius', token: 't2', sessionId: 'aifight-newer' };
        const store = fencedStore({
            'solo-pve:aifight-old': { sessionId: 'aifight-old' },
            'ai-fight-active:caius': newer,
            'battle-state:caius': projection('aifight-newer'),
        });
        const ended: string[] = [];
        await discardFailedStart({
            playerName: 'caius',
            sessionId: 'aifight-old',
            ifEqual: [{ key: 'ai-fight-active:caius', value: { ...newer, token: 't1', sessionId: 'aifight-old' } }],
        }, { store, noteEnded: (name) => { ended.push(name); } });
        assert.equal(store.values.has('solo-pve:aifight-old'), false);
        assert.deepEqual(store.values.get('ai-fight-active:caius'), newer);
        assert.deepEqual(store.values.get('battle-state:caius'), projection('aifight-newer'));
        assert.deepEqual(ended, [], 'a newer fight keeps its in-battle flag');
    });

    it('skips an ifEqual entry with nothing read, and never throws', async () => {
        const store = fencedStore({ 'ai-fight-active:caius': { token: 'someone-else' } });
        await discardFailedStart({ playerName: 'caius', ifEqual: [{ key: 'ai-fight-active:caius', value: null }] }, { store });
        assert.ok(store.values.has('ai-fight-active:caius'));
        const broken = { ...store, async del(): Promise<never> { throw new Error('kv down'); }, async get(): Promise<never> { throw new Error('kv down'); } };
        await discardFailedStart({ playerName: 'caius', sessionId: 's', keys: ['k'] }, { store: broken });
    });

    it('every fight start that writes a session and can then fail cleans up through it', () => {
        const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'api', ...parts), 'utf8');
        const expected: Array<[string[], number]> = [
            [['missions', 'ai-fight-start.ts'], 2],
            [['missions', 'combat-start.ts'], 1],
            [['hollow-gate', 'combat-start.ts'], 1],
            [['story', 'boss-start.ts'], 1],
            [['story', 'spar-start.ts'], 1],
            [['village', 'sector-war.ts'], 1],
            [['village', 'anbu-infiltration.ts'], 3],
            [['weekly-boss.ts'], 2],
        ];
        for (const [path, count] of expected) {
            const text = read(...path);
            assert.equal(text.match(/await discardFailedStart\(/g)?.length ?? 0, count, path.join('/'));
            assert.doesNotMatch(text, /kv\.del\([^)]*soloPveSessionKey\(/, `${path.join('/')} must not delete a session without retiring its projection`);
        }
    });
});
