import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/*
 * Server writers that used to write the save raw (read, edit, bump the version,
 * kv.set) dropped the idle recovery a player had earned since their last save.
 * Bumping the version moves the regeneration cursor to "now", so every second of
 * HP, chakra and stamina recovery since the last owner read or autosave was gone
 * for good, and the reply handed the client the stale vitals to display.
 *
 * Each writer below now commits through mutatePlayerSave, which settles that
 * recovery into the same write. The fixture save has earned 30 seconds of it
 * (one point per second in each pool at these maxima); each case drives the
 * real handler and checks that the committed save, and the character the
 * player is shown when the reply carries one, still has it.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'settled-mutation-writers-admin';
delete process.env.SESSION_SECRET;

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

const PREFIX = 'settledwriterqa';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const IDLE_MS = 30_000;
const EARNED = 30;

let kv: typeof import('../_storage.js').kv;
let PET_BREEDING_MIGRATION_VERSION: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
});

after(async () => {
    for (const key of await kv.keys(`*${PREFIX}*`)) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

function tiredCharacter(name: string, extra: Json = {}): Json {
    return {
        name,
        level: 20,
        village: 'Frostfang Village',
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
        pets: [],
        inventory: [],
        hp: 10, maxHp: 100,
        chakra: 20, maxChakra: 100,
        stamina: 0, maxStamina: 100,
        ryo: 1_000,
        bankRyo: 0,
        fateShards: 0,
        ...extra,
    };
}

async function seedTired(name: string, extraCharacter: Json = {}, extraRecord: Json = {}): Promise<void> {
    const at = Date.now() - IDLE_MS;
    await kv.set(`save:${name}`, {
        _saveVersion: 3,
        _saveAt: at,
        _regenAt: at,
        ...extraRecord,
        character: tiredCharacter(name, extraCharacter),
    });
}

async function call(handler: Handler, body: Json, method = 'POST'): Promise<{ statusCode: number; body?: Json }> {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method,
        body,
        query: method === 'GET' ? body : {},
        headers: {
            'content-type': 'application/json',
            'x-admin-password': ADMIN_PASSWORD,
            'x-forwarded-for': '127.0.0.91',
        },
        socket: { remoteAddress: '127.0.0.91' },
    } as never, res as never);
    return out;
}

async function load(path: string): Promise<Handler> {
    return (await import(path)).default as Handler;
}

function assertRecovered(character: Json | undefined, where: string): void {
    assert.ok(character, `${where}: no character`);
    assert.ok(Number(character.hp) >= 10 + EARNED, `${where}: hp ${character.hp} lost the idle recovery`);
    assert.ok(Number(character.chakra) >= 20 + EARNED, `${where}: chakra ${character.chakra} lost the idle recovery`);
    assert.ok(Number(character.stamina) >= EARNED, `${where}: stamina ${character.stamina} lost the idle recovery`);
}

async function assertStoredRecovered(name: string, where: string): Promise<Json> {
    const stored = await kv.get<Json>(`save:${name}`);
    assertRecovered(stored?.character as Json | undefined, `${where} (committed save)`);
    return stored!;
}

describe('server writers keep the idle recovery a player earned', { concurrency: false }, () => {
    it('daily login', async () => {
        const name = `${PREFIX}dailylogin`;
        await seedTired(name);
        const out = await call(await load('../player/daily-login.js'), { playerName: name });

        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal((out.body?.granted as Json).ryo, Number((out.body?.granted as Json).ryo));
        assertRecovered(out.body?.character as Json, 'daily login reply');
        const stored = await assertStoredRecovered(name, 'daily login');
        assert.equal(stored._saveVersion, 4);
        assert.equal(out.body?._saveVersion, 4);
    });

    it('bank interest', async () => {
        const name = `${PREFIX}bankinterest`;
        await seedTired(name, { bankRyo: 50_000, villageUpgrades: { bank: 10 } });
        const out = await call(await load('../bank/claim-interest.js'), { playerName: name });

        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.eligible, true, JSON.stringify(out.body));
        const stored = await assertStoredRecovered(name, 'bank interest');
        assert.equal((stored.character as Json).bankRyo, out.body?.bankRyo);
        assert.equal(out.body?._saveVersion, stored._saveVersion);
    });

    it('village daily agenda (personal reward)', async () => {
        const name = `${PREFIX}agenda`;
        await seedTired(name);
        const out = await call(await load('../village/claim-daily-agenda.js'), { playerName: name, village: `${PREFIX} Village` });

        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal((out.body?.personal as Json).alreadyClaimed, false);
        const stored = await assertStoredRecovered(name, 'daily agenda');
        assert.equal(out.body?._saveVersion, stored._saveVersion);
    });

    it('weekly board claim', async () => {
        const name = `${PREFIX}weekly`;
        await seedTired(name, { totalMissionsCompleted: 500, rankedWins: 500, hollowGateWardenKills: 500 });
        const handler = await load('../missions/weekly-board.js');
        const board = await call(handler, { playerName: name }, 'GET');
        assert.equal(board.statusCode, 200, JSON.stringify(board.body));
        const missionId = String(((board.body?.missions as Json[]) ?? [])[0]?.id ?? '');
        assert.ok(missionId, 'the board offers a mission');
        // Every counter is far past its target relative to an empty baseline.
        const { weekKey } = await import('../missions/_weekly-board.js');
        await kv.set(`weekly-board:${name}:${weekKey(Date.now())}`, {
            baseline: { totalMissionsCompleted: 0, rankedWins: 0, hollowGateWardenKills: 0 },
            claimed: [],
        });

        const out = await call(handler, { playerName: name, missionId });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.missionId, missionId, JSON.stringify(out.body));
        const stored = await assertStoredRecovered(name, 'weekly board');
        assert.equal(out.body?._saveVersion, stored._saveVersion);
    });

    it('war crate claim', async () => {
        const name = `${PREFIX}warcrate`;
        await seedTired(name);
        const warId = `frostfangvillage-vs-${PREFIX}`;
        await kv.set(`world:war:${warId}`, {
            endedAt: Date.now() - 60_000,
            warCrateId: `war-crate-${warId}`,
            winnerVillage: 'Frostfang Village',
        });
        const out = await call(await load('../village/claim-war-crate.js'), { playerName: name, warCrateId: `war-crate-${warId}` });

        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.granted, true, JSON.stringify(out.body));
        assertRecovered(out.body?.character as Json, 'war crate reply');
        const stored = await assertStoredRecovered(name, 'war crate');
        assert.equal(out.body?._saveVersion, stored._saveVersion);
    });

    it('pet evolution', async () => {
        const name = `${PREFIX}evolve`;
        await seedTired(name, {
            inventory: ['evo-stone-awakening'],
            pets: [{ id: 'starter-fire', name: 'Ember Pup', element: 'Fire', rarity: 'standard', level: 50, hp: 100, attack: 10, defense: 10, speed: 10 }],
        });
        const out = await call(await load('../pet/evolve.js'), { playerName: name, petId: 'starter-fire' });

        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.stage, 1);
        const stored = await assertStoredRecovered(name, 'pet evolution');
        assert.deepEqual((stored.character as Json).inventory, []);
        assert.equal(out.body?._saveVersion, stored._saveVersion);
    });

    it('profession choice', async () => {
        const name = `${PREFIX}profession`;
        await seedTired(name);
        const out = await call(await load('../profession/choose.js'), { playerName: name, profession: 'healer' });

        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assertRecovered(out.body?.character as Json, 'profession reply');
        const stored = await assertStoredRecovered(name, 'profession choice');
        assert.equal((stored.character as Json).profession, 'healer');
        assert.equal(out.body?._saveVersion, stored._saveVersion);
    });

    it('village tax day (no treasury share)', async () => {
        const name = `${PREFIX}tax`;
        // No seated Kage forces the rate to zero, so the day is only stamped:
        // the save write with no treasury share.
        await seedTired(name);
        const { assessVillageTax } = await import('../_war-tax-apply.js');
        const out = await assessVillageTax(name);

        assert.equal(out.applied, false);
        const stored = await assertStoredRecovered(name, 'village tax');
        assert.equal((stored.character as Json).lastTaxDate, new Date().toISOString().slice(0, 10));
        assert.equal(out._saveVersion, stored._saveVersion);
    });
});
