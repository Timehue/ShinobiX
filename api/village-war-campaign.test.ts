import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, describe, it, mock } from 'node:test';
import { campaignView, campaignScore, campaignObjectiveAvailable, reserveCampaignOperation,
    scoreCampaignBattle, advanceCampaign, updateShrineControl, WAR_DAY_MS, SHRINE_ROOM_PRESENCE_TTL_MS } from '../shared/village-war-campaign.js';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'campaign-tests-secret';
const A = 'Ashen Leaf Village', B = 'Moonshadow Village';
const id = 'ashenleafvillage-vs-moonshadowvillage';
let create: typeof import('./_village-war-campaign.js').createVillageCampaign;
let createCurrent: typeof create;
let advance: typeof import('./_village-war-campaign.js').advanceCampaignWar;
let kv: typeof import('./_storage.js').kv;
let endpoint: typeof import('./village/war-campaign.js').default;
let world: typeof import('./world-state.js');
let token: typeof import('./_auth.js').issuePlayerToken;
let presence: typeof import('./_realtime/online-store.js').onlineStore;
before(async () => {
    ({ createVillageCampaign: createCurrent, advanceCampaignWar: advance } = await import('./_village-war-campaign.js'));
    // Retained v2 rows: exercise the original persisted rules after the rollout.
    create = (...args) => {
        const c = createCurrent(...args); c.version = 2;
        c.shrine.forEach((o, day) => { o.limit = 15; o.opensAt = c.startsAt + day * WAR_DAY_MS + 20 * 3_600_000;
            o.closesAt = c.startsAt + (day + 1) * WAR_DAY_MS; });
        return c;
    };
    ({ kv } = await import('./_storage.js'));
    endpoint = (await import('./village/war-campaign.js')).default as unknown as typeof endpoint;
    world = (await import('./world-state.js')) as unknown as typeof world;
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    ({ onlineStore: presence } = await import('./_realtime/online-store.js'));
});
beforeEach(async () => { const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys); presence.remove('alice'); presence.remove('bob');
    (await import('./_ratelimit.js')).__resetRateLimitsForTest();
    const { leaveShrineRoom } = await import('./_village-war-shrine-presence.js'); leaveShrineRoom('alice'); leaveShrineRoom('bob');
    (await import('./_village-war-shrine-closing.js')).resetShrineClosingTimersForTests(); });
