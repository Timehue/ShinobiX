import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

/*
 * The Weekly Boss start validates and seeds the fight against the challenger's
 * save. It used to read the stored row raw, which trails the player's real
 * vitals by however long it has been since their last save: a challenger who
 * had regained the 20 stamina was refused ("You need at least 20 stamina"),
 * and one who got in started the fight on stale HP. The start now projects the
 * idle recovery first, and the locked stamina charge settles the same recovery
 * into the save it debits.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'weekly-boss-start-vitals-test-secret-32b';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Json };

const PLAYER = 'weeklystartvitals';
const WEEK_KEY = 'start-vitals-week';
const BOSS_KEY = 'game:weekly-boss-state';
const SAVE_KEY = `save:${PLAYER}`;
const IDLE_MS = 60_000;

let kv: typeof import('./_storage.js').kv;
let handler: Handler;
let issuePlayerToken: (name: string) => string | null;
let PET_BREEDING_MIGRATION_VERSION: number;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('./pet/_owned-pet.js'));
    handler = (await import('./weekly-boss.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function startFight(): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        query: {},
        body: { kind: 'startFight', weekKey: WEEK_KEY },
        headers: { 'x-player-token': issuePlayerToken(PLAYER) ?? '' },
        socket: { remoteAddress: '127.0.0.94' },
    } as never, res as never);
    return out;
}

test('a challenger who has regained the stamina since their last save can start', { concurrency: false }, async () => {
    const now = Date.now();
    await kv.set(BOSS_KEY, {
        weekKey: WEEK_KEY,
        aiId: 'ashen-dragon',
        bossName: 'Ashen Dragon',
        hpMax: 100_000,
        hpRemaining: 100_000,
        scaleFactor: 1,
        damageByPlayer: {},
        attemptsByPlayer: {},
        startedAt: now - 60_000,
        expiresAt: now + 60 * 60_000,
    });
    // Stored: 5 stamina, short of the 20 the start costs. Recovered since the
    // last save: one point a second in each pool for a minute.
    await kv.set(SAVE_KEY, {
        _saveVersion: 7,
        _saveAt: now - IDLE_MS,
        _regenAt: now - IDLE_MS,
        character: {
            name: PLAYER,
            level: 50,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            pets: [],
            hp: 30, maxHp: 100,
            chakra: 30, maxChakra: 100,
            stamina: 5, maxStamina: 100,
        },
    });

    const out = await startFight();
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));

    const stored = (await kv.get<Json>(SAVE_KEY))!;
    const character = stored.character as Json;
    // 5 + 60 recovered - 20 for the start.
    assert.ok(Number(character.stamina) >= 45, `stamina ${character.stamina}: the start charged the recovered pool`);
    assert.ok(Number(character.hp) >= 90, `hp ${character.hp}: the recovery was kept in the save`);
    const session = out.body?.session as { player?: { hp?: number } } | undefined;
    assert.ok(Number(session?.player?.hp) >= 90, `the fight started on ${session?.player?.hp} HP, not the recovered pool`);
});
