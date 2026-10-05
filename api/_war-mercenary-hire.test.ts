import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv, type KvLike } from './_storage.js';
import {
    PLAYER_WAR_MERCENARY_RECEIPTS_FIELD,
    MAX_PLAYER_WAR_MERCENARY_RECEIPTS,
    MAX_WAR_MERCENARY_RECEIPTS,
    WAR_MERCENARY_FUNDING_FIELD,
    WAR_MERCENARY_RECEIPTS_FIELD,
    helpWarMercenaryHire,
    settleWarMercenaryHire,
    warMercenaryHireFingerprint,
    type WarMercenaryHireIdentity,
    type WarMercenaryHirePlan,
} from './_war-mercenary-hire.js';

const WAR_KEY = 'world:war:leaf-vs-mist';
const SAVE_KEY = 'save:alice';
const NOW = 1_800_000_000_000;

function war(): Record<string, unknown> {
    return {
        id: 'leaf-vs-mist',
        villages: ['Leaf', 'Mist'],
        hp: { Leaf: 5_000, Mist: 5_000 },
        warGroundSector: 40,
        warGroundHp: 1_000,
        startedAt: NOW - 10_000,
        updatedAt: NOW - 10_000,
        declarationGeneration: 3,
        declarationFunding: {
            version: 1,
            status: 'active',
            declarationId: 'village:leaf-vs-mist:g3',
            fingerprint: 'a'.repeat(64),
            source: { kind: 'war-resources', recordKey: 'shared:village-war:leaf', accountId: 'Leaf', amount: 200 },
            createdAt: NOW - 20_000,
            ownerId: 'declaration-owner',
            leaseExpiresAt: NOW - 10_000,
            takeoverCount: 0,
            fundedAt: NOW - 19_000,
            activatedAt: NOW - 18_000,
        },
        contributions: {},
    };
}

function identity(): WarMercenaryHireIdentity {
    return {
        hireId: 'merc:leaf-vs-mist-g3:alice:elite',
        warId: 'leaf-vs-mist',
        warToken: 'leaf-vs-mist-g3',
        generation: 3,
        warEndsAt: NOW - 10_000 + 14 * 24 * 60 * 60 * 1_000,
        player: 'alice',
        displayName: 'Alice',
        village: 'Leaf',
        enemy: 'Mist',
        tierId: 'elite',
        costSeals: 500,
        warDamage: 300,
        sourceKey: SAVE_KEY,
    };
}

function plan(expectedWar: Record<string, unknown>, ownerId = 'owner-a'): WarMercenaryHirePlan {
    const startedAt = Number(expectedWar.startedAt);
    const effectiveStart = expectedWar.pendingUntil === undefined ? startedAt : Number(expectedWar.pendingUntil);
    const immutable = { ...identity(), warEndsAt: effectiveStart + 14 * 24 * 60 * 60 * 1_000 };
    return {
        ...immutable,
        warKey: WAR_KEY,
        fingerprint: warMercenaryHireFingerprint(immutable),
        ownerId,
        now: NOW,
        expectedWar,
    };
}

async function seeded(balance = 800) {
    const store = _makeMemoryKv();
    const target = war();
    await store.set(WAR_KEY, target);
    await store.set(SAVE_KEY, {
        _saveVersion: 1,
        character: { name: 'Alice', village: 'Leaf', honorSeals: balance },
    });
    return { store, target };
}

function sourceReceipts(row: Record<string, unknown> | null): Record<string, unknown> {
    const character = row?.character as Record<string, unknown> | undefined;
    const receipts = character?.[PLAYER_WAR_MERCENARY_RECEIPTS_FIELD];
    assert.ok(receipts && typeof receipts === 'object' && !Array.isArray(receipts));
    return receipts as Record<string, unknown>;
}

