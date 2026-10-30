import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'server-reset-test-full';
process.env.SESSION_SECRET = 'server-reset-test-session-secret-at-least-32-chars';

/*
 * The full reset end to end, against the in-memory store: every player account
 * and every clan goes, the village leadership falls back to its NPCs, and the
 * protected admin accounts keep their saves but leave every clan and seat
 * behind (owner ruling 2026-10-29).
 */

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./server-reset.js').default;
const month = new Date().toISOString().slice(0, 7);

async function reset(dryRun = false) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { dryRun }, headers: { 'x-admin-password': 'server-reset-test-full' }, query: {}, socket: { remoteAddress: '127.0.0.95' } } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./server-reset.js')).default as unknown as typeof handler;
});

test('a full reset leaves the start state: no players, no clans, NPC leaders, Rill kept without any role', async () => {
    const rillCharacter = {
        name: 'Rill', level: 99, village: 'Stormveil Village', ryo: 12345,
        clan: 'Storm Lords', clanFounder: true, clanUpgradeLevels: { hall: 3 }, guardQueued: true,
        monthlyPvpKills: 40, pvpKillMonth: month, totalPvpKills: 400,
        elderWinDays: [{ day: `${month}-01`, village: 'Stormveil Village', pvp: 3, pve: 2 }], elderFocus: 'war',
        clanBattleContrib: 9, clanEventContrib: 4, clanMissionContrib: 7, clanContribMonth: month,
    };
    await kv.set('save:rill', { _saveVersion: 3, character: rillCharacter });
    await kv.set('auth:rill', { hash: 'h', salt: 's' });
    await kv.set('save:dopey', { _saveVersion: 1, character: { name: 'Dopey', level: 40, village: 'Stormveil Village', clan: 'Dopey Clan' } });
    await kv.set('auth:dopey', { hash: 'h', salt: 's' });
    await kv.set('save:clan-stormlords', { name: 'Storm Lords', founderName: 'Rill', members: [{ name: 'Rill' }] });
    await kv.set('save:clan-dopeyclan', { name: 'Dopey Clan', founderName: 'Dopey', members: [{ name: 'Dopey' }] });
    await kv.set('clan-seal-pool:storm lords', { clanName: 'Storm Lords', balance: 500, log: [] });
    await kv.set('village:kage:stormveil-village', { kageSystemUnlocked: true, seatedKage: 'Rill', seatedAt: 1 });
    await kv.set('village:elder-council:stormveil', { seats: ['Rill', '', ''] });
    await kv.set('game:village-state:stormveilvillage', { anbuAppointees: ['Rill', '', ''], elderAppointees: ['Rill', '', ''] });
    await kv.set('game:village-leadership-images', { images: {} });
    await kv.set('save:admin1', { creatorItems: [] });

    const preview = await reset(true);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.ok(await kv.get('save:dopey'), 'the preview deletes nothing');

    const done = await reset(false);
    assert.equal(done.status, 200, JSON.stringify(done.body));

    // Every other player and every clan is gone.
    for (const key of ['save:dopey', 'auth:dopey', 'save:clan-stormlords', 'save:clan-dopeyclan', 'clan-seal-pool:storm lords']) {
        assert.equal(await kv.get(key), null, `${key} must be wiped`);
    }
    // Leadership falls back to the NPCs: no seated Kage, no council, no appointees.
    for (const key of ['village:kage:stormveil-village', 'village:elder-council:stormveil', 'game:village-state:stormveilvillage']) {
        assert.equal(await kv.get(key), null, `${key} must be wiped`);
    }
    // The admin's work survives.
    assert.ok(await kv.get('save:admin1'));
    assert.ok(await kv.get('game:village-leadership-images'));

    // Rill keeps the account and progress, but no clan, seat or seat-earning standing.
    const rill = (await kv.get<{ character: Record<string, unknown> }>('save:rill'))!.character;
    assert.equal(rill.level, 99);
    assert.equal(rill.ryo, 12345);
    assert.equal(rill.totalPvpKills, 400, 'lifetime record kept');
    assert.equal(rill.clan, null);
    assert.equal(rill.clanFounder, false);
    assert.equal(rill.guardQueued, false);
    assert.equal(rill.monthlyPvpKills, 0, 'no auto-earned ANBU seat from last era\'s kills');
    assert.deepEqual(rill.elderWinDays, [], 'no head start in the next elder election');
    assert.equal(rill.elderFocus, null);
    assert.equal(rill.clanBattleContrib, 0);
    assert.ok(await kv.get('auth:rill'), 'Rill can still sign in');
    assert.deepEqual(done.body.protectedStandingStripped, ['rill']);
});
