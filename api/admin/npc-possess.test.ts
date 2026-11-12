import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'npc-test-full';
process.env.ADMIN_CONTENT_PASSWORD = 'npc-test-content';
process.env.SESSION_SECRET = 'npc-possess-test-session-secret-at-least-32-chars';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./npc-possess.js').default;
let auth: typeof import('../_auth.js');
let roster: typeof import('../../shared/npc-village-roster.js');
let guard: typeof import('../_npc-guard.js');
let npcPossessKey: typeof import('./npc-possess.js').npcPossessKey;

const full = { 'x-admin-password': 'npc-test-full' };
const content = { 'x-admin-password': 'npc-test-content' };

async function request(body?: Record<string, unknown>, headers: Record<string, string> = full) {
    const out = { status: 200, body: {} as any };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: body ? 'POST' : 'GET', body, headers, query: {}, socket: { remoteAddress: '127.0.0.93' } } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const mod = await import('./npc-possess.js');
    handler = mod.default as unknown as typeof handler;
    npcPossessKey = mod.npcPossessKey;
    auth = await import('../_auth.js');
    roster = await import('../../shared/npc-village-roster.js');
    guard = await import('../_npc-guard.js');
});

let clockWindow = 0;
beforeEach(async (context) => {
    if (!('mock' in context)) throw new Error('needs a per-test clock');
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() + (++clockWindow) * 60_001 });
});

const npc = () => roster.NPC_VILLAGE_ROSTER[0]!;
// The seeder's stamp (api/_npc-village-seed.ts): only such an account is ever controlled (api/_npc-ownership.ts).
const seed = async () => kv.set(`auth:${npc().id}`, { createdAt: Date.now(), npcVillage: true });

test('only a full admin can list or take control of NPCs', async () => {
    assert.equal((await request(undefined, {})).status, 403);
    assert.equal((await request(undefined, content)).status, 403);
    assert.equal((await request({ npc: npc().id, action: 'take' }, content)).status, 403);
});

test('a real player account can never be entered through NPC control', async () => {
    await kv.set('auth:realplayer', { hash: 'x', salt: 'y' });
    const out = await request({ npc: 'realplayer', action: 'take' });
    assert.equal(out.status, 400);
    assert.equal(out.body.token, undefined);
});

test('an unseeded NPC cannot be taken', async () => {
    await kv.del(`auth:${npc().id}`);
    assert.equal((await request({ npc: npc().id, action: 'take' })).status, 409);
});

test('an NPC name a PLAYER holds (an unstamped or password account) is never taken or released', async () => {
    for (const playerAuth of [{ createdAt: Date.now() }, { createdAt: Date.now(), npcVillage: true, hash: 'x', salt: 'y' }]) {
        await kv.set(`auth:${npc().id}`, playerAuth);
        const before = await auth.readPlayerSessionEpoch(npc().id);
        const taken = await request({ npc: npc().id, action: 'take' });
        assert.equal(taken.status, 409, JSON.stringify(taken.body));
        assert.equal(taken.body.token, undefined);
        assert.equal((await request({ npc: npc().id, action: 'release' })).status, 409);
        assert.equal(await auth.readPlayerSessionEpoch(npc().id), before, 'the player is never signed out');
        const listed = (await request()).body.npcs.find((n: { id: string }) => n.id === npc().id);
        assert.equal(listed.seeded, false);
    }
    await kv.del(`auth:${npc().id}`);
});

test('take mints a 2 h token for that NPC only, rotates its epoch, and release revokes it', async () => {
    await seed();
    const before = await auth.readPlayerSessionEpoch(npc().id);
    const taken = await request({ npc: npc().id, action: 'take' });
    assert.equal(taken.status, 200);
    assert.equal(await auth.verifyPlayerToken(taken.body.token), npc().id);
    assert.ok(await auth.readPlayerSessionEpoch(npc().id) > before, 'any earlier holder is kicked');
    assert.ok(taken.body.expiresAt - Date.now() <= 2 * 3_600_000 + 1000);
    assert.ok(await kv.get(npcPossessKey(npc().id)));
    // Never slid into a long session.
    assert.equal(await auth.maybeRefreshPlayerToken(taken.body.token), null);
    // The listing shows who is controlled.
    const listed = (await request()).body.npcs.find((row: { id: string }) => row.id === npc().id);
    assert.ok(listed.possessedUntil);

    const released = await request({ npc: npc().id, action: 'release' });
    assert.equal(released.status, 200);
    assert.equal(await auth.verifyPlayerToken(taken.body.token), null, 'release revokes the token');
    assert.equal(await kv.get(npcPossessKey(npc().id)), null);
});

