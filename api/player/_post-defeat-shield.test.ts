process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'post-defeat-shield-test-secret-32-bytes';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * F5: post-defeat protection in open-world PvP.
 *
 * The offline path already refused to re-kill a downed player ("Target has
 * already been defeated.", api/player/sleeper-kill.ts). The online path did not:
 * attackBlock checks level, traveling, engagement and inBattle, but never the
 * target's condition — so /api/player/attack would stamp `pendingAttacker` on
 * someone lying at 0 HP. That stamp makes engagedInWorldDuel refuse their
 * safe-zone exit, and the heartbeat clears it each cycle, so at 6 attacks per
 * minute one attacker could pin a recovering player out of town indefinitely.
 * Rewards were capped at 3 per target per day; attacks were not capped at all.
 *
 * The shield is read from the target's SAVE, never from presence: the presence
 * character is whatever that player's own client sent, so a shield field there
 * would be self-declared permanent immunity — the F01 `inBattle` bug again.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let sanitizeCharacterSave: typeof import('../save/[name].js').sanitizeCharacterSave;
let PVP_RAID_SHIELD_MS: number;
let attack: Handler;

const ATTACKER = 'raiderone';
const TARGET = 'raidtarget';
const SECTOR = 9;
let ipSeed = 0;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function raid() {
    const token = issuePlayerToken(ATTACKER);
    const ip = `10.74.0.${++ipSeed}`;
    const { out, res } = response();
    await attack({
        method: 'POST',
        body: { targetName: TARGET, attacker: { name: ATTACKER } },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': ATTACKER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

async function seedTarget(character: Json = {}) {
    await kv.set(`save:${TARGET}`, {
        _saveVersion: 1,
        _saveAt: Date.now(),
        currentSector: SECTOR,
        character: {
            name: TARGET, level: 40, village: 'Mist',
            hp: 500, maxHp: 500, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            inventory: [], itemStacks: [], stats: {},
            ...character,
        },
    });
}

function present() {
    for (const who of [ATTACKER, TARGET]) {
        onlineStore.remove(who);
        onlineStore.upsert({ name: who, sector: SECTOR, character: { level: 40 }, tile: 4 });
    }
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ sanitizeCharacterSave } = await import('../save/[name].js'));
    ({ PVP_RAID_SHIELD_MS } = await import('../pvp/_vitals-settlement.js'));
    attack = (await import('./attack.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await seedTarget();
    present();
});

after(async () => {
    onlineStore.remove(ATTACKER);
    onlineStore.remove(TARGET);
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('world attack respects post-defeat recovery', { concurrency: false }, () => {
    it('allows an ordinary raid on a healthy target', async () => {
        const out = await raid();
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.ok(onlineStore.get(TARGET)?.pendingAttacker, 'a legitimate raid still engages the target');
    });

    it('refuses a target who is still admitted, and does NOT pin them', async () => {
        await seedTarget({ hp: 0, hospitalized: true, hospitalizedUntil: Date.now() + 60_000 });
        const out = await raid();
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.equal(out.body?.error, 'Target has already been defeated.', 'same wording the offline path already used');
        assert.equal(onlineStore.get(TARGET)?.pendingAttacker ?? null, null, 'no pendingAttacker stamp — that is what traps them out of town');
    });

    it('refuses a target inside the Field Recovery window after discharge', async () => {
        // Discharged and back to full HP, but still regrouping.
        await seedTarget({ hp: 500, pvpShieldUntil: Date.now() + 30_000 });
        const out = await raid();
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.equal(out.body?.error, 'Target is recovering from a recent defeat.');
        assert.ok(Number(out.body?.retryAfterMs) > 0, 'the client is told how long to wait');
        assert.equal(onlineStore.get(TARGET)?.pendingAttacker ?? null, null);
    });

    it('allows the raid again once the shield has expired', async () => {
        await seedTarget({ hp: 500, pvpShieldUntil: Date.now() - 1 });
        const out = await raid();
        assert.equal(out.statusCode, 200, `an expired shield must not linger: ${JSON.stringify(out.body)}`);
    });

    it('shields for the full window and no longer', () => {
        assert.equal(PVP_RAID_SHIELD_MS, 120_000, 'the 60s stay plus 60s to leave the sector');
    });
});

describe('the shield is server-owned', () => {
    const stored = (over: Json = {}) => ({
        character: {
            name: TARGET, level: 40, village: 'Mist',
            hp: 500, maxHp: 500, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            inventory: [], itemStacks: [], stats: {}, ...over,
        },
    });

    it('ignores a client trying to grant itself a shield', () => {
        const out = sanitizeCharacterSave(stored({ pvpShieldUntil: Date.now() + 86_400_000 }), stored());
        const char = out.character as Json;
        assert.ok(!char.pvpShieldUntil, 'a self-declared shield is permanent immunity — refuse it outright');
    });

    it('ignores a client trying to clear a shield it is still serving', () => {
        const until = Date.now() + 60_000;
        const out = sanitizeCharacterSave(stored({ pvpShieldUntil: 0 }), stored({ pvpShieldUntil: until }));
        assert.equal((out.character as Json).pvpShieldUntil, until, 'the stored value always wins');
    });
});
