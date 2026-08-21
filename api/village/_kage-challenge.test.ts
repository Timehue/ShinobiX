/**
 * Decision-logic guard for the Kage succession system (api/village/kage-challenge.ts).
 * Tests the pure eligibility gates, the overlap "must-accept" obligation math,
 * the official-duel settlement decision, and the reign-history transitions in
 * _kage-challenge.ts.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    canDeclareChallenge, isChallengeExpired, newChallenge, applyPress,
    applySeatTransfer, applyDefense, applyExpiry, applyAdminReset,
    openReign, closeCurrentReign, incrementDefense, resolveDuelDecision, resolveAcceptDecision,
    KAGE_ACCEPT_OBLIGATION_MS, KAGE_CHALLENGE_EXPIRY_MS, KAGE_POST_DEFENSE_GRACE_MS,
    KAGE_LOSS_COOLDOWN_MS, KAGE_PRESS_MAX_STEP_MS, KAGE_MIN_CHALLENGER_LEVEL,
    KAGE_MIN_MERIT, KAGE_DECLARE_RYO_COST, KAGE_MIN_ACCOUNT_AGE_MS,
    type DeclareInput, type KageStateLike, type KageChallenge,
} from './_kage-challenge.js';

const NOW = 1_000_000_000_000;
const OLD_ENOUGH = NOW - KAGE_MIN_ACCOUNT_AGE_MS - 1;
const CID = 'ch-test-0001';

function chal(name: string, at: number, over: Partial<KageChallenge> = {}): KageChallenge {
    return { ...newChallenge(name, at, `${CID}-${name}`), ...over };
}
function baseState(): KageStateLike {
    return { kageSystemUnlocked: true, seatedKage: 'Raiko', challenge: null };
}
function declareInput(over: Partial<DeclareInput> = {}): DeclareInput {
    return {
        now: NOW,
        state: baseState(),
        challengerName: 'Rill',
        challengerLevel: 95,
        challengerRyo: 5_000_000,
        challengerAccountCreatedAt: OLD_ENOUGH,
        challengerMerit: 300,
        isMember: true,
        ...over,
    };
}

describe('canDeclareChallenge — eligibility gates', () => {
    it('passes when every gate is satisfied', () => {
        assert.equal(canDeclareChallenge(declareInput()).ok, true);
    });
    it('blocks when the Kage system is not active', () => {
        assert.equal(canDeclareChallenge(declareInput({ state: { kageSystemUnlocked: false } })).ok, false);
    });
    it('blocks a non-member', () => {
        assert.equal(canDeclareChallenge(declareInput({ isMember: false })).ok, false);
    });
    it('blocks the seated Kage from challenging themselves', () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerName: 'Raiko' })).ok, false);
    });
    it(`blocks below level ${KAGE_MIN_CHALLENGER_LEVEL}`, () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerLevel: KAGE_MIN_CHALLENGER_LEVEL - 1 })).ok, false);
    });
    it('blocks a too-new account', () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerAccountCreatedAt: NOW - 1000 })).ok, false);
    });
    it(`blocks below ${KAGE_MIN_MERIT} personal Village Merit`, () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerMerit: KAGE_MIN_MERIT - 1 })).ok, false);
    });
    it(`allows at exactly ${KAGE_MIN_MERIT} merit`, () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerMerit: KAGE_MIN_MERIT })).ok, true);
    });
    it(`blocks without the ${KAGE_DECLARE_RYO_COST.toLocaleString()}-ryo stake`, () => {
        assert.equal(canDeclareChallenge(declareInput({ challengerRyo: KAGE_DECLARE_RYO_COST - 1 })).ok, false);
        // Honor Seals are the Vanguard's PvP earnings and fund VILLAGE upgrades —
        // a civic act must not tax them (owner ruling 2026-08-17).
        assert.equal(canDeclareChallenge(declareInput({ challengerRyo: KAGE_DECLARE_RYO_COST })).ok, true);
    });
    it('blocks when an active (non-expired) challenge already exists', () => {
        const state = { ...baseState(), challenge: chal('Someone', NOW) };
        assert.equal(canDeclareChallenge(declareInput({ state })).ok, false);
    });
    it('allows when the existing challenge is already expired', () => {
        const state = { ...baseState(), challenge: chal('Someone', NOW - KAGE_CHALLENGE_EXPIRY_MS - 1) };
        assert.equal(canDeclareChallenge(declareInput({ state })).ok, true);
    });
    it('blocks during the post-defense / post-transfer grace', () => {
        const state = { ...baseState(), postDefenseGraceUntil: NOW + 1000 };
        assert.equal(canDeclareChallenge(declareInput({ state })).ok, false);
    });
    it('blocks a challenger on loss cooldown', () => {
        const state = { ...baseState(), challengerCooldowns: { rill: NOW + 1000 } };
        assert.equal(canDeclareChallenge(declareInput({ state })).ok, false);
    });
});

describe('isChallengeExpired', () => {
    it('false within the window, true past 48h', () => {
        assert.equal(isChallengeExpired(chal('Rill', NOW - 1000), NOW), false);
        assert.equal(isChallengeExpired(chal('Rill', NOW - KAGE_CHALLENGE_EXPIRY_MS - 1), NOW), true);
    });
});

describe('newChallenge', () => {
    it('stamps the passed challengeId + a fresh full obligation', () => {
        const c = newChallenge('Rill', NOW, 'ch-abc');
        assert.equal(c.challengeId, 'ch-abc');
        assert.equal(c.status, 'pending');
        assert.equal(c.createdAt, NOW);
        assert.equal(c.obligationRemainingMs, KAGE_ACCEPT_OBLIGATION_MS);
    });
});

describe('applyPress — overlap obligation', () => {
    it('first press just stamps lastPressAt (no burn — no interval yet)', () => {
        const c = chal('Rill', NOW);
        const r = applyPress(c, NOW + 5000, /*bothOnline*/ true);
        assert.equal(r.burnedMs, 0);
        assert.equal(r.challenge.obligationRemainingMs, KAGE_ACCEPT_OBLIGATION_MS);
        assert.equal(r.challenge.lastPressAt, NOW + 5000);
        assert.equal(r.forfeited, false);
    });
    it('a subsequent press burns the elapsed overlap', () => {
        let c = chal('Rill', NOW);
        c = applyPress(c, NOW, true).challenge;            // stamp
        const r = applyPress(c, NOW + 40_000, true);       // 40s later
        assert.equal(r.burnedMs, 40_000);
        assert.equal(r.challenge.obligationRemainingMs, KAGE_ACCEPT_OBLIGATION_MS - 40_000);
    });
    it('caps a single press at KAGE_PRESS_MAX_STEP_MS', () => {
        let c = chal('Rill', NOW);
        c = applyPress(c, NOW, true).challenge;
        const r = applyPress(c, NOW + 10 * 60_000, true);  // 10 min gap
        assert.equal(r.burnedMs, KAGE_PRESS_MAX_STEP_MS);
    });
    it('does NOT burn when the parties are not both online (the AFK case)', () => {
        let c = chal('Rill', NOW);
        c = applyPress(c, NOW, true).challenge;
        const r = applyPress(c, NOW + 40_000, /*bothOnline*/ false);
        assert.equal(r.burnedMs, 0);
        assert.equal(r.challenge.obligationRemainingMs, KAGE_ACCEPT_OBLIGATION_MS);
    });
    it('forfeits once the obligation is exhausted', () => {
        const c = chal('Rill', NOW, { obligationRemainingMs: 30_000, lastPressAt: NOW });
        const r = applyPress(c, NOW + 60_000, true);       // burns the capped 60s -> <= 0
        assert.equal(r.forfeited, true);
        assert.equal(r.challenge.obligationRemainingMs, 0);
    });
    it('never burns an already-accepted challenge', () => {
        const c = chal('Rill', NOW, { status: 'accepted', lastPressAt: NOW });
        const r = applyPress(c, NOW + 60_000, true);
        assert.equal(r.burnedMs, 0);
        assert.equal(r.forfeited, false);
    });
});