test('an NPC seated in a clan-war Chronicle Showdown is engaged: no takeover, no second duel, no village-war post', async () => {
    await seed();
    const duel = await import('../_npc-duel.js');
    const campaign = await import('../_npc-clan-war-campaign.js');
    assert.equal(duel.NPC_CLAN_CARD_DUEL_REGISTRY_KEY, campaign.NPC_CLAN_CARD_DUEL_ACTIVE_KEY, 'the busy checks read the registry the card seat writes');
    const id = npc().id, challengeId = 'cw-busy-check-01', warId = 'busy-war-01';
    try {
        // Matched, the player has not opened the duel yet: the match holds the NPC.
        await kv.set(`clan-war:${warId}`, { id: warId, campaign: { matches: { [challengeId]: { status: 'active' } } } });
        await campaign.registerNpcClanCardDuel(challengeId, { npc: id, warId, at: Date.now() });
        assert.equal(await duel.npcEngaged(id), true, 'admitted, not opened yet');
        // Being played.
        await kv.set(`cw-tilecards:${challengeId}`, { status: 'active', p1Name: 'busyduelist', p2Name: id });
        assert.equal(await duel.npcInLiveCardDuel(id), true);
        assert.equal(await duel.npcEngaged(id), true);
        const refused = await request({ npc: id, action: 'take' });
        assert.equal(refused.status, 409, 'never taken over mid clan-war card duel');
        assert.equal(await kv.get(npcPossessKey(id)), null);
        await assert.rejects(duel.sealNpcDuel({ battleId: 'busy-shinobi-01', rewardAuthority: 'world', p1: { name: 'busyduelist' }, p2: { name: id } }, { sessionsEnabled: true }), /npc-duel-busy/);
        // Finished: the NPC is free again.
        await kv.set(`cw-tilecards:${challengeId}`, { status: 'done', p1Name: 'busyduelist', p2Name: id });
        assert.equal(await duel.npcEngaged(id), false);
        assert.equal((await request({ npc: id, action: 'take' })).status, 200);
    } finally {
        await kv.del(campaign.NPC_CLAN_CARD_DUEL_ACTIVE_KEY);
        await kv.del(`cw-tilecards:${challengeId}`);
        await kv.del(`clan-war:${warId}`);
        await request({ npc: id, action: 'release' });
    }
});

test('the takeover session can end itself (the return bar holds no admin password)', async () => {
    await seed();
    const taken = await request({ npc: npc().id, action: 'take' });
    const other = roster.NPC_VILLAGE_ROSTER[1]!;
    // Another NPC's token, or an ordinary player's, cannot release this one.
    await kv.set(`auth:${other.id}`, { createdAt: Date.now() });
    const otherToken = auth.issuePlayerToken(other.id, 60_000, await auth.readPlayerSessionEpoch(other.id))!;
    assert.equal((await request({ npc: npc().id, action: 'release' }, { 'x-player-token': otherToken })).status, 403);
    assert.equal((await request({ npc: npc().id, action: 'take' }, { 'x-player-token': taken.body.token })).status, 403, 'a token cannot take');
    const released = await request({ npc: npc().id, action: 'release' }, { 'x-player-token': taken.body.token });
    assert.equal(released.status, 200);
    assert.equal(await auth.verifyPlayerToken(taken.body.token), null);
    assert.equal(await kv.get(npcPossessKey(npc().id)), null);
});

test('every blocked route is a real registered route, wrapped at registration', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('server-api-routes.ts', 'utf8');
    for (const path of guard.NPC_BLOCKED_ROUTES) assert.ok(source.includes(`route('${path}'`), `${path} is not registered`);
    assert.match(source, /NPC_BLOCKED_ROUTES\.includes\(path\) \? refuseNpcAccounts\(handler, NPC_ALLOWED_ACTIONS\[path\]\) : handler/);
    for (const path of Object.keys(guard.NPC_ALLOWED_ACTIONS)) assert.ok(guard.NPC_BLOCKED_ROUTES.includes(path), `${path} allows an action on a route that is not blocked`);
    // An ordinary player, a request without a token and a preflight pass straight through.
    await kv.set('auth:ordinaryplayer', { createdAt: Date.now() });
    const playerToken = auth.issuePlayerToken('ordinaryplayer', 60_000, await auth.readPlayerSessionEpoch('ordinaryplayer'))!;
    let called = 0;
    const wrapped = guard.refuseNpcAccounts(async () => { called++; });
    const res = { setHeader() { return res; }, status() { return res; }, json() { return res; }, end() { return res; } };
    for (const req of [{ method: 'POST', headers: { 'x-player-token': playerToken } }, { method: 'POST', headers: {} }, { method: 'OPTIONS', headers: {} }])
        await wrapped({ ...req, body: {} } as never, res as never);
    assert.equal(called, 3);
});

test('a controlled NPC is refused on every value-moving and account route', async () => {
    await seed();
    const taken = await request({ npc: npc().id, action: 'take' });
    let called = 0;
    const wrapped = guard.refuseNpcAccounts(async () => { called++; });
    const out = { status: 200 };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json() { return res; }, end() { return res; } };
    await wrapped({ method: 'POST', headers: { 'x-player-token': taken.body.token }, body: {} } as never, res as never);
    assert.equal(out.status, 403);
    assert.equal(called, 0);
    assert.ok(guard.NPC_BLOCKED_ROUTES.includes('/player/trade'));
    assert.ok(guard.NPC_BLOCKED_ROUTES.includes('/bank/transfer'));
    assert.ok(guard.NPC_BLOCKED_ROUTES.includes('/player/account-deletion'));
    // Cinderhold's Kage seat is the server's: only NPCs belong to Cinderhold, so
    // the membership check alone would let a controlled NPC open one.
    assert.ok(guard.NPC_BLOCKED_ROUTES.includes('/village/kage'));
    assert.ok(guard.NPC_BLOCKED_ROUTES.includes('/village/kage-challenge'));
    // On the sector-war route only `attack` (binding a real world duel it is
    // fighting to the war) passes; declaring, abandoning and the rest do not.
    const war = guard.refuseNpcAccounts(async () => { called++; }, guard.NPC_ALLOWED_ACTIONS['/village/sector-war']);
    for (const action of ['declare', 'abandon', 'garrison-start', 'resolve']) {
        out.status = 200;
        await war({ method: 'POST', headers: { 'x-player-token': taken.body.token }, body: { action } } as never, res as never);
        assert.equal(out.status, 403, action);
    }
    assert.equal(called, 0);
    await war({ method: 'POST', headers: { 'x-player-token': taken.body.token }, body: JSON.stringify({ action: 'attack' }) } as never, res as never);
    assert.equal(called, 1, 'registering its own world duel passes');
});
