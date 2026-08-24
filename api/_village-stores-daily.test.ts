import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { runVillageStoresStep, runClanStoresDailyPass, STORES_RECEIPT_CAP } from './_village-stores-daily.js';
import { runVillageWarDailyPass } from './_war-daily.js';
import { defaultVillageWarRecord, villageWarKey, type VillageWarRecord } from './_war-state.js';
import { sectorWarKey } from './_sector-war.js';
import { clearMercSkipInRecord } from './_merc-auto.js';
import { homeSectorsForVillage } from './_war-map-sectors.js';

const NOW = Date.UTC(2026, 7, 22, 4, 0, 0);
const TODAY = '2026-08-22';
const FROST = 'Frostfang Village';
const MOON = 'Moonshadow Village';
const STATE = 'game:village-state:frostfangvillage';
const WAR = villageWarKey(FROST);

function memStore() {
    const m = new Map<string, unknown>();
    return {
        m,
        get: async <T = unknown>(k: string): Promise<T | null> => (m.has(k) ? (m.get(k) as T) : null),
        set: async (k: string, v: unknown) => { m.set(k, v); return 'OK'; },
        keys: async (pattern: string): Promise<string[]> => {
            const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
            return [...m.keys()].filter((k) => k.startsWith(prefix));
        },
        mget: async (...keys: string[]): Promise<unknown[]> => keys.map((k) => (m.has(k) ? m.get(k) : null)),
    };
}
const lock = <T>(_k: string, fn: () => Promise<T>) => fn();
const war = (id: string, over: Record<string, unknown> = {}) => ({
    id, sector: 26, attackerVillage: MOON, defenderVillage: FROST, winCondition: 'combat',
    attackerPoints: 0, defenderPoints: 0, startedAt: NOW - 1000, endsAt: NOW + 1000, updatedAt: NOW, flipped: false, ...over,
});

