import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    _shouldStamp,
    _resetPlayerIpStampMemo,
    hasRecentIpOrFpOverlapStrict,
} from './_player-ips.js';

// The heartbeat re-stamp throttle: a (player, ip/fp) pair is written to storage
// at most once per window. The invariant that protects anti-alt detection is
// that NEW pairs always write on first sight and the throttle only skips a
// redundant TTL refresh — never changes what is recorded.
describe('_shouldStamp — player-ip re-stamp throttle', () => {
    beforeEach(() => _resetPlayerIpStampMemo());

    it('writes on first sight of a pair', () => {
        assert.equal(_shouldStamp('player-ip:rin:1.2.3.4', 1_000), true);
    });

    it('skips a redundant write inside the window, writes again after it', () => {
        const key = 'player-ip:rin:1.2.3.4';
        const WINDOW = 5 * 60_000;
        assert.equal(_shouldStamp(key, 0), true);            // first sight → write
        assert.equal(_shouldStamp(key, 1_000), false);       // 1s later → skip
        assert.equal(_shouldStamp(key, WINDOW - 1), false);  // still inside window → skip
        assert.equal(_shouldStamp(key, WINDOW + 1), true);   // window elapsed → write (TTL refresh)
        assert.equal(_shouldStamp(key, WINDOW + 2), false);  // and the window restarts
    });

    it('a different ip or fp for the same player always writes immediately', () => {
        assert.equal(_shouldStamp('player-ip:rin:1.1.1.1', 0), true);
        assert.equal(_shouldStamp('player-ip:rin:2.2.2.2', 0), true);   // new ip → write
        assert.equal(_shouldStamp('player-fp:rin:deadbeef', 0), true);  // new fp → write
    });

    it('a cleared memo (process restart) re-stamps rather than dropping a write', () => {
        const key = 'player-ip:rin:1.2.3.4';
        assert.equal(_shouldStamp(key, 0), true);
        assert.equal(_shouldStamp(key, 1_000), false);
        _resetPlayerIpStampMemo();                            // simulate restart
        assert.equal(_shouldStamp(key, 2_000), true);         // strictly more writes, never fewer
    });
});

describe('strict ranked overlap evidence', () => {
    it('preserves the same IP-or-fingerprint overlap semantics', async () => {
        const keys = [
            'player-ip:alice:10.0.0.1',
            'player-ip:bob:10.0.0.2',
            'player-fp:alice:shared-device',
            'player-fp:bob:shared-device',
        ];
        const store = {
            async keys(pattern: string) {
                const prefix = pattern.slice(0, -1);
                return keys.filter((key) => key.startsWith(prefix));
            },
        };
        assert.equal(await hasRecentIpOrFpOverlapStrict('Alice', 'Bob', store as never), true);
        assert.equal(await hasRecentIpOrFpOverlapStrict('Alice', 'Charlie', store as never), false);
    });

    it('propagates storage uncertainty instead of sealing an eligible result', async () => {
        const unavailable = {
            async keys() { throw new Error('ranked-overlap-read-unavailable'); },
        };
        await assert.rejects(
            hasRecentIpOrFpOverlapStrict('alice', 'bob', unavailable as never),
            /ranked-overlap-read-unavailable/,
        );
    });
});
