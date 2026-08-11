import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { sanitizeCharacterSave } from '../save/[name].js';
import { claimPetLifecycleLease } from './_active-battle-lease.js';
import {
    getPetRankedJournal,
    loadPetRankedAuthorityToken,
    petRankedJournalCompletedKey,
    petRankedJournalKey,
    petRankedRecoveryKey,
    PET_RANKED_REPLAY_TTL_SECONDS,
    preparePetRankedJournal,
} from './_ranked-journal.js';
import {
    petRankedActiveKey,
    petRankedTokenKey,
    PET_RANKED_TOKEN_TTL_SECONDS,
    type ServerResolvedPetRankedToken,
} from './_ranked-engine.js';
import { settlePetRankedMatchDurably } from './_ranked-settlement.js';

const MATCH = 'abcdefabcdefabcdefabcdefabcdefab';
const NOW = 1_750_000_000_000;

const token: ServerResolvedPetRankedToken = {
    version: 'pet-ranked-token-v1',
    matchId: MATCH,
    a: 'alpha',
    b: 'bravo',
    aRating: 1000,
    bRating: 1000,
    createdAt: NOW,
    seed: 12345,
    aPetId: 'alpha-pet',
    bPetId: 'bravo-pet',
    resolution: {
        authority: 'server-engine-v1',
        engineVersion: 'pet-duel-sim-ranked-v1',
        winner: 'a',
        resolvedAt: NOW + 1,
        engineDigest: '0123456789abcdef'.repeat(4),
        reward: { kind: 'pet-rating-v1', ryo: 0, aDelta: 12, bDelta: -12 },
    },
};

const save = (name: string) => ({
    _saveVersion: 1,
    character: {
        name,
        petRankedRating: 1000,
        petRankedWins: 0,
        petRankedLosses: 0,
        pets: [{ id: `${name}-pet`, loadout: { consumable: 'pet-tonic' } }],
    },
});

const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

async function seed(store: KvLike): Promise<void> {
    await Promise.all([
        store.set('save:alpha', save('alpha')),
        store.set('save:bravo', save('bravo')),
        store.set(petRankedTokenKey(MATCH), token, { ex: PET_RANKED_TOKEN_TTL_SECONDS }),
        // Production ranked leases are durable from their first NX claim. No
        // pending-state code ever delete-refreshes these rows.
        store.set(petRankedActiveKey('alpha'), MATCH),
        store.set(petRankedActiveKey('bravo'), MATCH),
    ]);
}

function failOneSaveCompareSet(store: KvLike, key: string, afterCommit: boolean): KvLike {
    let failed = false;
    return {
        ...store,
        async compareSet(candidate, expected, value, options) {
            if (candidate !== key || failed) return store.compareSet(candidate, expected, value, options);
            failed = true;
            if (afterCommit) await store.compareSet(candidate, expected, value, options);
            throw new Error(afterCommit ? 'lost-save-ack' : 'save-write-failed');
        },
    };
}

