import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import type { mutatePlayerSave } from '../save/_mutate-player-save.js';
import type { TowerSession } from '../towers/_tower-session.js';
import { makePveEngineTestSession } from '../towers/_pve-engine-test-fixture.js';
import { applyAiFightOutcomeToCharacter, sessionSeedsFullHp } from '../missions/_ai-fight-outcome.js';
import {
    applyPveOutcomeBodyOnce,
    applyPveOutcomeWithReceipt,
    pveOutcomeReceiptIdentity,
    settlePveFightOutcome,
} from './_fight-outcome-settlement.js';

/*
 * The PvE "free heal" paths: settling a fight must never RAISE a player's HP
 * above what they held. Two shapes did.
 *
 *   - A Tower run seats its squad at FULL HP, and the Tower lapse (and a
 *     crafted /api/pve/fight-outcome) wrote the remainder back: enter at 100 of
 *     800, lapse at 600, leave at 600.
 *   - Modes that settle HP under their own receipt (Endless, the Weekly Boss,
 *     sealed AI fights, the caravan ambush, a story boss win, a Hollow Gate dive
 *     fight) could have it written AGAIN by the generic path from the same
 *     session, later, after the player had lost HP elsewhere. (A story boss
 *     win now shares the generic receipt instead of being deferred; see
 *     _delayed-settlement-paths.test.ts.)
 * The handler-level journeys are in _free-heal-journeys.test.ts.
 */

const NOW = 1_800_000_000_000;

