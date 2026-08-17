import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv, type KvLike } from './_storage.js';
import { normalizeVillageWarRecord } from './_war-state.js';
import {
    isSectorWarActive,
    newSectorWarSession,
    normalizeSectorWarSession,
    sectorWarKey,
} from './_sector-war.js';
import { settleReservedSectorWarDeclarationFunding } from './_sector-war-declaration-funding.js';
import {
    WAR_DECLARATION_FUNDING_FIELD,
    WAR_DECLARATION_FUNDING_RECEIPTS_FIELD,
    abortWarDeclarationFunding,
    activateWarDeclarationFunding,
    debitWarDeclarationFunding,
    fundAndActivateWarDeclaration,
    reserveWarDeclarationFunding,
    warDeclarationFundingFingerprint,
    type WarDeclarationFundingPlan,
} from './_war-declaration-funding.js';

type WarRow = {
    id: string;
    villages: [string, string];
    hp: Record<string, number>;
    startedAt: number;
    pendingUntil: number;
};

const WAR_KEY = 'world:war:leaf-vs-mist:declaration-7';
const WR_KEY = 'shared:village-war:leaf';
const SAVE_KEY = 'save:kage';
const NOW = 1_800_000_000_000;
const WAR: WarRow = {
    id: 'leaf-vs-mist:declaration-7',
    villages: ['Leaf', 'Mist'],
    hp: { Leaf: 5_000, Mist: 5_000 },
    startedAt: NOW,
    pendingUntil: NOW + 3_600_000,
};

function plan(
    kind: 'war-resources' | 'honor-seals' = 'war-resources',
    overrides: Partial<WarDeclarationFundingPlan<WarRow>> = {},
): WarDeclarationFundingPlan<WarRow> {
    const source = kind === 'war-resources'
        ? { kind, recordKey: WR_KEY, accountId: 'Leaf', amount: 200 } as const
        : { kind, recordKey: SAVE_KEY, accountId: 'kage', amount: 500 } as const;
    const declarationId = 'declaration-7';
    return {
        warKey: WAR_KEY,
        declarationId,
        fingerprint: warDeclarationFundingFingerprint({ declarationId, warId: WAR.id, villages: WAR.villages, source }),
        war: WAR,
        source,
        ownerId: 'owner-a',
        now: NOW,
        leaseMs: 10_000,
        ...overrides,
    };
}

function markerOf(row: Record<string, unknown> | null): Record<string, unknown> {
    assert.ok(row);
    const marker = row[WAR_DECLARATION_FUNDING_FIELD];
    assert.ok(marker && typeof marker === 'object' && !Array.isArray(marker));
    return marker as Record<string, unknown>;
}

function receiptsOf(holder: Record<string, unknown>): Record<string, unknown> {
    const receipts = holder[WAR_DECLARATION_FUNDING_RECEIPTS_FIELD];
    assert.ok(receipts && typeof receipts === 'object' && !Array.isArray(receipts));
    return receipts as Record<string, unknown>;
}

