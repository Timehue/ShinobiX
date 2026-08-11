import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import type { mutatePlayerSave } from '../save/_mutate-player-save.js';
import type { PvpFighter } from '../pvp/session.js';
import { sealCompanionFromSave } from '../combat-core/companion.js';
import { activeCarriedPets } from '../_entitlements.js';
import { executeSoloPveAction, type SoloPveActionServiceDeps } from './_action-service.js';
import { applySoloPveUsageCosts } from './_settlement.js';
import { settleSoloPveTerminalUsage } from './_usage-authority.js';
import { createSoloPveSession, type SoloPveSession } from './_session.js';
import {
    claimAuthoritativeSoloPveCompanion,
    claimSoloPveSummonLease,
    finalizeSoloPveCompanionUsage,
    releaseSoloPveSummonLease,
    settleSoloPveCompanionUsage,
    soloPveSummonLeaseKey,
} from './_pet-battle-authority.js';
import {
    claimSoloPveItemActionLease,
    finalizeSoloPveItemActionUsage,
    releaseSoloPveItemActionLease,
    settleSoloPveItemActionUsage,
    soloPveItemCostAuthority,
    soloPveItemActionLeaseKey,
} from './_item-usage-authority.js';
import {
    claimSoloPveItemActionIntent,
    readActiveSoloPveItemActionIntent,
    releaseSoloPveItemActionIntent,
    soloPveActiveItemIntentKey,
    soloPveItemIntentKey,
} from './_item-action-intent.js';

const NOW = 1_800_000_000_000;
const PET_ID = 'pet-active';
const ITEM_ID = 'battle-pill';

class LeaseStore implements Pick<KvLike, 'get' | 'set' | 'compareSet' | 'delIfEqual'> {
    readonly data = new Map<string, unknown>();
    setCommitThenThrow = false;
    compareSetCommitThenThrow = false;
    deleteCommitThenThrow = false;

    async get<T>(key: string): Promise<T | null> {
        return (this.data.has(key) ? this.data.get(key) : null) as T | null;
    }

    async set(key: string, value: unknown, options?: { nx?: boolean }): Promise<'OK' | null> {
        if (options?.nx && this.data.has(key)) return null;
        this.data.set(key, structuredClone(value));
        if (this.setCommitThenThrow) {
            this.setCommitThenThrow = false;
            throw new Error('injected-NX-ack-loss');
        }
        return 'OK';
    }

    async compareSet(key: string, expected: unknown | null, value: unknown): Promise<boolean> {
        if (!isDeepStrictEqual(this.data.get(key) ?? null, expected)) return false;
        this.data.set(key, structuredClone(value));
        if (this.compareSetCommitThenThrow) {
            this.compareSetCommitThenThrow = false;
            throw new Error('injected-CAS-ack-loss');
        }
        return true;
    }

    async delIfEqual(key: string, expected: unknown): Promise<boolean> {
        if (!isDeepStrictEqual(this.data.get(key), expected)) return false;
        this.data.delete(key);
        if (this.deleteCommitThenThrow) {
            this.deleteCommitThenThrow = false;
            throw new Error('injected-delete-ack-loss');
        }
        return true;
    }
}

function fighter(name: string, pos: number, character: Record<string, unknown> = {}): PvpFighter {
    return {
        name,
        hp: 500,
        maxHp: 500,
        chakra: 0,
        maxChakra: 200,
        stamina: 200,
        maxStamina: 200,
        shield: 0,
        statuses: [],
        pos,
        character: {
            name,
            level: 30,
            specialty: 'Taijutsu',
            stats: { taijutsuOffense: 200, taijutsuDefense: 150 },
            jutsu: [],
            pvpItems: [],
            equipment: {},
            ...character,
        },
    };
}

function petRecord() {
    return {
        id: PET_ID,
        name: 'Fang',
        level: 60,
        hp: 300,
        attack: 120,
        defense: 80,
        speed: 90,
        happiness: 100,
        unlockedForPve: true,
        jutsus: [{ name: 'Bite', kind: 'damage', power: 45, cooldown: 1, rounds: 2 }],
        loadout: { pve: 'pve-crest', pveDurability: 2, consumable: 'pet-tonic' },
    };
}

function summonSession(kind = 'generic-ai', id = 'summon-session'): SoloPveSession {
    return createSoloPveSession({
        sessionId: id,
        ownerSlug: 'Alice',
        encounter: { kind, id: `${kind}-encounter`, bindingId: id },
        player: fighter('Alice', 62),
        enemy: fighter('Enemy', 63),
        now: NOW,
        companion: {
            petId: 'stale-pet',
            name: 'Stale snapshot',
            hp: 1,
            damage: 1,
            happiness: 0,
            loyal: false,
            moves: [],
            pveGearId: '',
        },
    });
}

