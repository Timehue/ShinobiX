import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
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
    const terminal: SoloPveSession = {
        ...session,
        status: 'done',
        winner: 'enemy',
        outcome: 'loss',
        ...overrides,
    };
    return {
        ...terminal,
        terminalEvidence: terminal.terminalEvidence ?? {
            finishedAt: NOW,
            finalMoveToken: terminal.recentMoveTokens.at(-1) ?? 'terminal',
            finalVersion: terminal.version,
            finalEventSeq: terminal.eventSeq,
            winner: terminal.winner ?? 'enemy',
            outcome: terminal.outcome ?? 'loss',
            itemsUsed: { ...terminal.itemsUsed },
            settlementState: 'pending',
        },
    };
}

describe('atomic PvE physical-outcome receipts', () => {
    it('writes hospitalization and its replay receipt in the same character snapshot', () => {
        const session = terminalSession({ itemsUsed: { 'healing-pill': 1 } });
        session.terminalEvidence = { ...session.terminalEvidence!, itemsUsed: { 'healing-pill': 1 } };
        const applied = applyPveOutcomeWithReceipt({
            character: { name: 'Alice', hp: 100, maxHp: 100, inventory: ['healing-pill'] },
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
        assert.deepEqual(applied.character.inventory, [], 'mission usage settles with the physical outcome');
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

describe('the settlement boundary honours the sealed continuous-vitals flag', () => {
    /*
     * This is the SEAM, and it is the half that was missing. The pure helper was
     * always correct and pinned by _open-world-continuous-vitals.test.ts, but
     * every field-mission fight settles through HERE — and this boundary called
     * applyAiFightOutcomeToCharacter with four arguments, so the fifth defaulted
     * to `false`. api/missions/combat-start.ts seeds the fighter from the
     * player's REAL chakra and stamina, so the fight was fought on the bar they
     * actually had and then cost them nothing: HP was charged, chakra and
     * stamina were silently refunded to their entry values.
     *
     * The same boundary serves /api/pve/fight-outcome and the automatic lapse
     * reconciler in api/_battle-lapse.ts, so quitting a losing open-world fight
     * was cheaper in the scarce resource than finishing it.
     */
    const survivor = (): PvpFighter => ({
        ...fighter('Alice', 40),
        maxHp: 100,
        chakra: 15, maxChakra: 100,
        stamina: 25, maxStamina: 100,
    });

    const stored = () => ({ name: 'Alice', hp: 100, maxHp: 100, chakra: 90, maxChakra: 100, stamina: 80, maxStamina: 100 });

    function settleWith(continuous: boolean) {
        const base = terminalSession({ status: 'done', winner: 'player', outcome: 'win' });
        const session: SoloPveSession = {
            ...base,
            player: survivor(),
            encounter: continuous
                ? { ...base.encounter, metadata: { ...(base.encounter.metadata ?? {}), continuousVitals: true } }
                : base.encounter,
        };
        return applyPveOutcomeWithReceipt({ character: stored(), session, playerName: 'Alice', outcome: 'win', now: NOW });
    }

    it('charges the chakra and stamina an open-world fight actually cost', () => {
        const out = settleWith(true);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.character.hp, 40, 'HP was always carried');
        assert.equal(out.character.chakra, 15, 'chakra must be charged, not refunded');
        assert.equal(out.character.stamina, 25, 'stamina must be charged, not refunded');
    });

    it('leaves chakra and stamina alone for a fresh-start encounter', () => {
        // The faucet guard. A fresh-start fight seeds the actor at the FULL
        // pool, so its leftovers are what remains of a free bar — writing them
        // back would let a player enter drained and bank a full one.
        const out = settleWith(false);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.character.hp, 40);
        assert.equal(out.character.chakra, 90, 'untouched');
        assert.equal(out.character.stamina, 80, 'untouched');
    });

    it('still charges the fight cost when the player is knocked out', () => {
        const base = terminalSession();
        const session: SoloPveSession = {
            ...base,
            player: { ...survivor(), hp: 0 },
            encounter: { ...base.encounter, metadata: { ...(base.encounter.metadata ?? {}), continuousVitals: true } },
        };
        const out = applyPveOutcomeWithReceipt({ character: stored(), session, playerName: 'Alice', outcome: 'loss', now: NOW });
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.character.hp, 0);
        assert.equal(out.character.hospitalized, true);
        assert.equal(out.character.chakra, 15, 'a knockout is still a fight that spent chakra');
        assert.equal(out.character.stamina, 25);
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
            },
        );
        assert.equal(reconciled, null);
    });
});
