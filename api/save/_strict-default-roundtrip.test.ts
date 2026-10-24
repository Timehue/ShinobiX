import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The strict raw-save ledger is the CODE DEFAULT (owner amendment A13,
 * 2026-10-22): with STRICT_RAW_SAVE_LEDGER unset, a real player's progress must
 * survive the ordinary client loop of reading its own save and autosaving it
 * back, again and again, through the real save handler. Jutsu mastery, pets,
 * inventory (hunt-material stacks included), equipment (a named weapon whose
 * definition is in the forged-item registry), stats and level, and every
 * currency must come back unchanged, and loose hunt-material copies fold into
 * their stack exactly once.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'strict-default-roundtrip-secret-with-entropy';
process.env.ENABLE_LEGACY = '0';
delete process.env.STRICT_RAW_SAVE_LEDGER;

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;

const NAME = 'strictdefaultroundtrip';
const IP = '203.0.113.91';
const NAMED_WEAPON = 'named-weapon-00000000-0000-4000-8000-0000000c0ffe';
const NAMED_DEF = { id: NAMED_WEAPON, name: 'Roundtrip Edge', slot: 'hand', rarity: 'legendary', cost: 0, weaponEp: 40, bonuses: {} };

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let token: string;

function fakeRes() {
    const out = { statusCode: 200, body: undefined as unknown };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

const headers = () => ({ 'x-player-name': NAME, 'x-player-token': token, 'content-type': 'application/json', 'x-forwarded-for': IP });

async function readOwnSave(): Promise<Json> {
    const response = fakeRes();
    await handler({ method: 'GET', query: { name: NAME }, headers: headers(), socket: { remoteAddress: IP } } as never, response.res);
    assert.equal(response.out.statusCode, 200, JSON.stringify(response.out.body));
    return response.out.body as Json;
}

async function autosave(read: Json): Promise<void> {
    const response = fakeRes();
    const body: Json = { _baseSaveVersion: read._saveVersion, character: read.character };
    if (Array.isArray(read.creatorItems)) body.creatorItems = read.creatorItems;
    await handler({ method: 'POST', query: { name: NAME }, body, headers: headers(), socket: { remoteAddress: IP } } as never, response.res);
    assert.equal(response.out.statusCode, 200, JSON.stringify(response.out.body));
}

/** The fields a player would notice losing, as one comparable snapshot. */
function progress(read: Json) {
    const c = read.character as Json;
    const pets = (c.pets as Json[] | undefined ?? []).map((pet) => ({ id: pet.id, level: pet.level, xp: pet.xp, rarity: pet.rarity }));
    return {
        level: c.level, unspentStats: c.unspentStats, stats: c.stats,
        ryo: c.ryo, bankRyo: c.bankRyo, fateShards: c.fateShards, boneCharms: c.boneCharms, auraStones: c.auraStones,
        auraDust: c.auraDust, honorSeals: c.honorSeals,
        jutsuMastery: c.jutsuMastery, pets,
        inventory: [...(c.inventory as string[])].sort(),
        itemStacks: [...(c.itemStacks as Array<{ itemId: string; count: number }>)].sort((a, b) => a.itemId.localeCompare(b.itemId)),
        equipment: c.equipment,
        creatorItemIds: (read.creatorItems as Json[] | undefined ?? []).map((item) => item.id),
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const { issuePlayerToken } = await import('../_auth.js');
    const { PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js');
    const { recordForgedItem } = await import('../_forged-item-registry.js');
    handler = (await import('./[name].js')).default as unknown as Handler;
    token = issuePlayerToken(NAME)!;
    assert.ok(token);
    await recordForgedItem(NAMED_DEF, { required: true });
    await kv.set(`save:${NAME}`, {
        _saveVersion: 5,
        _saveAt: Date.now() - 1_000,
        worldGeoV: 2,
        currentSector: 0,
        creatorItems: [NAMED_DEF],
        character: {
            name: NAME, village: 'Stormveil Village', level: 30, xp: 0, experience: 0,
            rank: 'Genin', rankTitle: 'Genin', createdAt: Date.now() - 30 * 86_400_000,
            // Level 30 is owed 6,160 earned points: 120 allocated + 6,040 unspent.
            stats: { strength: 40, speed: 40, endurance: 40 }, unspentStats: 6_040,
            ryo: 12_345, bankRyo: 6_789, fateShards: 33, boneCharms: 44, auraStones: 5, auraDust: 210, honorSeals: 77, mythicSeals: 0, hollowShards: 0,
            hp: 500, maxHp: 500, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300,
            jutsuMastery: [{ jutsuId: 'starter-universal-flicker', level: 12, xp: 30 }],
            pets: [{ id: 'pet-roundtrip', name: 'Ember', rarity: 'rare', maxLevel: 100, level: 14, xp: 120, hp: 60, attack: 25, defense: 22, speed: 24, jutsus: [{ name: 'Bite', power: 10 }], unlockedForPve: true }],
            activePetId: 'pet-roundtrip',
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, relicRosterVersion: 1,
            // Two loose hunt-material copies from before stacking (owner A12)
            // sit beside a stack of three: a save folds them into one stack of 5.
            inventory: ['rustfang-kunai', 'hunt-wolf-fang', 'hunt-wolf-fang'],
            itemStacks: [{ itemId: 'hunt-wolf-fang', count: 3 }, { itemId: 'pet-treat', count: 4 }],
            equipment: { hand: NAMED_WEAPON, body: 'shinobi-vest' },
            earnedTitles: [], serverTitles: [],
        },
    });
});

after(async () => {
    for (const key of await kv.keys(`*${NAME}*`)) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('strict is the default, and progress survives repeated save and reload through the real handler', async (t) => {
    assert.equal(process.env.STRICT_RAW_SAVE_LEDGER, undefined, 'the default mode is under test');
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });

    const first = await readOwnSave();
    const seeded = progress(first);
    assert.equal(seeded.equipment && (seeded.equipment as Json).hand, NAMED_WEAPON, 'the named weapon is equipped');
    assert.ok(seeded.creatorItemIds.includes(NAMED_WEAPON), 'its forged definition travels with the save');

    // The first autosave folds the loose hunt-material copies, exactly once.
    await autosave(first);
    t.mock.timers.tick(4_000);
    const folded = progress(await readOwnSave());
    assert.deepEqual(folded.inventory, ['rustfang-kunai'], 'the loose copies left the backpack list');
    assert.deepEqual(folded.itemStacks, [{ itemId: 'hunt-wolf-fang', count: 5 }, { itemId: 'pet-treat', count: 4 }], 'and joined their stack with no unit lost or added');
    const expected = { ...seeded, inventory: folded.inventory, itemStacks: folded.itemStacks };
    assert.deepEqual(folded, expected, 'everything else came back as stored');

    // Then the ordinary loop: read your own save, autosave it, repeatedly.
    for (let round = 0; round < 3; round += 1) {
        const read = await readOwnSave();
        await autosave(read);
        t.mock.timers.tick(4_000);
        assert.deepEqual(progress(await readOwnSave()), expected, `round ${round + 1}`);
    }

    const stored = await kv.get<Json>(`save:${NAME}`);
    const storedCharacter = stored?.character as Json;
    assert.deepEqual(storedCharacter.jutsuMastery, [{ jutsuId: 'starter-universal-flicker', level: 12, xp: 30 }], 'mastery kept on the stored row');
    assert.equal((storedCharacter.equipment as Json).hand, NAMED_WEAPON, 'the named weapon is still equipped on the stored row');
    assert.equal(storedCharacter.ryo, 12_345);
    assert.equal(storedCharacter.fateShards, 33);
});
