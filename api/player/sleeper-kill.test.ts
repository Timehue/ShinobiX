process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sleeper-kill-test-secret-32-bytes-long';

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// The shared sleeper-KO settlement (`settleSleeperKoLocked`, used by the player
// handler AND by NPC merc raids in api/_merc-auto.ts) plus the player handler
// itself. Runs against the isolated in-memory KV.
//
// The settlement tests below used to call a `koSleeperCamp` wrapper that ONLY
// this file called — api/_merc-auto.ts takes the lock and calls
// settleSleeperKoLocked directly — so a green run proved nothing about either
// real caller. The wrapper is gone; these tests now take the same lock the merc
// raid takes, and the handler has its own coverage further down.

let kv: typeof import('../_storage.js').kv;
let settleSleeperKoLocked: typeof import('./sleeper-kill.js').settleSleeperKoLocked;
let handler: (req: never, res: never) => Promise<unknown>;
let withKvLock: typeof import('../_lock.js').withKvLock;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let computePvpWinGains: typeof import('../_xp-engine.js').computePvpWinGains;
let repeatWinDecayMultiplier: typeof import('../pvp/_reward-farm.js').repeatWinDecayMultiplier;
let setSleeperCamp: typeof import('../_realtime/sleeper-camps.js').setSleeperCamp;
let stampPlayerIp: typeof import('../_player-ips.js').stampPlayerIp;
let hasRecentIpOrFpOverlap: typeof import('../_player-ips.js').hasRecentIpOrFpOverlap;
let getSleeperCamp: typeof import('../_realtime/sleeper-camps.js').getSleeperCamp;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ settleSleeperKoLocked } = await import('./sleeper-kill.js'));
    handler = (await import('./sleeper-kill.js')).default as unknown as typeof handler;
    ({ withKvLock } = await import('../_lock.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ computePvpWinGains } = await import('../_xp-engine.js'));
    ({ repeatWinDecayMultiplier } = await import('../pvp/_reward-farm.js'));
    ({ setSleeperCamp, getSleeperCamp } = await import('../_realtime/sleeper-camps.js'));
    ({ stampPlayerIp, hasRecentIpOrFpOverlap } = await import('../_player-ips.js'));
});

/** Exactly what api/_merc-auto.ts does: take the target's save lock, settle. */
function koUnderLock(targetSlug: string, opts: { now?: number; expectSector?: number } = {}) {
    return withKvLock(`save:${targetSlug}`, () => settleSleeperKoLocked(targetSlug, opts), { failClosed: true });
}

function seedSave(name: string, sector: number, extra: Record<string, unknown> = {}) {
    return kv.set(`save:${name}`, {
        currentSector: sector,
        character: { name, village: 'Stormveil Village', hp: 400, maxHp: 500, level: 12, ...extra },
    });
}

test('settleSleeperKoLocked: an offline camper in a wild sector is hospitalized, sent to the village, and the camp is cleared', async () => {
    const NOW = 1_800_000_000_000;
    await seedSave('zed', 7);
    await setSleeperCamp({ name: 'zed', displayName: 'Zed', sector: 7, createdAt: NOW - 1000 });

    const r = await koUnderLock('zed', { now: NOW, expectSector: 7 });
    assert.equal(r.status, 200);
    const after = await kv.get<{ currentSector: number; character: Record<string, unknown> }>('save:zed');
    assert.equal(after?.character.hp, 0);
    assert.equal(after?.character.hospitalized, true);
    assert.equal(after?.character.hospitalizedAt, NOW);
    assert.ok(Number(after?.character.hospitalizedUntil) > NOW);
    assert.equal(after?.currentSector, 0, 'relocated to the village → out of the sleeper pool');
    assert.equal(await getSleeperCamp('zed'), null, 'camp cleared');

    // No double hit: the camp is gone, so a second raid (merc tick, other player) is refused.
    const again = await koUnderLock('zed', { now: NOW + 60_000, expectSector: 7 });
    assert.equal(again.status, 409);
});

test('settleSleeperKoLocked: a camp that moved to another sector is refused when the caller pins the sector', async () => {
    await seedSave('mia', 9);
    await setSleeperCamp({ name: 'mia', displayName: 'Mia', sector: 9, createdAt: 1 });
    const r = await koUnderLock('mia', { now: 2, expectSector: 4 });
    assert.equal(r.status, 409);
    const after = await kv.get<{ character: Record<string, unknown> }>('save:mia');
    assert.equal(after?.character.hospitalized, undefined, 'untouched');
});

