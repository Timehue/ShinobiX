/**
 * Post-battle vitals + hospital admission for a world PvP duel
 * (api/pvp/_vitals-settlement.ts).
 *
 * The owner's rule, in one line: a knockout admits, losing admits — including
 * losing to the AFK/turn-deadline forfeit — and FLEEING is the one exit that
 * sends you back to your spot in the sector carrying your damage instead.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    PVP_HOSPITAL_DURATION_MS,
    applyPvpVitalsToCharacter,
    pvpFighterIsHospitalized,
    pvpSessionCarriesVitals,
} from './_vitals-settlement.js';
import type { PvpFighter, PvpSession } from './session.js';

const NOW = 1_700_000_000_000;

function fighter(name: string, over: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name,
        hp: 50, maxHp: 100,
        chakra: 20, maxChakra: 50,
        stamina: 30, maxStamina: 60,
        shield: 0,
        statuses: [],
        character: {},
        pos: 0,
        ...over,
    };
}

function session(over: Partial<PvpSession> = {}): PvpSession {
    return {
        battleId: 'pvp-vitals-1',
        p1: fighter('Rill'),
        p2: fighter('Dopey'),
        round: 3,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        status: 'done',
        winner: 'p1',
        continuousVitals: true,
        rewardAuthority: 'world',
        ...over,
    } as PvpSession;
}

function save(over: Record<string, unknown> = {}) {
    return {
        _saveVersion: 7,
        character: {
            name: 'Rill',
            hp: 100, maxHp: 100,
            chakra: 50, maxChakra: 50,
            stamina: 60, maxStamina: 60,
            ...over,
        },
    };
}

describe('pvpSessionCarriesVitals', () => {
    it('settles a continuous engagement and leaves a fresh-start contest alone', () => {
        assert.equal(pvpSessionCarriesVitals(session({ continuousVitals: true })), true);
        // A spar/ranked/arena row reset both fighters to full on ENTRY, so
        // persisting its exit vitals would invent damage never charged.
        assert.equal(pvpSessionCarriesVitals(session({ continuousVitals: false, rewardAuthority: 'ranked' })), false);
    });

    it('falls back to world authority for rows sealed before the flag existed', () => {
        const legacy = session({ rewardAuthority: 'world' });
        delete (legacy as { continuousVitals?: boolean }).continuousVitals;
        assert.equal(pvpSessionCarriesVitals(legacy), true);

        const legacySpar = session({ rewardAuthority: 'challenge' });
        delete (legacySpar as { continuousVitals?: boolean }).continuousVitals;
        assert.equal(pvpSessionCarriesVitals(legacySpar), false, 'never guess a cost onto a legacy spar');
    });

    it('honours an explicit false even on a world row', () => {
        assert.equal(pvpSessionCarriesVitals(session({ continuousVitals: false })), false);
    });
});

describe('pvpFighterIsHospitalized', () => {
    it('admits a knocked-out fighter', () => {
        const s = session({ p2: fighter('Dopey', { hp: 0 }), winner: 'p1' });
        assert.equal(pvpFighterIsHospitalized(s, 'p2'), true);
    });

    it('admits the loser of a forfeit even at full HP', () => {
        // claim-afk-win / turn-deadline: the loser never dropped, they stopped
        // acting. This is how most abandoned duels actually end.
        const s = session({ p2: fighter('Dopey', { hp: 88 }), winner: 'p1' });
        assert.equal(pvpFighterIsHospitalized(s, 'p2'), true);
    });

    it('sends a fighter who FLED back to the sector, not the hospital', () => {
        const s = session({ p1: fighter('Rill', { hp: 40 }), winner: 'p2', fleedBy: 'p1' });
        assert.equal(pvpFighterIsHospitalized(s, 'p1'), false, 'fleeing already cost 10% max HP');
        assert.equal(pvpFighterIsHospitalized(s, 'p2'), false, 'the winner walks away');
    });

    it('still admits a fighter who fled at zero HP', () => {
        const s = session({ p1: fighter('Rill', { hp: 0 }), winner: 'p2', fleedBy: 'p1' });
        assert.equal(pvpFighterIsHospitalized(s, 'p1'), true, 'the knockout check is outcome-blind and comes first');
    });

    it('leaves the winner standing unless they also hit zero', () => {
        assert.equal(pvpFighterIsHospitalized(session({ winner: 'p1' }), 'p1'), false);
        // Mutual KO: a damage-over-time tick drops the winner on the same turn.
        const mutual = session({ p1: fighter('Rill', { hp: 0 }), p2: fighter('Dopey', { hp: 0 }), winner: 'p1' });
        assert.equal(pvpFighterIsHospitalized(mutual, 'p1'), true);
        assert.equal(pvpFighterIsHospitalized(mutual, 'p2'), true);
    });

    it('admits nobody on a draw fought to a standstill', () => {
        const s = session({ winner: 'draw' });
        assert.equal(pvpFighterIsHospitalized(s, 'p1'), false);
        assert.equal(pvpFighterIsHospitalized(s, 'p2'), false);
    });
});

describe('applyPvpVitalsToCharacter', () => {
    it('carries the survivor out at the vitals the fight left them', () => {
        const s = session({ p1: fighter('Rill', { hp: 37, chakra: 12, stamina: 5 }), winner: 'p1' });
        const next = applyPvpVitalsToCharacter(save().character, s, 'p1', NOW);
        assert.equal(next.hp, 37);
        assert.equal(next.chakra, 12);
        assert.equal(next.stamina, 5);
        assert.equal(next.hospitalized, undefined, 'a winner is not admitted');
    });

    it('admits a loser with the same 60s stay every other defeat path uses', () => {
        const s = session({ p2: fighter('Dopey', { hp: 0, chakra: 3, stamina: 1 }), winner: 'p1' });
        const next = applyPvpVitalsToCharacter(save({ name: 'Dopey' }).character, s, 'p2', NOW);
        assert.equal(next.hp, 0);
        assert.equal(next.hospitalized, true);
        assert.equal(next.hospitalizedAt, NOW);
        assert.equal(next.hospitalizedUntil, NOW + PVP_HOSPITAL_DURATION_MS);
        assert.equal(PVP_HOSPITAL_DURATION_MS, 60_000);
        assert.equal(next.chakra, 3, 'spent chakra is recorded either way');
    });

    it('clamps to the SAVE maxima, never the stale session ones', () => {
        // Session sealed before a level-down / gear change: its maxHp of 100 and
        // hp of 90 must not raise a save whose real ceiling is now 40.
        const s = session({ p1: fighter('Rill', { hp: 90, maxHp: 100, chakra: 44, stamina: 55 }), winner: 'p1' });
        const shrunk = save({ maxHp: 40, maxChakra: 10, maxStamina: 12 }).character;
        const next = applyPvpVitalsToCharacter(shrunk, s, 'p1', NOW);
        assert.equal(next.hp, 40);
        assert.equal(next.chakra, 10);
        assert.equal(next.stamina, 12);
    });

    it('leaves a fighter clinging on at exactly 1 HP on their feet', () => {
        const s = session({ p1: fighter('Rill', { hp: 1 }), winner: 'p1' });
        const next = applyPvpVitalsToCharacter(save().character, s, 'p1', NOW);
        assert.equal(next.hp, 1);
        assert.equal(next.hospitalized, undefined);
    });

    it('reads a sub-1 HP fraction as the knockout it is', () => {
        // Vitals are integral everywhere else, and both the admission check and
        // the write floor through the same num(). A fighter cannot end up
        // "alive at 0" because one of the two rounded differently.
        const s = session({ p1: fighter('Rill', { hp: 0.4 }), winner: 'p2' });
        assert.equal(pvpFighterIsHospitalized(s, 'p1'), true);
        const next = applyPvpVitalsToCharacter(save().character, s, 'p1', NOW);
        assert.equal(next.hp, 0);
        assert.equal(next.hospitalized, true);
    });

    it('preserves every unrelated character field', () => {
        const s = session({ winner: 'p1' });
        const next = applyPvpVitalsToCharacter(save({ ryo: 5_000, level: 22 }).character, s, 'p1', NOW);
        assert.equal(next.ryo, 5_000);
        assert.equal(next.level, 22);
        assert.equal(next.name, 'Rill');
    });
});