describe('village-war mercenary target-first funding saga', { concurrency: false }, () => {
    it('co-writes one debit receipt, applies one generation-bound strike, and replays exactly', async () => {
        const { store, target } = await seeded();
        const first = await settleWarMercenaryHire(store, plan(target));
        assert.equal(first.status, 'active');
        if (first.status !== 'active') return;
        assert.equal(first.replayed, false);
        assert.equal(first.receipt.dealt, 300);
        assert.equal(first.receipt.enemyHp, 4_700);
        assert.equal((first.sourceRow.character as Record<string, unknown>).honorSeals, 300);
        assert.equal(Object.keys(sourceReceipts(first.sourceRow)).length, 1);
        assert.equal(Object.prototype.hasOwnProperty.call(first.row, WAR_MERCENARY_FUNDING_FIELD), false);
        assert.equal(Object.keys(first.row[WAR_MERCENARY_RECEIPTS_FIELD] as Record<string, unknown>).length, 1);

        const replay = await settleWarMercenaryHire(store, plan(first.row, 'owner-b'));
        assert.equal(replay.status, 'active');
        if (replay.status !== 'active') return;
        assert.equal(replay.replayed, true);
        assert.equal((replay.sourceRow.character as Record<string, unknown>).honorSeals, 300);
        assert.equal((replay.row.hp as Record<string, unknown>).Mist, 4_700);
    });

    it('recovers a lost source-debit acknowledgement without charging twice', async () => {
        const { store: base, target } = await seeded();
        let lost = false;
        const lostDebitAck: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: base.get.bind(base),
            set: base.set.bind(base),
            compareSet: async (key, expected, value, options) => {
                const committedEntry = key === SAVE_KEY
                    && Object.values(sourceReceipts(value as Record<string, unknown>))
                        .some(entry => (entry as Record<string, unknown>).state === 'committed');
                if (committedEntry && !lost) {
                    lost = true;
                    assert.equal(await base.compareSet(key, expected, value, options), true);
                    throw new Error('lost-source-ack');
                }
                return base.compareSet(key, expected, value, options);
            },
        };
        const result = await settleWarMercenaryHire(lostDebitAck, plan(target));
        assert.equal(result.status, 'active');
        if (result.status !== 'active') return;
        assert.equal((result.sourceRow.character as Record<string, unknown>).honorSeals, 300);
        assert.equal((result.row.hp as Record<string, unknown>).Mist, 4_700);
        assert.equal(Object.keys(sourceReceipts(result.sourceRow)).length, 1);
    });

    it('leaves a marker-before-save crash hidden and help-forwardable', async () => {
        const { store: base, target } = await seeded();
        let crashed = false;
        const markerCrash: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: base.get.bind(base),
            set: base.set.bind(base),
            compareSet: async (key, expected, value, options) => {
                if (key === SAVE_KEY && !crashed) {
                    crashed = true;
                    throw new Error('crash-before-source-intent');
                }
                return base.compareSet(key, expected, value, options);
            },
        };
        await assert.rejects(settleWarMercenaryHire(markerCrash, plan(target)), /crash-before-source-intent/);
        const hidden = await base.get<Record<string, unknown>>(WAR_KEY);
        assert.ok(hidden?.[WAR_MERCENARY_FUNDING_FIELD]);
        assert.equal(((await base.get<Record<string, unknown>>(SAVE_KEY))?.character as Record<string, unknown>).honorSeals, 800);

        const recovered = await helpWarMercenaryHire(base, WAR_KEY, hidden!, NOW + 1);
        assert.equal(recovered.status, 'active');
        if (recovered.status !== 'active') return;
        assert.equal(recovered.receipt.enemyHp, 4_700);
        assert.equal((recovered.sourceRow.character as Record<string, unknown>).honorSeals, 300);
    });

    it('keeps a post-debit crash hidden until a retry applies the reserved strike', async () => {
        const { store: base, target } = await seeded();
        let crashed = false;
        const activationCrash: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: base.get.bind(base),
            set: base.set.bind(base),
            compareSet: async (key, expected, value, options) => {
                const activation = key === WAR_KEY
                    && !!(expected as Record<string, unknown>)?.[WAR_MERCENARY_FUNDING_FIELD]
                    && !(value as Record<string, unknown>)?.[WAR_MERCENARY_FUNDING_FIELD];
                if (activation && !crashed) {
                    crashed = true;
                    throw new Error('crash-before-war-activation');
                }
                return base.compareSet(key, expected, value, options);
            },
        };
        await assert.rejects(settleWarMercenaryHire(activationCrash, plan(target)), /crash-before-war-activation/);
        const hidden = await base.get<Record<string, unknown>>(WAR_KEY);
        const debited = await base.get<Record<string, unknown>>(SAVE_KEY);
        assert.ok(hidden?.[WAR_MERCENARY_FUNDING_FIELD]);
        assert.equal((hidden?.hp as Record<string, unknown>).Mist, 5_000);
        assert.equal((debited?.character as Record<string, unknown>).honorSeals, 300);

        const recovered = await helpWarMercenaryHire(base, WAR_KEY, hidden!, NOW + 1);
        assert.equal(recovered.status, 'active');
        if (recovered.status !== 'active') return;
        assert.equal((recovered.row.hp as Record<string, unknown>).Mist, 4_700);
        assert.equal((recovered.sourceRow.character as Record<string, unknown>).honorSeals, 300);
    });

    it('durably aborts an insufficient attempt, unhides the war, and safely allows a funded retry', async () => {
        const { store, target } = await seeded(100);
        const rejected = await settleWarMercenaryHire(store, plan(target));
        assert.deepEqual(rejected, { status: 'insufficient', have: 100, cost: 500 });
        const unhidden = await store.get<Record<string, unknown>>(WAR_KEY);
        assert.equal(Object.prototype.hasOwnProperty.call(unhidden!, WAR_MERCENARY_FUNDING_FIELD), false);
        const rejectedSave = await store.get<Record<string, unknown>>(SAVE_KEY);
        assert.equal((rejectedSave?.character as Record<string, unknown>).honorSeals, 100);
        assert.equal((Object.values(sourceReceipts(rejectedSave))[0] as Record<string, unknown>).state, 'aborted');

        await store.set(SAVE_KEY, {
            ...rejectedSave,
            character: { ...(rejectedSave?.character as Record<string, unknown>), honorSeals: 800 },
        });
        const accepted = await settleWarMercenaryHire(store, plan(unhidden!, 'owner-b'));
        assert.equal(accepted.status, 'active');
        if (accepted.status !== 'active') return;
        assert.equal(accepted.receipt.ownerId, 'owner-b');
        assert.equal((accepted.sourceRow.character as Record<string, unknown>).honorSeals, 300);
        assert.equal((accepted.row.hp as Record<string, unknown>).Mist, 4_700);
    });

    it('rejects exactly at the canonical lifetime and aborts a pre-source crash that crosses it without debit', async () => {
        const { store } = await seeded();
        const atBoundary = war();
        atBoundary.startedAt = NOW - 14 * 24 * 60 * 60 * 1_000;
        await store.set(WAR_KEY, atBoundary);
        await assert.rejects(
            settleWarMercenaryHire(store, plan(atBoundary)),
            /not an active exact generation/,
        );
        assert.equal(((await store.get<Record<string, unknown>>(SAVE_KEY))?.character as Record<string, unknown>).honorSeals, 800);
        assert.equal(Object.prototype.hasOwnProperty.call((await store.get<Record<string, unknown>>(WAR_KEY))!, WAR_MERCENARY_FUNDING_FIELD), false);

        const justBefore = war();
        justBefore.startedAt = NOW - 14 * 24 * 60 * 60 * 1_000 + 1;
        await store.set(WAR_KEY, justBefore);
        let crashed = false;
        const markerCrash: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: store.get.bind(store),
            set: store.set.bind(store),
            compareSet: async (key, expected, value, options) => {
                if (key === SAVE_KEY && !crashed) {
                    crashed = true;
                    throw new Error('pause-at-lifetime-boundary');
                }
                return store.compareSet(key, expected, value, options);
            },
        };
        await assert.rejects(settleWarMercenaryHire(markerCrash, plan(justBefore)), /pause-at-lifetime-boundary/);
        const hidden = await store.get<Record<string, unknown>>(WAR_KEY);
        const expired = await helpWarMercenaryHire(store, WAR_KEY, hidden!, NOW + 1);
        assert.equal(expired.status, 'expired');
        assert.equal(((await store.get<Record<string, unknown>>(SAVE_KEY))?.character as Record<string, unknown>).honorSeals, 800);
        assert.equal(Object.prototype.hasOwnProperty.call((await store.get<Record<string, unknown>>(WAR_KEY))!, WAR_MERCENARY_FUNDING_FIELD), false);
        assert.equal(((await store.get<Record<string, unknown>>(WAR_KEY))?.hp as Record<string, unknown>).Mist, 5_000);
    });

    it('fences a village transfer after target reservation and never debits the former villager', async () => {
        const { store, target } = await seeded();
        let crashed = false;
        const markerCrash: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: store.get.bind(store),
            set: store.set.bind(store),
            compareSet: async (key, expected, value, options) => {
                if (key === SAVE_KEY && !crashed) {
                    crashed = true;
                    throw new Error('pause-before-source-intent');
                }
                return store.compareSet(key, expected, value, options);
            },
        };
        await assert.rejects(settleWarMercenaryHire(markerCrash, plan(target)), /pause-before-source-intent/);
        const moved = await store.get<Record<string, unknown>>(SAVE_KEY);
        await store.set(SAVE_KEY, {
            ...moved,
            character: { ...(moved?.character as Record<string, unknown>), village: 'Mist' },
        });
        const hidden = await store.get<Record<string, unknown>>(WAR_KEY);
        const result = await helpWarMercenaryHire(store, WAR_KEY, hidden!, NOW + 1);
        assert.equal(result.status, 'blocked');
        if (result.status === 'blocked') assert.equal(result.reason, 'account-village-changed');
        const source = await store.get<Record<string, unknown>>(SAVE_KEY);
        assert.equal((source?.character as Record<string, unknown>).honorSeals, 800);
        assert.equal((source?.character as Record<string, unknown>).village, 'Mist');
        const unhidden = await store.get<Record<string, unknown>>(WAR_KEY);
        assert.equal(Object.prototype.hasOwnProperty.call(unhidden!, WAR_MERCENARY_FUNDING_FIELD), false);
        assert.equal((unhidden?.hp as Record<string, unknown>).Mist, 5_000);
    });

    it('fails before marker or debit when either non-evicting receipt ledger is full', async () => {
        const { store, target } = await seeded();
        const fullSource = Object.fromEntries(
            Array.from({ length: MAX_PLAYER_WAR_MERCENARY_RECEIPTS }, (_, index) => [`old-source-${index}`, { state: 'committed' }]),
        );
        const source = await store.get<Record<string, unknown>>(SAVE_KEY);
        await store.set(SAVE_KEY, {
            ...source,
            character: {
                ...(source?.character as Record<string, unknown>),
                [PLAYER_WAR_MERCENARY_RECEIPTS_FIELD]: fullSource,
            },
        });
        const sourceFull = await settleWarMercenaryHire(store, plan(target));
        assert.equal(sourceFull.status, 'blocked');
        if (sourceFull.status === 'blocked') assert.equal(sourceFull.reason, 'source-receipt-ledger-full');
        assert.equal(Object.prototype.hasOwnProperty.call((await store.get<Record<string, unknown>>(WAR_KEY))!, WAR_MERCENARY_FUNDING_FIELD), false);
        assert.equal(((await store.get<Record<string, unknown>>(SAVE_KEY))?.character as Record<string, unknown>).honorSeals, 800);

        await store.set(SAVE_KEY, source!);
        const fullWar = Object.fromEntries(
            Array.from({ length: MAX_WAR_MERCENARY_RECEIPTS }, (_, index) => [`old-war-${index}`, { state: 'applied' }]),
        );
        const targetWithFullLedger = { ...target, [WAR_MERCENARY_RECEIPTS_FIELD]: fullWar };
        await store.set(WAR_KEY, targetWithFullLedger);
        const warFull = await settleWarMercenaryHire(store, plan(targetWithFullLedger));
        assert.equal(warFull.status, 'blocked');
        if (warFull.status === 'blocked') assert.equal(warFull.reason, 'war-receipt-ledger-full');
        assert.equal(Object.prototype.hasOwnProperty.call((await store.get<Record<string, unknown>>(WAR_KEY))!, WAR_MERCENARY_FUNDING_FIELD), false);
        assert.equal(((await store.get<Record<string, unknown>>(SAVE_KEY))?.character as Record<string, unknown>).honorSeals, 800);
    });
});