describe('war declaration funding: row-first exact-once saga', { concurrency: false }, () => {
    it('publishes funding first, co-writes the WR receipt with the debit, activates, and replays once', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900, structures: {}, unrelated: 'preserved' });
        const request = plan();

        const first = await fundAndActivateWarDeclaration(store, request);
        assert.equal(first.status, 'active');
        if (first.status !== 'active') return;
        assert.equal(first.replayed, false);
        assert.equal(markerOf(first.row).status, 'active');
        const funded = await store.get<Record<string, unknown>>(WR_KEY);
        assert.equal(funded?.warResources, 700);
        assert.equal(funded?.unrelated, 'preserved');
        assert.equal(Object.keys(receiptsOf(funded!)).length, 1);

        const replay = await fundAndActivateWarDeclaration(store, {
            ...request,
            ownerId: 'owner-retry',
            now: NOW + 60_000,
        });
        assert.equal(replay.status, 'active');
        if (replay.status !== 'active') return;
        assert.equal(replay.replayed, true);
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);
        assert.equal(Object.keys(receiptsOf((await store.get<Record<string, unknown>>(WR_KEY))!)).length, 1);
    });

    it('commits an exact no-debit WR receipt when the comeback discount makes the cost zero', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 0, unrelated: 'preserved' });
        const source = { kind: 'war-resources', recordKey: WR_KEY, accountId: 'Leaf', amount: 0 } as const;
        const request = plan('war-resources', {
            source,
            fingerprint: warDeclarationFundingFingerprint({
                declarationId: 'declaration-7',
                warId: WAR.id,
                villages: WAR.villages,
                source,
            }),
        });

        const result = await fundAndActivateWarDeclaration(store, request);
        assert.equal(result.status, 'active');
        if (result.status !== 'active') return;
        assert.equal(result.receipt.amount, 0);
        assert.equal(result.receipt.balanceBefore, 0);
        assert.equal(result.receipt.balanceAfter, 0);
        const sourceRow = await store.get<Record<string, unknown>>(WR_KEY);
        assert.equal(sourceRow?.warResources, 0);
        assert.equal(sourceRow?.unrelated, 'preserved');
        assert.equal((receiptsOf(sourceRow!)[request.fingerprint] as Record<string, unknown>).state, 'committed');

        const replay = await fundAndActivateWarDeclaration(store, {
            ...request,
            ownerId: 'owner-zero-retry',
            now: NOW + 60_000,
        });
        assert.equal(replay.status, 'active');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 0);
        assert.equal(Object.keys(receiptsOf((await store.get<Record<string, unknown>>(WR_KEY))!)).length, 1);
    });

    it('co-writes an Honor receipt in the versioned character save and never double-debits it', async () => {
        const store = _makeMemoryKv();
        await store.set(SAVE_KEY, {
            _saveVersion: 4,
            _saveAt: NOW - 100,
            character: { name: 'Kage', village: 'Leaf', honorSeals: 800 },
        });
        const request = plan('honor-seals');

        const first = await fundAndActivateWarDeclaration(store, request);
        assert.equal(first.status, 'active');
        const save = await store.get<Record<string, unknown>>(SAVE_KEY);
        const character = save?.character as Record<string, unknown>;
        assert.equal(character.honorSeals, 300);
        assert.equal(save?._saveVersion, 6, 'source intent and committed debit are separately versioned');
        assert.equal(Object.keys(receiptsOf(character)).length, 1);
        const ledger = await store.get<{ saveVersion: number; balances: Record<string, number> }>('ledger:currency:kage');
        assert.equal(ledger?.saveVersion, 6);
        assert.equal(ledger?.balances.honorSeals, 300);

        const replay = await fundAndActivateWarDeclaration(store, { ...request, ownerId: 'owner-b', now: NOW + 20_000 });
        assert.equal(replay.status, 'active');
        const finalSave = await store.get<Record<string, unknown>>(SAVE_KEY);
        assert.equal((finalSave?.character as Record<string, unknown>).honorSeals, 300);
        assert.equal(finalSave?._saveVersion, 6, 'a replay does not manufacture another save mutation');
    });

    it('recovers exact publish, debit, and activation writes whose acknowledgements were lost', async () => {
        const base = _makeMemoryKv();
        await base.set(WR_KEY, { warResources: 900 });
        let warWrites = 0;
        let debitWrites = 0;
        const store: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: base.get.bind(base),
            set: base.set.bind(base),
            compareSet: async (key, expected, value, options) => {
                const committed = await base.compareSet(key, expected, value, options);
                if (committed && key === WAR_KEY && ++warWrites <= 2) throw new Error(`lost-war-ack-${warWrites}`);
                if (committed && key === WR_KEY && ++debitWrites <= 2) throw new Error(`lost-source-ack-${debitWrites}`);
                return committed;
            },
        };

        const result = await fundAndActivateWarDeclaration(store, plan());
        assert.equal(result.status, 'active');
        assert.equal(markerOf(await base.get<Record<string, unknown>>(WAR_KEY)).status, 'active');
        const funded = await base.get<Record<string, unknown>>(WR_KEY);
        assert.equal(funded?.warResources, 700);
        assert.equal(Object.keys(receiptsOf(funded!)).length, 1);
        assert.equal(warWrites, 2);
        assert.equal(debitWrites, 2, 'source intent and debit each exact-CAS once');
    });

    it('recomputes the debit after an exact-CAS conflict without erasing the concurrent source update', async () => {
        const base = _makeMemoryKv();
        await base.set(WR_KEY, { warResources: 900, revision: 1 });
        let injected = false;
        const store: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: base.get.bind(base),
            set: base.set.bind(base),
            compareSet: async (key, expected, value, options) => {
                if (key === WR_KEY && !injected) {
                    injected = true;
                    await base.set(WR_KEY, { warResources: 850, revision: 2 });
                    return false;
                }
                return base.compareSet(key, expected, value, options);
            },
        };

        const result = await fundAndActivateWarDeclaration(store, plan());
        assert.equal(result.status, 'active');
        const funded = await base.get<Record<string, unknown>>(WR_KEY);
        assert.equal(funded?.warResources, 650);
        assert.equal(funded?.revision, 2);
        assert.equal(Object.keys(receiptsOf(funded!)).length, 1);
    });

    it('recovers deterministically after a crash following row publication and fences the expired owner', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const ownerA = plan('war-resources', { leaseMs: 10 });
        const reservedA = await reserveWarDeclarationFunding(store, ownerA);
        assert.equal(reservedA.status, 'acquired');
        if (reservedA.status !== 'acquired') return;

        const beforeExpiry = await reserveWarDeclarationFunding(store, {
            ...ownerA,
            ownerId: 'owner-b',
            now: NOW + 9,
        });
        assert.equal(beforeExpiry.status, 'busy');

        const ownerB = { ...ownerA, ownerId: 'owner-b', now: NOW + 10 };
        const reservedB = await reserveWarDeclarationFunding(store, ownerB);
        assert.equal(reservedB.status, 'acquired');
        if (reservedB.status !== 'acquired') return;
        assert.equal(markerOf(reservedB.row).ownerId, 'owner-b');

        const staleDebit = await debitWarDeclarationFunding(store, WAR_KEY, reservedA.row, NOW + 10);
        assert.equal(staleDebit.status, 'stale-lease');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 900);

        const debit = await debitWarDeclarationFunding(store, WAR_KEY, reservedB.row, NOW + 10);
        assert.equal(debit.status, 'debited');
        const activation = await activateWarDeclarationFunding(store, WAR_KEY, reservedB.row, NOW + 10);
        assert.equal(activation.status, 'active');
        assert.equal(markerOf(await store.get<Record<string, unknown>>(WAR_KEY)).ownerId, 'owner-b');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);

        const staleActivation = await activateWarDeclarationFunding(store, WAR_KEY, reservedA.row, NOW + 11);
        assert.equal(staleActivation.status, 'active', 'stale owner can only observe the exact active successor');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);
    });

    it('keeps a published sector declaration invisible until exact debit activation and recovers the crash', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const session = {
            ...newSectorWarSession({
                sector: 40,
                attackerVillage: 'Leaf',
                defenderVillage: 'Mist',
                winCondition: 'combat',
                now: NOW,
            }),
            declarationGeneration: 1,
        };
        const declarationId = `sector:${session.id}:g1`;
        const source = { kind: 'war-resources', recordKey: WR_KEY, accountId: 'Leaf', amount: 200 } as const;
        const request: WarDeclarationFundingPlan<Record<string, unknown>> = {
            warKey: sectorWarKey(session.id),
            declarationId,
            fingerprint: warDeclarationFundingFingerprint({
                policyVersion: 2,
                declarationId,
                declarationGeneration: 1,
                contestId: session.id,
                sector: session.sector,
                attackerVillage: session.attackerVillage,
                defenderVillage: session.defenderVillage,
                winCondition: session.winCondition,
                startedAt: session.startedAt,
                endsAt: session.endsAt,
                source,
            }),
            war: session as unknown as Record<string, unknown>,
            expectedWar: null,
            source,
            ownerId: 'sector-owner-a',
            now: NOW,
            leaseMs: 10,
        };

        const published = await reserveWarDeclarationFunding(store, request);
        assert.equal(published.status, 'acquired');
        if (published.status !== 'acquired') return;
        const hidden = normalizeSectorWarSession(published.row);
        assert.ok(hidden);
        assert.equal(hidden.declarationFunding?.status, 'funding');
        assert.equal(isSectorWarActive(hidden, NOW), false, 'unpaid row-first publication is not a live contest');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 900);

        // Process A dies immediately after publication. The expired owner is
        // fenced, process B debits exactly once, and activation is the only
        // transition that makes the contest playable.
        const ownerB = { ...request, ownerId: 'sector-owner-b', now: NOW + 10 };
        const takenOver = await reserveWarDeclarationFunding(store, ownerB);
        assert.equal(takenOver.status, 'acquired');
        if (takenOver.status !== 'acquired') return;
        const debit = await debitWarDeclarationFunding(store, request.warKey, takenOver.row, ownerB.now);
        assert.equal(debit.status, 'debited');
        const stillHidden = normalizeSectorWarSession(await store.get<Record<string, unknown>>(request.warKey) ?? {});
        assert.ok(stillHidden);
        assert.equal(isSectorWarActive(stillHidden, ownerB.now), false);
        const activated = await activateWarDeclarationFunding(store, request.warKey, takenOver.row, ownerB.now);
        assert.equal(activated.status, 'active');
        const live = normalizeSectorWarSession(await store.get<Record<string, unknown>>(request.warKey) ?? {});
        assert.ok(live);
        assert.equal(isSectorWarActive(live, ownerB.now), true);
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);
        assert.equal(Object.keys(receiptsOf((await store.get<Record<string, unknown>>(WR_KEY))!)).length, 1);
    });

    it('fences a paused sector declaration after its immutable window expires without debiting', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const session = {
            ...newSectorWarSession({
                sector: 40,
                attackerVillage: 'Leaf',
                defenderVillage: 'Mist',
                winCondition: 'combat',
                now: NOW,
            }),
            endsAt: NOW + 10,
            declarationGeneration: 1,
        };
        const declarationId = `sector:${session.id}:g1`;
        const source = { kind: 'war-resources', recordKey: WR_KEY, accountId: 'Leaf', amount: 200 } as const;
        const request: WarDeclarationFundingPlan<Record<string, unknown>> = {
            warKey: sectorWarKey(session.id),
            declarationId,
            fingerprint: warDeclarationFundingFingerprint({ expiredSector: declarationId, source }),
            war: session as unknown as Record<string, unknown>,
            expectedWar: null,
            source,
            ownerId: 'sector-expiry-owner',
            now: NOW,
            leaseMs: 10,
        };
        const published = await reserveWarDeclarationFunding(store, request);
        assert.equal(published.status, 'acquired');
        if (published.status !== 'acquired') return;

        // The process pauses here until the immutable play window has elapsed.
        const expired = await settleReservedSectorWarDeclarationFunding(
            store,
            request,
            published,
            session.endsAt,
            session.endsAt,
        );
        assert.equal(expired.status, 'expired');
        if (expired.status !== 'expired') return;
        assert.equal(expired.activated, false);
        const row = await store.get<Record<string, unknown>>(request.warKey);
        assert.equal(markerOf(row).status, 'aborted');
        assert.equal(markerOf(row).abortReason, 'window-expired');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 900);
        assert.equal((receiptsOf((await store.get<Record<string, unknown>>(WR_KEY))!)[request.fingerprint] as Record<string, unknown>).state, 'aborted');

        const takeover = await reserveWarDeclarationFunding(store, {
            ...request,
            ownerId: 'sector-expiry-takeover',
            now: NOW + 20,
        });
        assert.equal(takeover.status, 'conflict');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 900);
    });

    it('recovers a crash after debit through the embedded receipt, even after lease takeover', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const ownerA = plan('war-resources', { leaseMs: 10 });
        const reservedA = await reserveWarDeclarationFunding(store, ownerA);
        assert.equal(reservedA.status, 'acquired');
        if (reservedA.status !== 'acquired') return;
        const debitA = await debitWarDeclarationFunding(store, WAR_KEY, reservedA.row, NOW);
        assert.equal(debitA.status, 'debited');
        // Process dies here: debit+receipt are durable but the war is still funding.

        const reservedB = await reserveWarDeclarationFunding(store, { ...ownerA, ownerId: 'owner-b', now: NOW + 10 });
        assert.equal(reservedB.status, 'acquired');
        if (reservedB.status !== 'acquired') return;
        const debitB = await debitWarDeclarationFunding(store, WAR_KEY, reservedB.row, NOW + 10);
        assert.equal(debitB.status, 'debited');
        if (debitB.status !== 'debited') return;
        assert.equal(debitB.replayed, true);
        assert.deepEqual(debitB.receipt, debitA.status === 'debited' ? debitA.receipt : null);
        const activation = await activateWarDeclarationFunding(store, WAR_KEY, reservedB.row, NOW + 10);
        assert.equal(activation.status, 'active');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);
        assert.equal(Object.keys(receiptsOf((await store.get<Record<string, unknown>>(WR_KEY))!)).length, 1);
    });

    it('rejects a different declaration fingerprint at the already-reserved war key', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const firstPlan = plan();
        const first = await reserveWarDeclarationFunding(store, firstPlan);
        assert.equal(first.status, 'acquired');
        const conflict = await reserveWarDeclarationFunding(store, {
            ...firstPlan,
            fingerprint: warDeclarationFundingFingerprint({ different: true }),
            ownerId: 'owner-b',
        });
        assert.equal(conflict.status, 'conflict');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 900);
    });

    it('publishes a rematch as the exact funded successor of the complete ended row', async () => {
        const store = _makeMemoryKv();
        const ended = {
            ...WAR,
            endedAt: NOW - 10_000,
            winnerVillage: 'Leaf',
            declarationGeneration: 1,
            unrelatedServerProof: { keptInPredecessorOnly: true },
        };
        await store.set(WAR_KEY, ended);
        await store.set(WR_KEY, { warResources: 900 });
        const successor = {
            ...WAR,
            id: 'leaf-vs-mist',
            startedAt: NOW,
            pendingUntil: NOW + 3_600_000,
            declarationGeneration: 2,
        };
        const declarationId = 'v2:leaf-vs-mist:g2';
        const source = plan().source;
        const request = plan('war-resources', {
            declarationId,
            fingerprint: warDeclarationFundingFingerprint({ declarationId, source, generation: 2 }),
            war: successor,
            expectedWar: ended,
        });

        const result = await fundAndActivateWarDeclaration(store, request);
        assert.equal(result.status, 'active');
        if (result.status !== 'active') return;
        assert.equal((result.row as Record<string, unknown>).declarationGeneration, 2);
        assert.equal((result.row as Record<string, unknown>).endedAt, undefined);
        assert.equal(markerOf(result.row).declarationId, declarationId);
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);

        const stale = await fundAndActivateWarDeclaration(store, {
            ...request,
            declarationId: 'v2:leaf-vs-mist:g3',
            fingerprint: warDeclarationFundingFingerprint({ generation: 3 }),
            ownerId: 'stale-successor',
        });
        assert.equal(stale.status, 'conflict', 'the consumed predecessor cannot publish a second successor');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);
    });

    it('exact-tombstones a fresh insufficient intent instead of blocking the war key forever', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 100 });
        const request = plan();
        const result = await fundAndActivateWarDeclaration(store, request);
        assert.deepEqual(result, { status: 'insufficient', have: 100, cost: 200 });
        const row = await store.get<Record<string, unknown>>(WAR_KEY);
        assert.equal(markerOf(row).status, 'aborted');
        assert.equal(markerOf(row).abortReason, 'insufficient');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 100);
    });

    it('exact-tombstones fresh missing, malformed-account, and invalid-balance failures', async () => {
        const cases: Array<{
            name: string;
            kind: 'war-resources' | 'honor-seals';
            seed?: Record<string, unknown>;
            error: RegExp;
            abortReason: string;
        }> = [
            { name: 'missing', kind: 'war-resources', error: /account-missing/, abortReason: 'account-missing' },
            { name: 'invalid-account', kind: 'honor-seals', seed: { _saveVersion: 1 }, error: /account-invalid/, abortReason: 'account-invalid' },
            { name: 'invalid-balance', kind: 'war-resources', seed: { warResources: 'not-a-balance' }, error: /balance-invalid/, abortReason: 'balance-invalid' },
        ];
        for (const testCase of cases) {
            const store = _makeMemoryKv();
            const request = plan(testCase.kind, {
                warKey: `${WAR_KEY}:${testCase.name}`,
                declarationId: `${plan(testCase.kind).declarationId}:${testCase.name}`,
                fingerprint: warDeclarationFundingFingerprint({ case: testCase.name }),
            });
            if (testCase.seed) await store.set(request.source.recordKey, testCase.seed);
            await assert.rejects(fundAndActivateWarDeclaration(store, request), testCase.error);
            const row = await store.get<Record<string, unknown>>(request.warKey);
            assert.equal(markerOf(row).status, 'aborted');
            assert.equal(markerOf(row).abortReason, testCase.abortReason);
        }
    });

    it('source-fences and aborts an insufficient intent after lease takeover', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 100 });
        const ownerA = plan('war-resources', { leaseMs: 10 });
        const reservedA = await reserveWarDeclarationFunding(store, ownerA);
        assert.equal(reservedA.status, 'acquired');
        const ownerB = { ...ownerA, ownerId: 'owner-b', now: NOW + 10 };
        const result = await fundAndActivateWarDeclaration(store, ownerB);
        assert.deepEqual(result, { status: 'insufficient', have: 100, cost: 200 });
        assert.equal(markerOf(await store.get<Record<string, unknown>>(WAR_KEY)).status, 'aborted');
        assert.equal(markerOf(await store.get<Record<string, unknown>>(WAR_KEY)).takeoverCount, 1);
        const sourceEntry = receiptsOf((await store.get<Record<string, unknown>>(WR_KEY))!)[ownerA.fingerprint] as Record<string, unknown>;
        assert.equal(sourceEntry.state, 'aborted');
    });

    it('an old-owner source abort permanently fences a later lease takeover', async () => {
        const base = _makeMemoryKv();
        await base.set(WR_KEY, { warResources: 900 });
        const ownerA = plan('war-resources', { leaseMs: 10 });
        const reservedA = await reserveWarDeclarationFunding(base, ownerA);
        assert.equal(reservedA.status, 'acquired');
        if (reservedA.status !== 'acquired') return;

        let pairAbortReached!: () => void;
        let releasePairAbort!: () => void;
        const reached = new Promise<void>((resolve) => { pairAbortReached = resolve; });
        const release = new Promise<void>((resolve) => { releasePairAbort = resolve; });
        let paused = false;
        const pauseAfterSourceFence: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: base.get.bind(base),
            set: base.set.bind(base),
            compareSet: async (key, expected, value, options) => {
                const marker = key === WAR_KEY && value && typeof value === 'object'
                    ? (value as Record<string, unknown>)[WAR_DECLARATION_FUNDING_FIELD] as Record<string, unknown> | undefined
                    : undefined;
                if (!paused && marker?.status === 'aborted') {
                    paused = true;
                    pairAbortReached();
                    await release;
                }
                return base.compareSet(key, expected, value, options);
            },
        };
        const abortPromise = abortWarDeclarationFunding(
            pauseAfterSourceFence,
            WAR_KEY,
            reservedA.row,
            'insufficient',
            NOW,
        );
        await reached;
        const sourceWhilePaused = await base.get<Record<string, unknown>>(WR_KEY);
        assert.equal((receiptsOf(sourceWhilePaused!)[ownerA.fingerprint] as Record<string, unknown>).state, 'aborted');
        assert.equal(markerOf(await base.get<Record<string, unknown>>(WAR_KEY)).status, 'funding');

        const ownerB = { ...ownerA, ownerId: 'owner-b', now: NOW + 10 };
        const reservedB = await reserveWarDeclarationFunding(base, ownerB);
        assert.equal(reservedB.status, 'acquired');
        if (reservedB.status !== 'acquired') return;
        const debitB = await debitWarDeclarationFunding(base, WAR_KEY, reservedB.row, NOW + 10);
        assert.equal(debitB.status, 'source-fenced');
        assert.equal((await base.get<Record<string, unknown>>(WR_KEY))?.warResources, 900);

        releasePairAbort();
        const aborted = await abortPromise;
        assert.equal(aborted.status, 'stale-lease');
        assert.equal(markerOf(await base.get<Record<string, unknown>>(WAR_KEY)).ownerId, 'owner-b');
        assert.equal((receiptsOf((await base.get<Record<string, unknown>>(WR_KEY))!)[ownerA.fingerprint] as Record<string, unknown>).state, 'aborted');
    });

    it('never aborts after the exact debit receipt exists', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const reserved = await reserveWarDeclarationFunding(store, plan());
        assert.equal(reserved.status, 'acquired');
        if (reserved.status !== 'acquired') return;
        const debit = await debitWarDeclarationFunding(store, WAR_KEY, reserved.row, NOW);
        assert.equal(debit.status, 'debited');
        const aborted = await abortWarDeclarationFunding(store, WAR_KEY, reserved.row, 'insufficient', NOW);
        assert.equal(aborted.status, 'funded');
        assert.equal(markerOf(await store.get<Record<string, unknown>>(WAR_KEY)).status, 'funding');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);
    });

    it('help-forwards a late exact receipt found under the bounded abort tombstone', async () => {
        const store = _makeMemoryKv();
        const request = plan();
        await store.set(WR_KEY, { warResources: 100 });
        const insufficient = await fundAndActivateWarDeclaration(store, request);
        assert.equal(insufficient.status, 'insufficient');
        assert.equal(markerOf(await store.get<Record<string, unknown>>(WAR_KEY)).status, 'aborted');

        const receipt = {
            version: 2,
            state: 'committed',
            declarationId: request.declarationId,
            fingerprint: request.fingerprint,
            sourceKind: 'war-resources',
            accountId: 'Leaf',
            amount: 200,
            ownerId: request.ownerId,
            reservedAt: NOW,
            balanceBefore: 900,
            balanceAfter: 700,
            debitedAt: NOW,
        };
        await store.set(WR_KEY, {
            warResources: 700,
            [WAR_DECLARATION_FUNDING_RECEIPTS_FIELD]: { [request.fingerprint]: receipt },
        });
        const recovered = await fundAndActivateWarDeclaration(store, {
            ...request,
            ownerId: 'owner-recovery',
            now: NOW + 1,
        });
        assert.equal(recovered.status, 'active');
        assert.equal(markerOf(await store.get<Record<string, unknown>>(WAR_KEY)).status, 'active');
        assert.equal((await store.get<Record<string, unknown>>(WR_KEY))?.warResources, 700);
    });

    it('source fence stops a paused old debit after abort expiry and a different declaration reuses the war key', async () => {
        const base = _makeMemoryKv();
        await base.set(WR_KEY, { warResources: 900 });
        const oldPlan = plan();
        const reserved = await reserveWarDeclarationFunding(base, oldPlan);
        assert.equal(reserved.status, 'acquired');
        if (reserved.status !== 'acquired') return;

        let releasePending!: () => void;
        let pendingReached!: () => void;
        const release = new Promise<void>((resolve) => { releasePending = resolve; });
        const reached = new Promise<void>((resolve) => { pendingReached = resolve; });
        let paused = false;
        const pausedStore: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: base.get.bind(base),
            set: base.set.bind(base),
            compareSet: async (key, expected, value, options) => {
                const entries = value && typeof value === 'object'
                    ? (value as Record<string, unknown>)[WAR_DECLARATION_FUNDING_RECEIPTS_FIELD] as Record<string, unknown> | undefined
                    : undefined;
                const entry = entries?.[oldPlan.fingerprint] as Record<string, unknown> | undefined;
                if (!paused && key === WR_KEY && entry?.state === 'pending') {
                    paused = true;
                    pendingReached();
                    await release;
                }
                return base.compareSet(key, expected, value, options);
            },
        };
        const oldDebitPromise = debitWarDeclarationFunding(pausedStore, WAR_KEY, reserved.row, NOW);
        await reached;

        const aborted = await abortWarDeclarationFunding(base, WAR_KEY, reserved.row, 'insufficient', NOW);
        assert.equal(aborted.status, 'aborted');
        assert.equal((receiptsOf((await base.get<Record<string, unknown>>(WR_KEY))!)[oldPlan.fingerprint] as Record<string, unknown>).state, 'aborted');

        // Deterministically model expiry of the bounded war tombstone.
        await base.del(WAR_KEY);
        const newDeclarationId = 'declaration-8';
        const newSource = { ...oldPlan.source };
        const newPlan: WarDeclarationFundingPlan<WarRow> = {
            ...oldPlan,
            declarationId: newDeclarationId,
            fingerprint: warDeclarationFundingFingerprint({
                declarationId: newDeclarationId,
                warId: 'leaf-vs-mist:declaration-8',
                villages: WAR.villages,
                source: newSource,
            }),
            war: { ...WAR, id: 'leaf-vs-mist:declaration-8' },
            ownerId: 'owner-new-declaration',
            now: NOW + 1_000,
        };
        const newResult = await fundAndActivateWarDeclaration(base, newPlan);
        assert.equal(newResult.status, 'active');

        releasePending();
        const staleResult = await oldDebitPromise;
        assert.equal(staleResult.status, 'stale-lease');
        const source = await base.get<Record<string, unknown>>(WR_KEY);
        assert.equal(source?.warResources, 700, 'only the new declaration debits');
        const entries = receiptsOf(source!);
        assert.equal((entries[oldPlan.fingerprint] as Record<string, unknown>).state, 'aborted');
        assert.equal((entries[newPlan.fingerprint] as Record<string, unknown>).state, 'committed');
    });

    it('rejects an overflowing lease deadline before publishing any row', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        await assert.rejects(
            reserveWarDeclarationFunding(store, plan('war-resources', {
                now: Number.MAX_SAFE_INTEGER - 5,
                leaseMs: 10,
            })),
            /safe integer range/,
        );
        assert.equal(await store.get(WAR_KEY), null);
    });

    it('will not activate a funding row without its exact co-written debit receipt', async () => {
        const store = _makeMemoryKv();
        await store.set(WR_KEY, { warResources: 900 });
        const reserved = await reserveWarDeclarationFunding(store, plan());
        assert.equal(reserved.status, 'acquired');
        if (reserved.status !== 'acquired') return;
        await assert.rejects(
            activateWarDeclarationFunding(store, WAR_KEY, reserved.row, NOW),
            /receipt-missing/,
        );
        assert.equal(markerOf(await store.get<Record<string, unknown>>(WAR_KEY)).status, 'funding');
    });

    it('preserves non-evicting WR debit receipts through war-record normalization', () => {
        const receipts = { abc: { version: 1, fingerprint: 'proof' } };
        const normalized = normalizeVillageWarRecord('Leaf', {
            warResources: 700,
            warDeclarationFundingReceipts: receipts,
        });
        assert.deepEqual(normalized.warDeclarationFundingReceipts, receipts);
        assert.notEqual(normalized.warDeclarationFundingReceipts, receipts);
    });
});