describe('runVillageStoresStep (IO orchestration)', () => {
    it('debits provisions + materials, converts at the depot, stamps the war fed, writes the ledger', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { honorSeals: 3, provisions: 100, materialPoints: 95 } });
        store.m.set(WAR, { ...defaultVillageWarRecord(FROST), warResources: 10 });
        const w = war('26:moonshadowvillage-vs-frostfangvillage');
        store.m.set(sectorWarKey(w.id), w);
        const notices: unknown[] = [];
        const r = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [w], store, lock, notifyUnfed: async (a) => { notices.push(a); } });
        assert.equal(r.provisions, 65, '100 − 5 spoil − 30 war');
        assert.equal(r.materialPoints, 5, '95 → 9 WR (90 pts)');
        assert.equal(r.wrConverted, 9);
        assert.deepEqual(r.unfedWars, []);
        assert.equal(notices.length, 0);
        const state = store.m.get(STATE) as { treasury: Record<string, number> };
        assert.equal(state.treasury.honorSeals, 3, 'other treasury fields preserved');
        assert.equal(state.treasury.provisions, 65);
        const rec = store.m.get(WAR) as VillageWarRecord;
        assert.equal(rec.warResources, 19);
        assert.deepEqual(rec.storesLedger!.map((e) => e.kind), ['spoil', 'war', 'convert']);
        const stamped = store.m.get(sectorWarKey(w.id)) as Record<string, unknown>;
        assert.equal(stamped.fed, true);
        assert.equal(stamped.storesDate, TODAY);
        assert.deepEqual(stamped.unfedVillages, []);
    });

    it('an unfed war gets fed:false, lists the village, heralds + notifies the seated Kage; the merc band skips a tick', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 10 } });
        store.m.set(WAR, { ...defaultVillageWarRecord(FROST), mercLeases: [{ tierId: 'merc-ronin', player: 'hirer', expiresAt: NOW + 9999, count: 3 }] });
        store.m.set('village:kage:frostfang-village', { seatedKage: 'FrostKage' });
        const w = war('26:moonshadowvillage-vs-frostfangvillage', { storesDate: TODAY, unfedVillages: [MOON], fed: false });
        store.m.set(sectorWarKey(w.id), w);
        const notices: Array<{ village: string; kage: string; war: { sector: number } }> = [];
        const r = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [w], store, lock, notifyUnfed: async (a) => { notices.push(a); } });
        assert.deepEqual(r.unfedWars, [w.id]);
        assert.equal(r.mercsSkipped, 1);
        const stamped = store.m.get(sectorWarKey(w.id)) as Record<string, unknown>;
        assert.equal(stamped.fed, false);
        assert.deepEqual(stamped.unfedVillages, [MOON, FROST], 'the other side\'s same-day verdict is kept');
        const rec = store.m.get(WAR) as VillageWarRecord;
        assert.equal(rec.mercLeases[0].skipNextAutoDeploy, true);
        assert.equal(notices.length, 1);
        assert.equal(notices[0].kage, 'frostkage');
        assert.equal(notices[0].war.sector, 26);
        // The auto-deploy tick clears the skip exactly once.
        const cleared = clearMercSkipInRecord(rec, 'merc-ronin', 'hirer');
        assert.equal('skipNextAutoDeploy' in cleared.mercLeases[0], false);
    });

    it('a fed village clears its own stale unfed mark but the war stays unfed while the other side is', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 500 } });
        store.m.set(WAR, defaultVillageWarRecord(FROST));
        const w = war('x', { storesDate: TODAY, unfedVillages: [MOON, FROST], fed: false });
        store.m.set(sectorWarKey(w.id), w);
        await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [w], store, lock, notifyUnfed: async () => {} });
        const stamped = store.m.get(sectorWarKey(w.id)) as Record<string, unknown>;
        assert.deepEqual(stamped.unfedVillages, [MOON]);
        assert.equal(stamped.fed, false);
    });

    const feedRow = (store: ReturnType<typeof memStore>, id: string) => (store.m.get(sectorWarKey(id)) as { garrisonFeed?: Record<string, { on: boolean; covered: boolean }> }).garrisonFeed;
    it('garrison coverage is stamped only on the entry of the village that turned ITS feed on', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 500 } });
        store.m.set(WAR, defaultVillageWarRecord(FROST));
        const w = war('g', { garrisonFeed: { [FROST]: { on: true, covered: false, updatedAt: NOW, by: 'frostkage' } } });
        store.m.set(sectorWarKey(w.id), w);
        const r = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [w], store, lock, notifyUnfed: async () => {} });
        assert.equal(r.provisions, 500 - 25 - 30 - 15);
        assert.equal(feedRow(store, w.id)?.[FROST].covered, true);
        assert.equal(feedRow(store, w.id)?.[MOON], undefined);
        // The OTHER side's pass must not touch Frostfang's entry (and pays no garrison rations itself).
        store.m.set('game:village-state:moonshadowvillage', { treasury: { provisions: 40 } });
        store.m.set(villageWarKey(MOON), defaultVillageWarRecord(MOON));
        const m = await runVillageStoresStep({ village: MOON, today: TODAY, now: NOW, wars: [w], store, lock, notifyUnfed: async () => {} });
        assert.equal(m.provisions, 40 - 2 - 30, 'war ration only - no garrison charge for a side whose feed is off');
        assert.equal(feedRow(store, w.id)?.[FROST].covered, true);
        assert.equal(feedRow(store, w.id)?.[MOON], undefined);
    });
    it('two fed sides each pay 15 rations and each get their OWN entry covered', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 500 } });
        store.m.set(WAR, defaultVillageWarRecord(FROST));
        store.m.set('game:village-state:moonshadowvillage', { treasury: { provisions: 500 } });
        store.m.set(villageWarKey(MOON), defaultVillageWarRecord(MOON));
        const w = war('two', { garrisonFeed: {
            [FROST]: { on: true, covered: false, updatedAt: NOW, by: 'frostkage' },
            [MOON]: { on: true, covered: false, updatedAt: NOW, by: 'moonkage' },
        } });
        store.m.set(sectorWarKey(w.id), w);
        const f = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [w], store, lock, notifyUnfed: async () => {} });
        assert.equal(f.provisions, 500 - 25 - 30 - 15);
        assert.equal(feedRow(store, w.id)?.[FROST].covered, true);
        assert.equal(feedRow(store, w.id)?.[MOON].covered, false, 'Moonshadow\'s entry waits for Moonshadow\'s own pass');
        const m = await runVillageStoresStep({ village: MOON, today: TODAY, now: NOW, wars: [w], store, lock, notifyUnfed: async () => {} });
        assert.equal(m.provisions, 500 - 25 - 30 - 15);
        assert.equal(feedRow(store, w.id)?.[FROST].covered, true);
        assert.equal(feedRow(store, w.id)?.[MOON].covered, true);
        const frostLedger = (store.m.get(WAR) as VillageWarRecord).storesLedger!.filter((e) => e.kind === 'garrison');
        const moonLedger = (store.m.get(villageWarKey(MOON)) as VillageWarRecord).storesLedger!.filter((e) => e.kind === 'garrison');
        assert.deepEqual([frostLedger.length, moonLedger.length, frostLedger[0].amount + moonLedger[0].amount], [1, 1, 30], '30 rations across the two sides');
    });
    it('a LEGACY single-flag row is charged and migrated to the per-village map by the pass', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 500 } });
        store.m.set(WAR, defaultVillageWarRecord(FROST));
        const w = war('legacy', { garrisonFed: true, garrisonFedBy: FROST });
        store.m.set(sectorWarKey(w.id), w);
        const r = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [w], store, lock, notifyUnfed: async () => {} });
        assert.equal(r.provisions, 500 - 25 - 30 - 15);
        const row = store.m.get(sectorWarKey(w.id)) as Record<string, unknown>;
        assert.equal(feedRow(store, w.id)?.[FROST].covered, true);
        assert.equal('garrisonFed' in row, false, 'legacy trio dropped once migrated');
    });

    it('burns 25% provisions ONCE when a HOME sector flips away (receipt-keyed)', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 400 } });
        store.m.set(WAR, { ...defaultVillageWarRecord(FROST), storesHomeHeld: [...homeSectorsForVillage(FROST)] });
        assert.ok(homeSectorsForVillage(FROST).includes(26));
        store.m.set('world:territory:26', { sector: 26, ownerVillage: MOON }); // lost
        const first = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store, lock, notifyUnfed: async () => {} });
        assert.deepEqual(first.homeLost, [26]);
        // 400 − 100 (home loss) = 300 → spoil 15 → 285
        assert.equal(first.provisions, 285);
        const rec = store.m.get(WAR) as VillageWarRecord;
        assert.equal(rec.storesReceipts![`home-loss:26:${TODAY}`], NOW);
        assert.equal(rec.storesHomeHeld!.includes(26), false);
        assert.equal(rec.storesLedger![0].kind, 'home-loss');
        // Re-running the same day (or a re-fire) is a CLEAN NO-OP: the day
        // receipt on the war record and treasury.storesDate both say it landed,
        // so nothing burns, spoils or converts a second time.
        const second = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store, lock, notifyUnfed: async () => {} });
        assert.deepEqual(second.homeLost, []);
        assert.equal(second.provisions, 285, 'no second spoil');
        assert.equal(second.spoiled, 0);
        assert.equal((store.m.get(STATE) as { treasury: Record<string, number> }).treasury.provisions, 285);
    });

    // ── Partial-write resilience (the two-key commit) ────────────────────────
    // The day debits the village-state row and credits the war record. A failure
    // between the two used to consume the day: converted WR destroyed, and
    // `storesHomeHeld` never persisted, so the NEXT day re-detected the same
    // home flip and burned another 25% for a loss already billed.
    function failingStore(failOn: (key: string, calls: number) => boolean) {
        const store = memStore();
        let calls = 0;
        const set = store.set;
        return Object.assign(store, {
            set: async (k: string, v: unknown) => {
                calls++;
                if (failOn(k, calls)) throw new Error(`KV blip on ${k}`);
                return set(k, v);
            },
        });
    }

    it('a war-record write that fails mid-day is REPLAYED, not lost: the WR lands and the home flip is never billed twice', async () => {
        const store = failingStore((k) => k === WAR);
        store.m.set(STATE, { treasury: { provisions: 400, materialPoints: 200 } });
        store.m.set(WAR, { ...defaultVillageWarRecord(FROST), storesHomeHeld: [...homeSectorsForVillage(FROST)] });
        store.m.set('world:territory:26', { sector: 26, ownerVillage: MOON }); // home sector lost

        await assert.rejects(
            () => runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store, lock, notifyUnfed: async () => {} }),
            /KV blip/,
        );
        // The DEBIT landed (state written first), the CREDIT did not.
        const midState = store.m.get(STATE) as { treasury: Record<string, unknown> };
        assert.equal(midState.treasury.provisions, 285, '400 - 100 home loss - 15 spoil');
        assert.equal(midState.treasury.storesDate, TODAY, 'the state write self-marks the day');
        assert.equal((store.m.get(WAR) as VillageWarRecord).warResources, 0, 'the WR credit is still owed');
        const journal = store.m.get(`war:stores-day:frostfangvillage`) as { date: string; wrGained: number };
        assert.equal(journal.date, TODAY, 'the sealed day survives the failure');
        assert.equal(journal.wrGained, 20, '200 material points -> 20 WR');

        // Next run (same or later day): the journal replays the CREDIT only.
        const healthy = memStore();
        for (const [k, v] of store.m) healthy.m.set(k, v);
        const replay = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store: healthy, lock, notifyUnfed: async () => {} });
        const rec = healthy.m.get(WAR) as VillageWarRecord;
        assert.equal(rec.warResources, 20, 'the converted War Resources are recovered, not destroyed');
        assert.deepEqual(rec.storesHomeHeld!.includes(26), false, 'the home baseline is persisted');
        assert.equal(rec.storesReceipts![`home-loss:26:${TODAY}`], NOW);
        assert.equal((healthy.m.get(STATE) as { treasury: Record<string, number> }).treasury.provisions, 285, 'the debit is NOT applied twice');
        assert.deepEqual(replay.homeLost, [26], 'the sealed verdict is replayed verbatim, not recomputed');
        assert.equal(healthy.m.get('war:stores-day:frostfangvillage') ?? null, null, 'the journal is dropped once fully applied');

        // TOMORROW: the flip is already billed and the baseline is persisted, so
        // the 25% burn does not fire again (only the normal spoilage).
        const tomorrow = await runVillageStoresStep({ village: FROST, today: '2026-08-23', now: NOW + 86_400_000, wars: [], store: healthy, lock, notifyUnfed: async () => {} });
        assert.deepEqual(tomorrow.homeLost, [], 'the same home-sector loss is never burned twice');
        assert.equal(tomorrow.provisions, 285 - 14, 'spoilage only');
    });

    it('the replay applies the debit by DELTA, so a donation banked in the gap survives', async () => {
        const store = failingStore((k) => k === STATE);
        store.m.set(STATE, { treasury: { provisions: 100, materialPoints: 0 } });
        store.m.set(WAR, defaultVillageWarRecord(FROST));
        await assert.rejects(
            () => runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store, lock, notifyUnfed: async () => {} }),
            /KV blip/,
        );
        const healthy = memStore();
        for (const [k, v] of store.m) healthy.m.set(k, v);
        // A cook donates 60 rations before the pass gets another turn.
        healthy.m.set(STATE, { treasury: { provisions: 160, materialPoints: 0 } });
        await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store: healthy, lock, notifyUnfed: async () => {} });
        assert.equal(
            (healthy.m.get(STATE) as { treasury: Record<string, number> }).treasury.provisions,
            155,
            '160 - the sealed 5-provision spoil; the donation is not clobbered by a stale absolute write',
        );
    });

    it('a journal parked from an EARLIER day is drained before today runs', async () => {
        const store = failingStore((k) => k === WAR);
        store.m.set(STATE, { treasury: { provisions: 400, materialPoints: 100 } });
        store.m.set(WAR, { ...defaultVillageWarRecord(FROST), storesHomeHeld: [...homeSectorsForVillage(FROST)] });
        store.m.set('world:territory:26', { sector: 26, ownerVillage: MOON });
        await assert.rejects(
            () => runVillageStoresStep({ village: FROST, today: '2026-08-21', now: NOW - 86_400_000, wars: [], store, lock, notifyUnfed: async () => {} }),
            /KV blip/,
        );
        const healthy = memStore();
        for (const [k, v] of store.m) healthy.m.set(k, v);
        const today = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store: healthy, lock, notifyUnfed: async () => {} });
        assert.deepEqual(today.homeLost, [], 'yesterday\'s flip is not billed a second time today');
        const rec = healthy.m.get(WAR) as VillageWarRecord;
        assert.equal(rec.warResources, 10, 'yesterday\'s conversion is recovered');
        assert.equal(rec.storesReceipts![`home-loss:26:2026-08-21`], NOW - 86_400_000);
    });

    it('an unseeded territory table reads as home-held (no phantom loss on first run)', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 100 } });
        const r = await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store, lock, notifyUnfed: async () => {} });
        assert.deepEqual(r.homeLost, []);
        assert.equal(r.provisions, 95);
    });
});

