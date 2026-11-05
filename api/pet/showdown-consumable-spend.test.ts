import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { ShowdownSession } from '../_pet-showdown/engine.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'showdown-consumable-spend-test-secret';
process.env.ENABLE_LEGACY = '0';

/*
 * PET-7 (2026-10 economy rebalance): the paid Coliseum bout spends the one-use
 * battle item it seals, as the PvE summon path does. It used to show as spent
 * in the fight and come back on the next load. Unpaid bouts keep the item.
 * Main's atomic Showdown admission (api/pet/_showdown-admission.ts) now does
 * the spend in the same commit that seals the session; these cases pin the
 * rebalance's rules against it.
 */

type Json = Record<string, any>;
let handler: typeof import('./showdown.js').default;
let spendShowdownConsumables: typeof import('./_showdown-admission.js').spendShowdownConsumables;
let createShowdownSession: typeof import('../_pet-showdown/engine.js').createShowdownSession;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let PET_CATALOG: typeof import('./_catalog.js').PET_CATALOG;
let player = '';
let caseIndex = 0;
const ITEM = 'consum-second-wind';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ createShowdownSession } = await import('../_pet-showdown/engine.js'));
    ({ PET_CATALOG } = await import('./_catalog.js'));
    const showdown = require('./showdown.js') as typeof import('./showdown.js');
    handler = showdown.default;
    ({ spendShowdownConsumables } = await import('./_showdown-admission.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_LEGACY;
});

function companion(id: string, consumable?: string) {
    const template = PET_CATALOG['standard-0'];
    return { ...template, id, templateId: template.id, level: 25, unlockedForPve: true, ...(consumable ? { loadout: { consumable } } : {}) };
}

beforeEach(async (context) => {
    if (!('mock' in context)) throw new Error('needs a per-test clock');
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    player = `consumablespend${++caseIndex}`;
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 50, ryo: 1000, dailyPetWins: 0, totalPetWins: 0,
        lastDailyReset: new Date().toISOString().slice(0, 10),
        pets: [companion('pet-a', ITEM), companion('pet-b'), companion('pet-c', ITEM)],
    } });
});

async function post(body: Json) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; },
        json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { playerName: player, ...body },
        headers: { 'x-player-token': issuePlayerToken(player) }, socket: { remoteAddress: '127.0.0.82' },
    } as never, res as never);
    return out;
}

const savedPets = async () => ((await kv.get<Json>(`save:${player}`))!.character.pets) as Json[];

test('a paid arena bout burns the sealed battle item and hands back the committed save', async () => {
    const started = await post({ action: 'arena', format: '1v1', petIds: ['pet-a'] });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const session = (await kv.get<ShowdownSession>(`pet:showdown:${player}:${started.body.state.sessionId}`))!;
    assert.equal(session.rewardEligible, true);
    assert.equal(session.player[0].consumableSpent, true, 'the engine still fights with the item');
    const pets = await savedPets();
    assert.equal(pets[0].loadout?.consumable, undefined, 'the single-use item is spent');
    assert.equal(pets[2].loadout?.consumable, ITEM, 'a pet that did not enter keeps its item');
    assert.equal(started.body.character.pets[0].loadout?.consumable, undefined, 'the reply carries the committed save');
    assert.equal(started.body._saveVersion, 2);
});

test('a paid bout with no battle item burns no other pet\'s item', async () => {
    const started = await post({ action: 'arena', format: '1v1', petIds: ['pet-b'] });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const pets = await savedPets();
    assert.equal(pets[0].loadout?.consumable, ITEM);
    assert.equal(pets[2].loadout?.consumable, ITEM);
});

test('practice keeps the item', async () => {
    const started = await post({ action: 'start', format: '1v1', sparring: true, petIds: ['pet-a', 'pet-b', 'pet-c'] });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const pets = await savedPets();
    assert.equal(pets[0].loadout?.consumable, ITEM);
    assert.equal(pets[2].loadout?.consumable, ITEM);
});