function itemSession(id: string): SoloPveSession {
    return createSoloPveSession({
        sessionId: id,
        ownerSlug: 'Alice',
        encounter: { kind: 'mission', id: 'combat-e-drill', bindingId: id },
        player: fighter('Alice', 62, {
            pvpItems: [{ id: ITEM_ID, name: 'Battle Pill', slot: 'item', apCost: 35, restoreChakra: 50 }],
            equipment: { item1: ITEM_ID },
        }),
        enemy: fighter('Enemy', 63),
        now: NOW,
        itemCharges: { [ITEM_ID]: 1 },
    });
}

function receiptChurn(count = 51) {
    return Array.from({ length: count }, (_, index) => ({
        requestId: `unrelated_receipt_${String(index).padStart(3, '0')}`,
        fingerprint: `unrelated-${index}`,
        value: { index },
        settledAt: NOW + index,
    }));
}

function saveHarness(initialCharacter: Record<string, unknown>) {
    let character = structuredClone(initialCharacter);
    let version = 1;
    let commitThenThrow = false;
    const mutateSave: typeof mutatePlayerSave = async (_playerName, mutate) => {
        const record = { character, _saveVersion: version };
        const decision = await mutate({ playerName: 'Alice', saveKey: 'save:Alice', record, character });
        if (!decision.ok) return decision;
        if (decision.write !== false) {
            character = structuredClone(decision.character);
            version += 1;
        }
        const result = {
            ok: true as const,
            value: decision.value,
            record: { character, _saveVersion: version },
            character: structuredClone(character),
            _saveVersion: version,
        };
        if (commitThenThrow) {
            commitThenThrow = false;
            throw new Error('injected-save-commit-ack-loss');
        }
        return result;
    };
    return {
        mutateSave,
        get character() { return character; },
        set character(value: Record<string, unknown>) { character = structuredClone(value); },
        throwAfterNextCommit() { commitThenThrow = true; },
    };
}

function sessionHarness(initial: SoloPveSession) {
    let stored = structuredClone(initial);
    let commitThenThrowAndHideRead = false;
    let hideNextRead = false;
    return {
        get stored() { return stored; },
        read: async () => {
            if (hideNextRead) {
                hideNextRead = false;
                throw new Error('injected-readback-failure');
            }
            return structuredClone(stored);
        },
        write: async (next: SoloPveSession) => {
            stored = structuredClone(next);
            if (commitThenThrowAndHideRead) {
                commitThenThrowAndHideRead = false;
                hideNextRead = true;
                throw new Error('injected-session-write-ack-loss');
            }
        },
        failNextWriteReadback() { commitThenThrowAndHideRead = true; },
    };
}

function commonDeps(
    store: LeaseStore,
    save: ReturnType<typeof saveHarness>,
    sessions: ReturnType<typeof sessionHarness>,
): SoloPveActionServiceDeps {
    return {
        read: sessions.read,
        write: sessions.write,
        lock: async (_key, fn) => fn(),
        now: () => NOW + 1_000,
        claimCompanion: (session, at, moveToken) => claimAuthoritativeSoloPveCompanion(session, at, {
            store,
            readSave: async () => ({ character: structuredClone(save.character) }),
            moveToken,
        }),
        settleCompanion: (session) => settleSoloPveCompanionUsage(session, {
            store,
            mutateSave: save.mutateSave,
            now: () => NOW + 1_000,
        }),
        finalizeCompanion: (session) => finalizeSoloPveCompanionUsage(session, {
            mutateSave: save.mutateSave,
            now: () => NOW + 1_001,
        }),
        releaseCompanion: (session) => releaseSoloPveSummonLease(
            store,
            session.ownerSlug,
            session.sessionId,
            session.companionCostAuthority?.moveToken,
        ),
        claimItem: (session, moveToken) => claimSoloPveItemActionLease(store, session.ownerSlug, session.sessionId, moveToken),
        settleItem: (session, authority) => settleSoloPveItemActionUsage(session, authority, {
            store,
            mutateSave: save.mutateSave,
            now: () => NOW + 1_000,
        }),
        finalizeItem: (session, authority) => finalizeSoloPveItemActionUsage(session, authority, {
            mutateSave: save.mutateSave,
            now: () => NOW + 1_001,
        }),
        releaseItem: (session, authority) => releaseSoloPveItemActionLease(store, session.ownerSlug, session.sessionId, authority.moveToken),
        claimItemIntent: (intent) => claimSoloPveItemActionIntent(intent, store),
        readItemIntent: (sessionId) => readActiveSoloPveItemActionIntent(sessionId, store),
        releaseItemIntent: (intent) => releaseSoloPveItemActionIntent(intent, store),
    };
}

