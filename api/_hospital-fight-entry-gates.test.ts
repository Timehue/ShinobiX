process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hospital-fight-entry-gates-secret-32b';

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * "Hospitalized" means the same thing at every door into a fight.
 *
 * The 2026-09-08 audit (docs/MMORPG_BEHAVIOR_RULINGS.md, F2) wired the shared
 * `isIncapacitated()` into the entry points it found. Eight more had been added
 * or were missed since — the Story Boss, the Academy spar, Endless Tower waves,
 * combat missions, the Clan Boss assault, the level-80 World Crisis, the Sector
 * War garrison and Anbu infiltration. Each one let a player lying in a hospital
 * bed walk into a fight, several of them at FULL vitals (the Tower engine seals
 * every fighter at max HP) and several spending a capped entry doing it.
 *
 * The first block drives the real handlers. The second is the ratchet that keeps
 * the rule whole: every non-test api file that creates a fight must either call
 * `isIncapacitated` or be listed below with the reason it does not. A new fight
 * endpoint fails this test until someone makes that decision on purpose.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;

const PLAYER = 'wardgatetest';
let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let ipSeed = 0;

async function call(handler: Handler, body: Json) {
    const out: { status: number; body: Json } = { status: 200, body: {} };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; },
        end() { return res; },
    };
    const ip = `10.75.0.${++ipSeed}`;
    await handler({
        method: 'POST', body, query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER)!, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

const ADMITTED = () => ({ hp: 0, hospitalized: true, hospitalizedAt: Date.now(), hospitalizedUntil: Date.now() + 60_000 });

async function seed(character: Json = {}) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1, _saveAt: Date.now(), _regenAt: Date.now(), currentSector: 0,
        savedBloodlines: [], creatorJutsus: [], acceptedMissionIds: [], missionProgress: {},
        character: {
            name: PLAYER, village: 'Stormveil Village', level: 10, specialty: 'Ninjutsu', rankTitle: 'Genin',
            hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, ryo: 500,
            inventory: [], itemStacks: [], pets: [], equippedJutsuIds: [], storyProgress: 0,
            stats: { strength: 100, speed: 100, intelligence: 100, willpower: 100, ninjutsuOffense: 120, ninjutsuDefense: 100, taijutsuOffense: 100, taijutsuDefense: 100, bukijutsuOffense: 100, bukijutsuDefense: 100, genjutsuOffense: 100, genjutsuDefense: 100 },
            ...character,
        },
    });
}

async function sessionKeys(): Promise<string[]> {
    return (await kv.keys('*')).filter((key) => key.startsWith('solo-pve:') || key.startsWith('tower:'));
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

describe('fight entry points refuse a hospitalized player before anything is created', { concurrency: false }, () => {
    it('story/boss-start', async () => {
        const handler = (await import('./story/boss-start.js')).default as unknown as Handler;
        await seed(ADMITTED());
        const refused = await call(handler, { playerName: PLAYER });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hospitalized');
        assert.deepEqual(await sessionKeys(), [], 'no story session was sealed');

        await seed();
        const ok = await call(handler, { playerName: PLAYER });
        assert.equal(ok.status, 200, `a healthy player still starts: ${JSON.stringify(ok.body)}`);
    });

    it('story/spar-start', async () => {
        const handler = (await import('./story/spar-start.js')).default as unknown as Handler;
        await seed({ ...ADMITTED(), onboardingStep: 'academySpar' });
        const refused = await call(handler, { playerName: PLAYER });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hospitalized');
        assert.deepEqual(await sessionKeys(), []);

        await seed({ onboardingStep: 'academySpar' });
        const ok = await call(handler, { playerName: PLAYER });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
    });

    it('endless/wave-start (a NEW wave; the run itself is already paid for)', async () => {
        const handler = (await import('./endless/wave-start.js')).default as unknown as Handler;
        const runToken = 'EndlessGateRunToken0001';
        await seed({ ...ADMITTED(), endlessTowerRun: { runToken, wave: 1 } });
        const refused = await call(handler, { playerName: PLAYER, runToken });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hospitalized');
        assert.deepEqual(await sessionKeys(), [], 'no wave was sealed at zero HP');
    });

    it('missions/combat-start', async () => {
        const handler = (await import('./missions/combat-start.js')).default as unknown as Handler;
        await seed(ADMITTED());
        const refused = await call(handler, { playerName: PLAYER, missionId: 'combat-e-drill' });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hospitalized');
        assert.deepEqual(await sessionKeys(), []);
        assert.equal((await kv.keys('*')).some((key) => key.includes('mission-combat')), false, 'no active-mission pointer was written');
    });

    // ai-fight-start has TWO entry branches that seal through one shared helper,
    // so the file-level ratchet below cannot tell a gated branch from an ungated
    // one. The World branch (ambush, hunt, raid, wanderer, crisis) was exactly
    // that gap: it seals from the save's CURRENT vitals, so an admitted player
    // entered at 0 HP. Each branch is proven here instead.
    it('missions/ai-fight-start — a World encounter', async () => {
        const handler = (await import('./missions/ai-fight-start.js')).default as unknown as Handler;
        await seed(ADMITTED());
        const refused = await call(handler, { playerName: PLAYER, worldEncounter: { kind: 'wanderer', sourceId: 'gate-test-wanderer', sector: 44 } });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.reason, 'hospitalized', 'refused as a patient, not as an unreachable encounter');
        assert.deepEqual(await sessionKeys(), [], 'no World session was sealed');
        const keys = await kv.keys('*');
        assert.equal(keys.some((key) => key.startsWith('world-ai-active:') || key.startsWith('ai-fight-token:')), false, 'no World pointer or token was minted');
    });

    it('missions/ai-fight-start — a generic encounter', async () => {
        const handler = (await import('./missions/ai-fight-start.js')).default as unknown as Handler;
        const bout = { playerName: PLAYER, battleKind: 'practice', opponentId: 'builtin-ai-exam-proctor', opponentLevel: 25 };
        await seed(ADMITTED());
        const refused = await call(handler, bout);
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.reason, 'hospitalized');
        assert.deepEqual(await sessionKeys(), []);

        await seed();
        const ok = await call(handler, bout);
        assert.equal(ok.status, 200, `a healthy player still starts: ${JSON.stringify(ok.body)}`);
    });
});

