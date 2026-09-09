process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'silence-surfaces-test-secret-32-bytes-x';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * A silence must hold on EVERY surface that reaches another player.
 *
 * api/messages.ts, api/village/chat.ts and api/pvp/chat.ts already refused a
 * silenced sender. Four surfaces that also publish player-authored text did not,
 * so a silenced player kept working broadcast channels:
 *   • clan chat            — a whole channel
 *   • sector trail signs   — authored text every passer-by reads
 *   • custom profile title — free text worn in front of everyone
 *   • named-weapon names   — echoed into the PUBLIC PvP battle log
 *
 * Each gate is scoped to the authored-text action only: sparking someone else's
 * sign, wearing an EARNED title, and rolling a forge carry no text and stay
 * available, so a silence costs speech rather than progress.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let PET_BREEDING_MIGRATION_VERSION: number;
let clanChatSend: Handler;
let trailSign: Handler;
let profileTitle: Handler;
let craftNamed: Handler;

const PLAYER = 'silencedshinobi';
const CLAN = 'Ashen Hand';
const SECTOR = 12;
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

async function call(handler: Handler, body: Json) {
    const token = issuePlayerToken(PLAYER);
    const ip = `10.72.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

async function seed(character: Json = {}) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        _saveAt: Date.now(),
        currentSector: SECTOR,
        character: {
            // >= NAMED_ITEM_LEVEL_REQ (90) so the named-forge case below reaches
            // the silence gate instead of stopping at the level gate.
            name: PLAYER, level: 95, village: 'Mist', clan: CLAN,
            hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
            ryo: 100_000, fateShards: 500,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            stats: {}, inventory: [], itemStacks: [],
            ...character,
        },
    });
}

async function silence(ms = 60 * 60 * 1000) {
    await kv.set(`mod:silence:${PLAYER}`, { until: Date.now() + ms, reason: 'test', by: 'admin', at: Date.now() });
}

function assertSilenced(out: { statusCode: number; body?: Json }, where: string) {
    assert.equal(out.statusCode, 403, `${where} must refuse a silenced author: ${JSON.stringify(out.body)}`);
    assert.equal(out.body?.error, 'You are silenced.', `${where} must use the shared 403 shape the client already handles`);
    assert.ok(out.body?.silence, `${where} must return the silence record so the client can show until/reason`);
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('./pet/_owned-pet.js'));
    clanChatSend = (await import('./clan/chat/send.js')).default as unknown as Handler;
    trailSign = (await import('./sector/trail-sign.js')).default as unknown as Handler;
    profileTitle = (await import('./player/profile-title.js')).default as unknown as Handler;
    craftNamed = (await import('./craft/named.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await seed();
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('silence holds on every broadcast surface', { concurrency: false }, () => {
    it('clan chat refuses a silenced sender', async () => {
        await silence();
        assertSilenced(await call(clanChatSend, { clan: CLAN, text: 'still talking' }), 'clan chat');
    });

    it('clan chat still works when the silence has expired', async () => {
        await kv.set(`mod:silence:${PLAYER}`, { until: Date.now() - 1, reason: 'served', by: 'admin', at: 0 });
        const out = await call(clanChatSend, { clan: CLAN, text: 'back again' });
        assert.equal(out.statusCode, 200, `an expired silence must not linger: ${JSON.stringify(out.body)}`);
    });

    it('trail signs refuse a silenced author', async () => {
        await silence();
        assertSilenced(await call(trailSign, { sector: SECTOR, action: 'leave', text: 'beware the ridge' }), 'trail sign');
    });

    it('a silenced player may still spark someone else\'s sign', async () => {
        // A spark is a wordless thumbs-up — nothing to moderate, so silencing it
        // would punish beyond speech.
        await silence();
        const out = await call(trailSign, { sector: SECTOR, action: 'spark', signId: 'no-such-sign' });
        assert.notEqual(out.statusCode, 403, `spark must not be silenced: ${JSON.stringify(out.body)}`);
    });

    it('a custom profile title is refused while silenced', async () => {
        await silence();
        assertSilenced(await call(profileTitle, { action: 'title', value: 'Lord Of Everything' }), 'custom title');
    });

    it('clearing a title and picking a style still work while silenced', async () => {
        await silence();
        const cleared = await call(profileTitle, { action: 'title', value: '' });
        assert.notEqual(cleared.statusCode, 403, `clearing a title is not speech: ${JSON.stringify(cleared.body)}`);
        const styled = await call(profileTitle, { action: 'style', value: '' });
        assert.notEqual(styled.statusCode, 403, `a registry style pick is not speech: ${JSON.stringify(styled.body)}`);
    });

    it('drops the AUTHORED NAME of a forged weapon while silenced, without taking the forge', async () => {
        // A named weapon's name reaches the public PvP battle log, so a silence
        // must reach it. The item is stat gear though, and the roll token expires
        // in 20 minutes while a silence lasts days — refusing the forge outright
        // would destroy a paid roll rather than mute anything.
        const rolled = await call(craftNamed, { action: 'roll', kind: 'weapon' });
        assert.equal(rolled.statusCode, 200, JSON.stringify(rolled.body));
        const token = String((rolled.body as { token?: string }).token ?? '');
        assert.ok(token, 'the roll must mint a forge token');

        await silence();
        const forged = await call(craftNamed, { action: 'forge', token, name: 'Slur Blade', flavorText: 'a slur' });
        assert.equal(forged.statusCode, 200, `the forge itself is progression, not speech: ${JSON.stringify(forged.body)}`);
        const item = (forged.body as { item?: { name?: string; flavorText?: string } }).item;
        assert.ok(item, 'the item is still minted');
        assert.notEqual(item?.name, 'Slur Blade', 'the authored name must not survive a silence');
        assert.equal(item?.name, 'Named Weapon', 'it falls back to the generic name');
        assert.equal(item?.flavorText, undefined, 'and the authored flavour text is dropped');
    });

    it('keeps the authored name when the forger is NOT silenced', async () => {
        const rolled = await call(craftNamed, { action: 'roll', kind: 'weapon' });
        const token = String((rolled.body as { token?: string }).token ?? '');
        const forged = await call(craftNamed, { action: 'forge', token, name: 'Ashfall', flavorText: 'Quiet steel.' });
        assert.equal(forged.statusCode, 200, JSON.stringify(forged.body));
        assert.equal((forged.body as { item?: { name?: string } }).item?.name, 'Ashfall');
    });

    it('none of the four surfaces refuse an unsilenced player', async () => {
        const chat = await call(clanChatSend, { clan: CLAN, text: 'hello clan' });
        assert.equal(chat.statusCode, 200, JSON.stringify(chat.body));
        const sign = await call(trailSign, { sector: SECTOR, action: 'leave', text: 'safe path east' });
        assert.equal(sign.statusCode, 200, JSON.stringify(sign.body));
        const title = await call(profileTitle, { action: 'title', value: 'Ashen Wanderer' });
        assert.notEqual(title.statusCode, 403, JSON.stringify(title.body));
    });
});
