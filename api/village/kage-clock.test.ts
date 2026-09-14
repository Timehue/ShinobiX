import assert from 'node:assert/strict';
import { before, beforeEach, test, mock } from 'node:test';
import { newChallenge, type KageStateLike } from './_kage-challenge.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'kage-clock-test-secret-at-least-32-characters';
let kv: typeof import('../_storage.js').kv;
let clocks: typeof import('./_kage-clock.js');
let handler: (req: never, res: never) => Promise<unknown>;
let getKage: typeof handler;
let token: typeof import('../_auth.js').issuePlayerToken;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let admission: typeof import('../pvp/_challenge-authorization.js');
let settle: typeof import('./_kage-settle.js');
const village = 'Frostfang Village';
const key = 'village:kage:frostfang-village';
const cid = 'political-challenge-one';
let now = Date.now();
let caseTime = 1_800_000_000_000;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    clocks = await import('./_kage-clock.js');
    handler = (await import('./kage-challenge.js')).default as unknown as typeof handler;
    getKage = (await import('./kage.js')).default as unknown as typeof handler;
    token = (await import('../_auth.js')).issuePlayerToken;
    online = (await import('../_realtime/online-store.js')).onlineStore;
    admission = await import('../pvp/_challenge-authorization.js');
    settle = await import('./_kage-settle.js');
});
beforeEach(async () => {
    mock.restoreAll();
    now = caseTime += 2 * 86400000;
    mock.method(Date, 'now', () => now);
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const name of ['kage', 'challenger', 'bystander']) {
        online.remove(name);
        await kv.set(`save:${name}`, { character: { name, village, ryo: 500_000 } });
    }
    await kv.set(key, { seatedKage: 'kage', kageSystemUnlocked: true, defenseCount: 3,
        challenge: newChallenge('challenger', now - 7 * 86400000, cid) });
});
function bothOnline() {
    for (const name of ['kage', 'challenger']) online.upsert({ name, sector: 0, character: null });
}
async function state() { return (await kv.get<KageStateLike>(key))!; }
async function post(name: string, body: Record<string, unknown>, endpoint = handler, method = 'POST') {
    const result = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(status: number) { result.status = status; return res; },
        json(body: Record<string, any>) { result.body = body; return res; }, end() { return res; } };
    await endpoint({ method, body: { playerName: name, village, ...body }, query: { village },
        headers: { 'x-player-token': token(name) }, socket: { remoteAddress: '127.0.0.78' } } as never, res as never);
    return result;
}
async function offer(from = 'kage', to = 'challenger', id = 'official-invite-123456') {
    const challenge = { id, fromName: from, toName: to, mode: 'standard', createdAt: now,
        kageChallengeId: cid, kageVillage: village };
    await admission.saveChallengeRecord({ id, from, to, mode: 'standard', status: 'pending', createdAt: now, challenge });
    return id;
}

test('server sampling runs outside Town Hall, pauses offline, and never charges a reconnect gap', async () => {
    bothOnline();
    await clocks.runKageChallengeClocks(now);
    now += 15_000;
    await clocks.runKageChallengeClocks(now);
    assert.equal((await state()).challenge?.obligationRemainingMs, 86_400_000 - 15_000);
    online.remove('challenger');
    now += 15_000;
    await clocks.runKageChallengeClocks(now);
    now += 86400000;
    bothOnline();
    await clocks.runKageChallengeClocks(now);
    assert.equal((await state()).challenge?.obligationRemainingMs, 86_400_000 - 15_000);
    assert.equal((await post('bystander', { action: 'press' })).status, 403);
});

