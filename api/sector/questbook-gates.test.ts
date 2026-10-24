import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'questbook-gates-test-secret';

/*
 * The Quest Book's war and rivalry epics used to be gated only by what the
 * client chose to offer (lib/questbook.ts epicForWanderer), so any caller could
 * accept "The Frostfang Defector" in peacetime or the rivalry capstone with no
 * nemesis and be paid for it. Accept now checks both on the server (framework
 * I-13, api/sector/_questbook.ts questBookGate). Advance, choose and claim stay
 * ungated, so a war or rivalry that ends mid-epic strands nothing.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const FIXED_NOW = Date.UTC(2026, 7, 22, 18, 0, 0);
const PREFIX = 'qbgateplayer';
const WAR_KEY = 'world:war:qbgate-war';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let questbook: Handler;

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    questbook = (await import('./questbook.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [`save:${PREFIX}*`, `ratelimit:*${PREFIX}*`, 'lock:*', `questbook*${PREFIX}*`, 'world:war:qbgate*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(async () => {
    const keys = await kv.keys('world:war:qbgate*');
    if (keys.length) await kv.del(...keys);
    mock.timers.reset();
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function accept(playerName: string, questId: string): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    await questbook({
        method: 'POST',
        body: { action: 'accept', playerName, questId },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: `127.6.0.${playerName.length}` },
    } as never, res as never);
    return out;
}

async function seed(playerName: string, character: Record<string, unknown>) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 1,
        character: { name: playerName, village: 'Leaf Village', level: 50, ryo: 1_000, inventory: [], ...character },
    });
}

async function assertNothingSealed(playerName: string) {
    const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    assert.equal(record?.activeQuestbookSeal ?? null, null, 'no durable seal');
    assert.equal((record?.character as Record<string, unknown>).activeQuestbook ?? null, null, 'no display mirror');
    assert.equal(await kv.get(`questbook:${playerName}`), null, 'no cached seal');
}

function war(extra: Record<string, unknown> = {}) {
    return {
        id: 'qbgate-war', villages: ['Leaf Village', 'Mist Village'], hp: { 'Leaf Village': 100, 'Mist Village': 100 },
        warGroundSector: 5, warGroundHp: 100, startedAt: FIXED_NOW - 60_000, updatedAt: FIXED_NOW - 60_000, ...extra,
    };
}

describe('Quest Book accept enforces the war and rivalry gates', () => {
    it('refuses the rivalry capstone without a nemesis, and seals nothing', async () => {
        const player = `${PREFIX}ashes`;
        await seed(player, {});
        const out = await accept(player, 'qb-ashes');
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, { ok: false, reason: 'requires-rivalry' });
        await assertNothingSealed(player);
    });

    it('accepts the rivalry capstone for a player who carries a nemesis', async () => {
        const player = `${PREFIX}rival`;
        await seed(player, { wandererNemesis: { name: 'Kagero', level: 51, tier: 1 } });
        const out = await accept(player, 'qb-ashes');
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        assert.equal(out.body?.id, 'qb-ashes');
    });

    it('refuses the war epic in peacetime and after the war has ended', async () => {
        const player = `${PREFIX}peace`;
        await seed(player, { level: 45 });
        assert.deepEqual((await accept(player, 'qb-defector')).body, { ok: false, reason: 'requires-war' });
        await kv.set(WAR_KEY, war({ endedAt: FIXED_NOW - 1_000 }));
        assert.deepEqual((await accept(player, 'qb-defector')).body, { ok: false, reason: 'requires-war' }, 'an ended war is not a war');
        await kv.set(WAR_KEY, war({ villages: ['Sand Village', 'Mist Village'] }));
        assert.deepEqual((await accept(player, 'qb-defector')).body, { ok: false, reason: 'requires-war' }, 'someone else\'s war');
        await assertNothingSealed(player);
    });

    it('accepts the war epic while the player\'s village is at war', async () => {
        const player = `${PREFIX}war`;
        await seed(player, { level: 45 });
        await kv.set(WAR_KEY, war());
        const out = await accept(player, 'qb-defector');
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        assert.equal(out.body?.id, 'qb-defector');
    });

    it('leaves an ungated epic exactly as it was', async () => {
        const player = `${PREFIX}bell`;
        await seed(player, { level: 30 });
        const out = await accept(player, 'qb-bell');
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
    });
});