describe('durable ranked pet settlement journal', { concurrency: false }, () => {
    it('recovers after the journal-first commit crashes before settlement and the short token expires', async () => {
        const realNow = Date.now;
        let clock = NOW;
        Date.now = () => clock;
        try {
            const store = _makeMemoryKv();
            await seed(store);

            // ranked-start now performs this immutable reservation before any
            // bounded token publication. A process may disappear immediately
            // afterward without losing the resolved match.
            await preparePetRankedJournal(store, token, clock);
            assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'pending');
            assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1000);

            clock += (PET_RANKED_TOKEN_TTL_SECONDS + 1) * 1_000;
            assert.equal(await store.get(petRankedTokenKey(MATCH)), null);
            const recoveredToken = await loadPetRankedAuthorityToken(store, MATCH);
            assert.equal(recoveredToken?.matchId, MATCH);
            assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH);
            assert.equal(await claimPetLifecycleLease(store, 'alpha', 'post-crash-probe'), null);

            const settled = await settlePetRankedMatchDurably(store, {
                matchToken: MATCH,
                token: recoveredToken!,
                lock,
                now: clock,
            });
            assert.equal(settled.a.status, 'settled');
            assert.equal(settled.b.status, 'settled');
            assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
        } finally {
            Date.now = realNow;
        }
    });

    it('never opens the shared gate when recovery-index creation faults', async () => {
        const realNow = Date.now;
        let clock = NOW;
        Date.now = () => clock;
        try {
            const store = _makeMemoryKv();
            await seed(store);
            let failed = false;
            const recoveryFault: KvLike = {
                ...store,
                async set(key, value, options) {
                    if (key === petRankedRecoveryKey('bravo') && !failed) {
                        failed = true;
                        throw new Error('recovery-index-write-failed');
                    }
                    return store.set(key, value, options);
                },
            };

            await assert.rejects(
                settlePetRankedMatchDurably(recoveryFault, { matchToken: MATCH, token, lock, now: clock }),
                /recovery-index-write-failed/,
            );
            assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'pending');
            assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1000);
            assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedRating, 1000);

            clock += (PET_RANKED_TOKEN_TTL_SECONDS + 1) * 1_000;
            assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH);
            assert.equal(await store.get(petRankedActiveKey('bravo')), MATCH);
            assert.equal(await claimPetLifecycleLease(store, 'alpha', 'fault-window-probe'), null);
            assert.equal(await claimPetLifecycleLease(store, 'bravo', 'fault-window-probe'), null);

            const recovered = await settlePetRankedMatchDurably(store, { matchToken: MATCH, token, lock, now: clock });
            assert.equal(recovered.a.status, 'settled');
            assert.equal(recovered.b.status, 'settled');
            assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
        } finally {
            Date.now = realNow;
        }
    });

    it('survives the 15-minute token window, recovers a partial settlement, and blocks other pet modes', async () => {
        const realNow = Date.now;
        let clock = NOW;
        Date.now = () => clock;
        try {
            const store = _makeMemoryKv();
            await seed(store);
            const staleAutosave = await store.get<Record<string, unknown>>('save:alpha');
            const failBravo = failOneSaveCompareSet(store, 'save:bravo', false);
            await assert.rejects(
                settlePetRankedMatchDurably(failBravo, { matchToken: MATCH, token, lock, now: clock }),
                /save-write-failed/,
            );

            const pending = await getPetRankedJournal(store, MATCH);
            assert.equal(pending?.state, 'pending');
            assert.deepEqual(pending?.confirmed, { a: true, b: false });
            assert.equal(await store.get(petRankedRecoveryKey('alpha')), MATCH);
            assert.equal(await store.get(petRankedRecoveryKey('bravo')), MATCH);
            assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1012);
            assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedRating, 1000);

            // The shared receipt ring is intentionally bounded and may churn
            // while operations unrelated to ranked settlement continue. The
            // dedicated atomic ranked stamp must remain sufficient authority.
            const alphaWithChurn = await store.get<Record<string, any>>('save:alpha');
            alphaWithChurn!.character.serverSettlementReceipts = Array.from({ length: 51 }, (_, index) => ({
                requestId: `unrelated-${index}`,
                fingerprint: 'other-settlement',
                value: { settled: 1 },
                settledAt: NOW + index,
            }));
            await store.set('save:alpha', alphaWithChurn);

            // A tab that loaded before the partial settlement may autosave after
            // unrelated server receipts have churned the shared 50-row ring.
            // Generic-save ownership must preserve the dedicated stamp even
            // though the stale body omits it entirely.
            const afterStaleAutosave = sanitizeCharacterSave(staleAutosave!, alphaWithChurn!);
            await store.set('save:alpha', afterStaleAutosave);
            const stampAfterAutosave = (await store.get<Record<string, any>>('save:alpha'))
                ?.character.petRankedSettlementStamp;
            assert.equal(stampAfterAutosave?.rating?.value, 1012);
            assert.equal(stampAfterAutosave?.fingerprint, 'pet-rating-winner');
            assert.equal(
                (await store.get<Record<string, any>>('save:alpha'))?.character.serverSettlementReceipts.length,
                51,
                'stale autosave preserves the server-side churned receipt ring',
            );

            clock += (PET_RANKED_TOKEN_TTL_SECONDS + 1) * 1_000;
            assert.equal(await store.get(petRankedTokenKey(MATCH)), null, 'the original short token expired');
            assert.equal((await loadPetRankedAuthorityToken(store, MATCH))?.matchId, MATCH, 'journal retained authority');
            assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH, 'unresolved active lease became durable');
            assert.equal(await store.get(petRankedActiveKey('bravo')), MATCH, 'both players remain blocked');
            assert.equal(await claimPetLifecycleLease(store, 'alpha', 'journal-probe'), null);

            const recoveredToken = await loadPetRankedAuthorityToken(store, MATCH);
            assert.ok(recoveredToken);
            const recovered = await settlePetRankedMatchDurably(store, {
                matchToken: MATCH,
                token: recoveredToken!,
                lock,
                now: clock,
            });
            assert.equal(recovered.a.status, 'replay');
            assert.equal(recovered.b.status, 'settled');
            assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1012);
            assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedRating, 988);
            assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
            assert.equal(await store.get(petRankedRecoveryKey('alpha')), null, 'completed recovery pointer is compare-deleted');
            assert.equal(await store.get(petRankedRecoveryKey('bravo')), null);

            clock += (PET_RANKED_TOKEN_TTL_SECONDS + 1) * 1_000;
            assert.equal(await store.get(petRankedActiveKey('alpha')), null, 'completed acknowledgement lease is bounded');
            assert.equal(await store.get(petRankedRecoveryKey('alpha')), null);
            const lifecycle = await claimPetLifecycleLease(store, 'alpha', 'after-ranked');
            assert.ok(lifecycle, 'other pet modes reopen after both receipts are confirmed');
            await lifecycle?.release();

            clock += (PET_RANKED_REPLAY_TTL_SECONDS + 1) * 1_000;
            assert.equal(await getPetRankedJournal(store, MATCH), null);
            assert.equal(await store.get(petRankedTokenKey(MATCH)), null);
        } finally {
            Date.now = realNow;
        }
    });

    it('recovers lost acknowledgements for both journal reservation and compaction', async () => {
        const store = _makeMemoryKv();
        await seed(store);
        const failedStates = new Set<string>();
        const lostJournalAcks: KvLike = {
            ...store,
            async set(key, value, options) {
                const isJournal = key === petRankedJournalKey(MATCH)
                    || key === petRankedJournalCompletedKey(MATCH);
                let state = '';
                if (isJournal && typeof value === 'string') {
                    state = String((JSON.parse(value) as { state?: unknown }).state ?? '');
                }
                if (state && !failedStates.has(state)) {
                    failedStates.add(state);
                    await store.set(key, value, options);
                    throw new Error(`lost-journal-${state}-ack`);
                }
                return store.set(key, value, options);
            },
        };

        const first = await settlePetRankedMatchDurably(lostJournalAcks, {
            matchToken: MATCH,
            token,
            lock,
            now: NOW,
        });
        assert.equal(first.a.status, 'settled');
        assert.equal(first.b.status, 'settled');
        assert.deepEqual([...failedStates].sort(), ['completed', 'pending']);
        assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');

        const replay = await settlePetRankedMatchDurably(store, { matchToken: MATCH, token, lock, now: NOW + 1 });
        assert.equal(replay.a.status, 'replay');
        assert.equal(replay.b.status, 'replay');
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedWins, 1);
        assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedLosses, 1);
    });

    it('does not overwrite a foreign mode that replaces an active row before completion CAS', async () => {
        const store = _makeMemoryKv();
        await seed(store);
        const alphaKey = petRankedActiveKey('alpha');
        let injected = false;
        const completionRace: KvLike = {
            ...store,
            async compareSet(key, expected, value, options) {
                if (key === alphaKey && expected === MATCH && !injected) {
                    injected = true;
                    await store.set(key, 'foreign-sanctuary-mode', { ex: 60 });
                }
                return store.compareSet(key, expected, value, options);
            },
        };

        const result = await settlePetRankedMatchDurably(completionRace, {
            matchToken: MATCH,
            token,
            lock,
            now: NOW,
        });
        assert.equal(result.a.status, 'settled');
        assert.equal(result.b.status, 'settled');
        assert.equal(injected, true);
        assert.equal(await store.get(alphaKey), 'foreign-sanctuary-mode');
        assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
    });

    it('keeps pending authority and durable leases when completion publication returns null', async () => {
        const store = _makeMemoryKv();
        await seed(store);
        let rejected = false;
        const nullCompletion: KvLike = {
            ...store,
            async set(key, value, options) {
                if (key === petRankedJournalCompletedKey(MATCH) && !rejected) {
                    rejected = true;
                    return null;
                }
                return store.set(key, value, options);
            },
        };

        await assert.rejects(
            settlePetRankedMatchDurably(nullCompletion, { matchToken: MATCH, token, lock, now: NOW }),
            /pet-ranked-journal-write-unconfirmed/,
        );
        assert.equal(await store.get(petRankedJournalCompletedKey(MATCH)), null);
        assert.deepEqual((await getPetRankedJournal(store, MATCH))?.confirmed, { a: true, b: true });
        assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH);
        assert.equal(await store.get(petRankedActiveKey('bravo')), MATCH);
        assert.equal(await store.get(petRankedRecoveryKey('alpha')), MATCH);
        assert.equal(await store.get(petRankedRecoveryKey('bravo')), MATCH);

        const replay = await settlePetRankedMatchDurably(store, { matchToken: MATCH, token, lock, now: NOW + 1 });
        assert.equal(replay.a.status, 'replay');
        assert.equal(replay.b.status, 'replay');
        assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedWins, 1);
        assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedLosses, 1);
    });

    it('resumes compaction after completed evidence lands but token publication fails', async () => {
        const store = _makeMemoryKv();
        await seed(store);
        await store.del(petRankedTokenKey(MATCH));
        let rejected = false;
        const nullToken: KvLike = {
            ...store,
            async set(key, value, options) {
                if (key === petRankedTokenKey(MATCH) && !rejected) {
                    rejected = true;
                    return null;
                }
                return store.set(key, value, options);
            },
        };

        await assert.rejects(
            settlePetRankedMatchDurably(nullToken, { matchToken: MATCH, token, lock, now: NOW }),
            /pet-ranked-journal-write-unconfirmed/,
        );
        assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
        assert.equal(await store.get(petRankedTokenKey(MATCH)), null);
        assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH, 'tail failure cannot clean the durable gate');

        const replay = await settlePetRankedMatchDurably(store, { matchToken: MATCH, token, lock, now: NOW + 1 });
        assert.equal(replay.a.status, 'replay');
        assert.equal(replay.b.status, 'replay');
        assert.equal((await loadPetRankedAuthorityToken(store, MATCH))?.matchId, MATCH);
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedWins, 1);
        assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedLosses, 1);
    });

    it('recognizes a lost save acknowledgement and compacts exactly once', async () => {
        const realNow = Date.now;
        let clock = NOW;
        Date.now = () => clock;
        try {
            const store = _makeMemoryKv();
            await seed(store);
            const lostBravoAck = failOneSaveCompareSet(store, 'save:bravo', true);
            const completed = await settlePetRankedMatchDurably(
                lostBravoAck,
                { matchToken: MATCH, token, lock, now: clock },
            );
            assert.equal(completed.b.status, 'settled');
            assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
            assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedRating, 988);

            clock += (PET_RANKED_TOKEN_TTL_SECONDS + 1) * 1_000;
            const recovered = await loadPetRankedAuthorityToken(store, MATCH);
            assert.ok(recovered);
            const replay = await settlePetRankedMatchDurably(store, { matchToken: MATCH, token: recovered!, lock, now: clock });
            assert.equal(replay.a.status, 'replay');
            assert.equal(replay.b.status, 'replay');
            assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedWins, 1);
            assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedLosses, 1);
            assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
        } finally {
            Date.now = realNow;
        }
    });

    it('fails closed on extra or malformed fields in immutable journal authority', async () => {
        const store = _makeMemoryKv();
        await seed(store);
        await preparePetRankedJournal(store, token, NOW);
        const key = petRankedJournalKey(MATCH);
        const raw = await store.get<string>(key);
        assert.ok(raw);
        const parsed = JSON.parse(raw!) as Record<string, unknown>;
        await store.set(key, JSON.stringify({ ...parsed, clientOutcome: 'win' }));
        await assert.rejects(getPetRankedJournal(store, MATCH), /pet-ranked-journal-invalid/);

        const malformedToken = structuredClone(parsed);
        (malformedToken.token as Record<string, unknown>).clientSeed = 999;
        await store.set(key, JSON.stringify(malformedToken));
        await assert.rejects(getPetRankedJournal(store, MATCH), /pet-ranked-journal-invalid/);
    });
});
