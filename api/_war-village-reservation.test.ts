import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv, type KvLike } from './_storage.js';
import {
    abortWarDeclarationFunding,
    reserveWarDeclarationFunding,
    settleReservedWarDeclarationFunding,
    warDeclarationFundingFingerprint,
    type WarDeclarationFundingPlan,
    type WarDeclarationFundingSource,
} from './_war-declaration-funding.js';
import {
    allocateVillageWarDeclarationGeneration,
    claimVillageWarReservations,
    releaseVillageWarReservations,
    reserveClaimedVillageWarReservations,
    villageWarGenerationKey,
    villageWarReservationBlocks,
    villageWarReservationFromRow,
    villageWarReservationKey,
    type VillageWarReservationPlan,
} from './_war-village-reservation.js';

const NOW = 1_800_000_000_000;
const WR_KEY = 'shared:village-war:leaf';

type WarRow = Record<string, unknown> & {
    id: string;
    villages: [string, string];
    startedAt: number;
};

function declaration(
    pairId: string,
    villages: [string, string],
    generation: number,
    ownerId: string,
    source: WarDeclarationFundingSource = {
        kind: 'war-resources',
        recordKey: WR_KEY,
        accountId: villages[0],
        amount: 200,
    },
): { reservation: VillageWarReservationPlan; funding: WarDeclarationFundingPlan<WarRow> } {
    const warKey = `world:war:${pairId}`;
    const declarationId = `v2:${pairId}:g${generation}`;
    const war: WarRow = {
        id: pairId,
        villages,
        hp: { [villages[0]]: 5_000, [villages[1]]: 5_000 },
        warGroundSector: 40,
        warGroundHp: 1_000,
        startedAt: NOW,
        updatedAt: NOW,
        pendingUntil: NOW + 3_600_000,
        declarationGeneration: generation,
        declaredBy: 'kage',
    };
    const fingerprint = warDeclarationFundingFingerprint({ declarationId, pairId, villages: [...villages].sort(), source });
    return {
        reservation: {
            pairId,
            warKey,
            villages,
            generation,
            declarationId,
            fingerprint,
            source,
            ownerId,
            now: NOW,
            leaseMs: 10_000,
        },
        funding: {
            warKey,
            declarationId,
            fingerprint,
            war,
            source,
            ownerId,
            now: NOW,
            leaseMs: 10_000,
        },
    };
}