function fighter(name: string, hp: number, maxHp = 100): PvpFighter {
    return {
        name, hp, maxHp, chakra: 40, maxChakra: 100, stamina: 30, maxStamina: 100,
        shield: 0, statuses: [], pos: 62,
        character: { name, level: 10, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

function soloSession(over: Partial<SoloPveSession> & { encounter?: SoloPveSession['encounter'] } = {}): SoloPveSession {
    const session = createSoloPveSession({
        sessionId: over.sessionId ?? 'free-heal-solo',
        ownerSlug: 'alice',
        encounter: over.encounter ?? { kind: 'generic-ai', id: 'rival' },
        player: fighter('Alice', 70),
        enemy: fighter('Enemy', 30),
        now: NOW,
    });
    const done: SoloPveSession = { ...session, status: 'done', winner: 'enemy', outcome: 'loss', ...over };
    return {
        ...done,
        terminalEvidence: done.terminalEvidence ?? {
            finishedAt: NOW, finalMoveToken: 'terminal', finalVersion: done.version, finalEventSeq: done.eventSeq,
            winner: done.winner ?? 'enemy', outcome: done.outcome ?? 'loss', itemsUsed: {}, settlementState: 'pending',
        },
    };
}

function towerRun(actorHp: number, over: Partial<TowerSession> = {}): TowerSession {
    const session = makePveEngineTestSession({ enemyLevel: 10, runId: 'free-heal-tower', playerMaxHp: 800 });
    session.actors[0] = { ...session.actors[0], ownerSlug: 'rill', hp: actorHp };
    return { ...session, status: 'done', winner: 'enemy', ...over };
}

const untouchedStorage = {
    readLegacyReceipt: async () => { throw new Error('must not touch storage'); },
    writeLegacyReceipt: async () => { throw new Error('must not touch storage'); },
    mutateSave: (async () => { throw new Error('must not write the save'); }) as unknown as typeof mutatePlayerSave,
};

describe('a Tower run seats its squad at full HP, so settling it never raises HP', () => {
    it('lowers HP to what the run left, but never lifts a wounded save to it', () => {
        const lifted = applyPveOutcomeWithReceipt({
            character: { name: 'rill', hp: 100, maxHp: 800 }, session: towerRun(600), playerName: 'rill', outcome: 'loss', now: NOW,
        });
        assert.equal(lifted.ok, true);
        if (!lifted.ok) return;
        assert.equal(lifted.character.hp, 100, 'entering at 100 and walking out of a run at 600 is no heal');
        assert.equal(lifted.value.applied, true, 'the settlement still lands (and its receipt), it just costs nothing here');

        const cost = applyPveOutcomeWithReceipt({
            character: { name: 'rill', hp: 700, maxHp: 800 }, session: towerRun(250), playerName: 'rill', outcome: 'loss', now: NOW,
        });
        assert.equal(cost.ok && cost.character.hp, 250, 'damage the run did below the save still costs');

        const down = applyPveOutcomeWithReceipt({
            character: { name: 'rill', hp: 700, maxHp: 800 }, session: towerRun(0), playerName: 'rill', outcome: 'loss', now: NOW,
        });
        assert.equal(down.ok && down.character.hospitalized, true, 'a fighter who fell in the run is still admitted');
    });

    it('applies only to Tower runs seeded at full HP: the caravan ambush and Solo-PvE fights carry HP', () => {
        assert.equal(sessionSeedsFullHp(towerRun(600)), true);
        const ambush = towerRun(600, { caravanAmbush: { runId: 'caravan-run', playerSlug: 'rill', nodeId: 'node-4' } });
        assert.equal(sessionSeedsFullHp(ambush), false, 'the ambush re-seeds its fighter from the save');
        assert.equal(sessionSeedsFullHp(soloSession()), false, 'every Solo-PvE builder seeds HP from the save');

        const carried = applyPveOutcomeWithReceipt({
            character: { name: 'rill', hp: 100, maxHp: 800 }, session: ambush, playerName: 'rill', outcome: 'loss', now: NOW,
        });
        assert.equal(carried.ok && carried.character.hp, 600, 'a fight seeded from the save writes what it left');
    });

    it('the pure helper treats a save with no readable HP as full', () => {
        const actor = { ...fighter('Rill', 300, 800) };
        assert.equal(applyAiFightOutcomeToCharacter({ maxHp: 800 }, 'loss', actor, NOW, false, false, true).hp, 300);
        assert.equal(applyAiFightOutcomeToCharacter({ hp: 50, maxHp: 800 }, 'loss', actor, NOW, false, false, false).hp, 300,
            'without the flag nothing changes');
    });
});

describe('the generic path leaves alone the fights their own mode settles', () => {
    it('defers a WON Academy spar to the spar settlement, which grants a scripted HP', async () => {
        const won = soloSession({ encounter: { kind: 'academy-spar', id: 'dummy' }, winner: 'player', outcome: 'win', player: fighter('Alice', 60) });
        const deferred = await settlePveFightOutcome(won, 'alice', untouchedStorage);
        assert.equal(deferred.ok, true);
        if (deferred.ok) assert.equal(deferred.deferredToSettlement, true);
    });

    it('writes a WON story boss\'s fight HP once; the story settle adds its +25 on top (api/story/settle.ts)', async () => {
        const won = soloSession({ encounter: { kind: 'story-boss', id: 'boss' }, winner: 'player', outcome: 'win', player: fighter('Alice', 60) });
        let written = null as Record<string, unknown> | null;
        const mutateSave: typeof mutatePlayerSave = async (_name, mutate) => {
            const character = { name: 'alice', hp: 90, maxHp: 100 };
            const decision = await mutate({ playerName: 'alice', saveKey: 'save:alice', record: { character, _saveVersion: 1 }, character });
            if (!decision.ok) return decision;
            written = decision.character;
            return { ok: true, value: decision.value, record: { character: decision.character, _saveVersion: 2 }, character: decision.character, _saveVersion: 2 };
        };
        const settled = await settlePveFightOutcome(won, 'alice', { readLegacyReceipt: async () => null, writeLegacyReceipt: async () => undefined, mutateSave });
        assert.equal(settled.ok && settled.applied, true);
        assert.equal(written!.hp, 60, 'the HP the fight left, and its receipt, so the story settle does not write it again');
    });

    it('still settles a LOST story boss, which its settlement refuses', async () => {
        const lost = soloSession({ encounter: { kind: 'story-boss', id: 'boss' }, player: fighter('Alice', 0) });
        let written = null as Record<string, unknown> | null;
        const mutateSave: typeof mutatePlayerSave = async (_name, mutate) => {
            const character = { name: 'alice', hp: 90, maxHp: 100 };
            const decision = await mutate({ playerName: 'alice', saveKey: 'save:alice', record: { character, _saveVersion: 1 }, character });
            if (!decision.ok) return decision;
            written = decision.character;
            return { ok: true, value: decision.value, record: { character: decision.character, _saveVersion: 2 }, character: decision.character, _saveVersion: 2 };
        };
        const settled = await settlePveFightOutcome(lost, 'alice', { readLegacyReceipt: async () => null, writeLegacyReceipt: async () => undefined, mutateSave });
        assert.equal(settled.ok && settled.applied, true);
        assert.equal(written!.hospitalized, true);
    });

    for (const shape of [{ sessionId: 'hgcombat-dive-1' }, { encounter: { kind: 'hollow-gate', id: 'hound' } }] as const) {
        it(`refuses a Hollow Gate dive fight (${'sessionId' in shape ? 'by its id' : 'by its kind'}): the dive settles it`, async () => {
            const refused = await settlePveFightOutcome(soloSession({ ...shape, player: fighter('Alice', 70) }), 'alice', untouchedStorage);
            assert.equal(refused.ok, false);
            if (!refused.ok) assert.equal(refused.status, 409);
        });
    }
});

describe('a mode writes its fight\'s body at most once across its own settlement and the generic path', () => {
    const save = () => ({ name: 'alice', hp: 100, maxHp: 100, chakra: 90, maxChakra: 100, stamina: 80, maxStamina: 100 });

    it('writes the body and stamps the generic receipt, so a later generic settle replays', () => {
        const session = soloSession();
        const mode = applyPveOutcomeBodyOnce({ character: save(), session, playerName: 'alice', now: NOW });
        assert.equal(mode.bodyWritten, true);
        assert.equal(mode.character.hp, 70);

        // The player then loses HP elsewhere, and the generic path is asked again.
        const later = applyPveOutcomeWithReceipt({ character: { ...mode.character, hp: 20 }, session, playerName: 'alice', outcome: 'loss', now: NOW + 60_000 });
        assert.equal(later.ok, true);
        if (!later.ok) return;
        assert.equal(later.value.replayed, true, 'the fight was already settled');
        assert.equal(later.character.hp, 20, 'HP is NOT set back up to the fight\'s end value');
    });

    it('leaves HP alone when the generic path got there first, and still charges what that path did not', () => {
        const base = soloSession();
        const session: SoloPveSession = { ...base, encounter: { ...base.encounter, metadata: { continuousVitals: true } } };
        const generic = applyPveOutcomeWithReceipt({ character: save(), session, playerName: 'alice', outcome: 'loss', now: NOW });
        assert.equal(generic.ok, true);
        if (!generic.ok) return;
        const mode = applyPveOutcomeBodyOnce({
            character: { ...generic.character, hp: 20 }, session, playerName: 'alice', now: NOW + 60_000,
            // A mode that charges resources the generic path also charged.
            continuousVitals: true,
        });
        assert.equal(mode.bodyWritten, false);
        assert.equal(mode.character.hp, 20, 'no second HP write');
        assert.equal(mode.character.chakra, 40, 'decrease-only resources settle to the same value, not refunded');

        const freshStart = applyPveOutcomeBodyOnce({
            character: { ...save(), hp: 20, serverSettlementReceipts: generic.character.serverSettlementReceipts },
            session: soloSession(), playerName: 'alice', now: NOW, continuousVitals: true,
        });
        assert.equal(freshStart.character.chakra, 40, 'a cost the generic path never charged is still charged');
        assert.equal(freshStart.character.hp, 20);
    });

    it('treats the generic run marker as proof, beyond the save\'s receipt window', () => {
        const mode = applyPveOutcomeBodyOnce({ character: { ...save(), hp: 20 }, session: soloSession(), playerName: 'alice', now: NOW, markedSettled: true });
        assert.equal(mode.bodyWritten, false);
        assert.equal(mode.character.hp, 20);
        assert.equal(mode.character.serverSettlementReceipts, undefined, 'and stamps nothing it did not write');
    });

    it('keys the receipt on the session\'s own result, whatever label the mode settles it under', () => {
        const session = soloSession({ outcome: 'fled' as SoloPveSession['outcome'] });
        const mode = applyPveOutcomeBodyOnce({ character: save(), session, playerName: 'alice', now: NOW, outcome: 'forfeit' });
        const receipts = mode.character.serverSettlementReceipts as Array<{ requestId: string; fingerprint: string }>;
        assert.deepEqual(
            { requestId: receipts[0].requestId, fingerprint: receipts[0].fingerprint },
            pveOutcomeReceiptIdentity(session, 'alice'),
            'the generic path computes the same identity, so it replays',
        );
    });

    it('does the same for the caravan ambush\'s Tower run, which carries its HP', () => {
        const ambush = towerRun(600, { caravanAmbush: { runId: 'caravan-run', playerSlug: 'rill', nodeId: 'node-4' } });
        const mode = applyPveOutcomeBodyOnce({ character: { name: 'rill', hp: 700, maxHp: 800 }, session: ambush, playerName: 'rill', now: NOW, outcome: 'forfeit', continuousVitals: true });
        assert.equal(mode.bodyWritten, true);
        assert.equal(mode.character.hp, 600);
        const later = applyPveOutcomeWithReceipt({ character: { ...mode.character, hp: 90 }, session: ambush, playerName: 'rill', outcome: 'loss', now: NOW + 60_000 });
        assert.equal(later.ok && later.value.replayed, true);
        assert.equal(later.ok && later.character.hp, 90);
    });
});