test('an item unequipped after the seal refuses the burn instead of burning nothing', async () => {
    const sealed = createShowdownSession({
        sessionId: 'sealedbeforeunequip', playerName: player, format: '1v1', tier: 'warrior', seed: 5,
        playerPets: [companion('pet-a', ITEM)] as never, enemyPets: [companion('foe')] as never, enemyTeamName: 'Foes',
        rewardEligible: true,
    });
    const save = (await kv.get<Json>(`save:${player}`))!;
    save.character.pets[0] = companion('pet-a');
    assert.throws(() => spendShowdownConsumables(save.character, sealed), /showdown-consumable-build-changed/);
});

test('an unpaid session (Hollow Gate, wanderer, practice) commits and burns nothing', async () => {
    const unpaid = createShowdownSession({
        sessionId: 'unpaidbout', playerName: player, format: '1v1', tier: 'warrior', seed: 5,
        playerPets: [companion('pet-a', ITEM)] as never, enemyPets: [companion('foe')] as never, enemyTeamName: 'Foes',
        rewardEligible: false,
    });
    const character = (await kv.get<Json>(`save:${player}`))!.character;
    assert.equal(spendShowdownConsumables(character, unpaid), character, 'nothing is struck');
});

test('a paid bout that lapses unplayed returns its spent item on the next admission', async () => {
    const first = await post({ action: 'arena', format: '1v1', petIds: ['pet-a'] });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((await savedPets())[0].loadout?.consumable, undefined);
    // The 45-minute admission row expires with nobody fighting.
    await kv.del(`pet:showdown:${player}:${first.body.state.sessionId}`);
    const next = await post({ action: 'arena', format: '1v1', petIds: ['pet-b'] });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.equal((await savedPets())[0].loadout?.consumable, ITEM, 'the unplayed bout gave the item back');
    assert.notEqual(next.body.state.sessionId, first.body.state.sessionId);
});

test('a refilled slot sends the refund to the bag instead', async () => {
    const first = await post({ action: 'arena', format: '1v1', petIds: ['pet-a'] });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    await kv.del(`pet:showdown:${player}:${first.body.state.sessionId}`);
    const save = (await kv.get<Json>(`save:${player}`))!;
    save.character.pets[0] = { ...save.character.pets[0], loadout: { consumable: 'consum-iron-hide' } };
    await kv.set(`save:${player}`, save);
    assert.equal((await post({ action: 'arena', format: '1v1', petIds: ['pet-b'] })).status, 200);
    const character = (await kv.get<Json>(`save:${player}`))!.character;
    assert.equal(character.pets[0].loadout?.consumable, 'consum-iron-hide');
    assert.ok((character.inventory as string[]).includes(ITEM), 'the refund lands in the bag');
});

test('a bout that played a round, or was conceded, keeps the spend after it lapses', async () => {
    const played = await post({ action: 'arena', format: '1v1', petIds: ['pet-a'] });
    assert.equal(played.status, 200, JSON.stringify(played.body));
    const turn = await post({ action: 'turn', sessionId: played.body.state.sessionId, commands: [] });
    assert.equal(turn.status, 200, JSON.stringify(turn.body));
    await kv.del(`pet:showdown:${player}:${played.body.state.sessionId}`);
    // The next admission (pet-c, which spends its own item) is where a lapse refund would land.
    const conceded = await post({ action: 'arena', format: '1v1', petIds: ['pet-c'] });
    assert.equal(conceded.status, 200, JSON.stringify(conceded.body));
    assert.equal((await savedPets())[0].loadout?.consumable, undefined, 'a played bout used its item');
    assert.equal((await savedPets())[2].loadout?.consumable, undefined, 'pet-c spent its item on admission');
    assert.equal((await post({ action: 'forfeit', sessionId: conceded.body.state.sessionId })).status, 200);
    await kv.del(`pet:showdown:${player}:${conceded.body.state.sessionId}`);
    const save = (await kv.get<Json>(`save:${player}`))!;
    await kv.set(`save:${player}`, { ...save, character: { ...save.character, petShowdownAdmission: { sessionId: conceded.body.state.sessionId, at: Date.now(), spent: [{ petId: 'pet-c', consumableId: ITEM }] } } });
    assert.equal((await post({ action: 'arena', format: '1v1', petIds: ['pet-b'] })).status, 200);
    assert.equal((await savedPets())[2].loadout?.consumable, undefined, 'a conceded bout is a decided loss');
});