describe('common solo-PvE pet boundary', () => {
    it('handles reservation and delete acknowledgement loss without erasing a successor', async () => {
        const store = new LeaseStore();
        store.setCommitThenThrow = true;
        const claimed = await claimSoloPveSummonLease(store, 'Alice', 'aifight-0123456789abcdef');
        assert.equal(claimed?.resumed, true);
        assert.equal(store.data.get(soloPveSummonLeaseKey('Alice')), claimed?.value);

        store.deleteCommitThenThrow = true;
        assert.equal(await releaseSoloPveSummonLease(store, 'Alice', 'aifight-0123456789abcdef'), true);
        assert.equal(store.data.has(soloPveSummonLeaseKey('Alice')), false);

        const next = await claimSoloPveSummonLease(store, 'Alice', 'mission-abcdef0123456789');
        assert.ok(next);
        store.data.set(soloPveSummonLeaseKey('Alice'), 'ranked-successor-token');
        assert.equal(await releaseSoloPveSummonLease(store, 'Alice', 'mission-abcdef0123456789'), true);
        assert.equal(store.data.get(soloPveSummonLeaseKey('Alice')), 'ranked-successor-token');
    });

    it('uses the entitlement-projected active roster when sealing a companion', () => {
        const pets = Array.from({ length: 5 }, (_, index) => ({ ...petRecord(), id: `pet-${index + 1}` }));
        const character = { patreon: { active: false }, activePetId: 'pet-5', activePetId2v2: 'pet-4', pets };
        assert.deepEqual(activeCarriedPets<{ id: string }>(character).map(({ id }) => id), ['pet-5', 'pet-4', 'pet-1']);
        assert.equal(sealCompanionFromSave(character, NOW)?.petId, 'pet-5');
    });

    it('covers every rewardful builder encounter at summon time and never double-decrements terminal gear', async () => {
        for (const kind of ['generic-ai', 'mission', 'story-boss', 'academy-spar', 'endless-wave', 'hollow-gate', 'weekly-boss']) {
            const store = new LeaseStore();
            if (kind === 'generic-ai') store.setCommitThenThrow = true;
            const save = saveHarness({
                name: 'Alice',
                activePetId: PET_ID,
                pets: [petRecord()],
                serverSettlementReceipts: receiptChurn(),
            });
            const sessions = sessionHarness(summonSession(kind, `${kind}-session`));
            const result = await executeSoloPveAction({
                sessionId: sessions.stored.sessionId,
                ownerSlug: 'Alice',
                expectedVersion: 1,
                moveToken: `summon-${kind.replace(/[^a-z]/g, '')}-0001`,
                action: { type: 'summon' },
            }, commonDeps(store, save, sessions));
            assert.equal(result.status, 200, kind);
            assert.equal(result.body.applied, true, kind);
            assert.equal(sessions.stored.companion?.petId, PET_ID, `${kind} must replace the stale start seal`);
            assert.equal(sessions.stored.companionCostAuthority?.settlementState, 'settled');
            const pet = (save.character.pets as Array<Record<string, any>>)[0]!;
            assert.equal(pet.loadout.pveDurability, 1, `${kind} charges durability once at summon`);
            assert.equal(pet.loadout.consumable, undefined, `${kind} charges the consumable once at summon`);
            assert.equal((save.character.soloPveCompanionSettlements as unknown[]).length, 1);
            assert.equal(store.data.has(soloPveSummonLeaseKey('Alice')), false);

            for (const outcome of ['win', 'loss', 'fled'] as const) {
                const terminal = {
                    ...sessions.stored,
                    status: 'done' as const,
                    winner: outcome === 'win' ? 'player' as const : 'enemy' as const,
                    outcome,
                };
                const replayed = applySoloPveUsageCosts(save.character, terminal);
                const replayPet = (replayed.pets as Array<Record<string, any>>)[0]!;
                assert.equal(replayPet.loadout.pveDurability, 1, `${kind}/${outcome} must not charge gear twice`);
            }
        }
    });

    it('blocks summon behind casual or ranked authority without mutating the session', async () => {
        for (const foreign of ['casual-token-123', 'ranked:match-456']) {
            const store = new LeaseStore();
            store.data.set(soloPveSummonLeaseKey('Alice'), foreign);
            const save = saveHarness({ name: 'Alice', activePetId: PET_ID, pets: [petRecord()] });
            const sessions = sessionHarness(summonSession('generic-ai', `blocked-${foreign.replace(/\W/g, '')}`));
            const result = await executeSoloPveAction({
                sessionId: sessions.stored.sessionId,
                ownerSlug: 'Alice',
                expectedVersion: 1,
                moveToken: 'summon-blocked-0001',
                action: { type: 'summon' },
            }, commonDeps(store, save, sessions));
            assert.equal(result.status, 409);
            assert.equal(sessions.stored.version, 1);
            assert.equal((save.character.pets as Array<Record<string, any>>)[0]!.loadout.pveDurability, 2);
            assert.equal(store.data.get(soloPveSummonLeaseKey('Alice')), foreign);
        }
    });

    it('recovers save and session commit acknowledgement loss through the dedicated marker', async () => {
        const store = new LeaseStore();
        const save = saveHarness({
            name: 'Alice', activePetId: PET_ID, pets: [petRecord()], serverSettlementReceipts: receiptChurn(),
        });
        const sessions = sessionHarness(summonSession());
        save.throwAfterNextCommit();
        await assert.rejects(executeSoloPveAction({
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'summon-recovery-0001',
            action: { type: 'summon' },
        }, commonDeps(store, save, sessions)), /injected-save-commit-ack-loss/);
        assert.equal(sessions.stored.companionCostAuthority?.settlementState, 'pending');
        assert.ok(store.data.has(soloPveSummonLeaseKey('Alice')), 'ambiguous charge retains exclusivity');
        assert.equal((save.character.pets as Array<Record<string, any>>)[0]!.loadout.pveDurability, 1);

        save.character = { ...save.character, serverSettlementReceipts: receiptChurn(80) };
        const retry = await executeSoloPveAction({
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'summon-recovery-0001',
            action: { type: 'summon' },
        }, commonDeps(store, save, sessions));
        assert.equal(retry.status, 200);
        assert.equal(retry.body.duplicate, true);
        assert.equal(sessions.stored.companionCostAuthority?.settlementState, 'settled');
        assert.equal((save.character.pets as Array<Record<string, any>>)[0]!.loadout.pveDurability, 1);
        assert.equal((save.character.soloPveCompanionSettlements as unknown[]).length, 1);
        assert.equal(store.data.has(soloPveSummonLeaseKey('Alice')), false);

        const secondStore = new LeaseStore();
        const secondSave = saveHarness({ name: 'Alice', activePetId: PET_ID, pets: [petRecord()] });
        const secondSessions = sessionHarness(summonSession('mission', 'session-write-recovery'));
        secondSessions.failNextWriteReadback();
        await assert.rejects(executeSoloPveAction({
            sessionId: secondSessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'summon-sessionack-0001',
            action: { type: 'summon' },
        }, commonDeps(secondStore, secondSave, secondSessions)), /injected-session-write-ack-loss/);
        assert.ok(secondStore.data.has(soloPveSummonLeaseKey('Alice')), 'unknown session write retains the lease');
        const secondRetry = await executeSoloPveAction({
            sessionId: secondSessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'summon-sessionack-0001',
            action: { type: 'summon' },
        }, commonDeps(secondStore, secondSave, secondSessions));
        assert.equal(secondRetry.body.duplicate, true);
        assert.equal((secondSave.character.pets as Array<Record<string, any>>)[0]!.loadout.pveDurability, 1);
        assert.equal(secondStore.data.has(soloPveSummonLeaseKey('Alice')), false);
    });

    it('keeps a move-specific summon lease when a CAS loser races the pending winner', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', activePetId: PET_ID, pets: [petRecord()] });
        const sessions = sessionHarness(summonSession('mission', 'summon-cas-race'));
        let releaseFirst!: () => void;
        let releaseWinner!: () => void;
        let firstPaused!: () => void;
        let winnerPaused!: () => void;
        const firstAtCas = new Promise<void>((resolve) => { firstPaused = resolve; });
        const winnerCommitted = new Promise<void>((resolve) => { winnerPaused = resolve; });
        const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const winnerRelease = new Promise<void>((resolve) => { releaseWinner = resolve; });
        let pendingCommits = 0;
        const commit = async (expected: SoloPveSession, next: SoloPveSession) => {
            if (next.companionCostAuthority?.settlementState === 'pending') {
                pendingCommits += 1;
                if (pendingCommits === 1) {
                    firstPaused();
                    await firstRelease;
                } else if (pendingCommits === 2) {
                    assert.ok(isDeepStrictEqual(sessions.stored, expected));
                    await sessions.write(next);
                    winnerPaused();
                    await winnerRelease;
                    return true;
                }
            }
            if (!isDeepStrictEqual(sessions.stored, expected)) return false;
            await sessions.write(next);
            return true;
        };
        const deps = { ...commonDeps(store, save, sessions), commit };
        const command = {
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'summon-shared-race-0001',
            action: { type: 'summon' as const },
        };
        const stalePromise = executeSoloPveAction(command, deps);
        await firstAtCas;
        const winnerPromise = executeSoloPveAction(command, deps);
        await winnerCommitted;
        releaseFirst();
        const stale = await stalePromise;
        assert.equal(stale.status, 200);
        assert.equal(stale.body.duplicate, true);
        assert.match(String(store.data.get(soloPveSummonLeaseKey('Alice'))), /summon-shared-race-0001$/);
        releaseWinner();
        const winner = await winnerPromise;
        assert.equal(winner.status, 200);
        assert.equal((save.character.pets as Array<Record<string, any>>)[0]!.loadout.pveDurability, 1);
        assert.equal(store.data.has(soloPveSummonLeaseKey('Alice')), false);
    });

    it('reacquires an expired move-specific pending lease only when the boundary is free', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', activePetId: PET_ID, pets: [petRecord()] });
        const session = summonSession('mission', 'summon-expired-pending');
        const moveToken = 'summon-expired-lease-0001';
        const claimed = await claimAuthoritativeSoloPveCompanion(session, NOW, {
            store,
            readSave: async () => ({ character: structuredClone(save.character) }),
            moveToken,
        });
        assert.equal(claimed.ok, true);
        if (!claimed.ok) return;
        const pending: SoloPveSession = {
            ...session,
            companionUsage: {
                petId: claimed.companion.petId,
                pveGearId: claimed.companion.pveGearId,
                consumableId: claimed.companion.consumableId,
            },
            companionCostAuthority: {
                version: 1,
                leaseValue: claimed.lease.value,
                moveToken,
                settlementState: 'pending',
            },
        };
        store.data.delete(soloPveSummonLeaseKey('Alice'));
        const charged = await settleSoloPveCompanionUsage(pending, {
            store,
            mutateSave: save.mutateSave,
            now: () => NOW + 1,
        });
        assert.equal(charged.ok, true);
        assert.equal(store.data.get(soloPveSummonLeaseKey('Alice')), claimed.lease.value);
        assert.equal((save.character.pets as Array<Record<string, any>>)[0]!.loadout.pveDurability, 1);
    });

    it('activates authority on a capable writer and settles only mixed-version unpaid deltas', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', inventory: [ITEM_ID] });
        const sessions = sessionHarness(itemSession('rolling-activation'));
        assert.equal(sessions.stored.usageAuthorityVersion, undefined);
        const activated = await executeSoloPveAction({
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'rolling-capable-wait-0001',
            action: { type: 'wait' },
        }, commonDeps(store, save, sessions));
        assert.equal(activated.status, 200);
        assert.equal(sessions.stored.usageAuthorityVersion, 1);

        const moveToken = 'rolling-paid-item-0001';
        const mixed: SoloPveSession = {
            ...sessions.stored,
            status: 'done',
            winner: 'player',
            outcome: 'win',
            itemsUsed: { [ITEM_ID]: 2 },
            itemCostAuthorities: [{
                version: 1,
                leaseValue: `solo-pve-item:${sessions.stored.sessionId}:${moveToken}`,
                moveToken,
                itemId: ITEM_ID,
                count: 1,
                chargedAt: NOW + 1,
            }],
            terminalEvidence: {
                finishedAt: NOW + 2,
                finalMoveToken: 'rolling-old-worker-0001',
                finalVersion: sessions.stored.version + 1,
                finalEventSeq: sessions.stored.eventSeq,
                winner: 'player',
                outcome: 'win',
                itemsUsed: { [ITEM_ID]: 2 },
                settlementState: 'pending',
            },
        };
        const verified = await settleSoloPveTerminalUsage(mixed, 'Alice', { readItemIntent: async () => null });
        assert.equal(verified.ok, true, 'an old rolling worker cannot strand the terminal session');
        assert.deepEqual(applySoloPveUsageCosts(save.character, mixed).inventory, [], 'only the one unpaid item is deducted');
    });
});