describe('seat transitions — grace, defense, expiry', () => {
    it('applySeatTransfer flips the seat, clears the challenge, and grants the NEW Kage 24h grace', () => {
        const state = { ...baseState(), challenge: chal('Rill', NOW), postDefenseGraceUntil: NOW + 999 };
        const next = applySeatTransfer(state, 'Rill', 'Stormveil', NOW, 'defeated');
        assert.equal(next.seatedKage, 'Rill');
        assert.equal(next.challenge, null);
        assert.equal(next.postDefenseGraceUntil, NOW + KAGE_POST_DEFENSE_GRACE_MS, 'new Kage gets post-install grace');
        assert.equal(next.seatedAt, NOW);
        assert.equal(next.defenseCount, 0);
    });
    it('applyDefense keeps the Kage, +defense, sets grace + challenger cooldown', () => {
        const state = { ...baseState(), challenge: chal('Rill', NOW), defenseCount: 1, seatedAt: NOW - 5,
            history: [{ name: 'Raiko', village: 'Stormveil', seatedAt: NOW - 5, defenseCount: 1 }] };
        const next = applyDefense(state, 'Rill', NOW);
        assert.equal(next.seatedKage, 'Raiko');
        assert.equal(next.challenge, null);
        assert.equal(next.defenseCount, 2, 'defense count incremented');
        assert.equal(next.postDefenseGraceUntil, NOW + KAGE_POST_DEFENSE_GRACE_MS);
        assert.equal(next.challengerCooldowns?.rill, NOW + KAGE_LOSS_COOLDOWN_MS);
        assert.equal(next.history?.[0].defenseCount, 2, 'open reign entry tracks defenses');
    });
    it('applyExpiry clears the challenge and cooldowns the abandoning challenger', () => {
        const state = { ...baseState(), challenge: chal('Rill', NOW - KAGE_CHALLENGE_EXPIRY_MS - 1) };
        const next = applyExpiry(state, NOW);
        assert.equal(next.challenge, null);
        assert.equal(next.challengerCooldowns?.rill, NOW + KAGE_LOSS_COOLDOWN_MS);
    });
    it('applyDefense prunes elapsed cooldowns', () => {
        const state = { ...baseState(), challenge: chal('Rill', NOW), challengerCooldowns: { old: NOW - 1 } };
        const next = applyDefense(state, 'Rill', NOW);
        assert.equal(next.challengerCooldowns?.old, undefined, 'stale cooldown pruned');
    });
});

