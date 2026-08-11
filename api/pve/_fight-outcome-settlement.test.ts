import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import { settleSoloPveTerminalUsage } from '../solo-pve/_usage-authority.js';
import type { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    applyPveOutcomeWithReceipt,
    pveOutcomeReceiptIdentity,
    reconcileTerminalSoloPveOutcome,
    settlePveFightOutcome,
    soloPveNeedsAutomaticOutcome,
} from './_fight-outcome-settlement.js';

const NOW = 1_800_000_000_000;

function fighter(name: string, hp: number): PvpFighter {
    return {
        name,
        hp,
        maxHp: 100,
        chakra: 100,
        maxChakra: 100,
        stamina: 100,
        maxStamina: 100,
        shield: 0,
        statuses: [],
        pos: name === 'Alice' ? 62 : 63,
        character: { name, level: 10, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

function terminalSession(overrides: Partial<SoloPveSession> = {}): SoloPveSession {
    const session = createSoloPveSession({
        sessionId: 'mission-outcome-run',
        ownerSlug: 'Alice',
        encounter: { kind: 'mission', id: 'combat-e-drill', bindingId: 'mission-outcome-run' },
        player: fighter('Alice', 0),
        enemy: fighter('Enemy', 25),
        now: NOW,
    });
    return {
        ...session,
        status: 'done',
        winner: 'enemy',
        outcome: 'loss',
        ...overrides,
    };
}

describe('atomic PvE physical-outcome receipts', () => {
    it('keeps pre-upgrade and mixed rolling-worker terminal usage payable exactly once', async () => {
        const modern = terminalSession({
            itemsUsed: { 'battle-pill': 1 },
            companionUsage: { petId: 'pet-legacy', pveGearId: 'pve-crest', consumableId: 'pet-tonic' },
            terminalEvidence: {
                finishedAt: NOW,
                finalMoveToken: 'legacy-final-move-0001',
                finalVersion: 2,
                finalEventSeq: 1,
                winner: 'enemy',
                outcome: 'loss',
                itemsUsed: { 'battle-pill': 1 },
                companionUsage: { petId: 'pet-legacy', pveGearId: 'pve-crest', consumableId: 'pet-tonic' },
                settlementState: 'pending',
            },
        });
        assert.equal(modern.usageAuthorityVersion, undefined, 'creation stays rollout-neutral until a capable action writer commits');
        modern.usageAuthorityVersion = 1;
        const mixedWorker = await settleSoloPveTerminalUsage(modern, 'Alice', { readItemIntent: async () => null });
        assert.equal(mixedWorker.ok, true, 'an older action worker cannot strand an opted-in terminal session');

        for (const terminalOutcome of ['loss', 'fled'] as const) {
            const legacy = structuredClone(modern);
            legacy.sessionId = `legacy-${terminalOutcome}-run`;
            legacy.encounter = { ...legacy.encounter, bindingId: legacy.sessionId };
            legacy.outcome = terminalOutcome;
            legacy.terminalEvidence = { ...legacy.terminalEvidence!, outcome: terminalOutcome };
            delete legacy.usageAuthorityVersion;
            const accepted = await settleSoloPveTerminalUsage(legacy, 'Alice', { readItemIntent: async () => null });
            assert.equal(accepted.ok, true, `a pre-upgrade ${terminalOutcome} must not be stranded`);

            const startingCharacter = {
                name: 'Alice',
                hp: 100,
                maxHp: 100,
                inventory: ['battle-pill'],
                pets: [{
                    id: 'pet-legacy',
                    loadout: { pve: 'pve-crest', pveDurability: 2, consumable: 'pet-tonic' },
                }],
            };
            const applied = applyPveOutcomeWithReceipt({
                character: startingCharacter,
                session: legacy,
                playerName: 'Alice',
                outcome: 'loss',
                now: NOW,
            });
            assert.equal(applied.ok, true);
            if (!applied.ok) continue;
            assert.deepEqual(applied.character.inventory, [], terminalOutcome);
            const chargedPet = (applied.character.pets as Array<Record<string, any>>)[0]!;
            assert.equal(chargedPet.loadout.pveDurability, 1, terminalOutcome);
            assert.equal(chargedPet.loadout.consumable, undefined, terminalOutcome);

            // There is no later win claim on either branch. A state poll or
            // lost response can replay the same terminal receipt after the
            // player replenishes inventory without consuming it again.
            const replenished = { ...applied.character, inventory: ['battle-pill'] };
            const replay = applyPveOutcomeWithReceipt({
                character: replenished,
                session: legacy,
                playerName: 'Alice',
                outcome: 'loss',
                now: NOW + 30_000,
            });
            assert.equal(replay.ok, true);
            if (!replay.ok) continue;
            assert.deepEqual(replay.character.inventory, ['battle-pill'], terminalOutcome);
            const replayPet = (replay.character.pets as Array<Record<string, any>>)[0]!;
            assert.equal(replayPet.loadout.pveDurability, 1, terminalOutcome);
        }
    });

    it('writes hospitalization and its replay receipt in the same character snapshot', () => {
        const session = terminalSession();
        const applied = applyPveOutcomeWithReceipt({
            character: { name: 'Alice', hp: 100, maxHp: 100 },
            session,
            playerName: 'Alice',
            outcome: 'loss',
            now: NOW,
        });
        assert.equal(applied.ok, true);
        if (!applied.ok) return;
        assert.equal(applied.value.applied, true);
        assert.equal(applied.character.hp, 0);
        assert.equal(applied.character.hospitalized, true);
        const identity = pveOutcomeReceiptIdentity(session, 'Alice', 'loss');
        const receipts = applied.character.serverSettlementReceipts as Array<{ requestId: string }>;
        assert.equal(receipts[0]?.requestId, identity.requestId);

        const replay = applyPveOutcomeWithReceipt({
            character: applied.character,
            session,
            playerName: 'Alice',
            outcome: 'loss',
            now: NOW + 30_000,
        });
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        assert.equal(replay.value.replayed, true);
        assert.equal(replay.character.hospitalizedUntil, applied.character.hospitalizedUntil, 'replay must not extend hospitalization');
    });

    it('does not backfill legacy usage after a mode receipt already settled the run', () => {
        const preUpgrade = terminalSession({
            itemsUsed: { 'battle-pill': 1 },
            companionUsage: { petId: 'pet-settled', pveGearId: 'pve-crest' },
        });
        const priorOutcomeReceipt = applyPveOutcomeWithReceipt({
            character: { name: 'Alice', hp: 100, maxHp: 100 },
            session: preUpgrade,
            playerName: 'Alice',
            outcome: 'loss',
            now: NOW,
        });
        assert.equal(priorOutcomeReceipt.ok, true);
        if (!priorOutcomeReceipt.ok) return;

        delete preUpgrade.usageAuthorityVersion;
        preUpgrade.settlementState = 'settled';
        const afterOldQueue = {
            ...priorOutcomeReceipt.character,
            inventory: ['battle-pill'],
            pets: [{ id: 'pet-settled', loadout: { pve: 'pve-crest', pveDurability: 2 } }],
        };
        const replay = applyPveOutcomeWithReceipt({
            character: afterOldQueue,
            session: preUpgrade,
            playerName: 'Alice',
            outcome: 'loss',
            now: NOW + 60_000,
        });
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        assert.deepEqual(replay.character.inventory, ['battle-pill']);
        assert.equal(((replay.character.pets as Array<Record<string, any>>)[0]!.loadout as Record<string, unknown>).pveDurability, 2);
        assert.equal(replay.value.migratedLegacyUsage, undefined);

        preUpgrade.settlementState = 'pending';
        const committedOldQueue = applyPveOutcomeWithReceipt({
            character: { ...afterOldQueue, pendingCombatMissionClaims: ['combat-e-drill'] },
            session: preUpgrade,
            playerName: 'Alice',
            outcome: 'loss',
            now: NOW + 90_000,
        });
        assert.equal(committedOldQueue.ok, true);
        if (!committedOldQueue.ok) return;
        assert.deepEqual(committedOldQueue.character.inventory, ['battle-pill']);
        assert.equal(((committedOldQueue.character.pets as Array<Record<string, any>>)[0]!.loadout as Record<string, unknown>).pveDurability, 2);
        assert.equal(committedOldQueue.value.migratedLegacyUsage, undefined);
    });

    it('migrates an old KV receipt without re-applying the outcome', () => {
        const applied = applyPveOutcomeWithReceipt({
            character: { name: 'Alice', hp: 77, maxHp: 100 },
            session: terminalSession(),
            playerName: 'Alice',
            outcome: 'loss',
            now: NOW,
            legacyReceiptExists: true,
        });
        assert.equal(applied.ok, true);
        if (!applied.ok) return;
        assert.equal(applied.value.replayed, true);
        assert.equal(applied.value.migratedLegacyReceipt, true);
        assert.equal(applied.character.hp, 77);
        assert.ok(Array.isArray(applied.character.serverSettlementReceipts));
    });

    it('recovers a compatibility-marker failure without applying the save effect twice', async () => {
        const session = terminalSession();
        let character: Record<string, unknown> = { name: 'Alice', hp: 100, maxHp: 100 };
        let version = 1;
        const mutateSave: typeof mutatePlayerSave = async (_playerName, mutate) => {
            const decision = await mutate({ playerName: 'Alice', saveKey: 'save:Alice', record: { character, _saveVersion: version }, character });
            if (!decision.ok) return decision;
            if (decision.write !== false) {
                character = decision.character;
                version += 1;
            }
            return { ok: true, value: decision.value, record: { character, _saveVersion: version }, character: decision.character, _saveVersion: version };
        };
        let markerWrites = 0;
        const deps = {
            now: () => NOW,
            readLegacyReceipt: async () => null,
            mutateSave,
            writeLegacyReceipt: async () => {
                markerWrites += 1;
                if (markerWrites === 1) throw new Error('injected marker write failure');
            },
        };

        await assert.rejects(settlePveFightOutcome(session, 'Alice', deps), /injected marker write failure/);
        const firstHospitalizedUntil = character.hospitalizedUntil;
        const replay = await settlePveFightOutcome(session, 'Alice', deps);
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        assert.equal(replay.replayed, true);
        assert.equal(character.hospitalizedUntil, firstHospitalizedUntil);
        assert.equal(version, 2, 'receipt replay must not manufacture another save write');
    });

    it('fails closed for another player and defers the winning Academy HP script', async () => {
        const session = terminalSession({
            encounter: { kind: 'academy-spar', id: 'academy-spar-dummy' },
            winner: 'player',
            outcome: 'win',
            player: fighter('Alice', 40),
        });
        const wrongOwner = await settlePveFightOutcome(session, 'Mallory', {
            readLegacyReceipt: async () => null,
            writeLegacyReceipt: async () => undefined,
        });
        assert.deepEqual(wrongOwner, { ok: false, status: 403, error: 'That fight belongs to another player.' });
        const deferred = await settlePveFightOutcome(session, 'Alice', {
            readLegacyReceipt: async () => { throw new Error('deferred result must not touch storage'); },
            writeLegacyReceipt: async () => { throw new Error('deferred result must not touch storage'); },
        });
        assert.equal(deferred.ok, true);
        if (deferred.ok) assert.equal(deferred.deferredToSettlement, true);
    });
});

describe('automatic terminal reconciliation scope', () => {
    it('covers every mission result and only non-winning story/Academy results', () => {
        assert.equal(soloPveNeedsAutomaticOutcome(terminalSession()), true);
        assert.equal(soloPveNeedsAutomaticOutcome(terminalSession({ winner: 'player', outcome: 'win' })), true);
        assert.equal(soloPveNeedsAutomaticOutcome(terminalSession({ encounter: { kind: 'story-boss', id: 'boss' } })), true);
        assert.equal(soloPveNeedsAutomaticOutcome(terminalSession({ encounter: { kind: 'story-boss', id: 'boss' }, winner: 'player', outcome: 'win' })), false);
        assert.equal(soloPveNeedsAutomaticOutcome(terminalSession({ encounter: { kind: 'academy-spar', id: 'dummy' } })), true);
        assert.equal(soloPveNeedsAutomaticOutcome(terminalSession({ encounter: { kind: 'generic-ai', id: 'enemy' } })), false);
        assert.equal(soloPveNeedsAutomaticOutcome(terminalSession({ status: 'active', winner: null, outcome: null })), false);
    });

    it('does nothing for an unrelated runtime mode', async () => {
        const reconciled = await reconcileTerminalSoloPveOutcome(
            terminalSession({ encounter: { kind: 'weekly-boss', id: 'week' } }),
            'Alice',
            {
                readLegacyReceipt: async () => { throw new Error('must not read'); },
                writeLegacyReceipt: async () => { throw new Error('must not write'); },
                settleTerminalUsage: async (session) => ({ ok: true, session, replayed: true }),
            },
        );
        assert.equal(reconciled, null);
    });
});