describe('village-war reservations: durable cross-pair exclusion', { concurrency: false }, () => {
    it('blocks A-C after A-B owns both durable village reservations', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const ab = declaration('leaf-vs-mist', ['Leaf', 'Mist'], 1, 'owner-ab');

        const claims = await claimVillageWarReservations(store, ab.reservation);
        assert.equal(claims.status, 'acquired');
        const funding = await reserveWarDeclarationFunding(store, ab.funding);
        assert.equal(funding.status, 'acquired');
        if (funding.status !== 'acquired') return;
        const promoted = await reserveClaimedVillageWarReservations(store, ab.reservation);
        assert.equal(promoted.status, 'reserved');

        const ac = declaration('leaf-vs-sand', ['Leaf', 'Sand'], 1, 'owner-ac');
        const conflict = await claimVillageWarReservations(store, ac.reservation);
        assert.equal(conflict.status, 'blocked');
        if (conflict.status === 'blocked') assert.equal(conflict.village, 'Leaf');
        assert.equal(await store.get(villageWarReservationKey('Sand')), null, 'partial claims are rolled back/released');

        const active = await settleReservedWarDeclarationFunding(store, ab.funding, funding);
        assert.equal(active.status, 'active');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);
        assert.equal(await villageWarReservationBlocks(store, 'Leaf', NOW + 1), true);
    });

    it('fences a paused old pair after lease takeover before allowing any debit', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const ab = declaration('leaf-vs-mist', ['Leaf', 'Mist'], 1, 'owner-old');
        ab.reservation.leaseMs = 10;
        ab.funding.leaseMs = 10;
        assert.equal((await claimVillageWarReservations(store, ab.reservation)).status, 'acquired');

        const ac = declaration('leaf-vs-sand', ['Leaf', 'Sand'], 1, 'owner-new');
        ac.reservation.now = NOW + 10;
        ac.funding.now = NOW + 10;
        assert.equal((await claimVillageWarReservations(store, ac.reservation)).status, 'acquired');

        // The stale process resumes and can publish only its non-playable pair
        // row. It cannot promote both village fences, so no source intent/debit
        // may follow.
        const oldFunding = await reserveWarDeclarationFunding(store, ab.funding);
        assert.equal(oldFunding.status, 'acquired');
        if (oldFunding.status !== 'acquired') return;
        const oldPromotion = await reserveClaimedVillageWarReservations(store, ab.reservation);
        assert.equal(oldPromotion.status, 'conflict');
        const aborted = await abortWarDeclarationFunding(
            store,
            ab.funding.warKey,
            oldFunding.row,
            'source-fenced',
            NOW + 11,
        );
        assert.equal(aborted.status, 'aborted');
        await releaseVillageWarReservations(store, ab.reservation, 'funding-conflict', NOW + 11);
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 900);
        assert.equal(villageWarReservationFromRow(await store.get(villageWarReservationKey('Mist')))?.state, 'released');
        assert.equal(villageWarReservationFromRow(await store.get(villageWarReservationKey('Leaf')))?.pairId, 'leaf-vs-sand');
    });

    it('replaces an ended pointer, but never an orphaned pointer backed by a committed debit', async () => {
        const endedStore = _makeMemoryKv();
        await endedStore.set(WR_KEY, { warResources: 900 });
        const ab = declaration('leaf-vs-mist', ['Leaf', 'Mist'], 1, 'owner-ab');
        await claimVillageWarReservations(endedStore, ab.reservation);
        const funding = await reserveWarDeclarationFunding(endedStore, ab.funding);
        assert.equal(funding.status, 'acquired');
        if (funding.status !== 'acquired') return;
        await reserveClaimedVillageWarReservations(endedStore, ab.reservation);
        const active = await settleReservedWarDeclarationFunding(endedStore, ab.funding, funding);
        assert.equal(active.status, 'active');
        if (active.status !== 'active') return;
        await endedStore.set(ab.funding.warKey, { ...active.row, endedAt: NOW + 1 });
        const ac = declaration('leaf-vs-sand', ['Leaf', 'Sand'], 1, 'owner-ac');
        ac.reservation.now = NOW + 2;
        assert.equal((await claimVillageWarReservations(endedStore, ac.reservation)).status, 'acquired');

        const orphanStore = _makeMemoryKv();
        await orphanStore.set(WR_KEY, { warResources: 900 });
        const orphan = declaration('leaf-vs-mist', ['Leaf', 'Mist'], 1, 'owner-orphan');
        await claimVillageWarReservations(orphanStore, orphan.reservation);
        const orphanFunding = await reserveWarDeclarationFunding(orphanStore, orphan.funding);
        assert.equal(orphanFunding.status, 'acquired');
        if (orphanFunding.status !== 'acquired') return;
        await reserveClaimedVillageWarReservations(orphanStore, orphan.reservation);
        assert.equal((await settleReservedWarDeclarationFunding(orphanStore, orphan.funding, orphanFunding)).status, 'active');
        await orphanStore.del(orphan.funding.warKey); // deterministic model of a lost/corrupt pair row
        const blocked = await claimVillageWarReservations(orphanStore, declaration('leaf-vs-sand', ['Leaf', 'Sand'], 1, 'other').reservation);
        assert.equal(blocked.status, 'blocked', 'a permanent committed source proof fails closed');
    });

    it('recovers an aborted pointer after its bounded pair-row tombstone expires', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 100 });
        const ab = declaration('leaf-vs-mist', ['Leaf', 'Mist'], 1, 'owner-ab');
        await claimVillageWarReservations(store, ab.reservation);
        const funding = await reserveWarDeclarationFunding(store, ab.funding);
        assert.equal(funding.status, 'acquired');
        if (funding.status !== 'acquired') return;
        await reserveClaimedVillageWarReservations(store, ab.reservation);
        const insufficient = await settleReservedWarDeclarationFunding(store, ab.funding, funding);
        assert.equal(insufficient.status, 'insufficient');
        await store.del(ab.funding.warKey); // bounded abort tombstone expires before release

        const ac = declaration('leaf-vs-sand', ['Leaf', 'Sand'], 1, 'owner-ac');
        ac.reservation.now = NOW + 301_000;
        assert.equal((await claimVillageWarReservations(store, ac.reservation)).status, 'acquired');
        assert.equal(villageWarReservationFromRow(await store.get(villageWarReservationKey('Leaf')))?.pairId, 'leaf-vs-sand');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 100);
    });

    it('keeps permanent abort authority when a missing or invalid source cannot carry the fence', async () => {
        const cases: Array<{
            name: string;
            source: WarDeclarationFundingSource;
            seed?: Record<string, unknown>;
            error: RegExp;
        }> = [
            {
                name: 'missing',
                source: { kind: 'war-resources', recordKey: 'shared:village-war:missing', accountId: 'Leaf', amount: 200 },
                error: /account-missing/,
            },
            {
                name: 'invalid-holder',
                source: { kind: 'honor-seals', recordKey: 'save:invalid-kage', accountId: 'invalid-kage', amount: 500 },
                seed: { _saveVersion: 1 },
                error: /account-invalid/,
            },
        ];
        for (const testCase of cases) {
            const store = _makeMemoryKv();
            if (testCase.seed) await store.set(testCase.source.recordKey, testCase.seed);
            const ab = declaration(`leaf-vs-mist-${testCase.name}`, ['Leaf', 'Mist'], 1, `owner-${testCase.name}`, testCase.source);
            // The production pair ids are canonical; keep test keys canonical
            // while varying only the source/fingerprint.
            ab.reservation.pairId = 'leaf-vs-mist';
            ab.reservation.warKey = `world:war:leaf-vs-mist-${testCase.name}`;
            ab.funding.warKey = ab.reservation.warKey;
            assert.equal((await claimVillageWarReservations(store, ab.reservation)).status, 'acquired');
            const funding = await reserveWarDeclarationFunding(store, ab.funding);
            assert.equal(funding.status, 'acquired');
            if (funding.status !== 'acquired') continue;
            assert.equal((await reserveClaimedVillageWarReservations(store, ab.reservation)).status, 'reserved');
            await assert.rejects(
                settleReservedWarDeclarationFunding(store, ab.funding, funding),
                testCase.error,
            );

            // Crash here: no finally-release. The pair abort row is permanent
            // because no exact source-side abort could be co-written.
            const aborted = await store.get<Record<string, unknown>>(ab.funding.warKey);
            assert.equal((aborted?.declarationFunding as Record<string, unknown>)?.status, 'aborted');
            const ac = declaration('leaf-vs-sand', ['Leaf', 'Sand'], 1, `replacement-${testCase.name}`);
            ac.reservation.now = NOW + 301_000;
            assert.equal((await claimVillageWarReservations(store, ac.reservation)).status, 'acquired');
        }
    });

    it('serializes the paused sector-publication interleave through the same village rows', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const village = declaration('leaf-vs-mist', ['Leaf', 'Mist'], 1, 'village-owner');
        const sectorDeclarationId = 'sector:40:leaf-vs-mist';
        const sectorFingerprint = warDeclarationFundingFingerprint({
            declarationId: sectorDeclarationId,
            sector: 40,
            villages: ['Leaf', 'Mist'],
        });
        const sectorPlan: VillageWarReservationPlan = {
            ...village.reservation,
            warKey: 'shared:sector-war:40:leaf-vs-mist',
            generation: 40,
            declarationId: sectorDeclarationId,
            fingerprint: sectorFingerprint,
            ownerId: 'sector-owner',
        };

        // Sector route has passed its old precheck and pauses immediately before
        // publication while holding these exact temporary claims.
        assert.equal((await claimVillageWarReservations(store, sectorPlan)).status, 'acquired');
        const villageDuringPause = await claimVillageWarReservations(store, village.reservation);
        assert.equal(villageDuringPause.status, 'blocked');
        assert.equal(await store.get(village.funding.warKey), null, 'blocked village route cannot publish or debit');

        // Once sector publication is durable it becomes the scan authority and
        // the temporary rows can be released without an admission gap.
        await store.set(sectorPlan.warKey, {
            id: '40:leaf-vs-mist',
            attackerVillage: 'Leaf',
            defenderVillage: 'Mist',
            startedAt: NOW,
            endsAt: NOW + 72 * 60 * 60 * 1_000,
            flipped: false,
        });
        assert.equal(
            await releaseVillageWarReservations(store, sectorPlan, 'sector-published', NOW + 1),
            2,
        );

        // Reverse ordering: a permanent village claim wins before sector
        // admission, so the sector route is the one that fails before publish.
        const reverseStore = _makeMemoryKv();
        await reverseStore.set(WR_KEY, { warResources: 900 });
        assert.equal((await claimVillageWarReservations(reverseStore, village.reservation)).status, 'acquired');
        assert.equal((await claimVillageWarReservations(reverseStore, sectorPlan)).status, 'blocked');
        assert.equal(await reverseStore.get(sectorPlan.warKey), null);
    });
});

