import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultWarfrontLadderPlan, parseWarfrontLadderPlan, WARFRONT_LADDER_RULES } from '../../shared/warfront-ladder-plan.js';
import type { DefenseDoc, LadderEntry } from './_core.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
const previousSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = 'warfront-ladder-handler-integration-fixture-secret';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./ladder.js').default;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let core: typeof import('./_core.js');
let runWarfrontRite: typeof import('../_pet-sim/pet-warfront-rite.js').runWarfrontRite;
let serial = 0;
const ORDER = 'petladder:tactical';
const defKey = (name: string) => `${ORDER}:def:${name}`;
const lastKey = (name: string) => `${ORDER}:last:${name}`;
const dailyKey = (name: string) => `${ORDER}:daily:${name}:${new Date().toISOString().slice(0, 10)}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./ladder.js')).default as unknown as typeof handler;
    core = await import('./_core.js');
    ({ runWarfrontRite } = await import('../_pet-sim/pet-warfront-rite.js'));
});
after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
});

async function call(player: string | null, action: string | null, fields: Record<string, unknown> = {}) {
    let status = 200;
    let body: any;
    const headers: Record<string, unknown> = {};
    const response = {
        setHeader: (name: string, value: unknown) => { headers[name] = value; return response; },
        status: (value: number) => { status = value; return response; },
        json: (value: unknown) => { body = JSON.parse(JSON.stringify(value)); return response; },
        end: () => response,
    };
    await handler({
        method: action ? 'POST' : 'GET',
        query: { mode: 'tactical', name: player, ...(!action ? fields : {}) },
        body: action ? { mode: 'tactical', name: player, action, ...fields } : undefined,
        headers: player ? { 'x-player-token': issuePlayerToken(player)! } : {},
        socket: { remoteAddress: `10.28.${serial}.1` },
    } as never, response as never);
    return { status, body, headers };
}

async function fixture() {
    serial++;
    const attacker = `wfladder${serial}attacker`, defender = `wfladder${serial}defender`;
    const pets = (name: string, strong: boolean) => ['Fire', 'Water', 'Wind', 'Earth'].map((element, index) => ({
        id: `${name}-${index}`, name: `${element} Companion`, element, rarity: 'rare', level: strong ? 40 : 1,
        hp: strong ? 1800 : 160, attack: strong ? 300 : 15, defense: strong ? 140 : 5, speed: strong ? 130 : 20,
        role: ['defender', 'tracker', 'assassin', 'sage'][index],
        subRole: ['bruiser', 'control', 'striker', 'support'][index],
        jutsus: [{ name: 'Strike', power: 60, kind: 'damage', cooldown: 1 }],
    }));
    const attackerPets = pets(attacker, true), defenderPets = pets(defender, false);
    for (const [name, roster] of [[attacker, attackerPets], [defender, defenderPets]] as const) {
        await kv.set(`save:${name}`, { character: { name, village: 'Leaf Village', level: 40, ryo: 1234, pets: roster } });
        const snapshots = roster.map(core.snapshotLadderPet);
        await kv.set(defKey(name), { slug: name, name, mode: 'tactical', pets: snapshots, roles: core.ladderRoles(snapshots), updatedAt: 123 } satisfies DefenseDoc);
    }
    const record = { wins: 7, losses: 3, defended: 5, defeated: 2 };
    const entries = [defender, attacker].map((name) => ({ slug: name, name, record: { ...record }, summary: [], updatedAt: 123 } satisfies LadderEntry));
    await kv.set(ORDER, entries);
    return { attacker, defender, attackerPets, defenderPets, entries, record };
}

test('ranked handler authenticates GET and rejects another player identity before saving', async () => {
    const f = await fixture();
    assert.equal((await call(null, null)).status, 401);
    const before = await kv.get(defKey(f.defender));
    const forged = await call(f.attacker, 'defense', { name: f.defender, petIds: f.defenderPets.map((pet) => pet.id), warfrontPlan: defaultWarfrontLadderPlan() });
    assert.equal(forged.status, 401);
    assert.deepEqual(await kv.get(defKey(f.defender)), before);
    const own = await call(f.attacker, null, { name: f.defender });
    assert.equal(own.body.you.rank, 2, 'GET query name must not substitute for authenticated identity');
});

test('save → offer → challenge scores the sealed Rite and preserves history, quota, and offline notification', async () => {
    const f = await fixture();
    const legacy = await call(f.defender, null);
    assert.deepEqual(legacy.body.you.warfrontPlan, defaultWarfrontLadderPlan());
    assert.deepEqual(legacy.body.you.defensePetIds, f.defenderPets.map((pet) => pet.id));
    assert.equal((await kv.get<DefenseDoc>(defKey(f.defender)))?.warfrontPlan, undefined, 'legacy read is nondestructive');
    const plan = { ...defaultWarfrontLadderPlan(), deployment: [0, 5, 2, 9] };
    const saved = await call(f.attacker, 'defense', { petIds: f.attackerPets.map((pet) => pet.id), warfrontPlan: plan, pets: [{ hp: 999999, attack: 999999 }] });
    assert.equal(saved.status, 200);
    const sealed = await kv.get<DefenseDoc>(defKey(f.attacker));
    assert.deepEqual(sealed?.warfrontPlan, plan);
    assert.equal(sealed?.pets[0].hp, 1800);
    assert.equal(sealed?.pets[0].subRole, 'bruiser');
    const offered = await call(f.attacker, 'offer');
    assert.equal(offered.status, 200);
    assert.equal(offered.body.offer[0].id, f.defender);
    assert.equal(offered.body.offer.length, 3);
    const saveBefore = await kv.get(`save:${f.attacker}`);
    const challenged = await call(f.attacker, 'challenge', { targetId: f.defender, warfrontRules: WARFRONT_LADDER_RULES, won: false, seed: 1 });
    assert.equal(challenged.status, 200);
    assert.equal(challenged.body.won, true);
    assert.equal(challenged.body.rank, 1);
    assert.equal(challenged.body.challengesLeft, 9);
    const replay = challenged.body.replay;
    assert.equal(replay.kind, 'warfront');
    assert.deepEqual(parseWarfrontLadderPlan(replay.bluePlan), plan);
    const band = (slots: Array<{ pet: Parameters<typeof core.toPet>[0]; role: string }>) => slots.map((slot) => ({ ...core.toPet(slot.pet), role: slot.pet.role ?? slot.role })) as unknown as Parameters<typeof runWarfrontRite>[0];
    const scored = runWarfrontRite(band(replay.blue), band(replay.red), replay.seed, replay.bluePlan, replay.redPlan);
    assert.equal(scored.winner, 'blue');
    assert.deepEqual(await kv.get(`save:${f.attacker}`), saveBefore, 'ranked challenges must not award or spend pet economy');
    const order = await kv.get<LadderEntry[]>(ORDER);
    assert.equal(order?.[0].slug, f.attacker);
    assert.deepEqual(order?.[0].record, { ...f.record, wins: 8 });
    assert.deepEqual(order?.[1].record, { ...f.record, defeated: 3 });
    assert.equal(await kv.get(dailyKey(f.attacker)), 1);
    assert.equal(await kv.get(lastKey(f.attacker)), f.defender);
    const offline = await call(f.defender, null);
    assert.equal(offline.body.notifications.at(-1).from, f.attacker);
    assert.equal(offline.body.notifications.at(-1).mode, 'tactical');
    assert.equal(offline.body.notifications.at(-1).won, true);
    assert.equal((await call(f.defender, 'clearNotify')).status, 200);
    assert.equal(await kv.get(`petladder:notify:${f.defender}`), null);
});

test('invalid positions, unowned pets, busy pets, and stale clients cannot alter a defense or consume a challenge', async () => {
    const f = await fixture();
    const before = await kv.get(defKey(f.attacker));
    assert.equal((await call(f.attacker, 'defense', { petIds: f.attackerPets.map((pet) => pet.id), warfrontPlan: { ...defaultWarfrontLadderPlan(), deployment: [0, 0, 2, 3] } })).status, 400);
    assert.equal((await call(f.attacker, 'defense', { petIds: f.defenderPets.map((pet) => pet.id), warfrontPlan: defaultWarfrontLadderPlan() })).status, 400);
    const save = await kv.get<any>(`save:${f.attacker}`);
    save.character.pets[0].training = { endsAt: Date.now() + 60_000 };
    await kv.set(`save:${f.attacker}`, save);
    assert.equal((await call(f.attacker, 'defense', { petIds: f.attackerPets.map((pet) => pet.id), warfrontPlan: defaultWarfrontLadderPlan() })).status, 409);
    assert.equal((await call(f.attacker, 'challenge', { targetId: f.defender })).status, 409);
    assert.deepEqual(await kv.get(defKey(f.attacker)), before);
    assert.equal(await kv.get(dailyKey(f.attacker)), null);
});

test('legacy random-instance defenses recover missing model identity on both seats without refreshing sealed combat or storage', async () => {
    const f = await fixture();
    const sealedBefore: DefenseDoc[] = [];
    for (const name of [f.attacker, f.defender]) {
        const save = await kv.get<any>(`save:${name}`);
        save.character.pets = save.character.pets.map((pet: Record<string, unknown>) => ({
            ...pet, templateId: `starter-${String(pet.element).toLowerCase()}`, evolutionStage: 1,
            paletteVariantId: 'chromatic', attack: 999, role: 'sage', jutsus: [],
        }));
        await kv.set(`save:${name}`, save);
        const sealed = await kv.get<DefenseDoc>(defKey(name));
        assert.ok(sealed);
        sealed.pets[0] = { ...sealed.pets[0], templateId: 'starter-earth', evolutionStage: 0, paletteVariantId: 'original' };
        await kv.set(defKey(name), sealed);
        sealedBefore.push(sealed);
    }
    const result = await call(f.attacker, 'challenge', { targetId: f.defender, warfrontRules: WARFRONT_LADDER_RULES });
    assert.equal(result.status, 200);
    const combatOnly = (pet: Record<string, unknown>) => {
        const copy = { ...pet };
        delete copy.templateId;
        delete copy.evolutionStage;
        delete copy.paletteVariantId;
        return JSON.parse(JSON.stringify(copy));
    };
    for (const [index, seat] of ['blue', 'red'].entries()) {
        result.body.replay[seat].forEach((slot: { pet: Record<string, unknown> }, slotIndex: number) => {
            assert.equal(slot.pet.templateId, slotIndex === 0 ? 'starter-earth' : `starter-${String(slot.pet.element).toLowerCase()}`);
            assert.equal(slot.pet.evolutionStage, slotIndex === 0 ? 0 : 1);
            assert.equal(slot.pet.paletteVariantId, slotIndex === 0 ? 'original' : 'chromatic');
            assert.deepEqual(combatOnly(slot.pet), combatOnly(sealedBefore[index].pets[slotIndex]));
        });
        const name = index === 0 ? f.attacker : f.defender;
        assert.deepEqual(await kv.get(defKey(name)), sealedBefore[index], 'presentation hydration must not overwrite an offline defense');
    }
});

test('a losing human challenge preserves rank and records a held offline defense', async () => {
    const f = await fixture();
    await kv.set(ORDER, [...f.entries].reverse());
    const result = await call(f.defender, 'challenge', { targetId: f.attacker, warfrontRules: WARFRONT_LADDER_RULES, won: true });
    assert.equal(result.status, 200);
    assert.equal(result.body.won, false, 'posted outcome cannot award a loss as a victory');
    assert.equal(result.body.rank, 2);
    const order = await kv.get<LadderEntry[]>(ORDER);
    assert.deepEqual(order?.map((entry) => entry.slug), [f.attacker, f.defender]);
    assert.deepEqual(order?.[0].record, { ...f.record, defended: 6 });
    assert.deepEqual(order?.[1].record, { ...f.record, losses: 4 });
    assert.equal(await kv.get(dailyKey(f.defender)), 1);
});

test('an unranked AI victory inducts the player without truncating existing standings or history', async () => {
    const f = await fixture();
    const existing = Array.from({ length: 1000 }, (_, index) => ({ ...f.entries[0], slug: `existing-${index}`, name: `Existing ${index}` }));
    await kv.set(ORDER, existing);
    const result = await call(f.attacker, 'challenge', { targetId: 'ai:0', warfrontRules: WARFRONT_LADDER_RULES });
    assert.equal(result.status, 200);
    assert.equal(result.body.won, true);
    assert.equal(result.body.rank, 1001);
    assert.equal(result.body.replay.red.length, 4);
    assert.ok(result.body.replay.red.every((slot: { pet: { templateId: string; jutsus: unknown[] } }) => slot.pet.templateId.startsWith('starter-') && slot.pet.jutsus.length > 0));
    const order = await kv.get<LadderEntry[]>(ORDER);
    assert.equal(order?.length, 1001);
    assert.deepEqual(order?.slice(0, 1000), existing);
    assert.equal(order?.at(-1)?.slug, f.attacker);
    const list = await call(f.attacker, null);
    assert.equal(list.body.total, 1001);
    assert.equal(list.body.you.rank, 1001);
    assert.deepEqual(list.body.you.record, { wins: 1, losses: 0, defended: 0, defeated: 0 });
    assert.equal(list.body.ladder.length, 200, 'only the response list is bounded');
});

test('malformed duplicate or wrong-mode legacy defenses fail eligibility without simulating or charging', async () => {
    for (const wrongMode of [false, true]) {
        const f = await fixture();
        const defense = await kv.get<DefenseDoc>(defKey(f.attacker));
        assert.ok(defense);
        if (wrongMode) defense.mode = 'coliseum';
        else defense.pets[1] = { ...defense.pets[0] };
        await kv.set(defKey(f.attacker), defense);
        assert.equal((await call(f.attacker, 'offer')).status, 409);
        assert.equal((await call(f.attacker, 'challenge', { targetId: f.defender, warfrontRules: WARFRONT_LADDER_RULES })).status, 409);
        assert.equal(await kv.get(dailyKey(f.attacker)), null);
        assert.deepEqual(await kv.get(ORDER), f.entries);
    }
});

test('rank eligibility lost while acquiring the commit lock returns a conflict without a replay or rematch penalty', async (t) => {
    const f = await fixture();
    const get = kv.get.bind(kv);
    let reads = 0;
    t.mock.method(kv, 'get', async (key: string) => {
        if (key === ORDER && ++reads === 2) await kv.set(ORDER, [...f.entries].reverse());
        return get(key);
    });
    const result = await call(f.attacker, 'challenge', { targetId: f.defender, warfrontRules: WARFRONT_LADDER_RULES });
    assert.equal(result.status, 409);
    assert.equal(result.body.replay, undefined);
    assert.equal(await kv.get(dailyKey(f.attacker)), null);
    assert.equal(await kv.get(lastKey(f.attacker)), null);
    assert.deepEqual(await kv.get(ORDER), [...f.entries].reverse());
});

test('latest rematch and daily-cap guards are rechecked inside the commit lock without burning another charge', async (t) => {
    const f = await fixture();
    const get = kv.get.bind(kv);
    let reads = 0;
    t.mock.method(kv, 'get', async (key: string) => {
        if (key === ORDER && ++reads === 2) await kv.set(dailyKey(f.attacker), 10);
        return get(key);
    });
    const result = await call(f.attacker, 'challenge', { targetId: f.defender, warfrontRules: WARFRONT_LADDER_RULES });
    assert.equal(result.status, 429);
    assert.equal(await kv.get(dailyKey(f.attacker)), 10);
    assert.deepEqual(await kv.get(ORDER), f.entries);
});

test('a just-recorded same-opponent match blocks a second result at the ranking lock', async (t) => {
    const f = await fixture();
    const get = kv.get.bind(kv);
    let reads = 0;
    t.mock.method(kv, 'get', async (key: string) => {
        if (key === ORDER && ++reads === 2) await kv.set(lastKey(f.attacker), f.defender);
        return get(key);
    });
    const result = await call(f.attacker, 'challenge', { targetId: f.defender, warfrontRules: WARFRONT_LADDER_RULES });
    assert.equal(result.status, 409);
    assert.equal(await kv.get(dailyKey(f.attacker)), null);
    assert.deepEqual(await kv.get(ORDER), f.entries);
});

test('a notification failure after rank commit still returns the committed replay', async (t) => {
    const f = await fixture();
    const set = kv.set.bind(kv);
    t.mock.method(console, 'error', () => undefined);
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: Parameters<typeof kv.set>[2]) => {
        if (key === `petladder:notify:${f.defender}`) throw new Error('injected notification outage');
        return set(key, value, options);
    });
    const result = await call(f.attacker, 'challenge', { targetId: f.defender, warfrontRules: WARFRONT_LADDER_RULES });
    assert.equal(result.status, 200);
    assert.equal(result.body.replay.kind, 'warfront');
    assert.equal(await kv.get(lastKey(f.attacker)), f.defender);
    assert.equal((await kv.get<LadderEntry[]>(ORDER))?.[0].record.wins, 8);
});

test('a contended defense save fails closed and preserves both stored formation and history', async (t) => {
    const f = await fixture();
    const before = await kv.get(defKey(f.attacker));
    t.mock.method(console, 'error', () => undefined);
    await kv.set(`lock:${ORDER}`, 'another-owner', { ex: 30 });
    try {
        const result = await call(f.attacker, 'defense', { petIds: f.attackerPets.map((pet) => pet.id), warfrontPlan: defaultWarfrontLadderPlan() });
        assert.equal(result.status, 500);
        assert.deepEqual(await kv.get(defKey(f.attacker)), before);
        assert.deepEqual(await kv.get(ORDER), f.entries);
    } finally { await kv.del(`lock:${ORDER}`); }
});