/*
 * Every write to the hiring player's save keeps the idle recovery they earned
 * since their last save. None of these writes moves a vital, so the recovered
 * HP, chakra and stamina settle into it and the cursor carries. They used to
 * fence the cursor to "now" and throw that recovery away. Each test starts the
 * player 30 s past their last save at HP 10/100, chakra 20/100 and stamina
 * 0/100.
 */
describe('a mercenary hire keeps the hiring player\'s idle recovery', { concurrency: false }, () => {
    let tiredAt = 0;

    async function tiredHirer(balance: number) {
        const { store, target } = await seeded(balance);
        tiredAt = Date.now() - 30_000;
        const stored = (await store.get<Record<string, any>>(SAVE_KEY))!;
        await store.set(SAVE_KEY, {
            ...stored,
            _saveAt: tiredAt,
            _regenAt: tiredAt,
            character: { ...stored.character, hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 },
        });
        return { store, target };
    }

    function assertRecovered(save: Record<string, any>): void {
        const character = save.character;
        assert.ok(character.hp >= 40, `hp ${character.hp} lost the idle recovery`);
        assert.ok(character.chakra >= 50, `chakra ${character.chakra} lost the idle recovery`);
        assert.ok(character.stamina >= 30, `stamina ${character.stamina} lost the idle recovery`);
        assert.ok(Number(save._regenAt) >= tiredAt + 30_000 - 1_000, `cursor ${save._regenAt} fell behind the recovery`);
        assert.equal((Number(save._regenAt) - tiredAt) % 1_000, 0, `cursor ${save._regenAt} was fenced to the write, not carried`);
    }

    it('through the source intent and the debit', async () => {
        const { store, target } = await tiredHirer(800);
        const hired = await settleWarMercenaryHire(store, plan(target));
        assert.equal(hired.status, 'active');
        const save = (await store.get<Record<string, any>>(SAVE_KEY))!;
        assert.equal(save.character.honorSeals, 300, 'the Seals were still spent');
        assert.equal(save._saveVersion, 3, 'the intent and the debit each wrote the save');
        if (hired.status === 'active') assert.deepEqual(hired.sourceRow, save, 'the reply carries the committed save');
        assertRecovered(save);
    });

    it('through the source intent and the abort when the Seals run short', async () => {
        const { store, target } = await tiredHirer(100);
        const short = await settleWarMercenaryHire(store, plan(target));
        assert.deepEqual(short, { status: 'insufficient', have: 100, cost: 500 });
        const save = (await store.get<Record<string, any>>(SAVE_KEY))!;
        assert.equal(save.character.honorSeals, 100, 'nothing was spent');
        assert.deepEqual(Object.values(sourceReceipts(save)).map((entry) => (entry as { state: string }).state), ['aborted']);
        assert.equal(save._saveVersion, 3, 'the intent and the abort each wrote the save');
        assertRecovered(save);
    });
});
