import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body?: Record<string, unknown> };

let rl: typeof import('./_ratelimit.js');
let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;

before(async () => {
    rl = await import('./_ratelimit.js');
    const storage = await import('./_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('./_auth.js'));
});

function sink() {
    const reply: Reply = { status: 200 };
    type Res = { setHeader: () => Res; status: (status: number) => Res; json: (body: unknown) => Res; end: () => Res };
    const res: Res = {
        setHeader: () => res,
        status: (status: number) => { reply.status = status; return res; },
        json: (body: unknown) => { reply.body = body as Record<string, unknown>; return res; },
        end: () => res,
    };
    return { reply, res };
}

const fromIp = (ip: string, name?: string) => ({
    headers: { 'x-forwarded-for': ip, ...(name === undefined ? {} : { 'x-player-name': name }) },
    socket: { remoteAddress: ip },
});

describe('requestPlayerKey', () => {
    it('pairs the normalized signed-in name with the client address and ignores junk', () => {
        assert.equal(rl.requestPlayerKey(fromIp('198.51.100.1', 'Kaya Moon!')), 'kayamoon@198.51.100.1');
        assert.equal(rl.requestPlayerKey({ ...fromIp('198.51.100.1'), headers: { ...fromIp('198.51.100.1').headers, 'x-player-name': ['Ren', 'x'] } }), 'ren@198.51.100.1');
        assert.equal(rl.requestPlayerKey(fromIp('198.51.100.1', 'a'.repeat(80)))?.split('@')[0].length, 32);
        assert.equal(rl.requestPlayerKey(fromIp('198.51.100.1'), 'Viewer'), 'viewer@198.51.100.1', 'an explicit name (EventSource `viewer`)');
        for (const value of ['', '!!!']) assert.equal(rl.requestPlayerKey(fromIp('198.51.100.1', value)), null);
        assert.equal(rl.requestPlayerKey(fromIp('198.51.100.1')), null);
    });
});

const publicRead = (req: ReturnType<typeof fromIp>, bucket: string, limit: number) =>
    rl.enforceRateLimit(req, sink().res, bucket, limit, 60_000, rl.requestPlayerKey(req), { ipBackstopMultiplier: rl.PUBLIC_READ_IP_BACKSTOP });

describe('public reads keyed per player at an address (used to be per IP)', () => {
    it('gives every player behind one shared address a full budget', () => {
        const bucket = `shared-${Math.random()}`;
        for (const player of ['aiko', 'ren', 'sora']) {
            for (let hit = 0; hit < 5; hit += 1) {
                assert.equal(publicRead(fromIp('198.51.100.7', player), bucket, 5), true, `${player} hit ${hit + 1}`);
            }
            const { reply, res } = sink();
            const req = fromIp('198.51.100.7', player);
            assert.equal(rl.enforceRateLimit(req, res, bucket, 5, 60_000, rl.requestPlayerKey(req), { ipBackstopMultiplier: rl.PUBLIC_READ_IP_BACKSTOP }), false);
            assert.equal(reply.status, 429, `${player} still has their own ceiling`);
        }
    });

    it("a stranger on another address sending a victim's name cannot spend the victim's budget", () => {
        const bucket = `grief-${Math.random()}`;
        for (let hit = 0; hit < 50; hit += 1) publicRead(fromIp('203.0.113.66', 'victim'), bucket, 5);
        for (let hit = 0; hit < 5; hit += 1) {
            assert.equal(publicRead(fromIp('198.51.100.20', 'victim'), bucket, 5), true, `the real victim's poll ${hit + 1} still lands`);
        }
    });

    it('keeps signed-out requests on the per-IP bucket', () => {
        const bucket = `signed-out-${Math.random()}`;
        for (let hit = 0; hit < 3; hit += 1) assert.equal(publicRead(fromIp('198.51.100.8'), bucket, 3), true);
        assert.equal(publicRead(fromIp('198.51.100.8'), bucket, 3), false);
    });

    it('on the KV path, an address that spent its backstop stops reaching the database', async () => {
        const bucket = `kv-rotation-${Math.random()}`;
        const store = kv as unknown as { incr: (...args: unknown[]) => Promise<number> };
        const original = store.incr;
        let increments = 0;
        store.incr = async (...args: unknown[]) => { increments += 1; return original.apply(kv, args as never); };
        let allowed = 0;
        try {
            for (let hit = 0; hit < 60; hit += 1) {
                const req = fromIp('198.51.100.30', `fake${hit}`);
                if (await rl.enforceRateLimitKv(req, sink().res, bucket, 2, 60_000, rl.requestPlayerKey(req), { ipBackstopMultiplier: rl.PUBLIC_READ_IP_BACKSTOP })) allowed += 1;
            }
        } finally { store.incr = original; }
        assert.equal(allowed, 2 * rl.PUBLIC_READ_IP_BACKSTOP);
        assert.ok(increments <= 2 * rl.PUBLIC_READ_IP_BACKSTOP + 1, `${increments} KV increments for 60 rotated requests`);
    });

    it('holds one client that rotates names to PUBLIC_READ_IP_BACKSTOP x the limit', () => {
        const bucket = `rotation-${Math.random()}`;
        let allowed = 0;
        for (let hit = 0; hit < 200; hit += 1) if (publicRead(fromIp('198.51.100.9', `fake${hit}`), bucket, 2)) allowed += 1;
        assert.equal(allowed, 2 * rl.PUBLIC_READ_IP_BACKSTOP);
    });
});

describe('refusals: a friendly 429 and a once-a-minute summary log', () => {
    it('answers with a player-facing message and a machine code', () => {
        const { reply, res } = sink();
        const bucket = `friendly-${Math.random()}`;
        const req = fromIp('198.51.100.40', 'kaya');
        rl.enforceRateLimit(req, sink().res, bucket, 1, 60_000, 'kaya');
        assert.equal(rl.enforceRateLimit(req, res, bucket, 1, 60_000, 'kaya'), false);
        assert.equal(reply.status, 429);
        assert.equal(reply.body?.code, 'RATE_LIMITED');
        assert.match(String(reply.body?.error), /^You're going a little fast — try again in \d+s\.$/);
        assert.equal(typeof reply.body?.retryAfterMs, 'number');
    });

    it('summarises refusals by limit and player, never logging an address', () => {
        rl.flushRefusalLog(() => undefined); // start from an empty window
        const bucket = `summary-${Math.random().toString(36).slice(2, 8)}`;
        for (let i = 0; i < 4; i += 1) rl.enforceRateLimit(fromIp('203.0.113.77', 'nero'), sink().res, bucket, 1, 60_000, 'nero');
        for (let i = 0; i < 3; i += 1) rl.enforceRateLimit(fromIp('203.0.113.78'), sink().res, bucket, 1, 60_000);
        const lines: string[] = [];
        const line = rl.flushRefusalLog((l) => lines.push(l));
        assert.equal(lines.length, 1, 'one line, not one per refusal');
        assert.match(String(line), new RegExp(`${bucket} 5 \\(nero×3, by address×2\\)`));
        assert.doesNotMatch(String(line), /203\.0\.113/, 'no IP addresses in the log');
        assert.equal(rl.flushRefusalLog(() => undefined), null, 'nothing to report after a flush');
    });

    it('cannot be used to inject a log line through a claimed name', () => {
        rl.flushRefusalLog(() => undefined);
        const bucket = `inject-${Math.random().toString(36).slice(2, 8)}`;
        const forged = 'x\n[admin] granted 999999 ryo\u001b[31m by address';
        for (let i = 0; i < 2; i += 1) rl.enforceRateLimit(fromIp('203.0.113.79'), sink().res, bucket, 1, 60_000, forged);
        const line = String(rl.flushRefusalLog(() => undefined));
        assert.doesNotMatch(line, /[\r\n\u001b]/, 'one physical line, no control codes');
        assert.match(line, new RegExp(`${bucket} 1 \\(xadmingranted999999ryo31mbyaddre×1\\)`), "reduced to safeName's alphabet and 32 characters");
    });
});

describe('wiring: every converted limit uses a key no stranger can spend', () => {
    const source = (rel: string) => readFileSync(join(process.cwd(), 'api', rel), 'utf8');
    it('public reads key on requestPlayerKey with the tight backstop', () => {
        for (const rel of ['./announcements.ts', './eras.ts', './hall-of-legends.ts', './legacy/definitions.ts',
            './world-crisis.ts', './world-crisis-80.ts', './sector/traces.ts', './pvp/session.ts', './pvp/stream.ts']) {
            const src = source(rel);
            assert.match(src, /requestPlayerKey\(req/, `${rel} keys on name@address`);
            assert.match(src, /ipBackstopMultiplier: PUBLIC_READ_IP_BACKSTOP/, `${rel} uses the tight backstop`);
        }
    });
    it('authenticated paths key on the verified identity (which only exists after auth)', () => {
        const limitLine = (src: string, bucket: string, from = 0) => {
            const at = src.indexOf(`'${bucket}'`, from);
            return at < 0 ? '' : src.slice(at, src.indexOf('\n', at));
        };
        for (const [rel, bucket] of [['./pvp/chat.ts', 'pvp-chat-post'], ['./village/chat.ts', 'village-chat-post'], ['./messages.ts', 'dm-send']]) {
            assert.match(limitLine(source(rel), bucket), /identity\.name/, `${rel}: ${bucket} keys on the verified player`);
        }
        // Pending recovery stays BEFORE auth (failed-auth probes must pay too),
        // so it keys on name@address like the public reads, never the bare name.
        assert.match(limitLine(source('./pvp/session.ts'), 'pvp-session-pending'), /requestPlayerKey\(req\)/,
            'pending recovery probes key per player at their address');
        assert.match(limitLine(source('./player/friends.ts'), 'friends-mutate'), /playerName\)/, 'friends keys on the verified player');
    });
});

describe('war reward claims', () => {
    async function claim(handler: Handler, name: string, warId: string): Promise<Reply> {
        const token = issuePlayerToken(name);
        assert.ok(token);
        const { reply, res } = sink();
        await handler({ method: 'POST', body: { playerName: name, kind: 'village', warId }, query: {},
            headers: { 'x-player-name': name, 'x-player-token': token }, socket: { remoteAddress: '127.0.0.1' },
        } as never, res as never);
        return reply;
    }

    it('grants once and never rewrites the save for a claim with nothing new', async () => {
        const handler = (await import('./war/claim-reward.js')).default as unknown as Handler;
        const name = `warclaim${Date.now().toString(36)}`;
        const warId = 'moonshadow-vs-stormveil';
        await kv.set(`world:war:${warId}`, {
            id: warId, villages: ['Moonshadow Village', 'Stormveil Village'], endedAt: Date.now() - 60_000,
            winnerVillage: 'Moonshadow Village', warCrateId: `crate-${name}`,
        });
        await kv.set(`save:${name}`, { _saveVersion: 5, character: {
            name, village: 'Moonshadow Village', level: 10, ryo: 0, inventory: [], claimedWarCrateIds: [],
        } });

        const first = await claim(handler, name, warId);
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal(first.body?.granted, true);
        const grantedVersion = Number(first.body?._saveVersion);
        assert.ok(grantedVersion > 5, 'a real grant is a versioned write');

        for (let poll = 0; poll < 3; poll += 1) {
            const again = await claim(handler, name, warId);
            assert.equal(again.status, 200);
            assert.equal(again.body?.granted, false);
            assert.equal(Number(again.body?._saveVersion), grantedVersion, 'a no-op claim must not bump the version');
        }
        const stored = await kv.get<{ _saveVersion: number; character: { inventory: string[] } }>(`save:${name}`);
        assert.equal(stored?._saveVersion, grantedVersion);
        assert.equal(stored?.character.inventory.filter(id => id === 'legendary-war-crate').length, 1, 'paid exactly once');
    });
});