test('Kage acceptance requires the actual official invitation; only the challenger clock then runs', async () => {
    bothOnline();
    assert.equal((await post('kage', { action: 'accept' })).status, 409);
    assert.equal((await post('challenger', { action: 'accept' })).status, 403);
    const invitationId = await offer();
    await clocks.advanceKageChallengeClock(village, now);
    now += 10_000;
    assert.equal((await post('kage', { action: 'accept', invitationId })).status, 200);
    const kageRemaining = (await state()).challenge!.obligationRemainingMs;
    now += 15_000;
    await clocks.advanceKageChallengeClock(village, now);
    now += 15_000;
    await clocks.advanceKageChallengeClock(village, now);
    assert.equal((await state()).challenge!.obligationRemainingMs, kageRemaining);
    assert.equal((await state()).challenge!.challengerRemainingMs, 86_400_000 - 15_000);
    assert.equal((await post('kage', { action: 'accept', invitationId })).status, 200);
    assert.equal((await state()).challenge!.challengerRemainingMs, 86_400_000 - 15_000);
    const publicView = await post('challenger', {}, getKage, 'GET');
    assert.equal(publicView.status, 200);
    assert.equal(publicView.body.challenge.duelInvitation, undefined);
});

test('an expired popup can be reopened and accepted into exactly one official duel', async () => {
    bothOnline();
    const invitationId = await offer();
    assert.equal((await post('kage', { action: 'accept', invitationId })).status, 200);
    await kv.del(admission.challengeRecordKey(invitationId));
    now += 4 * 60_000;
    bothOnline();
    assert.equal((await post('kage', { action: 'invitation' })).status, 403);
    assert.equal((await post('challenger', { action: 'invitation' })).status, 200);
    const inbox = (await kv.get<Array<{ id: string }>>('challenges:challenger'))!;
    const freshId = inbox[0].id;
    assert.notEqual(freshId, invitationId);
    const reservation = await admission.reserveChallengeForPvpSession({ challengeId: freshId,
        creator: 'challenger', p1: 'kage', p2: 'challenger', mode: 'standard', battleId: 'pvp-official-one' });
    assert.ok(reservation?.kageDuelAuthority);
    const session = { battleId: 'pvp-official-one', createdAt: now, p1: { name: 'kage' }, p2: { name: 'challenger' },
        kageDuelAuthority: reservation.kageDuelAuthority } as import('../pvp/session.js').PvpSession;
    await settle.ensureKageDuelAdmission(session);
    await settle.ensureKageDuelAdmission(session);
    assert.equal((await state()).challenge!.status, 'accepted');
    assert.equal((await state()).challenge!.clockRunning, false);
    assert.equal((await post('challenger', { action: 'invitation' })).status, 409);
    assert.equal(await admission.reserveChallengeForPvpSession({ challengeId: freshId,
        creator: 'challenger', p1: 'kage', p2: 'challenger', mode: 'standard', battleId: 'pvp-official-two' }), null);
});

test('a challenger-authored invitation cannot skip the Kage acceptance or second response', async () => {
    const id = await offer('challenger', 'kage');
    assert.equal((await post('kage', { action: 'accept', invitationId: id })).status, 409);
    await assert.rejects(admission.reserveChallengeForPvpSession({ challengeId: id,
        creator: 'kage', p1: 'challenger', p2: 'kage', mode: 'standard', battleId: 'pvp-forged' }), /kage-duel-requires/);
    assert.equal((await admission.loadChallengeRecord(id))!.status, 'pending');
});

test('clock forfeits publish once through concurrent polls and lost acknowledgements', async t => {
    bothOnline();
    const current = await state();
    await kv.set(key, { ...current, challenge: { ...current.challenge, obligationRemainingMs: 1,
        lastPressAt: now - 1, clockRunning: true } });
    const compare = kv.compareSet.bind(kv);
    let lost = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        const result = await compare(...args);
        if (args[0] === key && result && !lost) { lost = true; throw new Error('lost clock acknowledgement'); }
        return result;
    });
    await Promise.all([clocks.advanceKageChallengeClock(village, now), clocks.advanceKageChallengeClock(village, now)]);
    assert.equal((await state()).seatedKage, 'challenger');
    assert.equal((await state()).challenge, null);
    assert.equal((await state()).history!.filter(entry => entry.name === 'challenger').length, 1);
});