describe('runClanStoresDailyPass (clan mirror)', () => {
    it('burns 30/day per clan in an active war, marks the unfed clan, and is idempotent per day', async () => {
        const store = memStore();
        store.m.set('save:clan-alpha', { treasury: { provisions: 50, ryo: 7 } });
        store.m.set('save:clan-beta', { treasury: { provisions: 10 } });
        store.m.set('clan-war:alpha-vs-beta', { id: 'alpha-vs-beta', clans: ['Alpha', 'Beta'] });
        const wars = [{ id: 'alpha-vs-beta', clans: ['Alpha', 'Beta'] as [string, string] }];
        const r = await runClanStoresDailyPass({ today: TODAY, now: NOW, wars, warKeyOf: () => 'clan-war:alpha-vs-beta', store, lock });
        assert.equal(r.processed, 1);
        assert.deepEqual(r.unfed, ['alpha-vs-beta:Beta']);
        const alphaTreasury = (store.m.get('save:clan-alpha') as { treasury: Record<string, unknown> }).treasury;
        assert.equal(alphaTreasury.provisions, 20);
        assert.equal(alphaTreasury.ryo, 7, 'other treasury fields preserved');
        assert.deepEqual(
            alphaTreasury.storesReceipts,
            { [`alpha-vs-beta:Alpha:${TODAY}`]: { at: NOW, fed: true } },
            'the debit and its per-(war, clan, day) receipt land in one write',
        );
        const betaTreasury = (store.m.get('save:clan-beta') as { treasury: Record<string, unknown> }).treasury;
        assert.equal(betaTreasury.provisions, 10, 'too poor to feed - nothing debited');
        assert.deepEqual(betaTreasury.storesReceipts, { [`alpha-vs-beta:Beta:${TODAY}`]: { at: NOW, fed: false } });
        const row = store.m.get('clan-war:alpha-vs-beta') as Record<string, unknown>;
        assert.deepEqual(row.storesFed, { Alpha: true, Beta: false });
        assert.equal(row.storesDate, TODAY);
        const again = await runClanStoresDailyPass({ today: TODAY, now: NOW, wars, warKeyOf: () => 'clan-war:alpha-vs-beta', store, lock });
        assert.equal(again.processed, 0);
        assert.equal((store.m.get('save:clan-alpha') as { treasury: { provisions: number } }).treasury.provisions, 20);
    });
    it('skips ended wars', async () => {
        const store = memStore();
        const r = await runClanStoresDailyPass({ today: TODAY, now: NOW, wars: [{ id: 'x', clans: ['A', 'B'], endedAt: 1 }], warKeyOf: () => 'clan-war:x', store, lock });
        assert.equal(r.processed, 0);
    });
    it('a clan that already paid is never charged twice when the war-row stamp fails', async () => {
        // Clan A is debited under its own lock BEFORE the row is stamped; if the
        // second clan (or the row write) blows up, the outer catch logs and moves
        // on. Without the receipt, tomorrow charged BOTH clans again.
        const store = memStore();
        const set = store.set;
        let failBeta = true;
        store.set = async (k: string, v: unknown) => {
            if (failBeta && k === 'save:clan-beta') throw new Error('clan lock blew up');
            return set(k, v);
        };
        store.m.set('save:clan-alpha', { treasury: { provisions: 50 } });
        store.m.set('save:clan-beta', { treasury: { provisions: 90 } });
        store.m.set('clan-war:alpha-vs-beta', { id: 'alpha-vs-beta', clans: ['Alpha', 'Beta'] });
        const wars = [{ id: 'alpha-vs-beta', clans: ['Alpha', 'Beta'] as [string, string] }];
        const args = { today: TODAY, now: NOW, wars, warKeyOf: () => 'clan-war:alpha-vs-beta', store, lock };

        const first = await runClanStoresDailyPass(args);
        assert.equal(first.processed, 0, 'the day was never recorded');
        assert.equal((store.m.get('save:clan-alpha') as { treasury: { provisions: number } }).treasury.provisions, 20, 'Alpha paid');
        assert.equal((store.m.get('clan-war:alpha-vs-beta') as Record<string, unknown>).storesDate, undefined);

        // The retry: Alpha's receipt short-circuits its debit, Beta pays once.
        failBeta = false;
        const second = await runClanStoresDailyPass(args);
        assert.equal(second.processed, 1);
        assert.equal((store.m.get('save:clan-alpha') as { treasury: { provisions: number } }).treasury.provisions, 20, 'Alpha is NOT charged for the same day again');
        assert.equal((store.m.get('save:clan-beta') as { treasury: { provisions: number } }).treasury.provisions, 60, 'Beta pays exactly once');
        const row = store.m.get('clan-war:alpha-vs-beta') as Record<string, unknown>;
        assert.deepEqual(row.storesFed, { Alpha: true, Beta: true }, 'Alpha\'s sealed verdict is replayed from its receipt');
        assert.equal(row.storesDate, TODAY);
    });
});