// ─── The ratchet ────────────────────────────────────────────────────────────
//
// A file "creates a fight" when it seals a Tower session, claims Tower battle
// leases, or writes a NEW Solo-PvE session. Settlement writes wrap the session
// in withSoloPveSettlementReceipt and are not entry points.
//
// The check is per FILE: one isIncapacitated call anywhere passes the whole
// file. An endpoint with more than one entry branch therefore needs a handler
// test per branch in the block above (ai-fight-start has two).
const FIGHT_CREATION = /\bbuildTowerEncounter\(|\bclaimTowerBattleLeases\(|\bwriteSoloPveSession\((?!withSoloPveSettlementReceipt)/;

/** Files that create fights WITHOUT calling isIncapacitated, and why that is right. */
const EXEMPT: Record<string, string> = {
    // Definitions — the entry points that call them are checked.
    'api/solo-pve/_store.ts': 'defines writeSoloPveSession',
    'api/towers/_encounter.ts': 'defines buildTowerEncounter',
    'api/towers/_battle-lease.ts': 'defines claimTowerBattleLeases',
    // Matchmade PvP that fights on a FRESH pool, like ranked. Admission is gated
    // where a player asks to join; the match itself is formed from those joins.
    'api/pvp/_ranked-2v2.ts': 'ranked 2v2 match former; the queue (api/pvp/ranked-queue.ts) refuses an admitted player',
    'api/towers/_pvp-store.ts': 'Team Arena match former; the queue (api/towers/pvp-queue.ts) refuses an admitted player',
    'api/clan/war/_mpvp.ts': 'an ACCEPTED four-player clan-war duel on a fresh pool; refusing one member would strand the other three',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(absolute, out);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(absolute);
    }
    return out;
}

describe('every fight entry point is gated or exempt on purpose', () => {
    // process.cwd(), like the other api source scans: api tests also compile
    // into the CommonJS server build, where import.meta is not allowed.
    const root = process.cwd();
    const creators = sourceFiles(join(root, 'api'))
        .filter((file) => FIGHT_CREATION.test(readFileSync(file, 'utf8')))
        .map((file) => relative(root, file).replaceAll('\\', '/'));

    it('still finds the fight creators (the scan matches real code)', () => {
        for (const known of ['api/missions/ai-fight-start.ts', 'api/towers/start.ts', 'api/clan-boss/assault-start.ts', 'api/story/boss-start.ts', 'api/world-crisis-80/combat-start.ts']) {
            assert.ok(creators.includes(known), `${known} should be detected as a fight creator`);
        }
    });

    it('each creator calls isIncapacitated or carries a reason', () => {
        const ungated = creators.filter((file) => !EXEMPT[file] && !/\bisIncapacitated\(/.test(readFileSync(join(root, file), 'utf8')));
        assert.deepEqual(ungated, [], `These files create fights without refusing a hospitalized player. Gate them with isIncapacitated (api/_elapsed-state.ts) or add them to EXEMPT with the reason:\n${ungated.join('\n')}`);
    });

    it('lists no stale exemptions', () => {
        const stale = Object.keys(EXEMPT).filter((file) => !creators.includes(file));
        assert.deepEqual(stale, [], 'an exempt file no longer creates fights — drop it from EXEMPT');
    });
});