test('settleSleeperKoLocked: a village / Central logout never becomes a camp, so it cannot be KO\'d', async () => {
    await seedSave('home', 0);
    await setSleeperCamp({ name: 'home', displayName: 'Home', sector: 0, createdAt: 1 }); // store refuses sector < 1
    assert.equal(await getSleeperCamp('home'), null);
    const r = await koUnderLock('home', { now: 2 });
    assert.equal(r.status, 409);
    const after = await kv.get<{ character: Record<string, unknown> }>('save:home');
    assert.equal(after?.character.hp, 400, 'untouched');
});

test('settleSleeperKoLocked: an already-hospitalized camper is not hit twice', async () => {
    await seedSave('down', 5, { hospitalized: true, hospitalizedUntil: Date.now() + 60_000 });
    await setSleeperCamp({ name: 'down', displayName: 'Down', sector: 5, createdAt: 1 });
    const r = await koUnderLock('down', { now: Date.now() });
    assert.equal(r.status, 409);
});

// ── The PLAYER handler: rewards + the notify wiring ──────────────────────────
//
// Everything above settles a KO with no attacker. The handler is the only path
// that PAYS, and it was previously untested end to end: ryo (with the repeat-
// opponent decay), the PvP kill credit, Vanguard seals, and the victim notice.

type ResponseOut = { statusCode: number; body: Record<string, unknown> };

