import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { _shouldStamp, _resetPlayerIpStampMemo, hasRecentIpOrFpOverlapStrict } from './_player-ips.js';

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

describe('ranked IP and fingerprint evidence', () => {
    function evidence(keys: string[]) {
        return { keys: async (pattern: string) => keys.filter(key => key.startsWith(pattern.slice(0, -1))) } as never;
    }

    it('does not suppress Elo for players whose only common addresses are proxy hops', async () => {
        const store = evidence([
            'player-ip:branks:10.0.0.3', 'player-ip:rill:10.0.0.3',
            'player-ip:branks:162.158.14.68', 'player-ip:rill:162.158.14.68',
            'player-ip:branks:86.123.45.67', 'player-ip:rill:8.8.8.8',
            `player-fp:branks:${'a'.repeat(32)}`, `player-fp:rill:${'b'.repeat(32)}`,
        ]);
        assert.equal(await hasRecentIpOrFpOverlapStrict('Branks', 'Rill', store), false);
    });

    it('still blocks a shared public visitor IP or browser fingerprint', async () => {
        const sharedIp = evidence(['player-ip:branks:86.123.45.67', 'player-ip:rill:86.123.45.67']);
        assert.equal(await hasRecentIpOrFpOverlapStrict('Branks', 'Rill', sharedIp), true);
        const sharedFp = evidence([`player-fp:branks:${'a'.repeat(32)}`, `player-fp:rill:${'a'.repeat(32)}`]);
        assert.equal(await hasRecentIpOrFpOverlapStrict('Branks', 'Rill', sharedFp), true);
    });
});