describe('reign history (server-owned record)', () => {
    it('openReign appends an open entry and seats the reign', () => {
        const s = openReign({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        assert.equal(s.seatedKage, 'Raiko');
        assert.equal(s.seatedAt, NOW);
        assert.equal(s.defenseCount, 0);
        assert.equal(s.history?.length, 1);
        assert.equal(s.history?.[0].endedAt, undefined, 'entry is open');
    });
    it('closeCurrentReign stamps endedAt/reason/wonBy on the open entry', () => {
        const opened = openReign({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        const closed = closeCurrentReign(opened, 'Stormveil', NOW + 100, 'defeated', 'Rill');
        assert.equal(closed.history?.[0].endedAt, NOW + 100);
        assert.equal(closed.history?.[0].endedReason, 'defeated');
        assert.equal(closed.history?.[0].wonBy, 'Rill');
    });
    it('closeCurrentReign synthesizes a record for a pre-history seated Kage', () => {
        const legacy: KageStateLike = { kageSystemUnlocked: true, seatedKage: 'Old', seatedAt: NOW - 10 };
        const closed = closeCurrentReign(legacy, 'Stormveil', NOW, 'admin-reset');
        assert.equal(closed.history?.length, 1);
        assert.equal(closed.history?.[0].name, 'Old');
        assert.equal(closed.history?.[0].endedReason, 'admin-reset');
    });
    it('a duel transfer closes the old reign (defeated) and opens the new one', () => {
        const seated = openReign({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        const transferred = applySeatTransfer({ ...seated, challenge: chal('Rill', NOW + 1) }, 'Rill', 'Stormveil', NOW + 200, 'defeated');
        assert.equal(transferred.history?.length, 2);
        assert.equal(transferred.history?.[0].name, 'Raiko');
        assert.equal(transferred.history?.[0].endedReason, 'defeated');
        assert.equal(transferred.history?.[0].wonBy, 'Rill');
        assert.equal(transferred.history?.[1].name, 'Rill');
        assert.equal(transferred.history?.[1].endedAt, undefined, 'new reign is open');
    });
    it('a forfeit transfer records endedReason "forfeit"', () => {
        const seated = openReign({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        const transferred = applySeatTransfer(seated, 'Rill', 'Stormveil', NOW + 5, 'forfeit');
        assert.equal(transferred.history?.[0].endedReason, 'forfeit');
    });
    it('incrementDefense bumps live count + open entry', () => {
        const seated = openReign({ kageSystemUnlocked: true }, 'Raiko', 'Stormveil', NOW);
        const d = incrementDefense(incrementDefense(seated));
        assert.equal(d.defenseCount, 2);
        assert.equal(d.history?.[0].defenseCount, 2);
    });
    it('applyAdminReset closes the reign, re-seals, and preserves history', () => {
        const seated = openReign({ kageSystemUnlocked: true, firstLiberator: 'Raiko' }, 'Raiko', 'Stormveil', NOW);
        const reset = applyAdminReset(seated, 'Stormveil', NOW + 50);
        assert.equal(reset.kageSystemUnlocked, false);
        assert.equal(reset.seatedKage, undefined, 'seat cleared');
        assert.equal(reset.firstLiberator, undefined, 'liberator cleared for a fresh era');
        assert.equal(reset.history?.length, 1);
        assert.equal(reset.history?.[0].endedReason, 'admin-reset');
    });
    it('bounds history to KAGE_HISTORY_MAX entries', () => {
        let s: KageStateLike = { kageSystemUnlocked: true };
        for (let i = 0; i < 60; i++) {
            s = closeCurrentReign(openReign(s, `K${i}`, 'Stormveil', NOW + i), 'Stormveil', NOW + i + 1, 'abdicated');
        }
        assert.ok((s.history?.length ?? 0) <= 50, 'history bounded');
    });
});

describe('resolveDuelDecision — official-duel settlement (pure)', () => {
    const accepted = chal('Rill', NOW, { status: 'accepted', battleId: 'pvp-1' });
    const base = {
        challenge: accepted,
        battleId: 'pvp-1',
        seatNorm: 'raiko',
        challengerNorm: 'rill',
        fighterNorms: ['raiko', 'rill'],
    };
    it('transfers when the challenger beats the Kage', () => {
        assert.deepEqual(resolveDuelDecision({ ...base, winnerNorm: 'rill', loserNorm: 'raiko' }), { kind: 'transfer' });
    });
    it('defends when the Kage beats the challenger', () => {
        assert.deepEqual(resolveDuelDecision({ ...base, winnerNorm: 'raiko', loserNorm: 'rill' }), { kind: 'defend' });
    });
    it('rejects an un-accepted challenge (must settle via the forfeit clock)', () => {
        const r = resolveDuelDecision({ ...base, challenge: chal('Rill', NOW), winnerNorm: 'rill', loserNorm: 'raiko' });
        assert.equal(r.kind, 'reject');
    });
    it('rejects a superseded challengeId', () => {
        const r = resolveDuelDecision({ ...base, expectChallengeId: 'stale-id', winnerNorm: 'rill', loserNorm: 'raiko' });
        assert.equal(r.kind, 'reject');
    });
    it('rejects a battleId that is not the accepted duel', () => {
        const r = resolveDuelDecision({ ...base, battleId: 'pvp-other', winnerNorm: 'rill', loserNorm: 'raiko' });
        assert.equal(r.kind, 'reject');
    });
    it('rejects a duel between the wrong fighters', () => {
        const r = resolveDuelDecision({ ...base, fighterNorms: ['raiko', 'stranger'], winnerNorm: 'raiko', loserNorm: 'stranger' });
        assert.equal(r.kind, 'reject');
    });
    it('rejects a non-participant caller on manual resolve', () => {
        const r = resolveDuelDecision({ ...base, callerNorm: 'stranger', winnerNorm: 'rill', loserNorm: 'raiko' });
        assert.equal(r.kind, 'reject');
    });
    it('allows a participant caller on manual resolve', () => {
        assert.equal(resolveDuelDecision({ ...base, callerNorm: 'rill', winnerNorm: 'rill', loserNorm: 'raiko' }).kind, 'transfer');
    });
    it('allows the auto path (no caller) to settle', () => {
        assert.equal(resolveDuelDecision({ ...base, expectChallengeId: accepted.challengeId, winnerNorm: 'rill', loserNorm: 'raiko' }).kind, 'transfer');
    });
});

describe('resolveAcceptDecision — anti-stall accept guard (pure)', () => {
    const pending = chal('Rill', NOW); // status pending
    const base = {
        challenge: pending,
        seatNorm: 'raiko',
        challengerNorm: 'rill',
        callerNorm: 'raiko',   // the seated Kage
        isAdmin: false,
        battleId: 'pvp-1',
        sessionFighters: ['raiko', 'rill'],
    };
    it('seals a real duel between the Kage and challenger', () => {
        assert.deepEqual(resolveAcceptDecision(base), { kind: 'seal' });
    });
    it('rejects when there is no active challenge', () => {
        assert.equal(resolveAcceptDecision({ ...base, challenge: null }).kind, 'reject');
    });
    it('rejects a caller who is not the seated Kage', () => {
        assert.equal(resolveAcceptDecision({ ...base, callerNorm: 'rill' }).kind, 'reject');
    });
    it('allows an admin caller', () => {
        assert.equal(resolveAcceptDecision({ ...base, callerNorm: 'someadmin', isAdmin: true }).kind, 'seal');
    });
    it('rejects a bogus battleId with no live session (the freeze exploit)', () => {
        assert.equal(resolveAcceptDecision({ ...base, sessionFighters: null }).kind, 'reject');
    });
    it('rejects a real session that is not between the two parties', () => {
        assert.equal(resolveAcceptDecision({ ...base, sessionFighters: ['raiko', 'stranger'] }).kind, 'reject');
    });
    it('idempotently re-accepts the SAME sealed duel', () => {
        const accepted = chal('Rill', NOW, { status: 'accepted', battleId: 'pvp-1' });
        assert.equal(resolveAcceptDecision({ ...base, challenge: accepted }).kind, 'idempotent');
    });
    it('rejects re-accepting a DIFFERENT duel once sealed', () => {
        const accepted = chal('Rill', NOW, { status: 'accepted', battleId: 'pvp-1' });
        assert.equal(resolveAcceptDecision({ ...base, challenge: accepted, battleId: 'pvp-2' }).kind, 'reject');
    });
});

describe('Kage challenge cost — server/client parity', () => {
    const read = (rel: string) => readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8');

    it('the declare cost is RYO, not Honor Seals, on every copy', () => {
        // Seals are the Vanguard's PvP earnings and fund VILLAGE upgrades; a
        // civic act must not tax them (owner ruling 2026-08-17). The number now
        // exists exactly TWICE — the server core and the one client mirror.
        const server = read('api/village/_kage-challenge.ts');
        const townHall = read('shinobij.client/src/screens/TownHall.tsx');
        const stateLib = read('shinobij.client/src/lib/kage-challenge-state.ts');

        assert.match(server, /export const KAGE_DECLARE_RYO_COST = 250_000;/);
        assert.match(stateLib, /export const KAGE_CHALLENGE_RYO_COST = 250_000;/);

        // TownHall must IMPORT that mirror rather than re-declare the price. It
        // used to keep its own copy, which is a third place for the number to
        // drift — the same failure mode that let the fate dice, the black market
        // and this very cost each quote one price and charge another.
        assert.match(
            townHall,
            /import \{[^}]*KAGE_CHALLENGE_RYO_COST[^}]*\} from "\.\.\/lib\/kage-challenge-state"/s,
            'TownHall must import the kage cost from lib/kage-challenge-state',
        );
        assert.doesNotMatch(
            townHall,
            /^const KAGE_CHALLENGE_(?:RYO_COST|MIN_LEVEL|MIN_CONTRIBUTION)\s*=/m,
            'TownHall must not re-declare the kage entry terms',
        );

        // The old seal constant must be gone everywhere, or a player is told one
        // price and charged another. The Machinations/Figma handoff exporter is
        // in that list because it imports this constant BY NAME: it is a CI-only
        // gate (npm run check:tooling-handoffs), so when the seal constant was
        // renamed the exporter went on importing the dead symbol and crashed on
        // every run while `npm test` stayed green.
        const handoffs = read('scripts/export-tooling-handoffs.mjs');
        for (const [name, src] of [['server', server], ['TownHall', townHall], ['state lib', stateLib], ['handoff exporter', handoffs]] as const) {
            assert.doesNotMatch(src, /KAGE_DECLARE_SEAL_COST|KAGE_CHALLENGE_SEAL_COST/, `${name} still references the seal cost`);
        }
        // Player-facing STRINGS drift separately from the constants. The refund
        // path told the challenger their "Honor Seals were refunded" long after
        // the stake became ryo — the code was right and the sentence was wrong.
        const handler = read('api/village/kage-challenge.ts');
        assert.doesNotMatch(handler, /Honor Seal/, 'the kage handler must not mention Honor Seals anywhere, prose included');
        // …and the readiness checklist must measure ryo, not the seal balance.
        assert.match(stateLib, /ok: ryo >= KAGE_CHALLENGE_RYO_COST/);
    });

    it('the panel names the gate the server actually enforces', () => {
        // The server gate is personal Village Merit (KAGE_MIN_MERIT, read from
        // char.villageMerit). TownHall used to advertise it as "contribution" —
        // directly above a village CONTRIBUTION POINTS leaderboard, which is a
        // different stat entirely. A player could top that board, read the hint as
        // met, declare, and be refused.
        const townHall = read('shinobij.client/src/screens/TownHall.tsx');
        assert.match(townHall, /Village Merit/, 'the Kage panel must name Village Merit');
        assert.doesNotMatch(
            townHall,
            /KAGE_CHALLENGE_MIN_CONTRIBUTION/,
            'the merit gate must not be relabelled as contribution',
        );
        // …and it must show the player their own standing against each requirement.
        assert.match(townHall, /kageEligibility\(character, kageNow\)/);
    });

    it('the client account-age check defaults the same way the server does', () => {
        // Server: num(char.createdAt) coerces a missing field to 0, so the age
        // check PASSES. A client default of `now` would fail the same save and
        // show a blocker that does not exist.
        const stateLib = read('shinobij.client/src/lib/kage-challenge-state.ts');
        assert.match(stateLib, /Number\(character\.createdAt \?\? 0\)/);
        assert.doesNotMatch(stateLib, /Number\(character\.createdAt \?\? now\)/);
        const handler = read('api/village/kage-challenge.ts');
        assert.match(handler, /challengerAccountCreatedAt: num\(char\.createdAt\)/);
    });

    it('the handler debits and refunds ryo', () => {
        const handler = read('api/village/kage-challenge.ts');
        assert.match(handler, /ryo: num\(c\.ryo\) - KAGE_DECLARE_RYO_COST/);
        assert.match(handler, /ryo: num\(c\.ryo\) \+ KAGE_DECLARE_RYO_COST/);
        assert.match(handler, /resource: 'ryo'/);
        assert.doesNotMatch(handler, /honorSeals/);
    });
});