describe('runVillageWarDailyPass — stores integration + kill switch', () => {
    it('runs the stores step for each village on a fresh day and stays idempotent', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 100, materialPoints: 50 } });
        store.m.set('game:village-state:moonshadowvillage', { treasury: { provisions: 100 } });
        const w = war('26:moonshadowvillage-vs-frostfangvillage');
        store.m.set(sectorWarKey(w.id), w);
        const r = await runVillageWarDailyPass({
            store, lock, now: NOW, enabled: true, storesEnabled: true,
            sweepSectorWars: async () => [], listSectorWars: async () => [w], listClanWars: async () => [], notifyUnfed: async () => {},
        });
        assert.equal(r.ran, 4);
        const state = store.m.get(STATE) as { treasury: Record<string, number> };
        assert.equal(state.treasury.provisions, 65);
        assert.equal(state.treasury.materialPoints, 0);
        assert.equal(state.treasury.honorSeals, 8, 'seal accrual untouched');
        const rec = store.m.get(WAR) as VillageWarRecord;
        assert.equal(rec.warResources, 205, '8 sectors × 25 + 5 converted');
        assert.equal((store.m.get(sectorWarKey(w.id)) as Record<string, unknown>).fed, true);
        // Same-day re-run: no second burn.
        await runVillageWarDailyPass({ store, lock, now: NOW, enabled: true, storesEnabled: true, sweepSectorWars: async () => [], listSectorWars: async () => [w], listClanWars: async () => [], notifyUnfed: async () => {} });
        assert.equal((store.m.get(STATE) as { treasury: Record<string, number> }).treasury.provisions, 65);
    });

    it('with the kill switch off the pass never touches provisions, materials, or the war', async () => {
        const store = memStore();
        store.m.set(STATE, { treasury: { provisions: 100, materialPoints: 50 } });
        const w = war('26:moonshadowvillage-vs-frostfangvillage');
        store.m.set(sectorWarKey(w.id), w);
        const r = await runVillageWarDailyPass({
            store, lock, now: NOW, enabled: true, storesEnabled: false,
            sweepSectorWars: async () => [], listSectorWars: async () => { throw new Error('must not scan'); }, listClanWars: async () => { throw new Error('must not scan'); },
        });
        assert.equal(r.ran, 4);
        const state = store.m.get(STATE) as { treasury: Record<string, number> };
        assert.equal(state.treasury.provisions, 100);
        assert.equal(state.treasury.materialPoints, 50);
        assert.equal((store.m.get(sectorWarKey(w.id)) as Record<string, unknown>).fed, undefined);
        assert.equal((store.m.get(WAR) as VillageWarRecord).storesLedger, undefined);
    });
});

describe('stores receipts stay bounded', () => {
    it('the day/home-loss receipt ledger is trimmed to the newest STORES_RECEIPT_CAP', async () => {
        const store = memStore();
        const old: Record<string, number> = {};
        for (let i = 0; i < STORES_RECEIPT_CAP + 20; i++) old[`stores-day:old-${i}`] = 1_000 + i;
        store.m.set(STATE, { treasury: { provisions: 100 } });
        store.m.set(WAR, { ...defaultVillageWarRecord(FROST), storesReceipts: old });
        await runVillageStoresStep({ village: FROST, today: TODAY, now: NOW, wars: [], store, lock, notifyUnfed: async () => {} });
        const receipts = (store.m.get(WAR) as VillageWarRecord).storesReceipts!;
        assert.equal(Object.keys(receipts).length, STORES_RECEIPT_CAP, 'a daily row can no longer grow the record forever');
        assert.equal(receipts[`stores-day:${TODAY}`], NOW, 'today\'s receipt always survives the trim');
        assert.equal(receipts['stores-day:old-0'], undefined, 'the oldest rows fall off first');
    });
});
