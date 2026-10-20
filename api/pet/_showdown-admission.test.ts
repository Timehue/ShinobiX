import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PET_CATALOG } from './_catalog.js';
import { createShowdownSession, type ShowdownSession } from '../_pet-showdown/engine.js';
import type { Pet } from '../_pet-sim/pet-types.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let kv: typeof import('../_storage.js').kv;
let admission: typeof import('./_showdown-admission.js');
let player = '', index = 0;
const item = 'consum-smoke-pellet';
before(async () => { ({ kv } = await import('../_storage.js')); admission = await import('./_showdown-admission.js'); });
beforeEach(async () => {
    player = 'admissionprobe' + (++index);
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 30, ryo: 10,
        pets: [{ ...PET_CATALOG['standard-0'], templateId: 'standard-0', id: 'lead', level: 30, loadout: { consumable: item } }] } });
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

async function open() {
    return admission.admitShowdown(player, async character => {
        const pending = admission.arenaAdmissionId(character);
        const existing = pending ? await kv.get<ShowdownSession>(admission.showdownAdmissionKey(player, pending)) : null;
        if (existing && !existing.finished) return { ok: true as const, session: existing, character, write: false };
        const pets = character.pets as Pet[];
        const sessionId = randomUUID().replaceAll('-', '');
        const session = createShowdownSession({ sessionId, playerName: player, format: '1v1', tier: 'warrior', seed: 51,
            playerPets: pets, enemyPets: [{ ...pets[0], id: 'enemy' }], enemyTeamName: 'Fixture', rewardEligible: true });
        return { ok: true as const, session, character: { ...character, petShowdownAdmission: { sessionId, at: Date.now() } } };
    });
}

test('duplicate concurrent starts atomically spend once and resume the same sealed charges', async () => {
    const [a, b] = await Promise.all([open(), open()]);
    assert.ok(a.ok && b.ok);
    assert.equal(a.session.sessionId, b.session.sessionId);
    assert.equal(a.session.player[0].consumable?.id, item);
    assert.equal(a.session.player[0].consumable?.mitigate, 50);
    const saved = await kv.get<Record<string, any>>(`save:${player}`);
    assert.equal(saved!.character.pets[0].loadout.consumable, undefined);
    assert.equal(saved!._saveVersion, 2);
    assert.equal((await kv.keys(`pet:showdown:${player}:*`)).length, 1);
    const reconnect = await open();
    assert.ok(reconnect.ok); assert.equal(reconnect.session.sessionId, a.session.sessionId);
    assert.equal((await kv.get<Record<string, any>>(`save:${player}`))!._saveVersion, 2);
});

test('an atomic write failure neither spends the item nor publishes combat; retry succeeds', async t => {
    const original = kv.compareSetMany!.bind(kv);
    const mock = t.mock.method(kv as typeof kv & { compareSetMany: NonNullable<typeof kv.compareSetMany> }, 'compareSetMany', async () => { throw new Error('fixture-write-failed'); });
    await assert.rejects(open(), /fixture-write-failed/);
    assert.equal((await kv.get<Record<string, any>>(`save:${player}`))!.character.pets[0].loadout.consumable, item);
    assert.equal((await kv.keys(`pet:showdown:${player}:*`)).length, 0);
    mock.mock.restore();
    assert.ok(original);
    assert.equal((await open()).ok, true);
});

test('a dropped commit acknowledgement is confirmed and never spends a replacement on retry', async t => {
    const original = kv.compareSetMany!.bind(kv);
    let once = true;
    const mock = t.mock.method(kv as typeof kv & { compareSetMany: NonNullable<typeof kv.compareSetMany> }, 'compareSetMany', async (ops: Parameters<NonNullable<typeof kv.compareSetMany>>[0]) => {
        const committed = await original(ops);
        if (once) { once = false; throw new Error('fixture-ack-lost'); }
        return committed;
    });
    const first = await open(); assert.ok(first.ok);
    mock.mock.restore();
    const saved = (await kv.get<Record<string, any>>(`save:${player}`))!;
    saved.character.pets[0].loadout.consumable = item;
    await kv.set(`save:${player}`, saved);
    const retry = await open(); assert.ok(retry.ok);
    assert.equal(retry.session.sessionId, first.session.sessionId);
    assert.equal((await kv.get<Record<string, any>>(`save:${player}`))!.character.pets[0].loadout.consumable, item);
});

test('losses keep the paid spend and terminal or expired pointers cannot permanently lock entry', async () => {
    const first = await open(); assert.ok(first.ok);
    const key = admission.showdownAdmissionKey(player, first.session.sessionId);
    await kv.set(key, { ...first.session, finished: true, outcome: 'loss' });
    await admission.clearArenaAdmission(player, first.session.sessionId);
    let saved = (await kv.get<Record<string, any>>(`save:${player}`))!;
    assert.equal(saved.character.petShowdownAdmission, undefined);
    assert.equal(saved.character.pets[0].loadout.consumable, undefined);
    const second = await open(); assert.ok(second.ok);
    assert.notEqual(second.session.sessionId, first.session.sessionId);
    await kv.del(admission.showdownAdmissionKey(player, second.session.sessionId));
    const expired = await open(); assert.ok(expired.ok);
    assert.notEqual(expired.session.sessionId, second.session.sessionId);
    saved = (await kv.get<Record<string, any>>(`save:${player}`))!;
    assert.equal(saved.character.pets[0].loadout.consumable, undefined);
});

test('practice remains rewardless and retains its equipped one-use item', async () => {
    const saved = (await kv.get<Record<string, any>>(`save:${player}`))!;
    const pets = saved.character.pets as Pet[];
    const session = createShowdownSession({ sessionId: 'practicefixture', playerName: player, format: '1v1', tier: 'warrior', seed: 51,
        playerPets: pets, enemyPets: [{ ...pets[0], id: 'enemy' }], enemyTeamName: 'Fixture', rewardEligible: false });
    assert.equal(admission.spendShowdownConsumables(saved.character, session), saved.character);
    assert.equal(saved.character.pets[0].loadout.consumable, item);
});

test('generic saves cannot forge an admission pointer or restore a consumed equipped item', async () => {
    const { sanitizeCharacterSave } = await import('../save/[name].js');
    const opened = await open(); assert.ok(opened.ok);
    const stored = (await kv.get<Record<string, any>>(`save:${player}`))!;
    const incoming = structuredClone(stored);
    incoming.character.petShowdownAdmission = { sessionId: 'forgedreceipt', at: 0 };
    incoming.character.pets[0].loadout.consumable = item;
    const sanitized = sanitizeCharacterSave(incoming, stored) as Record<string, any>;
    assert.deepEqual(sanitized.character.petShowdownAdmission, stored.character.petShowdownAdmission);
    assert.equal(sanitized.character.pets[0].loadout.consumable, undefined);
});
