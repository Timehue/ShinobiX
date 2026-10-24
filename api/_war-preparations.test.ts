import assert from 'node:assert/strict';
import { before, beforeEach, it } from 'node:test';
import { emptyPreparationLevels, preparationUpkeep, supportPoints } from '../shared/war-preparations.js';
import { campaignDay, campaignScore, scoreCampaignBattle, WAR_DAY_MS } from '../shared/village-war-campaign.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'war-preparations-local-test-secret-32-bytes';
let kv: typeof import('./_storage.js').kv;
let prep: typeof import('./_war-preparations.js');
let state: typeof import('./_war-state.js');
let campaign: typeof import('./_village-war-campaign.js');
let sector: typeof import('./_sector-war.js');
const A = 'Moonshadow Village', B = 'Frostfang Village';
before(async () => {
    ({ kv } = await import('./_storage.js'));
    prep = await import('./_war-preparations.js'); state = await import('./_war-state.js');
    campaign = await import('./_village-war-campaign.js'); sector = await import('./_sector-war.js');
});
beforeEach(async () => { const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys); });
// A tier also costs treasury ryo and Bone Charms (2026-10 rebalance, #6).
const TREASURY_RYO = 1_000_000, TREASURY_BC = 1_000;
const treasuryKey = (village: string) => `game:village-state:${state.villageWarSlug(village)}`;
async function seedTreasury(village: string, treasury: Record<string, number> = { ryo: TREASURY_RYO, boneCharms: TREASURY_BC }) {
    await kv.set(treasuryKey(village), { treasury });
}
async function treasuryOf(village: string): Promise<Record<string, number>> {
    return ((await kv.get<{ treasury?: Record<string, number> }>(treasuryKey(village)))?.treasury) ?? {};
}
async function seedSector(n = 26, generation = 1) {
    const now = Date.now();
    const war = sector.newSectorWarSession({ sector: n, attackerVillage: A, defenderVillage: B,
        winCondition: 'combat', now: now - 1000 });
    war.declarationGeneration = generation;
    await kv.set(sector.sectorWarKey(war.id), war);
    await kv.set(state.villageWarKey(A), { ...state.defaultVillageWarRecord(A), warResources: 2000 });
    await kv.set(state.villageWarKey(B), { ...state.defaultVillageWarRecord(B), warResources: 2000 });
    await seedTreasury(A);
    await seedTreasury(B);
    return war;
}
it('a purchase moves WR, treasury ryo, Bone Charms and the tier in one commit; a lost answer replays without another debit', async () => {
    const war = await seedSector(), instance = prep.sectorPreparationInstance(war), key = state.villageWarKey(A);
    const original = kv.compareSetMany!;
    let injected = false;
    kv.compareSetMany = (async (...args: Parameters<typeof original>) => {
        const result = await original.apply(kv, args);
        if (!injected) { injected = true; throw new Error('lost purchase response'); }
        return result;
    }) as typeof original;
    try { await assert.rejects(prep.upgradeWarPreparation(A, 'warAcademy', instance, 1), /lost purchase response/); }
    finally { kv.compareSetMany = original; }
    const replay = await prep.upgradeWarPreparation(A, 'warAcademy', instance, 1);
    assert.equal(replay.ok, true);
    assert.equal('replayed' in replay && replay.replayed, true);
    assert.equal('treasuryRyo' in replay && replay.treasuryRyo, 10_000, 'the replay reports what the proof says was paid');
    const record = state.normalizeVillageWarRecord(A, await kv.get(key) ?? undefined);
    assert.equal(record.warResources, 1960);
    assert.equal(prep.preparationLevels(record, instance).warAcademy, 1);
    assert.equal(record.structures.warAcademy, 0);
    const treasury = await treasuryOf(A);
    assert.equal(treasury.ryo, TREASURY_RYO - 10_000, 'tier 1: 40 WR x 250 ryo, once');
    assert.equal(treasury.boneCharms, TREASURY_BC - 20, 'and 40 x 0.5 Bone Charms');
});
it('the price of each tier: 40 / 80 / 120 WR + 10,000 / 20,000 / 30,000 ryo + 20 / 40 / 60 Bone Charms', async () => {
    const { preparationTreasuryCost } = await import('../shared/war-preparations.js');
    assert.deepEqual([0, 1, 2].map((tier) => preparationTreasuryCost(tier)), [
        { wr: 40, ryo: 10_000, boneCharms: 20 }, { wr: 80, ryo: 20_000, boneCharms: 40 }, { wr: 120, ryo: 30_000, boneCharms: 60 },
    ]);
    assert.deepEqual(preparationTreasuryCost(0, 0), { wr: 40, ryo: 0, boneCharms: 0 }, 'the dial at 0 is the WR-only price');
});
it('a short treasury refuses with no movement, in ryo and in Bone Charms', async () => {
    const war = await seedSector(), instance = prep.sectorPreparationInstance(war);
    await seedTreasury(A, { ryo: 9_999, boneCharms: 1_000 });
    const poor = await prep.upgradeWarPreparation(A, 'barracks', instance, 1);
    assert.equal(poor.ok, false);
    assert.equal('error' in poor && poor.error, 'insufficient-treasury-ryo');
    assert.equal('need' in poor && poor.need, 10_000);
    await seedTreasury(A, { ryo: 50_000, boneCharms: 19 });
    const charmless = await prep.upgradeWarPreparation(A, 'barracks', instance, 1);
    assert.equal('error' in charmless && charmless.error, 'insufficient-treasury-bc');
    assert.deepEqual(await treasuryOf(A), { ryo: 50_000, boneCharms: 19 });
    assert.equal((await kv.get<import('./_war-state.js').VillageWarRecord>(state.villageWarKey(A)))!.warResources, 2000);
});
it('a commit that loses its compare-and-set moves nothing', async () => {
    const war = await seedSector(), instance = prep.sectorPreparationInstance(war);
    const original = kv.compareSetMany;
    kv.compareSetMany = async () => false;
    let busy: Awaited<ReturnType<typeof prep.upgradeWarPreparation>>;
    try { busy = await prep.upgradeWarPreparation(A, 'barracks', instance, 1); }
    finally { kv.compareSetMany = original; }
    assert.equal('error' in busy && busy.error, 'treasury-busy');
    assert.deepEqual(await treasuryOf(A), { ryo: TREASURY_RYO, boneCharms: TREASURY_BC });
    assert.equal((await kv.get<import('./_war-state.js').VillageWarRecord>(state.villageWarKey(A)))!.warResources, 2000);
});
it('WAR_RYO_PER_WR=0 charges WR only', async () => {
    const war = await seedSector(), instance = prep.sectorPreparationInstance(war);
    process.env.WAR_RYO_PER_WR = '0';
    try {
        const out = await prep.upgradeWarPreparation(A, 'barracks', instance, 1);
        assert.equal(out.ok, true);
        assert.equal('treasuryRyo' in out && out.treasuryRyo, 0);
    } finally {
        delete process.env.WAR_RYO_PER_WR;
    }
    assert.deepEqual(await treasuryOf(A), { ryo: TREASURY_RYO, boneCharms: TREASURY_BC });
    assert.equal((await kv.get<import('./_war-state.js').VillageWarRecord>(state.villageWarKey(A)))!.warResources, 1960);
});
it('concurrent requests for the same tier debit once and all temporary buildings stop at tier three', async () => {
    const war = await seedSector(), instance = prep.sectorPreparationInstance(war);
    await Promise.all([1, 2].map(() => prep.upgradeWarPreparation(A, 'barracks', instance, 1)));
    await prep.upgradeWarPreparation(A, 'barracks', instance, 2);
    await prep.upgradeWarPreparation(A, 'barracks', instance, 3);
    const denied = await prep.upgradeWarPreparation(A, 'barracks', instance, 4);
    assert.equal(denied.ok, false); assert.equal('error' in denied && denied.error, 'max-level');
    assert.equal((await kv.get<import('./_war-state.js').VillageWarRecord>(state.villageWarKey(A)))!.warResources, 1760);
});
it('simultaneous contests and same-sector rematches never inherit another instance’s levels', async () => {
    const war = await seedSector(), instance = prep.sectorPreparationInstance(war);
    await prep.upgradeWarPreparation(A, 'watchtower', instance, 1);
    const other = { ...war, sector: 27, id: '27:moonshadowvillage-vs-frostfangvillage' };
    await kv.set(sector.sectorWarKey(other.id), other);
    let record = state.normalizeVillageWarRecord(A, await kv.get(state.villageWarKey(A)) ?? undefined);
    assert.equal(prep.preparationLevels(record, prep.sectorPreparationInstance(other)).watchtower, 0);
    const rematch = { ...war, declarationGeneration: 2 };
    await kv.set(sector.sectorWarKey(war.id), rematch);
    const stale = await prep.upgradeWarPreparation(A, 'watchtower', instance, 2);
    assert.equal(stale.ok, false);
    assert.equal('error' in stale && stale.error, 'war-ended');
    await prep.upgradeWarPreparation(A, 'watchtower', prep.sectorPreparationInstance(rematch), 1);
    record = state.normalizeVillageWarRecord(A, await kv.get(state.villageWarKey(A)) ?? undefined);
    assert.equal(prep.preparationLevels(record, prep.sectorPreparationInstance(rematch)).watchtower, 1);
    assert.equal(record.warResources, 1920);
});
it('peace, surrender and a war closing during its quote cannot spend resources', async () => {
    const war = await seedSector(), instance = prep.sectorPreparationInstance(war), key = sector.sectorWarKey(war.id);
    assert.equal((await prep.upgradeWarPreparation(A, 'watchtower', '', 1)).ok, false);
    const original = kv.get;
    let closed = false;
    kv.get = (async (...args: Parameters<typeof original>) => {
        if (args[0] === key && !closed) { closed = true; await kv.set(key, { ...war, expiredAt: Date.now() }); }
        return original.apply(kv, args);
    }) as typeof original;
    try { assert.equal((await prep.upgradeWarPreparation(A, 'watchtower', instance, 1)).ok, false); }
    finally { kv.get = original; }
    assert.equal((await kv.get<import('./_war-state.js').VillageWarRecord>(state.villageWarKey(A)))!.warResources, 2000);
    assert.deepEqual(await treasuryOf(A), { ryo: TREASURY_RYO, boneCharms: TREASURY_BC }, 'nor any treasury ryo or Bone Charms');
});
it('campaign preparations can be purchased during funded preparation and disappear from live contexts on surrender', async () => {
    const now = Date.now(), c = campaign.createVillageCampaign([A, B], now + 1000, 40);
    const war = { id: 'moonshadowvillage-vs-frostfangvillage', villages: [A, B] as [string, string],
        startedAt: now, updatedAt: now, declarationGeneration: 4, campaign: c };
    await kv.set(`world:war:${war.id}`, war);
    await kv.set(state.villageWarKey(A), { ...state.defaultVillageWarRecord(A), warResources: 1000 });
    await seedTreasury(A);
    const instance = prep.campaignPreparationInstance(war);
    assert.equal((await prep.upgradeWarPreparation(A, 'warAcademy', instance, 1)).ok, true);
    await kv.set(`world:war:${war.id}`, { ...war, endedAt: now + 1 });
    assert.deepEqual(await prep.listWarPreparationContexts(A), []);
    assert.equal((await prep.upgradeWarPreparation(A, 'warAcademy', instance, 2)).ok, false);
});
it('Academy raises raw support only; zero PvP still scores zero and support never exceeds 20% of the total', () => {
    const c = campaign.createVillageCampaign([A, B], 1000, 40);
    assert.equal(scoreCampaignBattle(c, { receipt: 'field:one', village: A, player: 'alice', at: 2001, createdAt: 2000,
        pve: true, operation: 'supply', supportTiers: { warAcademy: 3, watchtower: 0 } }), 13);
    assert.equal(campaignScore(c, A).total, 0);
    c.pvp[A] = 40;
    assert.deepEqual(campaignScore(c, A), { pvp: 40, rawPve: 13, pve: 10, total: 50 });
    assert.equal(supportPoints(20, 3), 26);
});
it('sealed admission tiers control all field/ANBU awards; later changes cannot retroactively upgrade an accepted order', () => {
    const c = campaign.createVillageCampaign([A, B], 1000, 40);
    c.admissions.one = { player: 'alice', operation: 'sabotage', createdAt: 2000, supportTiers: { warAcademy: 1, watchtower: 0 } };
    const war = { id: 'campaign', villages: [A, B] as [string, string], startedAt: 1000, updatedAt: 1000, campaign: c };
    const args = { receipt: 'field:one', village: A, player: 'alice', at: 2001, createdAt: 2000,
        pve: true, operation: 'sabotage' as const, supportTiers: { warAcademy: 3, watchtower: 3 } };
    const paid = campaign.awardCampaignBattle(war, args, 'Alice');
    assert.equal(paid.points, 22);
    const again = campaign.awardCampaignBattle(paid.row, args, 'Alice');
    assert.equal(again.replayed, true); assert.equal(again.row.campaign.pve[A], 22);
});
it('Watchtower intel applies to one successful Espionage order per player/day; retries, other missions and full meters add nothing extra', () => {
    const c = campaign.createVillageCampaign([A, B], 1000, 40);
    const args = { village: A, player: 'alice', at: 2001, createdAt: 2000, pve: true,
        operation: 'espionage' as const, supportTiers: { warAcademy: 3, watchtower: 3 } };
    scoreCampaignBattle(c, { ...args, receipt: 'one' }); assert.equal(c.intel[A], 5);
    scoreCampaignBattle(c, { ...args, receipt: 'one' }); assert.equal(c.intel[A], 5);
    scoreCampaignBattle(c, { ...args, receipt: 'two' }); assert.equal(c.intel[A], 7);
    scoreCampaignBattle(c, { ...args, receipt: 'bob', player: 'bob' }); assert.equal(c.intel[A], 12);
    scoreCampaignBattle(c, { ...args, receipt: 'tomorrow', createdAt: 2000 + WAR_DAY_MS, at: 2001 + WAR_DAY_MS });
    assert.equal(c.intel[A], 17); assert.equal(campaignDay(c, 2001 + WAR_DAY_MS), 1);
    c.intel[A] = 71; scoreCampaignBattle(c, { ...args, receipt: 'last', player: 'carol' }); assert.equal(c.intel[A], 72);
});
it('sector Academy improves only player-run garrison support and preserves its cap and human awards', async () => {
    const war = await seedSector(), now = Date.now();
    const base = sector.applySectorWarBattle(war, true, { now, roleSwing: 100, garrisonBattle: true }).awarded;
    const improved = sector.applySectorWarBattle(war, true, { now, roleSwing: 100, garrisonBattle: true, supportMultiplier: 1.3 });
    assert.equal(improved.awarded, Math.round(base * 1.3));
    assert.equal(sector.applySectorWarBattle(war, true, { now, roleSwing: 100, supportMultiplier: 1.3 }).awarded, 100);
    const capped = { ...war, appliedBattles: [{ battleId: 'old', attackerWon: true, points: 149, garrison: true as const, by: 'alice', at: now - 1 }] };
    assert.ok(sector.applySectorWarBattle(capped, true, { now, roleSwing: 100, garrisonBattle: true, supportMultiplier: 1.3 }).awarded <= 1);
});
it('Barracks upkeep is per instance, rounded up, and excludes expired preparations', async () => {
    const war = await seedSector(), now = Date.now();
    assert.equal(preparationUpkeep({ watchtower: 3, barracks: 3, warAcademy: 3 }), 13);
    const record = state.defaultVillageWarRecord(A);
    record.warPreparations = [{ ...prep.sectorPreparationContext(war, A, now)!, levels: { watchtower: 3, barracks: 3, warAcademy: 3 }, alerts: [] }];
    assert.equal(state.totalUpkeepWr(record, now), 13);
    assert.equal(state.totalUpkeepWr(record, war.endsAt), 0);
    record.dormant = true;
    assert.deepEqual(prep.preparationLevels(record, prep.sectorPreparationInstance(war)), emptyPreparationLevels());
});
it('Watchtower reports are idempotent and private to the attacked village’s war chest', async () => {
    const war = await seedSector(), instance = prep.sectorPreparationInstance(war);
    await prep.upgradeWarPreparation(B, 'watchtower', instance, 1);
    await prep.alertSectorPreparation(war, 'assault-one', 'combat', Date.now());
    await prep.alertSectorPreparation(war, 'assault-one', 'combat', Date.now());
    const defender = state.normalizeVillageWarRecord(B, await kv.get(state.villageWarKey(B)) ?? undefined);
    const attacker = state.normalizeVillageWarRecord(A, await kv.get(state.villageWarKey(A)) ?? undefined);
    assert.equal(defender.warPreparations![0].alerts.length, 1);
    assert.equal(attacker.warPreparations?.length ?? 0, 0);
    const unnecessary = await prep.upgradeWarPreparation(B, 'watchtower', instance, 2);
    assert.equal(unnecessary.ok, false);
    assert.equal((await kv.get<import('./_war-state.js').VillageWarRecord>(state.villageWarKey(B)))!.warResources, 1960);
});
it('the daily pass removes surrendered preparations before billing while another war remains active', async () => {
    const war = await seedSector(), key = state.villageWarKey(A), now = Date.now();
    await prep.upgradeWarPreparation(A, 'barracks', prep.sectorPreparationInstance(war), 1);
    await kv.set(sector.sectorWarKey(war.id), { ...war, expiredAt: now });
    const { runVillageWarDailyPass } = await import('./_war-daily.js');
    const result = await runVillageWarDailyPass({ enabled: true, now, heldSectors: {}, storesEnabled: false,
        isAtWar: async () => true, sweepSectorWars: async () => [] });
    assert.equal(result.complete, true);
    const record = state.normalizeVillageWarRecord(A, await kv.get(key) ?? undefined);
    assert.equal(record.warResources, 1960);
    assert.deepEqual(record.warPreparations, []);
});
it('the real upgrade endpoint allows the seated Kage, rejects a member, and charges treasury ryo and Bone Charms but never seals for a temporary tier', async () => {
    const war = await seedSector(), village = B;
    const { issuePlayerToken } = await import('./_auth.js');
    const handler = (await import('./village/war-structure.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    await kv.set('village:kage:frostfang-village', { seatedKage: 'frostkage' });
    for (const name of ['frostkage', 'villager']) await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 50 } });
    await kv.set('game:village-state:frostfangvillage', { treasury: { honorSeals: 100, materialPoints: 200, ryo: 50_000, boneCharms: 30 } });
    async function call(name: string) {
        let statusCode = 200, body: Record<string, unknown> = {};
        const res = { setHeader() { return res; }, status(n: number) { statusCode = n; return res; },
            json(v: Record<string, unknown>) { body = v; return res; }, end() { return res; } };
        await handler({ method: 'POST', headers: { 'x-player-name': name, 'x-player-token': issuePlayerToken(name) },
            body: { playerName: name, village, structure: 'warAcademy', toLevel: 1, warInstance: prep.sectorPreparationInstance(war) } } as never, res as never);
        return { statusCode, body };
    }
    const before = await kv.get('game:village-state:frostfangvillage');
    assert.equal((await call('villager')).statusCode, 403);
    assert.deepEqual(await kv.get('game:village-state:frostfangvillage'), before, 'a refused member moves nothing');
    const purchase = await call('frostkage');
    assert.equal(purchase.statusCode, 200, JSON.stringify(purchase.body));
    assert.equal(purchase.body.currency, 'wr'); assert.equal(purchase.body.cost, 40);
    assert.equal(purchase.body.treasuryRyo, 10_000);
    assert.equal(purchase.body.treasuryBoneCharms, 20);
    assert.equal(purchase.body.remainingTreasuryRyo, 40_000);
    assert.equal(purchase.body.remainingTreasuryBoneCharms, 10);
    assert.deepEqual(await treasuryOf(village), { honorSeals: 100, materialPoints: 200, ryo: 40_000, boneCharms: 10 });
    // The next tier needs 40 Bone Charms: a short treasury answers 402 with the sentence the client shows.
    const short = await (async () => {
        let statusCode = 200, body: Record<string, unknown> = {};
        const res = { setHeader() { return res; }, status(n: number) { statusCode = n; return res; },
            json(v: Record<string, unknown>) { body = v; return res; }, end() { return res; } };
        await handler({ method: 'POST', headers: { 'x-player-name': 'frostkage', 'x-player-token': issuePlayerToken('frostkage') },
            body: { playerName: 'frostkage', village, structure: 'warAcademy', toLevel: 2, warInstance: prep.sectorPreparationInstance(war) } } as never, res as never);
        return { statusCode, body };
    })();
    assert.equal(short.statusCode, 402);
    assert.equal(short.body.error, 'insufficient-treasury-bc');
    assert.equal(short.body.message, 'The treasury is short — 40 Bone Charms needed.');
});