async function postKill(attacker: string, target: string, ip = '10.9.0.1'): Promise<ResponseOut> {
    const token = issuePlayerToken(attacker);
    assert.ok(token, 'test session token should be minted');
    const out: ResponseOut = { statusCode: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.statusCode = code; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { targetName: target },
        headers: { 'x-player-name': attacker, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

/** A fresh sleeping victim in `sector`, and the attacker standing right there. */
async function stage(attacker: string, victim: string, sector: number, victimExtra: Record<string, unknown> = {}) {
    await seedSave(victim, sector, victimExtra);
    await setSleeperCamp({ name: victim, displayName: victim, sector, createdAt: Date.now() - 1000 });
    onlineStore.upsert({ name: attacker, sector, character: null });
}

const charOf = async (name: string) =>
    (await kv.get<{ character: Record<string, unknown> }>(`save:${name}`))?.character ?? {};

test('sleeper-kill handler: pays the base ryo + a PvP kill credit, and tells the victim who did it', async () => {
    const { takeOfflineNotices } = await import('./_offline-notices.js');
    const { recentAnnouncements } = await import('../_announce.js');

    await seedSave('raiden', 0, { ryo: 1_000, totalPvpKills: 4 });
    await stage('raiden', 'sleepy', 11);

    const out = await postKill('raiden', 'sleepy');
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const reward = out.body.reward as Record<string, unknown>;
    assert.equal(reward.rewardEligible, true);
    assert.equal(reward.target, 'sleepy');

    // Base ryo is the live PvP-win primitive, undecayed on a first win.
    const expected = computePvpWinGains(await charOf('raiden') as never, 11).ryoGain;
    assert.ok(expected > 0);
    assert.equal(reward.ryo, expected, 'first win against this opponent pays in full');
    assert.equal(reward.xp, 0, 'character XP is retired — a sleeper KO grants no stat growth');

    const attacker = await charOf('raiden');
    assert.equal(attacker.ryo, 1_000 + expected, 'the ryo landed on the committed save');
    assert.equal(attacker.totalPvpKills, 5, 'PvP kill credit is applied server-side');
    assert.equal(attacker.monthlyPvpKills, 1);
    assert.equal(typeof attacker.pvpKillMonth, 'string');

    // The victim is settled exactly as the shared path settles them.
    const victim = await charOf('sleepy');
    assert.equal(victim.hp, 0);
    assert.equal(victim.hospitalized, true);
    assert.equal(await getSleeperCamp('sleepy'), null);

    // notifySleeperKill wiring — the one thing a KO owes the offline victim.
    const notices = await takeOfflineNotices('sleepy');
    assert.equal(notices.length, 1, JSON.stringify(notices));
    assert.equal(notices[0].kind, 'sleeper-kill');
    assert.equal(notices[0].by, 'raiden');
    assert.equal(notices[0].sector, 11, 'the notice names the sector the camp was in');
    const post = (await recentAnnouncements(50)).find((a) => a.type === 'sleeper_kill' && a.player === 'raiden');
    assert.ok(post, 'the world feed heard about it');
    assert.equal(post.importance, 'low');
});

test('sleeper-kill handler: returns the bumped save version so the attacker can adopt it', async () => {
    // A server credit that bumps _saveVersion without handing it back leaves the
    // open tab on the old version: its next autosave 409s and has to refetch. The
    // credit was never lost, but the round trip is avoidable — every other credit
    // endpoint returns the version, and this one now does too.
    await seedSave('kiyo', 0, { ryo: 0 });
    await stage('kiyo', 'dozer', 9);

    const before = Number((await kv.get<Record<string, unknown>>('save:kiyo'))?._saveVersion ?? 0);
    const out = await postKill('kiyo', 'dozer');
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));

    const stored = Number((await kv.get<Record<string, unknown>>('save:kiyo'))?._saveVersion ?? 0);
    assert.ok(stored > before, 'the credit must bump the stored version (bumpSaveVersion contract)');
    assert.equal(out.body._saveVersion, stored,
        'the response must carry the version that actually landed on the save');
});

test('sleeper-kill handler: collects the head bounty, once, and clears it from the board', async () => {
    // A bounty is "kill this player, collect" — and a sleeping-camp KO is a real
    // kill (it hospitalizes them and books a PvP kill credit). It just has no
    // PvpSession, so it could never reach api/pvp/bounty.ts's session-keyed
    // claim route, and the hunter got nothing.
    const BOUNTY_KEY = 'pvp:bounties';
    await kv.set(BOUNTY_KEY, { bounties: [{ target: 'napper', amount: 25_000, contributors: ['someone'], updatedAt: Date.now() }] });

    await seedSave('hunter', 0, { ryo: 500 });
    await stage('hunter', 'napper', 8);
    const before = Number((await charOf('hunter')).ryo);

    const out = await postKill('hunter', 'napper');
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const reward = out.body.reward as Record<string, unknown>;
    assert.equal(reward.bounty, 25_000, 'the head bounty must be paid to the hunter');

    const hunter = await charOf('hunter');
    const baseRyo = Number(reward.ryo);
    assert.equal(hunter.ryo, before + baseRyo + 25_000, 'base ryo AND the bounty land on the committed save');
    const returned = out.body.character as Record<string, unknown>;
    assert.equal(Number(returned.ryo), Number(hunter.ryo),
        'the returned character must match what was persisted, or the client paints a stale balance');

    // The pool pays ONCE: claimBounty removes the head under the board lock.
    const board = await kv.get<{ bounties: unknown[] }>(BOUNTY_KEY);
    assert.deepEqual(board?.bounties, [], 'the claimed head must leave the board');
});

test('sleeper-kill handler: an ineligible (same-device) KO leaves the bounty for a real hunter', async () => {
    const BOUNTY_KEY = 'pvp:bounties';
    await kv.set(BOUNTY_KEY, { bounties: [{ target: 'dozy', amount: 9_000, contributors: ['x'], updatedAt: Date.now() }] });

    await seedSave('altfarm', 0, { ryo: 0 });
    await stage('altfarm', 'dozy', 6);
    // The victim must have been SEEN on that address for the overlap to exist —
    // seeding only the attacker's request IP proves nothing about a shared device.
    const sharedIp = '10.9.9.9';
    await stampPlayerIp({ headers: { 'x-forwarded-for': sharedIp }, socket: { remoteAddress: sharedIp } }, 'dozy');
    await stampPlayerIp({ headers: { 'x-forwarded-for': sharedIp }, socket: { remoteAddress: sharedIp } }, 'altfarm');
    assert.equal(await hasRecentIpOrFpOverlap('altfarm', 'dozy'), true, 'test setup: the two must look same-device');

    const out = await postKill('altfarm', 'dozy', sharedIp);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.equal((out.body.reward as Record<string, unknown>).rewardEligible, false, 'the KO must be ruled ineligible');
    assert.equal((out.body.reward as Record<string, unknown>).bounty, 0, 'an ineligible KO pays no bounty');

    const board = await kv.get<{ bounties: { amount: number }[] }>(BOUNTY_KEY);
    assert.equal(board?.bounties.length, 1, 'an alt-farmed KO must not drain the pool');
    assert.equal(board?.bounties[0].amount, 9_000);
});

test('sleeper-kill handler: repeat kills on the SAME victim taper by the repeat-opponent decay', async () => {
    await seedSave('kaido', 0, { ryo: 0 });

    const ryoAfter: number[] = [];
    for (let i = 0; i < 3; i++) {
        await stage('kaido', 'mark', 14);
        const out = await postKill('kaido', 'mark', '10.9.0.2');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        ryoAfter.push(Number((out.body.reward as Record<string, unknown>).ryo));
    }

    const base = computePvpWinGains(await charOf('kaido') as never, 14).ryoGain;
    assert.deepEqual(ryoAfter, [0, 1, 2].map((prior) => Math.floor(base * repeatWinDecayMultiplier(prior))));
    assert.ok(ryoAfter[2] < ryoAfter[0], 'the third win in the window pays less than the first');
    assert.equal(await charOf('kaido').then((c) => c.ryo), ryoAfter.reduce((a, b) => a + b, 0));
    assert.equal(await charOf('kaido').then((c) => c.totalPvpKills), 3);
});

test('sleeper-kill handler: a Vanguard attacker banks capped Honor Seals; anyone else banks none', async () => {
    await seedSave('vanya', 0, { profession: 'vanguard', professionRank: 3, professionXp: 0, honorSeals: 2 });
    await stage('vanya', 'dozer', 8, { createdAt: 1 }); // old enough to pay

    const out = await postKill('vanya', 'dozer', '10.9.0.3');
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const seals = Number((out.body.reward as Record<string, unknown>).seals);
    assert.ok(seals > 0, 'a ranked Vanguard earns seals from a sleeper KO');

    const vanya = await charOf('vanya');
    assert.equal(vanya.honorSeals, 2 + seals, 'seals are added, never overwritten');
    assert.equal((vanya.dailyHonorSealsByTarget as Record<string, number>)?.dozer, seals, 'the per-target daily ledger is stamped');
    assert.equal(vanya.dailyHonorSealsEarned, seals);
    assert.equal(typeof vanya.vanguardDailyResetDate, 'string');
    assert.ok(Number(vanya.professionXp) > 0, 'profession XP advanced');

    // A non-Vanguard attacker takes the ryo and the kill, and nothing else.
    await seedSave('plainjo', 0, { profession: 'medic', honorSeals: 0 });
    await stage('plainjo', 'napper', 8, { createdAt: 1 });
    const plain = await postKill('plainjo', 'napper', '10.9.0.4');
    assert.equal(plain.statusCode, 200, JSON.stringify(plain.body));
    assert.equal((plain.body.reward as Record<string, unknown>).seals, 0);
    assert.equal((await charOf('plainjo')).honorSeals, 0);
});

test('sleeper-kill handler: an attacker standing in a DIFFERENT sector is refused, and nothing is paid', async () => {
    await seedSave('faraway', 0, { ryo: 500 });
    await seedSave('elsewhere', 6);
    await setSleeperCamp({ name: 'elsewhere', displayName: 'Elsewhere', sector: 6, createdAt: Date.now() - 1000 });
    onlineStore.upsert({ name: 'faraway', sector: 2, character: null });

    const out = await postKill('faraway', 'elsewhere', '10.9.0.5');
    assert.equal(out.statusCode, 409);
    assert.match(String(out.body.error), /no longer in your sector/i);
    assert.equal((await charOf('faraway')).ryo, 500, 'no ryo minted on a refused KO');
    assert.equal((await charOf('elsewhere')).hospitalized, undefined, 'the victim is untouched');
});

// ── Offline notices: the victim must learn WHO knocked them out ──────────────

test('notifySleeperKill: queues a sleeper-kill notice for the victim and a low-importance world announcement', async () => {
    const { notifySleeperKill } = await import('./sleeper-kill.js');
    const { takeOfflineNotices } = await import('./_offline-notices.js');
    const { recentAnnouncements } = await import('../_announce.js');

    await notifySleeperKill({ attackerName: 'Raiden', victimSlug: 'zed', victimName: 'Zed', sector: 17, now: 4242 });

    const notices = await takeOfflineNotices('zed');
    assert.deepEqual(notices, [{ kind: 'sleeper-kill', by: 'Raiden', sector: 17, at: 4242 }]);

    const feed = await recentAnnouncements(50);
    const post = feed.find((a) => a.type === 'sleeper_kill' && a.player === 'Raiden');
    assert.ok(post, 'announcement posted');
    assert.equal(post.importance, 'low');
    assert.equal(post.title, 'Camp Ambushed');
    assert.equal(post.message, "Raiden ambushed Zed's camp in Sector 17.");
});

test('raidSleeperCamp (NPC merc raid): a successful raid leaves a merc-raid notice naming the raiding village', async () => {
    const { raidSleeperCamp } = await import('../_merc-auto.js');
    const { takeOfflineNotices } = await import('./_offline-notices.js');
    const NOW = 1_800_000_100_000;
    await seedSave('raided', 9);
    await setSleeperCamp({ name: 'raided', displayName: 'Raided', sector: 9, createdAt: NOW - 1000 });

    assert.equal(await raidSleeperCamp({ targetPlayer: 'raided', sector: 9, now: NOW, attackerVillage: 'Frostfang' }), true);
    const after = await kv.get<{ character: Record<string, unknown> }>('save:raided');
    assert.equal(after?.character.hospitalized, true);

    const notices = await takeOfflineNotices('raided');
    assert.deepEqual(notices, [{ kind: 'merc-raid', by: 'Frostfang mercenaries', village: 'Frostfang', sector: 9, at: NOW }]);

    // A refused raid (camp gone) leaves no notice.
    assert.equal(await raidSleeperCamp({ targetPlayer: 'raided', sector: 9, now: NOW + 1, attackerVillage: 'Frostfang' }), false);
    assert.deepEqual(await takeOfflineNotices('raided'), []);
});