test('challenger timeout keeps the Kage and stake unchanged, with cooldown but no fake victory', async () => {
    bothOnline();
    const current = await state();
    await kv.set(key, { ...current, challenge: { ...current.challenge, kageAcceptedAt: now - 100,
        challengerRemainingMs: 1, lastPressAt: now - 1, clockRunning: true } });
    await clocks.advanceKageChallengeClock(village, now);
    const next = await state();
    assert.equal(next.seatedKage, 'kage');
    assert.equal(next.challenge, null);
    assert.equal(next.defenseCount, 3);
    assert.ok(next.challengerCooldowns!.challenger > now);
    assert.equal((await kv.get<{ character: { ryo: number } }>('save:challenger'))!.character.ryo, 500_000);
});


test('manual sealing and wrong-fighter sessions cannot freeze an outstanding response clock', async () => {
    const invitationId = await offer();
    assert.equal((await post('kage', { action: 'accept', battleId: 'invented-battle' })).status, 409);
    assert.equal((await post('kage', { action: 'accept', invitationId })).status, 200);
    assert.equal((await post('kage', { action: 'accept', battleId: 'unrelated-battle' })).status, 409);
    const session = { battleId: 'pvp-wrong-fighters', createdAt: now, p1: { name: 'kage' }, p2: { name: 'bystander' },
        kageDuelAuthority: { version: 1, village, challengeId: cid } } as import('../pvp/session.js').PvpSession;
    await assert.rejects(settle.ensureKageDuelAdmission(session), /authority-conflict/);
    await assert.rejects(settle.ensureKageDuelAdmission({ ...session, p1: { name: 'challenger' },
        p2: { name: 'kage' } } as import('../pvp/session.js').PvpSession), /kage-duel-requires/);
    assert.equal((await state()).challenge!.status, 'pending');
    assert.equal((await state()).challenge!.battleId, undefined);
});


test('the challenger clock pauses while the Kage cannot join the official duel', async () => {
    bothOnline();
    assert.equal((await post('kage', { action: 'accept', invitationId: await offer() })).status, 200);
    await clocks.advanceKageChallengeClock(village, now);
    online.setInBattle('kage', true);
    now += 15_000;
    await clocks.advanceKageChallengeClock(village, now);
    assert.equal((await state()).challenge!.challengerRemainingMs, 86400000);
    assert.equal((await state()).challenge!.clockPauseReason, 'kage-unavailable');
    online.setInBattle('kage', false);
    await clocks.advanceKageChallengeClock(village, now);
    now += 15_000;
    await clocks.advanceKageChallengeClock(village, now);
    assert.equal((await state()).challenge!.challengerRemainingMs, 86400000 - 15000);
});

test('only the verified political pair can use the official invitation exception', async () => {
    const challenge = { kageVillage: village, kageChallengeId: cid };
    assert.equal(await admission.isCurrentKageInvitation({ from: 'kage', to: 'challenger', mode: 'standard', challenge }), true);
    assert.equal(await admission.isCurrentKageInvitation({ from: 'bystander', to: 'challenger', mode: 'standard', challenge }), false);
    assert.equal(await admission.isCurrentKageInvitation({ from: 'kage', to: 'bystander', mode: 'standard', challenge }), false);
    await kv.set('save:kage', { character: { name: 'kage', village: 'Stormveil Village' } });
    assert.equal(await admission.isCurrentKageInvitation({ from: 'kage', to: 'challenger', mode: 'standard', challenge }), false);
});


test('real official delivery works through a social block and busy recipient; ordinary spars remain blocked', async () => {
    bothOnline();
    online.setInBattle('challenger', true);
    await kv.set('player-blocks:challenger', ['kage']);
    const notices = (await import('../player/challenge.js')).default as unknown as typeof handler;
    const invite = { id: 'official-delivery-1234', fromName: 'kage', toName: 'challenger', mode: 'standard',
        kageVillage: village, kageChallengeId: cid };
    const sent = await post('kage', { targetName: 'challenger', challenge: invite }, notices);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal((await post('kage', { action: 'accept', invitationId: invite.id })).status, 200);
    assert.equal((await post('kage', { targetName: 'challenger', challenge: { ...invite, id: 'forced-attack-1234', sectorAttack: true } }, notices)).status, 409);
    const spar = { id: 'ordinary-spar-1234', fromName: 'kage', toName: 'challenger', mode: 'standard' };
    assert.equal((await post('kage', { targetName: 'challenger', challenge: spar }, notices)).status, 403);
});
