import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _toSqlPattern, _chunkArray, _collectPaginated } from './_storage.js';
import { consumeSingleUseToken } from './_single-use-token.js';

describe('SQL key-pattern escaping', () => {
    it('escapes LIKE metacharacters and escape characters before expanding glob syntax', () => {
        assert.equal(_toSqlPattern(String.raw`save:\alice_%*?`), String.raw`save:\\alice\_\%%_`);
    });
});

describe('compareSet backend wiring contract', () => {
    const storageSource = readFileSync(join(process.cwd(), 'api', '_storage.ts'), 'utf8');
    const pgSource = storageSource.slice(
        storageSource.indexOf('const pgKv = {'),
        storageSource.indexOf('// ─── Supabase REST backend'),
    );
    const pgCompareSet = pgSource.slice(
        pgSource.indexOf('async compareSet('),
        pgSource.indexOf('async del(', pgSource.indexOf('async compareSet(')),
    );

    it('direct Postgres uses atomic SQL without depending on the optional schema RPC', () => {
        assert.doesNotMatch(pgCompareSet, /kv_compare_set|get\([^)]*key|set\([^)]*key/,
            'Railway CAS must neither require a manual RPC migration nor degrade to get-then-set');
        assert.match(pgCompareSet,
            /expected === null[\s\S]*INSERT INTO public\.kv_store AS current[\s\S]*ON CONFLICT \(key\) DO UPDATE[\s\S]*WHERE current\.expires_at IS NOT NULL[\s\S]*AND current\.expires_at <= now\(\)[\s\S]*RETURNING true AS swapped/,
            'null predecessor inserts only when absent or atomically replaces an expired row');
        assert.match(pgCompareSet,
            /UPDATE public\.kv_store[\s\S]*SET value = \$3::jsonb,[\s\S]*expires_at = \$4::timestamptz[\s\S]*WHERE key = \$1[\s\S]*AND value = \$2::jsonb[\s\S]*AND \(expires_at IS NULL OR expires_at > now\(\)\)[\s\S]*RETURNING true AS swapped/,
            'non-null predecessor updates only the exact live JSONB row and replaces its TTL');
    });

    it('the retired Supabase REST adapter retains its atomic schema RPC', () => {
        assert.match(storageSource, /db\.rpc\('kv_compare_set'/);
    });
});

// PostgREST silently truncates every response at the project's max-rows setting
// (Supabase default 1000). These pin the pagination/chunking that keeps the REST
// backend's keys()/mget()/del() from silently dropping rows past that cap — the
// live save-snapshot prefix already holds ~880 rows, near the cap.
describe('PostgREST result-limit safety helpers', () => {
    it('_chunkArray splits into bounded, order-preserving, non-overlapping chunks', () => {
        assert.deepEqual(_chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
        assert.deepEqual(_chunkArray([], 3), []);
        assert.deepEqual(_chunkArray([1, 2], 10), [[1, 2]]);
        // Flattening a chunked list must reproduce the input exactly (no dupes/gaps).
        const input = Array.from({ length: 205 }, (_, i) => i);
        assert.deepEqual(_chunkArray(input, 50).flat(), input);
        assert.equal(_chunkArray(input, 50).length, 5); // 50,50,50,50,5
    });

    it('_collectPaginated drains every full page and stops on the first short page', async () => {
        // 2350 synthetic rows behind a 1000-row page cap → 3 pages (1000,1000,350).
        const total = 2350;
        const all = Array.from({ length: total }, (_, i) => `k${i}`);
        const ranges: Array<[number, number]> = [];
        const rows = await _collectPaginated(async (from, to) => {
            ranges.push([from, to]);
            return all.slice(from, to + 1);
        }, 1000);
        assert.equal(rows.length, total);
        assert.deepEqual(rows, all); // order preserved across pages
        assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
    });

    it('_collectPaginated makes a second request when the first page is exactly full', async () => {
        // Exactly one full page then empty — must probe the next page to learn it ended.
        const rows = await _collectPaginated(async (from) => (from === 0 ? Array.from({ length: 1000 }, (_, i) => i) : []), 1000);
        assert.equal(rows.length, 1000);
    });

    it('_collectPaginated single short page → one request only', async () => {
        let calls = 0;
        const rows = await _collectPaginated(async () => { calls += 1; return [1, 2, 3]; }, 1000);
        assert.deepEqual(rows, [1, 2, 3]);
        assert.equal(calls, 1);
    });
});

describe('consumeSingleUseToken', () => {
    it('returns the token when the delete actually consumed it', async () => {
        const token = { playerName: 'rin' };
        const store = {
            async get<T>() { return token as T; },
            async del() { return 1; },
        };

        assert.deepEqual(await consumeSingleUseToken(store, 'token:key'), token);
    });

    it('refuses a raced duplicate when the token was read but delete removed nothing', async () => {
        const store = {
            async get<T>() { return { playerName: 'rin' } as T; },
            async del() { return 0; },
        };

        assert.equal(await consumeSingleUseToken(store, 'token:key'), null);
    });

    it('does not delete when the token is absent', async () => {
        let delCalls = 0;
        const store = {
            async get<T>() { return null as T | null; },
            async del() { delCalls += 1; return 0; },
        };

        assert.equal(await consumeSingleUseToken(store, 'token:key'), null);
        assert.equal(delCalls, 0);
    });
});