describe('village-war generations: permanent pair identity', { concurrency: false }, () => {
    it('allocates monotonically, honors a migrated floor, and recovers a lost acknowledgement', async () => {
        const base = _makeMemoryKv();
        let loseAck = true;
        const store: Pick<KvLike, 'get' | 'compareSet'> = {
            get: base.get.bind(base),
            compareSet: async (key, expected, value, options) => {
                const committed = await base.compareSet(key, expected, value, options);
                if (committed && loseAck) {
                    loseAck = false;
                    throw new Error('lost-generation-ack');
                }
                return committed;
            },
        };
        const first = await allocateVillageWarDeclarationGeneration(store, 'leaf-vs-mist', 1, NOW);
        assert.deepEqual(first, {
            version: 1,
            pairId: 'leaf-vs-mist',
            generation: 1,
            declarationId: 'v2:leaf-vs-mist:g1',
            allocatedAt: NOW,
        });
        const migrated = await allocateVillageWarDeclarationGeneration(store, 'leaf-vs-mist', 5, NOW + 1);
        assert.equal(migrated.generation, 5);
        assert.equal(migrated.declarationId, 'v2:leaf-vs-mist:g5');
        const next = await allocateVillageWarDeclarationGeneration(store, 'leaf-vs-mist', 1, NOW + 2);
        assert.equal(next.generation, 6);
        assert.deepEqual(await base.get(villageWarGenerationKey('leaf-vs-mist')), next);
    });
});
