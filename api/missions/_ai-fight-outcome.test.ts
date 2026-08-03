import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { TowerActor, TowerSession } from '../towers/_tower-session.js';
import {
    AI_FIGHT_HOSPITAL_DURATION_MS,
    aiFightPlayerActor,
    aiFightPaysReward,
    applyAiFightOutcomeToCharacter,
    isPveFightMember,
    resolveAiFightOutcome,
    settlementOwnsHpOnWin,
} from './_ai-fight-outcome.js';

function actor(overrides: Partial<TowerActor>): TowerActor {
    return { id: 'a', side: 'squad', ai: false, ownerSlug: 'Rill', hp: 100, maxHp: 100, statuses: [] } as unknown as TowerActor;
}

function session(overrides: Partial<TowerSession>): TowerSession {
    return {
        runId: 'aifight-1',
        status: 'done',
        winner: 'squad',
        actors: [
            { ...actor({}), id: 'p1', side: 'squad', ai: false, hp: 42, maxHp: 300 },
            { ...actor({}), id: 'e1', side: 'enemy', ai: true, hp: 0, maxHp: 200 },
        ],
        ...overrides,
    } as unknown as TowerSession;
}

describe('resolveAiFightOutcome — the session is the authority', () => {
    it('reads a squad win as a win', () => {
        assert.equal(resolveAiFightOutcome(session({})), 'win');
    });

    it('reads an enemy win as a loss and a tie as a draw', () => {
        assert.equal(resolveAiFightOutcome(session({ winner: 'enemy' })), 'loss');
        assert.equal(resolveAiFightOutcome(session({ winner: 'draw' })), 'draw');
    });

    it('reads an UNRESOLVED session as a forfeit, not a no-op', () => {
        // The free-retry hole: without this a player about to lose could close
        // the fight screen and take no damage at all.
        assert.equal(resolveAiFightOutcome(session({ status: 'active', winner: null })), 'forfeit');
    });

    it('reads a MISSING session as unknown — neither pays nor punishes', () => {
        // The store has a TTL. A settle that arrives after it lapsed is far more
        // likely to be a slow network than a cheat, so it must not hospitalize.
        assert.equal(resolveAiFightOutcome(null), 'unknown');
        assert.equal(resolveAiFightOutcome(undefined), 'unknown');
    });
});

describe('aiFightPaysReward — only a win pays, and practice never does', () => {
    it('pays a real win', () => {
        for (const kind of ['raidAi', 'explore', 'mission', 'defense', 'endless']) {
            assert.equal(aiFightPaysReward('win', kind), true, `${kind} should pay on a win`);
        }
    });

    it('never pays a practice bout — a sparring partner is not a faucet', () => {
        // Arena's local practice branch returns before it reports, so paying here
        // would quietly start rewarding fights that are meant to reward nothing.
        assert.equal(aiFightPaysReward('win', 'practice'), false);
    });

    it('never pays a loss, a draw, a forfeit or an unverifiable settle', () => {
        for (const outcome of ['loss', 'draw', 'forfeit', 'unknown'] as const) {
            assert.equal(aiFightPaysReward(outcome, 'raidAi'), false, `${outcome} must not pay`);
        }
    });

    it('treats a missing battleKind as payable (the local-fallback track)', () => {
        // A token minted before battleKind was sealed still settles as it always
        // did; only an explicit 'practice' suppresses the reward.
        assert.equal(aiFightPaysReward('win', undefined), true);
    });

    it('finds the human fighter, never the AI or a summoned companion', () => {
        const withPet = session({
            actors: [
                { ...actor({}), id: 'pet', side: 'squad', ai: true, hp: 10, maxHp: 10 },
                { ...actor({}), id: 'me', side: 'squad', ai: false, hp: 55, maxHp: 300 },
                { ...actor({}), id: 'foe', side: 'enemy', ai: true, hp: 0, maxHp: 200 },
            ],
        });
        assert.equal(aiFightPlayerActor(withPet)?.id, 'me');
        assert.equal(aiFightPlayerActor(null), undefined);
    });
});