afterEach(async () => { (await import('./_village-war-shrine-closing.js')).resetShrineClosingTimersForTests(); mock.timers.reset(); mock.restoreAll(); });
let counter = 0;
async function call(handler: typeof endpoint, player: string | null, body: Record<string, unknown>, method = 'POST') {
    let status = 200; let data: any;
    const res = { setHeader() {}, status(n: number) { status = n; return this; }, json(b: unknown) { data = b; return this; }, end() {} };
    const ip = `10.95.0.${++counter}`;
    await handler({ method, body, headers: { ...(player ? { 'x-player-token': token(player) } : {}), 'x-forwarded-for': ip }, query: {}, socket: { remoteAddress: ip } } as never, res as never);
    return { status, data };
}
async function seed(startsAt = Date.now() - 3_600_000, version: 2 | 3 = 2) {
    const campaign = (version === 2 ? create : createCurrent)([A, B], startsAt, 47);
    const row = { id, villages: [A, B] as [string, string], startedAt: startsAt, updatedAt: startsAt, declarationGeneration: 1,
        hp: { [A]: 5000, [B]: 5000 }, warGroundSector: 47, warGroundHp: 1000, campaign, contributions: {} };
    await kv.set(`world:war:${id}`, row);
    await kv.set('save:alice', { character: { name: 'Alice', village: A, level: 100, hp: 1000, maxHp: 1000,
        chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, stats: {} } });
    await kv.set('save:bob', { character: { name: 'Bob', village: B, level: 100, hp: 1000, maxHp: 1000 } });
    return row;
}
describe('five-day village campaigns', { concurrency: false }, () => {
    it('caps only v3 shrine extras while normal role rewards and deductions survive restart and retries', async () => {
        const { ROLE_KAGE, ROLE_ELDER, ROLE_ANBU, ROLE_VILLAGER } = await import('./_war-role.js');
        for (const version of [2, 3] as const) for (const winner of [ROLE_KAGE, ROLE_ELDER, ROLE_ANBU, ROLE_VILLAGER]) {
            let c = (version === 2 ? create : createCurrent)([A, B], 1000, 47);
            const o = c.shrine[0]; c.pvp[B] = 1000;
            for (let i = 0; i < o.limit + 3; i++) {
                const scored = i < o.limit;
                const args = { receipt: `role-${i}`, village: A, player: 'alice', objectiveId: o.id,
                    createdAt: o.opensAt, at: o.opensAt + 1,
                    shrineVictory: { enemyVillage: B, winPoints: winner.win, lossPenalty: ROLE_ELDER.loss } };
                const points = version === 2 ? (scored ? 100 : 0) : winner.win + (scored ? 20 : 0);
                assert.equal(scoreCampaignBattle(c, args), points);
                c = JSON.parse(JSON.stringify(c));
                const snapshot = structuredClone(c);
                assert.equal(scoreCampaignBattle(c, args), points);
                assert.deepEqual(c, snapshot, 'a replay must not deduct enemy points or grant normal rewards twice');
            }
            assert.equal(c.shrine[0].bouts, o.limit);
            assert.equal(c.shrine[0].wins[A], o.limit);
            assert.equal(c.pvp[A], version === 2 ? 1500 : 200 + 13 * winner.win);
            assert.equal(c.pvp[B], version === 2 ? 1000 : 740);
        }
    });
    it('does not let normal shrine deductions make enemy scores negative or bypass window/deadline bounds', () => {
        const c = createCurrent([A, B], 1000, 47), o = c.shrine[4];
        o.bouts = o.limit; c.pvp[B] = 10;
        const args = { village: A, player: 'alice', objectiveId: o.id, createdAt: o.opensAt,
            shrineVictory: { enemyVillage: B, winPoints: 30, lossPenalty: 50 } };
        assert.equal(scoreCampaignBattle(c, { ...args, receipt: 'last-valid', at: c.endsAt - 1 }), 30);
        assert.equal(c.pvp[B], 0);
        assert.equal(scoreCampaignBattle(c, { ...args, receipt: 'deadline', at: c.endsAt }), 0);
        assert.equal(c.pvp[A], 30);
        assert.equal(scoreCampaignBattle(c, { ...args, receipt: 'before-open', createdAt: o.opensAt - 1, at: o.opensAt }), 0);
        assert.equal(scoreCampaignBattle(c, { ...args, objectiveId: undefined, receipt: 'world', at: o.opensAt + 1 }), 20);
        assert.equal(c.pvp[A], 50, 'ordinary worldwide scoring stays unchanged');
    });
    for (const version of [2, 3] as const) it(`v${version}: retains rules and all five exact boundaries after JSON recovery, including the campaign deadline`, () => {
        // Both US DST transitions and a non-hour UTC offset must leave elapsed hours intact.
        for (const start of ['2026-03-07T12:00:00-06:00', '2026-10-31T12:00:00-05:00', '2026-10-14T12:00:00+05:45']) {
            const original = (version === 2 ? create : createCurrent)([A, B], Date.parse(start), 47);
            const c = JSON.parse(JSON.stringify(original)) as typeof original;
            const points = version === 2 ? 100 : 25, bonus = version === 2 ? 1000 : 100;
            assert.equal(c.version, version);
            assert.equal(c.endsAt - c.startsAt, 120 * 3_600_000);
            for (const [day, o] of c.shrine.entries()) {
                assert.equal((o.opensAt - c.startsAt) / 3_600_000, version === 2 ? 20 + day * 24 : 2 + day * 29);
                assert.equal((o.closesAt - c.startsAt) / 3_600_000, version === 2 ? 24 + day * 24 : 4 + day * 29);
                assert.equal(o.limit, version === 2 ? 15 : 10);
                for (const [at, available] of [[o.opensAt - 1, false], [o.opensAt, true], [o.closesAt - 1, true], [o.closesAt, false]] as const)
                    assert.equal(campaignObjectiveAvailable(c, o, A, at), available);
                const win = { village: A, player: 'alice', objectiveId: o.id, createdAt: o.opensAt };
                assert.equal(scoreCampaignBattle(c, { ...win, receipt: `${o.id}-early`, createdAt: o.opensAt - 1, at: o.opensAt }), 0);
                assert.equal(scoreCampaignBattle(c, { ...win, receipt: `${o.id}-open`, at: o.opensAt }), points);
                assert.equal(scoreCampaignBattle(c, { ...win, receipt: `${o.id}-last`, at: o.closesAt - 1 }), points);
                assert.equal(scoreCampaignBattle(c, { ...win, receipt: `${o.id}-closed`, at: o.closesAt }), 0);
                o.controlTimeMs = { [A]: 1000 };
            }
            const row: import('./_village-war-campaign.js').CampaignWarRow = { id, villages: [A, B], startedAt: c.startsAt, updatedAt: c.startsAt, campaign: c };
            const ended = advance(row, c.endsAt);
            assert.equal(ended.endedAt, c.endsAt);
            assert.equal(ended.winnerVillage, A);
            assert.equal(ended.campaign!.pvp[A], 5 * (2 * points + bonus));
            assert.deepEqual(advance(JSON.parse(JSON.stringify(ended)), c.endsAt + WAR_DAY_MS), ended);
            assert.deepEqual(c.shrine.map(o => [o.opensAt, o.closesAt, o.limit]), original.shrine.map(o => [o.opensAt, o.closesAt, o.limit]));
            assert.equal(campaignView(c, [A, B], A, c.startsAt - 1).version, version);
        }
    });
    it('seals exactly one objective per battle type on three distinct sectors per village', () => {
        const c = create([A, B], 1000, 47);
        assert.equal(c.endsAt - c.startsAt, 5 * WAR_DAY_MS);
        assert.equal(c.shrine.length, 5);
        for (const village of [A, B]) {
            const objectives = c.strongholds.filter(o => o.village === village);
            assert.equal(new Set(objectives.map(o => o.sector)).size, 3);
            assert.deepEqual(objectives.map(o => o.mode), ['combat', 'pet', 'card']);
        }
        for (const o of c.shrine) assert.equal(o.closesAt - o.opensAt, 4 * 3_600_000);
    });
    it('keeps enemy assignments and attack access secret until each 24-intel threshold', () => {
        const c = create([A, B], 1000, 47);
        const targets = c.strongholds.filter(o => o.village === B);
        for (const intel of [0, 6, 18, 23, 24, 47, 48, 71, 72]) {
            c.intel[A] = intel;
            const revealed = intel >= 72 ? 3 : intel >= 48 ? 2 : intel >= 24 ? 1 : 0;
            const view = campaignView(c, [A, B], A, 1001);
            assert.equal(view.strongholds.length, 3 + revealed);
            assert.equal(view.hiddenStrongholds, 3 - revealed);
            assert.equal(campaignView(c, [A, B], B, 1001).strongholds.length, 3);
            for (const [i, target] of targets.entries()) assert.equal(campaignObjectiveAvailable(c, target, A, 1001), i < revealed);
        }
    });
    it('allows every villager their own attempts while enforcing personal category and total caps', () => {
        const c = create([A, B], 1000, 47);
        for (const kind of ['supply', 'sabotage', 'espionage'] as const) {
            for (let i = 0; i < 50; i++) assert.equal(reserveCampaignOperation(c, A, `${kind}-${i}`, kind, 1001), true);
        }
        assert.equal(c.usage[`${A}:0`].total, 150);
        assert.equal(reserveCampaignOperation(c, A, 'extra', 'supply', 1001), true);
        assert.equal(reserveCampaignOperation(c, B, 'smaller-village', 'supply', 1001), true);
        assert.equal(reserveCampaignOperation(c, A, 'fresh', 'supply', 1001 + WAR_DAY_MS), true);
        assert.equal(reserveCampaignOperation(c, A, 'fresh', 'supply', c.endsAt), false);
        const personal = create([A, B], 1000, 47);
        assert.equal(reserveCampaignOperation(personal, A, 'alice', 'supply', 1001), true);
        assert.equal(reserveCampaignOperation(personal, A, 'alice', 'supply', 1001), false);
        assert.equal(reserveCampaignOperation(personal, A, 'alice', 'sabotage', 1001), true);
        assert.equal(reserveCampaignOperation(personal, A, 'alice', 'sabotage', 1001), true);
        assert.equal(reserveCampaignOperation(personal, A, 'alice', 'sabotage', 1001), false);
        assert.equal(reserveCampaignOperation(personal, A, 'alice', 'espionage', 1001), true);
        assert.equal(reserveCampaignOperation(personal, A, 'alice', 'espionage', 1001), false);
        assert.equal(reserveCampaignOperation(personal, A, 'alice', 'supply', 1001 + WAR_DAY_MS), true);
        const espionage = create([A, B], 1000, 47);
        assert.equal(reserveCampaignOperation(espionage, A, 'alice', 'espionage', 1001), true);
        assert.equal(reserveCampaignOperation(espionage, A, 'alice', 'espionage', 1001), true);
        assert.equal(reserveCampaignOperation(espionage, A, 'alice', 'espionage', 1001), false);
    });
    it('treats prototype-shaped account names as ordinary bounded participants', () => {
        const c = create([A, B], 1000, 47);
        for (const player of ['constructor', '__proto__', 'toString']) {
            assert.equal(reserveCampaignOperation(c, A, player, 'sabotage', 1001), true);
            assert.equal(Object.hasOwn(c.usage[`${A}:0`].players, player), true);
        }
        const roundTrip = JSON.parse(JSON.stringify(c));
        assert.equal(roundTrip.usage[`${A}:0`].players.__proto__.total, 1);
        assert.equal(reserveCampaignOperation(roundTrip, A, '__proto__', 'sabotage', 1001), true);
        assert.equal(reserveCampaignOperation(roundTrip, A, '__proto__', 'sabotage', 1001), false);
    });
    it('scores world PvP and capped support once; support alone cannot win a war', () => {
        const c = create([A, B], 1000, 47);
        const win = { village: A, player: 'alice', createdAt: 1001, at: 1002 };
        scoreCampaignBattle(c, { ...win, receipt: 'pve', pve: true, operation: 'espionage' });
        assert.equal(campaignScore(c, A).total, 0);
        scoreCampaignBattle(c, { ...win, receipt: 'world' });
        scoreCampaignBattle(c, { ...win, receipt: 'world' });
        assert.deepEqual(campaignScore(c, A), { pvp: 20, pve: 5, rawPve: 20, total: 25 });
        assert.equal(c.intel[A], 2);
    });
    it('allows mission intel past the old ceiling, caps it at 72 and never repeats a receipt', () => {
        const c = create([A, B], 1000, 47);
        const win = { village: A, player: 'alice', createdAt: 1001, at: 1002, pve: true, operation: 'espionage' as const };
        c.intel[A] = 17;
        scoreCampaignBattle(c, { ...win, receipt: 'beyond-old-ceiling' });
        assert.equal(c.intel[A], 19);
        scoreCampaignBattle(c, { ...win, receipt: 'beyond-old-ceiling' });
        assert.equal(c.intel[A], 19);
        c.intel[A] = 71;
        scoreCampaignBattle(c, { ...win, receipt: 'full-discovery' });
        assert.equal(c.intel[A], 72);
        scoreCampaignBattle(c, { ...win, receipt: 'after-full-discovery' });
        assert.equal(c.intel[A], 72);
        assert.equal(c.pve[A], 60, 'support still pays once per new receipt when intel is full');
    });
    it('honors the shrine timer, battle limit and once-only objective bonus', () => {
        const c = create([A, B], 1000, 47), o = c.shrine[0];
        const win = { village: A, player: 'alice', objectiveId: o.id, createdAt: o.opensAt, at: o.opensAt + 1000 };
        assert.equal(campaignObjectiveAvailable(c, o, A, o.opensAt - 1), false);
        for (let i = 0; i < 15; i++) assert.equal(scoreCampaignBattle(c, { ...win, receipt: `shrine-${i}` }), 100);
        assert.equal(scoreCampaignBattle(c, { ...win, receipt: 'sixteenth' }), 0);
        assert.equal(campaignObjectiveAvailable(c, o, A, o.closesAt - 1), true, 'control fights remain available after 15 scored victories');
        updateShrineControl(c, o, [A], o.closesAt - 1);
        o.controlTimeMs = { [A]: 1000 };
        advanceCampaign(c, o.closesAt); advanceCampaign(c, o.closesAt + 1);
        assert.equal(c.pvp[A], 2500);
        assert.equal(scoreCampaignBattle(c, { ...win, receipt: 'late', at: o.closesAt }), 0);
    });
    it('awards the accumulated-time leader at closing, independently of combat lead, and pays once', () => {
        const c = create([A, B], 1000, 47), o = c.shrine[0], start = o.opensAt;
        updateShrineControl(c, o, [A], start - 1); assert.equal(o.controlVillage, undefined);
        for (let seconds = 0; seconds <= 60; seconds += 10) updateShrineControl(c, o, [A, A], start + seconds * 1000);
        assert.equal(o.controlVillage, A); assert.equal(c.pvp[A], undefined);
        for (let i = 0; i < 5; i++) scoreCampaignBattle(c, { receipt: `early-${i}`, village: A, player: 'alice', objectiveId: o.id, createdAt: start + 60_000, at: start + 61_000 });
        advanceCampaign(c, start + 62_000); assert.equal(o.bonusSettled, undefined);
        updateShrineControl(c, o, [B], o.closesAt - 1);
        o.controlTimeMs = { [A]: 60_000, [B]: 120_000 };
        advanceCampaign(c, o.closesAt); updateShrineControl(c, o, [B], o.closesAt);
        advanceCampaign(c, o.closesAt + 1);
        assert.equal(c.pvp[A], 500); assert.equal(c.pvp[B], 1000);
        assert.equal(o.bonusWinner, B, 'the time leader wins despite the other village taking every scored victory');
    });
    it('clears live control when contested or empty and grants neither a closing bonus nor a battle-leader fallback', () => {
        const c = create([A, B], 1000, 47), o = c.shrine[0], start = o.opensAt;
        updateShrineControl(c, o, [A], start);
        updateShrineControl(c, o, [A, B], start + 10_000); assert.equal(o.controlVillage, undefined);
        updateShrineControl(c, o, [A], start + 20_000);
        updateShrineControl(c, o, [], start + 30_000); assert.equal(o.controlVillage, undefined);
        updateShrineControl(c, o, [A], start + 40_000);
        updateShrineControl(c, o, [A], start + 40_000 + SHRINE_ROOM_PRESENCE_TTL_MS + 1);
        assert.equal(c.pvp[A], undefined);
        for (const roster of [[A, B], []]) {
            const c = create([A, B], 1000, 47), o = c.shrine[0];
            o.wins[A] = 3; o.bouts = 3;
            updateShrineControl(c, o, roster, o.closesAt - 1);
            o.closingControlVillage = null; o.controlCapturedAt = o.closesAt;
            advanceCampaign(c, o.closesAt);
            assert.equal(o.bonusWinner, undefined); assert.deepEqual(c.pvp, {});
        }
    });
    it('requires physical shrine entry, keeps outside enemies out of control, and separates shrine and stronghold interiors', async () => {
        const row = await seed(Date.now() - 21 * 3_600_000), objectiveId = row.campaign.shrine[0].id;
        presence.upsert({ name: 'alice', sector: 0, character: { level: 100, village: A } });
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId })).status, 409);
        presence.remove('alice'); presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 47, character: { level: 100, village: B } });
        const entered = await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId });
        assert.equal(entered.status, 200, JSON.stringify(entered.data));
        assert.deepEqual(entered.data.room.players.map((p: { name: string }) => p.name), ['alice']);
        const { sameStrongholdLocation, touchStrongholdPresence } = await import('./_stronghold-presence.js');
        assert.equal(sameStrongholdLocation({ name: 'alice', sector: 47 }, { name: 'bob', sector: 47 }), false);
        touchStrongholdPresence('bob', 47, 0);
        assert.equal(sameStrongholdLocation({ name: 'alice', sector: 47 }, { name: 'bob', sector: 47 }), false, 'the normal stronghold is a separate room');
        const step = await call(endpoint, 'alice', { warId: id, action: 'shrine-step', objectiveId, tile: 114 });
        assert.equal(step.status, 200); assert.equal(step.data.room.players[0].tile, 114);
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'shrine-step', objectiveId, tile: 0 })).status, 409);
        const rival = await call(endpoint, 'bob', { warId: id, action: 'shrine-enter', objectiveId });
        assert.equal(rival.status, 200); assert.equal(rival.data.room.objective.controlVillage, undefined);
        assert.equal((await call(endpoint, 'bob', { warId: id, action: 'shrine-leave', objectiveId })).status, 200);
        const after = await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId });
        assert.deepEqual(after.data.room.players.map((p: { name: string }) => p.name), ['alice']);
        assert.equal(after.data.room.objective.controlVillage, A);
        await call(endpoint, 'alice', { warId: id, action: 'shrine-leave', objectiveId });
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId })).status, 409);
    });
    it('captures the real closing roster on the server timer and commits its bonus once without a client poll', async () => {
        const clock = Date.now(); let now = clock;
        mock.method(Date, 'now', () => now);
        mock.timers.enable({ apis: ['setTimeout'] });
        const row = await seed(clock - WAR_DAY_MS + 10_000), objectiveId = row.campaign.shrine[0].id;
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId });
        const early = await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId, points: 99999, winner: B });
        assert.equal(early.data.campaign.scores[A].pvp, 0);
        now += 10_000; mock.timers.tick(10_000);
        let settled: any;
        for (let i = 0; i < 100; i++) { await new Promise(resolve => setImmediate(resolve));
            settled = await kv.get<any>(`world:war:${id}`); if (settled.campaign.shrine[0].bonusSettled) break; }
        assert.equal(settled.campaign.shrine[0].bonusWinner, A);
        assert.equal(settled.campaign.pvp[A], 1000);
        for (let i = 0; i < 2; i++) {
            const view = await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId, points: 99999, winner: B });
            assert.equal(view.status, 200, JSON.stringify(view.data)); assert.equal(view.data.campaign.scores[A].pvp, 1000);
            assert.equal(view.data.room.objective.closingControlVillage, A);
        }
        const fresh = await kv.get<any>(`world:war:${id}`);
        assert.equal(fresh.campaign.shrine[0].bouts, 0); assert.deepEqual(fresh.campaign.usage, {});
        assert.equal(fresh.campaign.pvp[B], undefined);
        assert.equal(fresh.contributions.alice.damage, 1000, 'closing control earns the controller actual war contribution');
        assert.equal(fresh.contributions.alice.pvpKills, 0, 'control never fabricates a combat kill');
        const { settleVillageWarRewards } = await import('./war/_reward.js');
        const ended = { ...fresh, endedAt: now, winnerVillage: A, warCrateId: `war-crate-${id}` };
        const claimed = settleVillageWarRewards({ name: 'alice', village: A, inventory: [], claimedWarCrateIds: [] }, ended, now);
        assert.equal(claimed.character.warsWon, 1, 'a shrine controller can claim the earned victory reward');
        assert.equal(settleVillageWarRewards(claimed.character, ended, now).granted, false);
    });
    for (const version of [2, 3] as const) it(`v${version}: splits the closing bonus among verified players exactly once`, async () => {
        const clock = Date.now(); let now = clock;
        mock.method(Date, 'now', () => now); mock.timers.enable({ apis: ['setTimeout'] });
        const row = await seed(clock - (version === 2 ? 24 : 4) * 3_600_000 + 10_000, version), objectiveId = row.campaign.shrine[0].id;
        const alice = await kv.get<any>('save:alice');
        for (const player of ['alice', 'ally', 'zed']) {
            if (player !== 'alice') await kv.set(`save:${player}`, { ...alice, character: { ...alice.character, name: player, village: A } });
            presence.upsert({ name: player, sector: 47, character: { level: 100, village: A } });
            assert.equal((await call(endpoint, player, { warId: id, action: 'shrine-enter', objectiveId })).status, 200);
        }
        now += 10_000; mock.timers.tick(10_000);
        let settled: any;
        for (let i = 0; i < 100; i++) { await new Promise(resolve => setImmediate(resolve));
            settled = await kv.get<any>(`world:war:${id}`); if (settled.campaign.shrine[0].bonusSettled) break; }
        assert.equal(settled.campaign.pvp[A], version === 2 ? 1000 : 100);
        assert.deepEqual(Object.fromEntries(Object.entries(settled.contributions).map(([p, v]: [string, any]) => [p, v.damage])), version === 2 ? { alice: 334, ally: 333, zed: 333 } : { alice: 34, ally: 33, zed: 33 });
        assert.equal(Object.values(settled.contributions).reduce((sum: number, v: any) => sum + v.damage, 0), version === 2 ? 1000 : 100);
        await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId });
        const repeated = await kv.get<any>(`world:war:${id}`);
        assert.deepEqual(repeated.contributions, settled.contributions);
        presence.remove('ally'); presence.remove('zed');
    });
    for (const version of [2, 3] as const) for (const ending of ['empty', 'enemy', 'contested', 'tie'] as const) it(`v${version}: settles total uncontested time with a ${ending} closing room`, async () => {
        const clock = Date.now(); let now = clock;
        mock.method(Date, 'now', () => now); mock.timers.enable({ apis: ['setTimeout'] });
        const row = await seed(clock - (version === 2 ? 24 : 4) * 3_600_000 + 30_000, version), objectiveId = row.campaign.shrine[0].id;
        for (const [player, village] of [['alice', A], ['bob', B]]) presence.upsert({ name: player, sector: 47, character: { level: 100, village } });
        const action = async (player: string, command: string) => {
            const result = await call(endpoint, player, { warId: id, action: command, objectiveId });
            assert.equal(result.status, 200, JSON.stringify(result.data)); return result;
        };
        await action('alice', 'shrine-enter');
        now = clock + 10_000;
        await action('bob', 'shrine-enter');
        now = clock + 15_000;
        await action('bob', 'shrine-leave');
        now = clock + 20_000;
        await action('alice', 'shrine-leave');
        await action('bob', 'shrine-enter');
        if (ending !== 'tie') { now = clock + 25_000; await action('bob', 'shrine-leave'); }
        if (ending === 'enemy' || ending === 'contested') { now = clock + 29_000; await action('bob', 'shrine-enter'); }
        if (ending === 'contested') await action('alice', 'shrine-enter');
        if (ending === 'tie') {
            const { resetShrineClosingTimersForTests, scheduleShrineClosing } = await import('./_village-war-shrine-closing.js');
            const stored = await kv.get<any>(`world:war:${id}`);
            resetShrineClosingTimersForTests();
            stored.campaign.shrine[0].controlTimeMs[B] += 5000;
            await kv.set(`world:war:${id}`, stored);
            scheduleShrineClosing(stored, stored.campaign.shrine[0]);
        }
        now = clock + 30_000; mock.timers.tick(30_000);
        for (let i = 0; i < 100; i++) {
            await new Promise(resolve => setImmediate(resolve));
            if ((await kv.get<any>(`world:war:${id}`)).campaign.shrine[0].bonusSettled) break;
        }
        const final = await action('alice', 'shrine-state');
        assert.equal(final.data.room.objective.controlTimeMs[A], 15_000);
        assert.equal(final.data.room.objective.controlTimeMs[B], ending === 'tie' ? 15_000 : ending === 'enemy' ? 6000 : 5000);
        assert.equal(final.data.room.objective.bonusWinner, ending === 'tie' ? undefined : A);
        assert.equal(final.data.campaign.scores[A].pvp, ending === 'tie' ? 0 : version === 2 ? 1000 : 100);
        assert.equal(final.data.room.objective.controlParticipantMs, undefined);
        const retry = await action('alice', 'shrine-state');
        assert.deepEqual(retry.data.campaign.scores, final.data.campaign.scores);
        if (ending !== 'tie') assert.equal((await kv.get<any>(`world:war:${id}`)).contributions.alice.damage, version === 2 ? 1000 : 100);
    });
    for (const version of [2, 3] as const) it(`v${version}: counts control once and weights contribution by actual participation`, async () => {
        const clock = Date.now(); let now = clock;
        mock.method(Date, 'now', () => now); mock.timers.enable({ apis: ['setTimeout'] });
        const row = await seed(clock - (version === 2 ? 24 : 4) * 3_600_000 + 15_000, version), objectiveId = row.campaign.shrine[0].id;
        const alice = await kv.get<any>('save:alice');
        await kv.set('save:ally', { ...alice, character: { ...alice.character, name: 'Ally' } });
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId });
        now += 10_000;
        presence.upsert({ name: 'ally', sector: 47, character: { level: 100, village: A } });
        await call(endpoint, 'ally', { warId: id, action: 'shrine-enter', objectiveId });
        now += 5000; mock.timers.tick(15_000);
        let settled: any;
        for (let i = 0; i < 100; i++) { await new Promise(resolve => setImmediate(resolve));
            settled = await kv.get<any>(`world:war:${id}`); if (settled.campaign.shrine[0].bonusSettled) break; }
        assert.equal(settled.campaign.shrine[0].controlTimeMs[A], 15_000, 'headcount cannot multiply village control');
        assert.equal(settled.campaign.pvp[A], version === 2 ? 1000 : 100);
        assert.equal(settled.contributions.alice.damage, version === 2 ? 750 : 75);
        assert.equal(settled.contributions.ally.damage, version === 2 ? 250 : 25);
        presence.remove('ally');
    });
    for (const version of [2, 3] as const) it(`v${version}: shares the declaration's shrine win slots under concurrent claims`, async () => {
        const row = await seed(Date.now() - (version === 2 ? 21 : 3) * 3_600_000, version), objective = row.campaign.shrine[0];
        const { mutateCampaignWar, awardCampaignBattle } = await import('./_village-war-campaign.js');
        await Promise.all(Array.from({ length: 18 }, (_, i) => mutateCampaignWar(id, async current => {
            const village = i % 2 ? B : A;
            const result = awardCampaignBattle(current, { receipt: `parallel-${i}`, village, player: i % 2 ? 'bob' : 'alice',
                objectiveId: objective.id, createdAt: objective.opensAt, at: Date.now() }, i % 2 ? 'Bob' : 'Alice');
            return { row: result.row, value: result.points };
        })));
        const settled = await kv.get<any>(`world:war:${id}`);
        assert.equal(settled.campaign.shrine[0].bouts, version === 2 ? 15 : 10);
        assert.equal((settled.campaign.pvp[A] ?? 0) + (settled.campaign.pvp[B] ?? 0), version === 2 ? 1500 : 290);
        assert.equal(Object.values(settled.campaign.receipts).filter((r: any) => r.points === (version === 2 ? 100 : 25)).length, version === 2 ? 15 : 10);
        assert.equal(Object.values(settled.campaign.receipts).filter((r: any) => r.points === (version === 2 ? 0 : 5)).length, version === 2 ? 3 : 8);
    });
    for (const version of [2, 3] as const) it(`v${version}: preserves checkpointed time and rewards across a restart without extrapolating the offline gap`, async () => {
        const clock = Date.now(); let now = clock;
        mock.method(Date, 'now', () => now); mock.timers.enable({ apis: ['setTimeout'] });
        const row = await seed(clock - (version === 2 ? 24 : 4) * 3_600_000 + 30_000, version), objectiveId = row.campaign.shrine[0].id;
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId });
        now += 10_000;
        await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId });
        (await import('./_village-war-shrine-closing.js')).resetShrineClosingTimersForTests();
        presence.remove('alice');
        now = clock + 30_000;
        const final = await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId });
        assert.equal(final.status, 200);
        assert.deepEqual(final.data.room.objective.controlTimeMs, { [A]: 10_000, [B]: 0 });
        assert.equal(final.data.campaign.scores[A].pvp, version === 2 ? 1000 : 100);
        assert.equal((await kv.get<any>(`world:war:${id}`)).contributions.alice.damage, version === 2 ? 1000 : 100);
    });
    it('expires disconnected shrine members and never carries entry into a later scoring window', async () => {
        const row = await seed(Date.now() - 21 * 3_600_000), objective = row.campaign.shrine[0];
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId: objective.id });
        const { shrineRoomLocation } = await import('./_village-war-shrine-presence.js');
        const now = Date.now();
        assert.ok(shrineRoomLocation('alice', row, 47, now));
        assert.equal(shrineRoomLocation('alice', row, 47, now + SHRINE_ROOM_PRESENCE_TTL_MS + 1), null);
        assert.equal(shrineRoomLocation('alice', row, 47, objective.closesAt), null);
        presence.remove('alice');
        const stored = await kv.get<any>(`world:war:${id}`);
        stored.campaign.shrine[0].controlCheckedAt = now;
        await kv.set(`world:war:${id}`, stored);
        presence.upsert({ name: 'bob', sector: 47, character: { level: 100, village: B } });
        const entrant = await call(endpoint, 'bob', { warId: id, action: 'shrine-enter', objectiveId: objective.id });
        assert.equal(entrant.status, 200); assert.equal(entrant.data.campaign.scores[A].pvp, 0);
        assert.equal(entrant.data.room.objective.controlVillage, B);
    });
    for (const scenario of ['empty', 'contested', 'offline', 'expired', 'travel', 'late takeover'] as const) {
        it(`excludes unverified or contested intervals and retains verified time for ${scenario}`, async () => {
            const clock = Date.now(); let now = clock;
            mock.method(Date, 'now', () => now); mock.timers.enable({ apis: ['setTimeout'] });
            const duration = scenario === 'expired' ? 40_000 : 10_000;
            const row = await seed(clock - WAR_DAY_MS + duration), objectiveId = row.campaign.shrine[0].id;
            for (const player of ['alice', 'bob']) presence.upsert({ name: player, sector: 47, character: { level: 100, village: player === 'alice' ? A : B } });
            assert.equal((await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId })).status, 200);
            if (scenario === 'empty' || scenario === 'late takeover') await call(endpoint, 'alice', { warId: id, action: 'shrine-leave', objectiveId });
            if (scenario === 'contested') await call(endpoint, 'bob', { warId: id, action: 'shrine-enter', objectiveId });
            if (scenario === 'offline') presence.remove('alice');
            if (scenario === 'travel') { presence.startTravel('alice', 48, clock - 1, 47); presence.startTravel('alice', 47, clock - 1, 48); }
            if (scenario === 'late takeover') {
                now = clock + duration - 1000;
                assert.equal((await call(endpoint, 'bob', { warId: id, action: 'shrine-enter', objectiveId })).status, 200);
            }
            now = clock + duration; mock.timers.tick(duration);
            let closed: any;
            for (let i = 0; i < 100; i++) { await new Promise(resolve => setImmediate(resolve));
                closed = await kv.get<any>(`world:war:${id}`); if (closed.campaign.shrine[0].bonusSettled) break; }
            const objective = closed.campaign.shrine[0];
            assert.equal(objective.bonusSettled, true);
            assert.equal(objective.closingControlVillage, scenario === 'late takeover' ? B : scenario === 'expired' ? A : null);
            assert.deepEqual(closed.campaign.pvp, scenario === 'late takeover' ? { [B]: 1000 } : scenario === 'expired' ? { [A]: 1000 } : {});
            // Changes and delayed polling after closure cannot transfer the result.
            if (scenario === 'late takeover') presence.remove('bob');
            const final = await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId, winner: A, points: 99999 });
            assert.equal(final.status, 200); assert.equal(final.data.room.objective.closingControlVillage, objective.closingControlVillage);
        });
    }
    for (const contested of [false, true]) it(`freezes ${contested ? 'contested' : 'sole'} closing presence before a post-deadline departure and delayed timer`, async () => {
        const clock = Date.now(); let now = clock;
        mock.method(Date, 'now', () => now); mock.timers.enable({ apis: ['setTimeout'] });
        const row = await seed(clock - WAR_DAY_MS + 10_000), objectiveId = row.campaign.shrine[0].id;
        for (const player of contested ? ['alice', 'bob'] : ['alice']) {
            presence.upsert({ name: player, sector: 47, character: { level: 100, village: player === 'alice' ? A : B } });
            await call(endpoint, player, { warId: id, action: 'shrine-enter', objectiveId });
        }
        now = clock + 10_001;
        presence.remove(contested ? 'bob' : 'alice');
        // The I/O mutation happened before a delayed timer callback; it must
        // preserve the roster at the deadline, rather than the new empty/sole room.
        mock.timers.tick(10_000);
        let closed: any;
        for (let i = 0; i < 100; i++) { await new Promise(resolve => setImmediate(resolve));
            closed = await kv.get<any>(`world:war:${id}`); if (closed.campaign.shrine[0].bonusSettled) break; }
        assert.equal(closed.campaign.shrine[0].bonusSettled, true);
        assert.equal(closed.campaign.shrine[0].closingControlVillage, contested ? null : A);
        assert.deepEqual(closed.campaign.pvp, contested ? {} : { [A]: 1000 });
    });
    it('a fast round trip invalidates shrine membership and requires fresh entry for control', async () => {
        const row = await seed(Date.now() - 21 * 3_600_000), objectiveId = row.campaign.shrine[0].id;
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId });
        const stored = await kv.get<any>(`world:war:${id}`);
        stored.campaign.shrine[0].controlCheckedAt = Date.now() - 1000;
        await kv.set(`world:war:${id}`, stored);
        presence.startTravel('alice', 48, Date.now() - 1, 47);
        presence.startTravel('alice', 47, Date.now() - 1, 48);
        assert.equal(presence.get('alice')?.sector, 47);
        const { strongholdLocation } = await import('./_stronghold-presence.js');
        assert.equal(strongholdLocation('alice', 47), undefined, 'a stale shrine lease must not hide a returned exterior traveler');
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId })).status, 409);
        const reentry = await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId });
        assert.equal(reentry.status, 200); assert.equal(reentry.data.campaign.scores[A].pvp, 0);
        assert.equal(reentry.data.room.objective.controlVillage, A);
    });
    it('accepted exterior walking breaks shrine membership while a stationary world acknowledgement does not', async () => {
        const row = await seed(Date.now() - 21 * 3_600_000), objectiveId = row.campaign.shrine[0].id;
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        await call(endpoint, 'alice', { warId: id, action: 'shrine-enter', objectiveId });
        const { worldPositionModel } = await import('../shared/continuous-world-layout.js');
        const { shrineRoomLocation } = await import('./_village-war-shrine-presence.js');
        const model = worldPositionModel(), current = model.fallback(47, presence.get('alice')!.tile ?? 78)!;
        assert.ok(presence.commitWorldPosition('alice', current, presence.get('alice')!.movementSeq ?? 0));
        assert.ok(shrineRoomLocation('alice', row, 47));
        const target = Array.from({ length: 144 }, (_, tile) => model.fallback(47, tile))
            .find(position => position && JSON.stringify(position) !== JSON.stringify(current))!;
        assert.ok(presence.commitWorldPosition('alice', target, presence.get('alice')!.movementSeq ?? 0));
        assert.equal(presence.get('alice')!.sector, 47);
        assert.equal(shrineRoomLocation('alice', row, 47), null);
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId })).status, 409);
    });
    it('ends on score at exactly five days and finalizes missed window bonuses before selecting the winner', async () => {
        const row = await seed();
        row.campaign.shrine[0].wins[B] = 1; row.campaign.shrine[0].bouts = 1;
        row.campaign.shrine[0].controlTimeMs = { [B]: 1000 };
        row.campaign.pvp[A] = 200; row.campaign.pvp[B] = 200;
        const ended = advance(row as never, row.campaign.endsAt) as typeof row;
        assert.equal((ended as any).winnerVillage, B);
        assert.equal((ended as any).endedAt, row.campaign.endsAt);
        assert.equal((advance(row as never, row.campaign.endsAt - 1) as any).endedAt, undefined);
    });
    for (const version of [2, 3] as const) it(`v${version}: retains closing control and sealed rewards through delayed battle settlement and retries`, async () => {
        const { awardCampaignBattle } = await import('./_village-war-campaign.js');
        let row = await seed(Date.now() - 25 * 3_600_000, version);
        const objective = row.campaign.shrine[0];
        const win = (receipt: string, village: string, at: number) => ({ receipt, village,
            player: village === A ? 'alice' : 'bob', objectiveId: objective.id, createdAt: objective.opensAt, at });
        for (const [receipt, village] of [['early-a1', A], ['early-a2', A], ['early-b1', B]]) {
            row = awardCampaignBattle(row, win(receipt, village, objective.closesAt - 2000), village).row;
        }
        row.campaign.shrine[0].controlTimeMs = { [B]: 1000 };
        row = advance(row, objective.closesAt);
        assert.equal(row.campaign.pvp[A], version === 2 ? 200 : 50); assert.equal(row.campaign.pvp[B], version === 2 ? 1100 : 125);
        row = awardCampaignBattle(row, win('late-b2', B, objective.closesAt - 1000), 'Bob').row;
        assert.equal(row.campaign.pvp[A], version === 2 ? 200 : 50, 'late kill leadership cannot transfer the closing-control bonus');
        assert.equal(row.campaign.pvp[B], version === 2 ? 1200 : 150);
        row = awardCampaignBattle(row, win('late-b2', B, objective.closesAt - 1000), 'Bob').row;
        row = awardCampaignBattle(row, win('late-b3', B, objective.closesAt - 500), 'Bob').row;
        assert.equal(row.campaign.pvp[B], version === 2 ? 1300 : 175);
        row = advance(row, row.campaign.endsAt);
        assert.equal((row as any).winnerVillage, B);
        const finalized = awardCampaignBattle(row, win('too-late-a', A, objective.closesAt - 1), 'Alice');
        assert.equal(finalized.points, 0); assert.equal(finalized.row.campaign.pvp[B], version === 2 ? 1300 : 175);
        assert.equal((finalized.row as any).winnerVillage, B);
    });
    it('does not offer paid HP-damage mercenary bands for score-based campaigns', async () => {
        const row = await seed();
        const { villageWarInstanceFromRow } = await import('./_merc-context.js');
        assert.equal(villageWarInstanceFromRow(`world:war:${id}`, row, Date.now()), null);
        const { campaign: _campaign, ...legacy } = row;
        assert.ok(villageWarInstanceFromRow(`world:war:${id}`, legacy, Date.now()));
    });
    it('authenticates private objective views, rejects another village, and public GET exposes no nominations or prepared inputs', async () => {
        const row = await seed();
        const unauthorized = await call(endpoint, null, { name: 'alice', warId: id, action: 'view' });
        assert.equal(unauthorized.status, 401);
        const view = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'view' });
        assert.equal(view.status, 200); assert.equal(view.data.campaign.strongholds.length, 3);
        await kv.set('save:outsider', { character: { name: 'Outsider', village: 'Stormveil Village' } });
        assert.equal((await call(endpoint, 'outsider', { name: 'outsider', warId: id, action: 'view' })).status, 403);
        const publicState = await call(world.default, null, {}, 'GET');
        const published = publicState.data.wars.find((w: any) => w.id === id);
        assert.equal(published.campaign, undefined); assert.equal(published.campaignVersion, 2);
        for (const o of row.campaign.strongholds) assert.equal(JSON.stringify(published).includes(o.id), false);
    });
    it('refuses undiscovered attacks, own-objective attacks and a locked shrine without consuming PvE allowance', async () => {
        const row = await seed();
        for (const objectiveId of [row.campaign.strongholds[0].id, row.campaign.strongholds[3].id, row.campaign.shrine[0].id]) {
            assert.equal((await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId })).status, 409);
        }
        assert.deepEqual((await kv.get<any>(`world:war:${id}`)).campaign.usage, {});
    });
    it('counts a sanctioned enemy player win in any world sector, excludes ranked and spars, and reconstructs a lost continuation receipt', async () => {
        await seed();
        const now = Date.now();
        const battle = { battleId: 'campaign-world-battle', p1: { name: 'Alice', character: { village: A } },
            p2: { name: 'Bob', character: { village: B } }, status: 'done', winner: 'p1', rewardAuthority: 'world',
            progressionAuthorityVersion: 1, baseRewards: true, rewardSector: 99, joined: { p1: true, p2: true }, realFighters: { p1: true, p2: true },
            round: 2, activePlayer: 'p1', ap: { p1: 1, p2: 1 }, actionsThisTurn: 0, cooldowns: { p1: {}, p2: {} }, log: [], createdAt: now - 2000, endedAt: now - 1000 };
        await kv.set(`pvp:${battle.battleId}`, battle);
        assert.equal((await world.settlePvpVillageWarContinuation(battle.battleId, 'alice')).status, 200);
        assert.equal((await kv.get<any>(`world:war:${id}`)).campaign.pvp[A], 20);
        await kv.del(`pvp:war-continuation:alice:${battle.battleId}`);
        assert.equal((await world.settlePvpVillageWarContinuation(battle.battleId, 'alice')).body.replayed, true);
        await kv.set('pvp:campaign-ranked', { ...battle, battleId: 'campaign-ranked', ranked: true, rankedKind: 'player', rewardAuthority: 'ranked' });
        assert.equal((await world.settlePvpVillageWarContinuation('campaign-ranked', 'alice')).status, 200);
        await kv.set('pvp:campaign-spar', { ...battle, battleId: 'campaign-spar', progressionAuthorityVersion: undefined, baseRewards: false, rewardAuthority: 'challenge' });
        assert.equal((await world.settlePvpVillageWarContinuation('campaign-spar', 'alice')).status, 403);
        assert.equal((await kv.get<any>(`world:war:${id}`)).campaign.pvp[A], 20);
    });
    it('requires both fighters inside the golden shrine and resumes the same sealed shared PvP session', async () => {
        const row = await seed(Date.now() - 21 * 3_600_000);
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 47, character: { level: 100, village: B } });
        const queued = await call(endpoint, 'bob', { name: 'bob', warId: id, action: 'defend', objectiveId: row.campaign.shrine[0].id });
        assert.equal(queued.status, 409, 'a remote shrine defense queue is forbidden');
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: row.campaign.shrine[0].id })).status, 409, 'standing in the sector is not entering');
        for (const player of ['alice', 'bob']) assert.equal((await call(endpoint, player, { warId: id, action: 'shrine-enter', objectiveId: row.campaign.shrine[0].id })).status, 200);
        const start = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: row.campaign.shrine[0].id });
        assert.equal(start.status, 200, JSON.stringify(start.data));
        assert.equal(start.data.npc, false);
        const session = await kv.get<any>(`pvp:${start.data.battleId}`);
        const { shrineRoomLocation } = await import('./_village-war-shrine-presence.js');
        assert.ok(shrineRoomLocation('alice', await kv.get<any>(`world:war:${id}`), 47), 'an admitted fight preserves its legitimate room membership');
        assert.ok(shrineRoomLocation('bob', await kv.get<any>(`world:war:${id}`), 47));
        assert.equal(session.p2.name, 'Bob'); assert.deepEqual(session.joined, { p1: true, p2: true });
        assert.equal(session.villageWarObjective.objectiveId, row.campaign.shrine[0].id);
        assert.equal(session.progressionAuthorityVersion, 1);
        const { loadPvpPendingSessionPointer } = await import('./pvp/_pending-session.js');
        for (const player of ['alice', 'bob']) {
            const pointer = await loadPvpPendingSessionPointer(kv, player);
            assert.equal(pointer?.battleId, session.battleId); assert.equal(pointer?.phase, 'active');
            assert.equal(presence.get(player)?.inBattle, true);
            const { battleAuthorityKeys, battleEvidenceFrom, resolveBattleAuthority } = await import('./_realtime/battle-authority.js');
            const authority = await resolveBattleAuthority(player, battleEvidenceFrom(await kv.mget(...battleAuthorityKeys(player))), { kv });
            assert.equal(authority.inBattle, true, 'heartbeat must independently prove both dispatched fighters, not rely on the start grace');
        }
        const retry = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: row.campaign.shrine[0].id });
        assert.equal(retry.status, 200, JSON.stringify(retry.data)); assert.equal(retry.data.battleId, start.data.battleId);
        assert.equal(Object.keys((await kv.get<any>(`world:war:${id}`)).campaign.admissions).length, 1);
    });
    for (const version of [2, 3] as const) for (const capped of [false, true]) it(`v${version}: sealed Kage shrine rewards ${capped ? 'after' : 'before'} the cap settle once despite changed seats`, async () => {
        const row = await seed(Date.now() - (version === 2 ? 21 : 3) * 3_600_000, version), objective = row.campaign.shrine[0];
        objective.bouts = capped ? objective.limit : 0;
        row.campaign.pvp[A] = 100; row.campaign.pvp[B] = 200;
        await kv.set(`world:war:${id}`, row);
        await kv.set('village:kage:ashen-leaf-village', { seatedKage: 'alice' });
        await kv.set('village:kage:moonshadow-village', { seatedKage: 'bob' });
        for (const player of ['alice', 'bob']) {
            presence.upsert({ name: player, sector: 47, character: { level: 100, village: player === 'alice' ? A : B } });
            assert.equal((await call(endpoint, player, { warId: id, action: 'shrine-enter', objectiveId: objective.id })).status, 200);
        }
        const start = await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(start.status, 200, JSON.stringify(start.data));
        const session = await kv.get<any>(`pvp:${start.data.battleId}`);
        assert.deepEqual(session.warRoleEvidence.p1.role, { win: 30, loss: 50 });
        assert.deepEqual(session.warRoleEvidence.p2.role, { win: 30, loss: 50 });
        await kv.del('village:kage:ashen-leaf-village', 'village:kage:moonshadow-village');
        await kv.set(`pvp:${session.battleId}`, { ...session, status: 'done', winner: 'p1', endedAt: Date.now() });
        const results = await Promise.all(Array.from({ length: 4 }, () => world.settlePvpVillageWarContinuation(session.battleId, 'alice')));
        const points = version === 2 ? (capped ? 0 : 100) : capped ? 30 : 50;
        for (const result of results) { assert.equal(result.status, 200); if ('points' in result.body) assert.equal(result.body.points, points); }
        const settled = await kv.get<any>(`world:war:${id}`);
        assert.equal(settled.campaign.pvp[A], 100 + points);
        assert.equal(settled.campaign.pvp[B], version === 2 ? 200 : 150);
        assert.equal(settled.campaign.shrine[0].bouts, capped ? objective.limit : 1);
        assert.equal(settled.contributions.alice?.damage ?? 0, points);
        assert.equal(settled.contributions.alice?.pvpKills ?? 0, points ? 1 : 0);
        (await import('./_village-war-shrine-closing.js')).resetShrineClosingTimersForTests();
        await kv.set(`world:war:${id}`, JSON.parse(JSON.stringify(settled)));
        await kv.del(`pvp:war-continuation:alice:${session.battleId}`);
        const recovered = await world.settlePvpVillageWarContinuation(session.battleId, 'alice');
        assert.equal(recovered.status, 200); assert.equal(recovered.body.points, points);
        assert.deepEqual((await kv.get<any>(`world:war:${id}`)).campaign.pvp, settled.campaign.pvp);
    });
    for (const version of [2, 3] as const) it(`v${version}: keeps real shrine PvP after its cap and binds defeat to the correct visit`, async () => {
        const row = await seed(Date.now() - (version === 2 ? 21 : 3) * 3_600_000, version), objectiveId = row.campaign.shrine[0].id;
        row.campaign.shrine[0].bouts = row.campaign.shrine[0].limit; row.campaign.shrine[0].wins[A] = row.campaign.shrine[0].limit; row.campaign.pvp[A] = version === 2 ? 1500 : 200;
        await kv.set(`world:war:${id}`, row);
        for (const player of ['alice', 'bob']) {
            presence.upsert({ name: player, sector: 47, character: { level: 100, village: player === 'alice' ? A : B } });
            assert.equal((await call(endpoint, player, { warId: id, action: 'shrine-enter', objectiveId })).status, 200);
        }
        const started = await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId });
        assert.equal(started.status, 200, JSON.stringify(started.data));
        const session = await kv.get<any>(`pvp:${started.data.battleId}`);
        const { commitPvpSessionMutation } = await import('./pvp/_session-mutation.js');
        const terminal = { ...session, status: 'done', winner: 'p1', endedAt: Date.now() };
        const committed = await commitPvpSessionMutation(kv, `pvp:${session.battleId}`, session, terminal);
        assert.equal(committed.status, 'committed');
        const { shrineRoomLocation, touchShrineRoom, releaseDefeatedShrinePlayer } = await import('./_village-war-shrine-presence.js');
        assert.equal(shrineRoomLocation('bob', row, 47), null);
        assert.ok(shrineRoomLocation('alice', row, 47));
        const paid = await world.settlePvpVillageWarContinuation(session.battleId, 'alice');
        assert.equal(paid.status, 200); assert.equal(paid.body.points, version === 2 ? 0 : 5);
        assert.equal((await kv.get<any>(`world:war:${id}`)).campaign.pvp[A], version === 2 ? 1500 : 205);
        const later = Date.now() + 5000;
        mock.method(Date, 'now', () => later);
        const control = await call(endpoint, 'alice', { warId: id, action: 'shrine-state', objectiveId });
        assert.equal(control.status, 200);
        assert.equal(control.data.room.objective.controlVillage, A);
        assert.ok(control.data.room.objective.controlTimeMs[A] >= 5000, 'verified control keeps accumulating after the win cap');
        // A delayed terminal replay is bound to the defeated visit's battle ID.
        touchShrineRoom('bob', row, 47, objectiveId, 126, Date.now(), B);
        releaseDefeatedShrinePlayer(terminal);
        assert.ok(shrineRoomLocation('bob', row, 47));
    });
    it('still dispatches a Town Hall combat defender for an entered stronghold and awards stronghold points', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'combat')!;
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 0, character: { level: 100, village: B } });
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'enter', objectiveId: objective.id })).status, 200);
        assert.equal((await call(endpoint, 'bob', { warId: id, action: 'defend', objectiveId: objective.id })).status, 200);
        const dispatched = await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(dispatched.status, 200, JSON.stringify(dispatched.data)); assert.equal(dispatched.data.npc, false);
        const session = await kv.get<any>(`pvp:${dispatched.data.battleId}`);
        assert.equal(session.p2.name, 'Bob'); assert.equal(session.villageWarObjective.objectiveId, objective.id);
        assert.equal(presence.get('bob')?.sector, 0, 'stronghold defenses still dispatch from town');
        await kv.set(`pvp:${dispatched.data.battleId}`, { ...session, status: 'done', winner: 'p1', endedAt: Date.now() });
        const paid = await world.settlePvpVillageWarContinuation(dispatched.data.battleId, 'alice');
        assert.equal(paid.status, 200);
        const fresh = await kv.get<any>(`world:war:${id}`);
        assert.equal(fresh.campaign.pvp[A], 50); assert.equal(fresh.campaign.strongholds.find((o: { id: string; bouts: number }) => o.id === objective.id).bouts, 1);
        assert.equal(fresh.campaign.shrine[0].bouts, 0);
    });
    it('rechecks a queued defender\'s current level before dispatch and does not charge an unavailable assault', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'combat')!;
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 0, character: { level: 100, village: B } });
        await call(endpoint, 'alice', { warId: id, action: 'enter', objectiveId: objective.id });
        assert.equal((await call(endpoint, 'bob', { warId: id, action: 'defend', objectiveId: objective.id })).status, 200);
        const save = await kv.get<any>('save:bob'); save.character.level = 14;
        await kv.set('save:bob', save);
        const rejected = await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(rejected.status, 409, 'an ineligible queue member must not be seated as a human defender');
        const fresh = await kv.get<any>(`world:war:${id}`);
        assert.deepEqual(fresh.campaign.admissions, {});
        assert.deepEqual(fresh.campaign.usage, {});
        assert.equal(fresh.campaign.strongholds.find((o: any) => o.id === objective.id).bouts, 0);
    });
    it('releases completed combat for another attack and defender dispatch without opening the campaign view', async () => {
        const row = await seed(Date.now() - 21 * 3_600_000);
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 47, character: { level: 100, village: B } });
        const objectiveId = row.campaign.shrine[0].id;
        for (const player of ['alice', 'bob']) await call(endpoint, player, { warId: id, action: 'shrine-enter', objectiveId });
        const first = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId });
        assert.equal(first.status, 200, JSON.stringify(first.data));
        const bobSave = await kv.get<any>('save:bob');
        const session = await kv.get<any>(`pvp:${first.data.battleId}`);
        session.activePlayer = 'p2'; session.consecAutoWait = { p2: 2 };
        await kv.set(`pvp:${first.data.battleId}`, session);
        const move = (await import('./pvp/move.js')).default as unknown as typeof endpoint;
        const terminal = await call(move, 'alice', { battleId: first.data.battleId, role: 'p1', action: 'claim-afk-win', moveToken: 'campaign-audit-afk' });
        assert.equal(terminal.status, 200, JSON.stringify(terminal.data));
        assert.equal(terminal.data.status, 'done'); assert.equal(terminal.data.winner, 'p1');
        const beforeClaim = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'state', runId: first.data.runId });
        assert.equal(beforeClaim.data.status, 'done');
        const unsettled = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId });
        assert.equal(unsettled.status, 409); assert.match(unsettled.data.error, /pending PvP battle settlement/);
        assert.equal(Object.keys((await kv.get<any>(`world:war:${id}`)).campaign.admissions).length, 1);
        const claim = (await import('./pvp/claim-rewards.js')).default as unknown as typeof endpoint;
        for (const [playerName, outcome] of [['alice', 'win'], ['bob', 'loss']]) {
            const body = { battleId: first.data.battleId, playerName, outcome, completionVersion: 1 };
            const paid = await call(claim, playerName, body);
            assert.equal(paid.status, 200, JSON.stringify(paid.data));
            const ack = await call(claim, playerName, { ...body, completionAck: true });
            assert.equal(ack.status, 200, JSON.stringify(ack.data));
            assert.equal(ack.data.completionPending, false);
            if (playerName === 'alice') {
                await kv.set('save:bob', bobSave);
                presence.upsert({ name: 'bob', sector: 47, character: { level: 100, village: B }, inBattle: false });
                const unavailable = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId });
                assert.equal(unavailable.status, 409);
                assert.equal(Object.keys((await kv.get<any>(`world:war:${id}`)).campaign.admissions).length, 1,
                    'an unacknowledged defender must not consume a new objective admission');
            }
        }
        assert.equal((await kv.get<any>(`world:war:${id}`)).campaign.pvp[A], 100);
        // Fixture recovery lets the defeated player queue again; neither player
        // polls the campaign view to release their stale active run.
        await kv.set('save:bob', bobSave);
        presence.upsert({ name: 'bob', sector: 47, character: { level: 100, village: B }, inBattle: false });
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A }, inBattle: false });
        assert.equal((await call(endpoint, 'bob', { name: 'bob', warId: id, action: 'shrine-state', objectiveId })).status, 409, 'a defeated fighter must enter on a fresh visit');
        assert.equal((await call(endpoint, 'bob', { name: 'bob', warId: id, action: 'shrine-enter', objectiveId })).status, 200);
        const second = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId });
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.notEqual(second.data.runId, first.data.runId);
        assert.equal(second.data.npc, false);
        const completed = await kv.get<any>(`village-campaign-run:${first.data.runId}`);
        assert.equal(completed.status, 'done'); assert.equal(completed.result.points, 100);
        assert.equal((await kv.get<any>(`world:war:${id}`)).campaign.shrine[0].bouts, 1);
    });
    it('releases the objective reservation for a drawn combat without awarding war points', async () => {
        const row = await seed(Date.now() - 21 * 3_600_000);
        presence.upsert({ name: 'alice', sector: 47, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 47, character: { level: 100, village: B } });
        const objectiveId = row.campaign.shrine[0].id;
        for (const player of ['alice', 'bob']) await call(endpoint, player, { warId: id, action: 'shrine-enter', objectiveId });
        const started = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId });
        assert.equal(started.status, 200, JSON.stringify(started.data));
        const session = await kv.get<any>(`pvp:${started.data.battleId}`);
        await kv.set(`pvp:${started.data.battleId}`, { ...session, status: 'done', winner: 'draw', endedAt: Date.now() });
        const view = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'view' });
        assert.equal(view.status, 200, JSON.stringify(view.data));
        assert.equal(view.data.run.status, 'done'); assert.equal(view.data.run.warResult.points, 0);
        const fresh = await kv.get<any>(`world:war:${id}`);
        assert.equal(fresh.campaign.admissions[started.data.runId].finished, true);
        assert.equal(fresh.campaign.shrine[0].bouts, 0);
        assert.deepEqual(fresh.campaign.pvp, {});
        assert.equal(await kv.get('village-campaign-assigned:bob'), null);
    });
    it('seals a real solo-PvE operation, reserves its allowance once and resumes after a lost response', async () => {
        await seed();
        for (const sector of [17, 18, 19, 20, 21, 22, 23, 24]) await kv.set(`world:territory:${sector}`, { ownerVillage: B });
        const accepted = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'operation-start', operation: 'espionage' });
        const fieldMissionId = accepted.data.mission.id;
        presence.upsert({ name: 'alice', sector: accepted.data.mission.sectors[0], character: { level: 100, village: A } });
        assert.equal((await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'operation-enter' })).status, 200);
        const first = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', fieldMissionId });
        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.equal(first.data.session.runtime, 'solo-pve');
        assert.equal(first.data.session.encounter.kind, 'village-war-operation');
        assert.equal(first.data.session.ownerSlug, 'alice');
        const retry = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', fieldMissionId });
        assert.equal(retry.status, 200); assert.equal(retry.data.runId, first.data.runId);
        assert.equal((await kv.get<any>(`world:war:${id}`)).campaign.usage[`${A}:0`].total, 1);
    });
    it('admits a card-mode stronghold defender, seals legal decks, and scores a server forfeit once', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'card')!;
        const deck = await import('./card-clash/_deck.js');
        await deck.resolveChronicleDeckWithSave('bob', []);
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 0, character: { level: 100, village: B } });
        assert.equal((await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'enter', objectiveId: objective.id })).status, 200);
        presence.upsert({ name: 'alice', sector: 0, character: { level: 100, village: A } });
        const remote = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(remote.status, 409);
        assert.match(String(remote.data.error), /not in that sector/);
        assert.equal(Object.keys((await kv.get<any>(`world:war:${id}`)).campaign.admissions).length, 0);
        // Reconnect at the objective after the legitimate return trip.
        presence.remove('alice');
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        assert.equal((await call(endpoint, 'bob', { name: 'bob', warId: id, action: 'defend', objectiveId: objective.id })).status, 200);
        const start = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(start.status, 200, JSON.stringify(start.data)); assert.equal(start.data.mode, 'card'); assert.equal(start.data.npc, false);
        const inbox = await kv.get<any[]>('offline-notices:bob');
        assert.equal(inbox?.[0].kind, 'village-war-card-defense');
        assert.equal(inbox?.[0].campaignRunId, start.data.runId);
        const result = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'forfeit', runId: start.data.runId });
        assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.warResult.points, 50);
        await call(endpoint, 'bob', { name: 'bob', warId: id, action: 'state', runId: start.data.runId });
        assert.equal((await kv.get<any>(`world:war:${id}`)).campaign.pvp[B], 50);
    });
    it('resolves a pet stronghold with sealed player teams and a replay, without consuming a PvE attempt', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        for (const slug of ['alice', 'bob']) {
            const save = await kv.get<any>(`save:${slug}`);
            save.character.pets = [{ id: `pet-${slug}`, name: `${slug}'s pet`, element: 'Fire', role: 'assassin', rarity: 'standard',
                level: 20, hp: 400, attack: 50, defense: 30, speed: 35, jutsus: [{ name: 'Ember Jab', power: 90, kind: 'damage' }] }];
            await kv.set(`save:${slug}`, save);
        }
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'pet')!;
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 0, character: { level: 100, village: B } });
        await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'enter', objectiveId: objective.id });
        await call(endpoint, 'bob', { name: 'bob', warId: id, action: 'defend', objectiveId: objective.id });
        const start = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(start.status, 200, JSON.stringify(start.data)); assert.equal(start.data.npc, false);
        assert.equal(start.data.mode, 'pet'); assert.equal(start.data.status, 'done'); assert.equal(start.data.warResult.points, 50);
        const replay = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'watch', runId: start.data.runId });
        assert.equal(replay.status, 200); assert.ok(replay.data.script);
        await call(endpoint, 'bob', { name: 'bob', warId: id, action: 'state', runId: start.data.runId, winner: 'p1', points: 99999 });
        const fresh = await kv.get<any>(`world:war:${id}`);
        assert.equal((fresh.campaign.pvp[A] ?? 0) + (fresh.campaign.pvp[B] ?? 0), 50);
        assert.deepEqual(fresh.campaign.usage, {});
    });
    it('combines ANBU support with three human pet wins and the completion bonus exactly once', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        await kv.set('village:kage:moonshadow-village', { seatedKage: 'bob' });
        for (const slug of ['alice', 'bob']) {
            const save = await kv.get<any>(`save:${slug}`), powerful = slug === 'alice';
            save.character.pets = [{ id: `pet-${slug}`, name: `${slug}'s pet`, element: 'Fire', role: 'assassin', rarity: 'standard',
                level: powerful ? 100 : 1, hp: powerful ? 1200 : 60, attack: powerful ? 300 : 5,
                defense: powerful ? 160 : 5, speed: powerful ? 150 : 5, jutsus: [{ name: 'Ember Jab', power: 90, kind: 'damage' }] }];
            await kv.set(`save:${slug}`, save);
        }
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'pet')!;
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 0, character: { level: 100, village: B } });
        await call(endpoint, 'alice', { warId: id, action: 'enter', objectiveId: objective.id });
        const npc = await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(npc.status, 200, JSON.stringify(npc.data));
        assert.equal(npc.data.npc, true); assert.equal(npc.data.warResult.points, 20);
        let fresh = await kv.get<any>(`world:war:${id}`);
        assert.equal(fresh.campaign.strongholds.find((o: any) => o.id === objective.id).bouts, 0);
        assert.deepEqual(campaignScore(fresh.campaign, A), { pvp: 0, pve: 0, rawPve: 20, total: 0 });
        for (let bout = 1; bout <= 3; bout++) {
            assert.equal((await call(endpoint, 'bob', { warId: id, action: 'defend', objectiveId: objective.id })).status, 200);
            const human = await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: objective.id });
            assert.equal(human.status, 200, JSON.stringify(human.data));
            assert.equal(human.data.npc, false); assert.equal(human.data.warResult.points, 50);
            await call(endpoint, 'bob', { warId: id, action: 'state', runId: human.data.runId });
            await call(endpoint, 'alice', { warId: id, action: 'state', runId: human.data.runId });
            fresh = await kv.get<any>(`world:war:${id}`);
            const post = fresh.campaign.strongholds.find((o: any) => o.id === objective.id);
            assert.equal(post.bouts, bout);
            assert.equal(fresh.campaign.pvp[A], bout * 50 + (bout === 3 ? 150 : 0));
            assert.equal(fresh.campaign.pve[A], 20);
            assert.equal(fresh.campaign.usage[`${A}:0`].players.alice.total, 1, 'human bouts spend no support attempts');
        }
        assert.deepEqual(campaignScore(fresh.campaign, A), { pvp: 300, pve: 20, rawPve: 20, total: 320 });
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: objective.id })).status, 409);
        const summary = await call(endpoint, 'alice', { warId: id, action: 'view' });
        assert.equal(summary.data.campaign.scores[A].total, 320);
        assert.equal(summary.data.campaign.strongholds.find((o: any) => o.id === objective.id).bouts, 3);
    });
    it('reuses the same offline ANBU pet copy without disturbing its real breeding or expedition', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        const pet = (name: string, power: number) => ({ id: name, name, level: 100, rarity: 'legendary', hp: power, attack: power, defense: power, speed: power, element: 'Earth', fatigue: 0 });
        await kv.set('save:alice', { character: { name: 'Alice', village: A, level: 100, hp: 1000, maxHp: 1000, pets: [pet('champion', 100)] } });
        const defender = { character: { name: 'Bob', village: B, level: 100, hp: 0, maxHp: 1000,
            pets: [{ ...pet('sentry', 1), expedition: { status: 'active' } }],
            petBreeding: { state: 'breeding', parentIds: ['sentry'], readyAt: Date.now() + WAR_DAY_MS } } };
        await kv.set('save:bob', defender);
        await kv.set('game:village-state:moonshadowvillage', { anbuAppointees: ['bob'] });
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'pet')!;
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'enter', objectiveId: objective.id })).status, 200);
        const runIds = new Set<string>();
        for (let assault = 0; assault < 2; assault++) {
            const started = await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: objective.id });
            assert.equal(started.status, 200, JSON.stringify(started.data));
            assert.equal(started.data.npc, true); assert.equal(started.data.warResult.points, 20);
            runIds.add(started.data.runId);
            assert.equal((await kv.get<any>(`village-campaign-run:${started.data.runId}`))?.defender, 'bob');
            assert.deepEqual(await kv.get('save:bob'), defender);
        }
        assert.equal(runIds.size, 2);
        const fresh = await kv.get<any>(`world:war:${id}`);
        assert.equal(fresh.campaign.pve[A], 40);
        assert.equal(fresh.campaign.strongholds.find((o: any) => o.id === objective.id).bouts, 0);
        assert.equal(fresh.campaign.usage[`${A}:0`].players.alice.categories.sabotage, 2);
        assert.equal((await call(endpoint, 'alice', { warId: id, action: 'start', objectiveId: objective.id })).status, 409, 'only the personal support cap limits repeated NPC assaults');
    });
    it('fields an anonymous ANBU fallback and enforces Sabotage admission without consuming live objective bouts', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        const defender = await kv.get<any>('save:bob');
        defender.character.hp = 0; defender.character.avatarImage = '/private-bob-avatar.webp';
        await kv.set('save:bob', defender);
        await kv.set('game:village-state:moonshadowvillage', { anbuAppointees: ['bob'] });
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'combat')!;
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'enter', objectiveId: objective.id });
        const malformed = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: objective.id, operation: 'supply' });
        assert.equal(malformed.status, 409);
        const start = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(start.status, 200, JSON.stringify(start.data)); assert.equal(start.data.npc, true);
        assert.equal(start.data.session.encounter.kind, 'village-war-garrison');
        assert.equal(start.data.session.encounter.metadata.anbuSlug, undefined);
        assert.notEqual(start.data.session.enemy.name, 'Bob');
        assert.equal(start.data.session.enemy.character.avatarImage, '/anbu/moonshadow.webp?v=2');
        assert.equal(start.data.session.enemy.hp, start.data.session.enemy.maxHp, 'the AI copy defends at full strength');
        assert.equal(start.data.session.enemy.character.boss, undefined);
        assert.equal(start.data.session.enemy.character.aiTargetMode, 'lowest-hp');
        assert.equal(start.data.session.enemy.character.masterAi, true);
        assert.equal(start.data.session.enemy.character.aiTurnPolicy, 'standard-pve-v1');
        assert.equal(start.data.session.difficultyGuard, undefined);
        assert.equal(start.data.session.weeklyBossGuard, undefined);
        const snapshot = await (await import('./_village-war-anbu-defender.js')).sealCampaignAnbuCombat('bob');
        const expectedCharacter = { ...snapshot!.character, name: start.data.session.enemy.name,
            avatarImage: '/anbu/moonshadow.webp?v=2', aiTargetMode: 'lowest-hp', masterAi: true, aiTurnPolicy: 'standard-pve-v1' };
        delete (expectedCharacter as Record<string, unknown>).boss;
        assert.deepEqual(start.data.session.enemy.character, expectedCharacter, 'every combat build field matches the actual player snapshot');
        assert.deepEqual(await kv.get('save:bob'), defender, 'the real member stays wounded and keeps their own avatar');
        const fresh = await kv.get<any>(`world:war:${id}`);
        assert.equal(fresh.campaign.usage[`${A}:0`].categories.sabotage, 1);
        assert.equal(fresh.campaign.strongholds.find((o: any) => o.id === objective.id).bouts, 0);
    });
    it('does not rewind a completed card battle when retrying interrupted prepared cleanup', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'card')!;
        const deck = await import('./card-clash/_deck.js'); await deck.resolveChronicleDeckWithSave('bob', []);
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: 0, character: { level: 100, village: B } });
        await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'enter', objectiveId: objective.id });
        await call(endpoint, 'bob', { name: 'bob', warId: id, action: 'defend', objectiveId: objective.id });
        const start = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(start.status, 200, JSON.stringify(start.data));
        const prepared = await kv.get<any>(`village-campaign-run:${start.data.runId}`);
        await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'forfeit', runId: start.data.runId });
        const fresh = await kv.get<any>(`world:war:${id}`);
        fresh.campaign.admissions[start.data.runId].prepared = { run: prepared };
        await kv.set(`world:war:${id}`, fresh);
        const retry = await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'start', objectiveId: objective.id });
        assert.equal(retry.status, 200, JSON.stringify(retry.data)); assert.equal(retry.data.status, 'done');
        assert.equal(retry.data.session.status, 'complete');
        assert.equal((await kv.get<any>(`world:war:${id}`)).campaign.pvp[B], 50);
        assert.equal(await kv.get(`village-campaign-assigned:bob`), null);
    });
    it('refuses an otherwise authorized shinobi spar inside a pet-only stronghold', async () => {
        const row = await seed(); row.campaign.intel[A] = 72;
        await kv.set(`world:war:${id}`, row);
        const objective = row.campaign.strongholds.find(o => o.village === B && o.mode === 'pet')!;
        presence.upsert({ name: 'alice', sector: objective.sector, character: { level: 100, village: A } });
        presence.upsert({ name: 'bob', sector: objective.sector, character: { level: 100, village: B } });
        await call(endpoint, 'alice', { name: 'alice', warId: id, action: 'enter', objectiveId: objective.id });
        const { saveChallengeRecord } = await import('./pvp/_challenge-authorization.js');
        await saveChallengeRecord({ id: 'mode-restriction-spar', from: 'alice', to: 'bob', mode: 'standard', status: 'pending', createdAt: Date.now(), challenge: {} });
        const pvp = (await import('./pvp/session.js')).default as unknown as typeof endpoint;
        const response = await call(pvp, 'bob', { challengeId: 'mode-restriction-spar', battleId: 'pvp-mode-restriction', mode: 'standard',
            p1Character: { name: 'Alice' }, p2Character: { name: 'Bob' }, useCurrentVitals: false, baseRewards: false });
        assert.equal(response.status, 409, JSON.stringify(response.data));
        assert.match(response.data.error, /pet battles only/);
        assert.equal(await kv.get('pvp:pvp-mode-restriction'), null);
    });
});