describe('common solo-PvE combat-item authority', () => {
    it('does not debit a paused item action that loses the session CAS', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', inventory: [ITEM_ID], itemStacks: [] });
        const sessions = sessionHarness(itemSession('item-stale-writer'));
        let releasePaused!: () => void;
        let markPaused!: () => void;
        const paused = new Promise<void>((resolve) => { markPaused = resolve; });
        const release = new Promise<void>((resolve) => { releasePaused = resolve; });
        const commit = async (expected: SoloPveSession, next: SoloPveSession) => {
            if (next.pendingItemAction?.moveToken === 'item-paused-action-0001') {
                markPaused();
                await release;
            }
            if (!isDeepStrictEqual(sessions.stored, expected)) return false;
            await sessions.write(next);
            return true;
        };
        const deps = { ...commonDeps(store, save, sessions), commit };
        const first = executeSoloPveAction({
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'item-paused-action-0001',
            action: { type: 'item', itemId: ITEM_ID },
        }, deps);
        await paused;
        const second = await executeSoloPveAction({
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'item-winning-wait-0001',
            action: { type: 'wait' },
        }, deps);
        releasePaused();
        const stale = await first;
        assert.equal(second.status, 200);
        assert.equal(stale.status, 409);
        assert.deepEqual(save.character.inventory, [ITEM_ID]);
        assert.equal(save.character.soloPveItemSettlements, undefined);
        assert.equal(sessions.stored.pendingItemAction, undefined);
        assert.deepEqual(sessions.stored.recentMoveTokens, ['item-winning-wait-0001']);
        assert.equal(store.data.has(soloPveItemActionLeaseKey('Alice')), false);
        assert.equal(store.data.has(soloPveActiveItemIntentKey(sessions.stored.sessionId)), false);
        assert.equal(store.data.has(soloPveItemIntentKey(sessions.stored.sessionId, 'item-paused-action-0001')), false,
            'a pre-debit CAS loser leaves no external recovery intent');
    });

    it('helps forward an exact charged intent after a paused old writer erases the session reservation', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', inventory: [ITEM_ID], itemStacks: [] });
        const original = itemSession('item-old-writer-overwrite');
        const sessions = sessionHarness(original);
        let debitLanded!: () => void;
        let resumeNew!: () => void;
        const debit = new Promise<void>((resolve) => { debitLanded = resolve; });
        const resume = new Promise<void>((resolve) => { resumeNew = resolve; });
        const baseDeps = commonDeps(store, save, sessions);
        const commit = async (expected: SoloPveSession, next: SoloPveSession) => {
            if (!isDeepStrictEqual(sessions.stored, expected)) return false;
            await sessions.write(next);
            return true;
        };
        const settleItem: NonNullable<SoloPveActionServiceDeps['settleItem']> = async (session, authority) => {
            const result = await baseDeps.settleItem!(session, authority);
            if (result.ok && !result.replayed) {
                debitLanded();
                await resume;
            }
            return result;
        };
        const command = {
            sessionId: original.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'item-old-overwrite-0001',
            action: { type: 'item' as const, itemId: ITEM_ID },
        };
        const settling = executeSoloPveAction(command, { ...baseDeps, commit, settleItem });
        await debit;
        assert.deepEqual(save.character.inventory, []);
        assert.ok(store.data.has(soloPveActiveItemIntentKey(original.sessionId)));
        assert.ok(sessions.stored.pendingItemAction, 'the new reservation won before the old writer resumed');

        // A rolling old worker ignores pendingItemAction and unconditionally
        // writes its stale successor after the action lock expired.
        await sessions.write({
            ...original,
            version: 2,
            recentMoveTokens: ['old-worker-wait-0001'],
            lastActionAt: NOW + 1_001,
            expiresAt: original.expiresAt + 1_001,
        });
        resumeNew();
        const recovered = await settling;
        assert.equal(recovered.status, 200);
        assert.equal(recovered.body.applied, true);
        assert.deepEqual(sessions.stored.recentMoveTokens, [command.moveToken]);
        assert.equal(sessions.stored.pendingItemAction, undefined);
        assert.equal((sessions.stored.itemCostAuthorities ?? []).length, 1);
        assert.equal((save.character.soloPveItemSettlements as Array<{ committedAt?: number }>)[0]?.committedAt, NOW + 1_001);
        assert.equal(store.data.has(soloPveItemActionLeaseKey('Alice')), false);
        assert.equal(store.data.has(soloPveActiveItemIntentKey(original.sessionId)), false);
        assert.equal(store.data.has(soloPveItemIntentKey(original.sessionId, command.moveToken)), false);
    });

    it('recovers an exact pending reservation after its session acknowledgement and readback are lost', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', inventory: [ITEM_ID], itemStacks: [] });
        const sessions = sessionHarness(itemSession('item-pending-ack-loss'));
        const command = {
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'item-pending-ack-0001',
            action: { type: 'item' as const, itemId: ITEM_ID },
        };
        sessions.failNextWriteReadback();
        await assert.rejects(
            executeSoloPveAction(command, commonDeps(store, save, sessions)),
            /injected-session-write-ack-loss/,
        );
        assert.ok(sessions.stored.pendingItemAction, 'the exact pending session did commit');
        assert.deepEqual(save.character.inventory, [ITEM_ID], 'no debit occurs before the pending write is acknowledged');
        assert.equal(store.data.has(soloPveActiveItemIntentKey(sessions.stored.sessionId)), false);

        const recovered = await executeSoloPveAction(command, commonDeps(store, save, sessions));
        assert.equal(recovered.status, 200);
        assert.equal(recovered.body.applied, true);
        assert.deepEqual(save.character.inventory, []);
        assert.deepEqual(sessions.stored.recentMoveTokens, [command.moveToken]);
        assert.equal(store.data.has(soloPveItemActionLeaseKey('Alice')), false);
        assert.equal(store.data.has(soloPveActiveItemIntentKey(sessions.stored.sessionId)), false);
    });

    it('accepts an intent CAS acknowledgement loss only from exact stored readback', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', inventory: [ITEM_ID], itemStacks: [] });
        const sessions = sessionHarness(itemSession('item-intent-ack-loss'));
        store.compareSetCommitThenThrow = true;
        const result = await executeSoloPveAction({
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'item-intent-ack-0001',
            action: { type: 'item', itemId: ITEM_ID },
        }, commonDeps(store, save, sessions));
        assert.equal(result.status, 200);
        assert.equal(result.body.applied, true);
        assert.deepEqual(save.character.inventory, []);
        assert.deepEqual(sessions.stored.recentMoveTokens, ['item-intent-ack-0001']);
        assert.equal(store.data.has(soloPveActiveItemIntentKey(sessions.stored.sessionId)), false);
    });

    it('allows only one of two pre-sealed sessions to spend one item and terminal settlement never charges again', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', inventory: [ITEM_ID], itemStacks: [], serverSettlementReceipts: receiptChurn() });
        const first = sessionHarness(itemSession('item-session-a'));
        const second = sessionHarness(itemSession('item-session-b'));
        const command = (session: SoloPveSession, token: string) => ({
            sessionId: session.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: token,
            action: { type: 'item' as const, itemId: ITEM_ID },
        });

        const used = await executeSoloPveAction(command(first.stored, 'item-action-a-0001'), commonDeps(store, save, first));
        assert.equal(used.status, 200);
        assert.equal(used.body.applied, true);
        assert.deepEqual(save.character.inventory, []);
        const blocked = await executeSoloPveAction(command(second.stored, 'item-action-b-0001'), commonDeps(store, save, second));
        assert.equal(blocked.status, 409);
        assert.equal(second.stored.version, 1, 'the unpaid action never lands');
        assert.equal(store.data.has(soloPveItemActionLeaseKey('Alice')), false);

        save.character = {
            ...save.character,
            inventory: [ITEM_ID],
            serverSettlementReceipts: receiptChurn(80),
        };
        const duplicate = await executeSoloPveAction(command(first.stored, 'item-action-a-0001'), commonDeps(store, save, first));
        assert.equal(duplicate.body.duplicate, true);
        assert.deepEqual(save.character.inventory, [ITEM_ID], 'replenishment cannot be consumed by an old action replay');
        const terminal = { ...first.stored, status: 'done' as const, winner: 'player' as const, outcome: 'win' as const };
        assert.deepEqual(applySoloPveUsageCosts(save.character, terminal).inventory, [ITEM_ID], 'terminal settlement does not charge action-paid items');
        assert.equal((save.character.soloPveItemSettlements as unknown[]).length, 1);
    });

    it('recovers a committed item charge after acknowledgement loss despite receipt churn and replenishment', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', inventory: [ITEM_ID], itemStacks: [], serverSettlementReceipts: receiptChurn() });
        const sessions = sessionHarness(itemSession('item-ack-recovery'));
        const command = {
            sessionId: sessions.stored.sessionId,
            ownerSlug: 'Alice',
            expectedVersion: 1,
            moveToken: 'item-ack-loss-0001',
            action: { type: 'item' as const, itemId: ITEM_ID },
        };
        save.throwAfterNextCommit();
        await assert.rejects(executeSoloPveAction(command, commonDeps(store, save, sessions)), /injected-save-commit-ack-loss/);
        assert.equal(sessions.stored.version, 1);
        assert.ok(store.data.has(soloPveItemActionLeaseKey('Alice')));
        assert.ok(store.data.has(soloPveActiveItemIntentKey(sessions.stored.sessionId)),
            'lost save acknowledgement retains the exact external action intent');
        assert.deepEqual(save.character.inventory, []);
        const pendingBeforeChurn = (save.character.soloPveItemSettlements as Array<{
            markerId: string;
            recoverUntil: number;
            committedAt?: number;
        }>)[0]!;
        assert.equal(pendingBeforeChurn.recoverUntil, sessions.stored.expiresAt);
        assert.equal(pendingBeforeChurn.committedAt, undefined);

        // Simulate lease expiry followed by more than the soft marker limit of
        // fully committed actions. The original uncommitted marker remains
        // protected through its session recovery horizon.
        store.data.delete(soloPveItemActionLeaseKey('Alice'));
        save.character = {
            ...save.character,
            inventory: Array.from({ length: 140 }, () => ITEM_ID),
            serverSettlementReceipts: receiptChurn(80),
        };
        for (let index = 0; index < 129; index += 1) {
            const churnSession = itemSession(`item-churn-session-${String(index).padStart(3, '0')}`);
            const moveToken = `item-churn-${String(index).padStart(4, '0')}`;
            const lease = await claimSoloPveItemActionLease(store, 'Alice', churnSession.sessionId, moveToken);
            assert.ok(lease);
            const provisional = {
                version: 1 as const,
                leaseValue: lease.value,
                moveToken,
                itemId: ITEM_ID,
                count: 1,
            };
            const charged = await settleSoloPveItemActionUsage(churnSession, provisional, {
                store,
                mutateSave: save.mutateSave,
                now: () => NOW + 2_000 + index,
            });
            assert.equal(charged.ok, true);
            if (!charged.ok) continue;
            const authority = soloPveItemCostAuthority({ session: churnSession, ...provisional, chargedAt: charged.chargedAt });
            const finalized = await finalizeSoloPveItemActionUsage(churnSession, authority, {
                mutateSave: save.mutateSave,
                now: () => NOW + 3_000 + index,
            });
            assert.equal(finalized.ok, true);
            await releaseSoloPveItemActionLease(store, 'Alice', churnSession.sessionId, moveToken);
        }
        const originalMarkerId = `${sessions.stored.sessionId}:${command.moveToken}`;
        const preserved = (save.character.soloPveItemSettlements as Array<{
            markerId: string;
            recoverUntil: number;
            committedAt?: number;
        }>).find((marker) => marker.markerId === originalMarkerId);
        assert.ok(preserved);
        assert.equal(preserved.recoverUntil, sessions.stored.expiresAt);
        assert.equal(preserved.committedAt, undefined);

        save.character = { ...save.character, inventory: [ITEM_ID], serverSettlementReceipts: receiptChurn(80) };
        const retry = await executeSoloPveAction(command, commonDeps(store, save, sessions));
        assert.equal(retry.status, 200);
        assert.equal(retry.body.applied, true);
        assert.deepEqual(save.character.inventory, [ITEM_ID]);
        const finalMarkers = save.character.soloPveItemSettlements as Array<{ markerId: string; committedAt?: number }>;
        assert.ok(finalMarkers.length <= 128);
        assert.ok(finalMarkers.some((marker) => marker.markerId === originalMarkerId && Number(marker.committedAt) > 0));
        assert.equal(store.data.has(soloPveItemActionLeaseKey('Alice')), false);
        assert.equal(store.data.has(soloPveActiveItemIntentKey(sessions.stored.sessionId)), false);
    });

    it('finalizing one item charge never evicts other live pending recovery markers above the soft cap', async () => {
        const store = new LeaseStore();
        const save = saveHarness({ name: 'Alice', inventory: [ITEM_ID], itemStacks: [] });
        const session = itemSession('item-finalize-retention');
        const moveToken = 'item-finalize-retention-0001';
        const lease = await claimSoloPveItemActionLease(store, 'Alice', session.sessionId, moveToken);
        assert.ok(lease);
        const provisional = {
            version: 1 as const,
            leaseValue: lease!.value,
            moveToken,
            itemId: ITEM_ID,
            count: 1,
        };
        const charged = await settleSoloPveItemActionUsage(session, provisional, {
            store,
            mutateSave: save.mutateSave,
            now: () => NOW + 1_000,
        });
        assert.equal(charged.ok, true);
        if (!charged.ok) return;
        const authority = soloPveItemCostAuthority({ session, ...provisional, chargedAt: charged.chargedAt });
        const current = save.character.soloPveItemSettlements as Array<Record<string, unknown>>;
        const pending = Array.from({ length: 130 }, (_, index) => ({
            markerId: `pending-session-${String(index).padStart(3, '0')}:pending-move-${String(index).padStart(4, '0')}`,
            fingerprint: String(index % 10).repeat(64),
            chargedAt: NOW + 10 + index,
            recoverUntil: NOW + 60_000,
        }));
        save.character = { ...save.character, soloPveItemSettlements: [...current, ...pending] };

        const finalized = await finalizeSoloPveItemActionUsage(session, authority, {
            mutateSave: save.mutateSave,
            now: () => NOW + 2_000,
        });
        assert.equal(finalized.ok, true);
        const retained = save.character.soloPveItemSettlements as Array<{ markerId: string; committedAt?: number }>;
        assert.equal(retained.length, 131);
        assert.equal(pending.every(({ markerId }) => retained.some((marker) => marker.markerId === markerId)), true);
        assert.ok(retained.some((marker) => marker.markerId === `${session.sessionId}:${moveToken}` && Number(marker.committedAt) > 0));
    });
});