describe('applyAiFightOutcomeToCharacter — a fight costs the same on either engine', () => {
    const now = 1_700_000_000_000;
    const base = { hp: 300, maxHp: 300, hospitalized: false, hospitalizedAt: 0, hospitalizedUntil: 0 };

    const downed = session({ winner: 'enemy', actors: [{ ...actor({}), side: 'squad', ai: false, hp: 0, maxHp: 300 }] });

    it('carries the surviving HP back on a win', () => {
        const next = applyAiFightOutcomeToCharacter({ ...base }, 'win', aiFightPlayerActor(session({})), now);
        assert.equal(next.hp, 42, 'the win must cost the HP the fight actually cost');
        assert.equal(next.hospitalized, false);
    });

    it('hospitalizes when the player is DOWN, matching the local Arena KO paths', () => {
        const next = applyAiFightOutcomeToCharacter({ ...base }, 'loss', aiFightPlayerActor(downed), now);
        assert.equal(next.hp, 0);
        assert.equal(next.hospitalized, true);
        assert.equal(next.hospitalizedAt, now);
        assert.equal(next.hospitalizedUntil, now + AI_FIGHT_HOSPITAL_DURATION_MS);
    });

    it('does NOT hospitalize a player who lost but SURVIVED', () => {
        // A run can end with the player alive and standing: the weekly boss is
        // won by OUTLASTING the round budget, and a mission or story run that
        // times out is a failure the player walked away from. Keying the hospital
        // off `winner !== squad` would send someone at full HP to a hospital bed
        // for surviving — the opposite of what the local Arena does.
        const timedOut = session({ winner: 'enemy' }); // player actor is on 42 HP
        const next = applyAiFightOutcomeToCharacter({ ...base }, 'loss', aiFightPlayerActor(timedOut), now);
        assert.equal(next.hospitalized, false, 'surviving a timeout must not hospitalize');
        assert.equal(next.hp, 42, 'but it still costs the HP the fight cost');
    });

    it('a forfeit costs the HP you walked out with, not a hospital bed', () => {
        // This is what keeps bailing out of a losing fight from being free
        // WITHOUT over-punishing someone who quits at full HP: you leave at the
        // HP you left with, so you still have to heal before the next fight.
        const bailed = session({ status: 'active', winner: null });
        const next = applyAiFightOutcomeToCharacter({ ...base }, 'forfeit', aiFightPlayerActor(bailed), now);
        assert.equal(next.hospitalized, false);
        assert.equal(next.hp, 42);
    });

    it('leaves the character untouched when the outcome is unknown', () => {
        const next = applyAiFightOutcomeToCharacter({ ...base }, 'unknown', aiFightPlayerActor(session({})), now);
        assert.deepEqual(next, base, 'a vanished session must not punish an honest player');
    });

    it('leaves the character untouched when there is no actor to read', () => {
        // The local-fallback track, which still applies its own HP client-side.
        // Guessing a cost with no evidence would be worse than doing nothing.
        assert.deepEqual(applyAiFightOutcomeToCharacter({ ...base }, 'loss', undefined, now), base);
    });

    it('clamps surviving HP to the SAVE maxHp, never the stale session one', () => {
        // The session was sealed before the save changed; its actor hp must never
        // be able to set HP above the real ceiling.
        const shrunk = { ...base, hp: 20, maxHp: 30 };
        const generous = session({ actors: [{ ...actor({}), side: 'squad', ai: false, hp: 999, maxHp: 999 }] });
        const next = applyAiFightOutcomeToCharacter(shrunk, 'win', aiFightPlayerActor(generous), now);
        assert.equal(next.hp, 30);
    });

    it('never leaves a survivor on 0 HP — 1 HP is the floor for anyone still up', () => {
        const barely = session({ actors: [{ ...actor({}), side: 'squad', ai: false, hp: 1, maxHp: 300 }] });
        const next = applyAiFightOutcomeToCharacter({ ...base }, 'win', aiFightPlayerActor(barely), now);
        assert.equal(next.hp, 1);
        assert.equal(next.hospitalized, false);
    });

    it('re-applying a defeat PUSHES the hospital stay out — which is why the receipt exists', () => {
        // Documents the hazard /api/pve/fight-outcome's per-run receipt guards
        // against: this write is not naturally idempotent, so a refresh on the
        // results screen would make a defeat get worse the more you looked at it.
        const ko = aiFightPlayerActor(downed);
        const first = applyAiFightOutcomeToCharacter({ ...base }, 'loss', ko, now);
        const second = applyAiFightOutcomeToCharacter(first, 'loss', ko, now + 30_000);
        assert.ok(
            Number(second.hospitalizedUntil) > Number(first.hospitalizedUntil),
            'a second apply extends the stay — the caller MUST gate this behind a receipt',
        );
    });
});

describe('isPveFightMember — a client-supplied runId must be your own', () => {
    const solo = session({});

    it('accepts the player who actually fought', () => {
        assert.equal(isPveFightMember(solo, 'Rill'), true);
    });

    it("refuses a stranger's run — on a WIN that would be a free heal", () => {
        // /api/pve/fight-outcome takes the runId from the request body, unlike the
        // AI-fight path whose runId comes from a token sealed under the caller's
        // own name. Without this, handing in someone else's winning session would
        // write THEIR surviving HP onto YOUR save.
        assert.equal(isPveFightMember(solo, 'Mallory'), false);
        assert.equal(isPveFightMember(solo, ''), false);
        assert.equal(isPveFightMember(null, 'Rill'), false);
    });

    it('never matches on the enemy side', () => {
        const spoofed = session({
            actors: [{ ...actor({}), id: 'foe', side: 'enemy', ai: true, ownerSlug: 'Mallory' }],
        });
        assert.equal(isPveFightMember(spoofed, 'Mallory'), false);
    });
});

describe('settlementOwnsHpOnWin — who writes the winning HP', () => {
    it('defers only for the Academy spar, whose settlement grants a scripted HP', () => {
        assert.equal(settlementOwnsHpOnWin(session({ towerId: 'academy-spar' } as Partial<TowerSession>)), true);
    });

    it('leaves every other mode alone, so their wins still carry surviving HP back', () => {
        for (const towerId of ['ai-fight', 'story-boss', 'mission', 'tower', 'spire', 'clan-boss', undefined]) {
            assert.equal(
                settlementOwnsHpOnWin(session({ towerId } as Partial<TowerSession>)),
                false,
                `${String(towerId)} must keep reporting its own outcome`,
            );
        }
        assert.equal(settlementOwnsHpOnWin(null), false);
    });

    it('is about the WIN only — a lost spar still costs, which is what hospitalizes a beginner', () => {
        // The predicate is deliberately outcome-blind; the endpoint pairs it with
        // `outcome === 'win'`. This pins the pairing's premise: a lost spar run
        // still resolves as a loss and still applies the KO.
        const lost = session({ towerId: 'academy-spar', winner: 'enemy' } as Partial<TowerSession>);
        assert.equal(resolveAiFightOutcome(lost), 'loss');
        const downed = { ...actor({}), id: 'p1', side: 'squad', ai: false, hp: 0, maxHp: 300 } as TowerActor;
        const after = applyAiFightOutcomeToCharacter({ maxHp: 300, hp: 300 }, 'loss', downed, 1_700_000_000_000);
        assert.equal(after.hp, 0);
        assert.equal(after.hospitalized, true);
    });
});
