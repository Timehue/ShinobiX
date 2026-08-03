import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from '../pvp/move.js';
import { endTurn, runAiUntilHuman, startRound } from './_engine.js';
import { makeRng } from './_sim.js';
import { buildAiFightEncounter, type AiFightProfile } from '../missions/_ai-fight-encounter.js';
import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import type { TowerSession } from './_tower-session.js';
import type { TowerFloor } from './_floor-catalog.js';

/*
 * Step 3b wiring: the standard-PvE hit guard, end to end.
 *
 * The unit-level parity of the curve itself lives in
 * scripts/pve-difficulty-parity.test.ts. What THIS file pins is the wiring —
 * that the clamp actually reaches the damage the engine applies, that it lands
 * PRE-shield (so shield remains a separate mitigation on top of an already
 * capped hit, exactly as on the client), that it is metered per enemy turn, and
 * — the part that matters most — that it is a strict no-op for every mode that
 * did not seal a pveGuard, so PvP and un-migrated PvE are untouched.
 */

const profile = AI_PROFILE_CATALOG['builtin-ai-academy-sparring'] as unknown as AiFightProfile;

function makeSave(level: number, maxHp: number): Record<string, unknown> {
    return {
        character: {
            name: 'Rill', level, specialty: 'Ninjutsu', maxHp, hp: maxHp,
            stats: {
                strength: 100, speed: 100, intelligence: 100, willpower: 100,
                ninjutsuOffense: 200, ninjutsuDefense: 100,
                taijutsuOffense: 100, taijutsuDefense: 100,
                bukijutsuOffense: 100, bukijutsuDefense: 100,
                genjutsuOffense: 100, genjutsuDefense: 100,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
        },
        savedBloodlines: [], creatorJutsus: [],
    };
}

function build(scalingLevel: number, playerMaxHp = 800): TowerSession {
    return buildAiFightEncounter({
        playerName: 'Rill',
        save: makeSave(20, playerMaxHp),
        profile,
        runId: `aifight-guard-${scalingLevel}`,
        seed: 99,
        now: 1_770_000_000_000,
        scaling: { level: scalingLevel, statBonus: 200 },
    });
}

/**
 * Pass the human's turn and let the enemy act, `rounds` times.
 *
 * Driving this correctly matters: an earlier version jumped activeIndex past
 * the queue, which skipped the enemy's turn entirely and made the guard tests
 * pass VACUOUSLY (the peer-band fight "ended" on the round limit, not a kill).
 * Every caller below therefore also asserts the enemy actually dealt damage.
 */
function runEnemyTurns(session: TowerSession, rounds: number): void {
    const floor = session.encounterFloor as TowerFloor;
    const rng = makeRng(session.seed);
    for (let i = 0; i < rounds && session.status === 'active'; i++) {
        const human = session.actors.find((a) => a.ai === false);
        if (!human || human.hp <= 0) break;
        endTurn(session, floor);              // human passes → enemy becomes active
        if (session.status !== 'active') break;
        runAiUntilHuman(session, floor, rng); // enemy acts, then stops back at the human
    }
}

describe('standard-PvE hit guard (engine wiring)', () => {
    it('is a strict no-op when the resolver gets no damageCap', () => {
        // The byte-identical guarantee for PvP and every un-migrated PvE mode.
        const fighter = () => ({
            name: 'A', hp: 500, maxHp: 500, chakra: 500, maxChakra: 500,
            stamina: 500, maxStamina: 500, shield: 0, statuses: [], pos: 0,
            character: { level: 50, stats: { ninjutsuOffense: 900, ninjutsuDefense: 200 }, jutsu: [] },
        });
        const jutsu = { id: 'j', name: 'J', type: 'Ninjutsu', element: 'Fire', ap: 60, range: 3, effectPower: 30, tags: [] };
        const uncapped = applyJutsu(fighter() as never, fighter() as never, jutsu as never, 1, 'central', 1);
        assert.equal(uncapped.metadata.damage, uncapped.metadata.rawDamage, 'no cap → identity');
        assert.ok(uncapped.metadata.damage > 0, 'fixture check: the cast deals damage');
    });

    it('sealed jutsu mastery actually raises the damage the AI deals', () => {
        // Closes the loop on the step-3b finding. The encounter test asserts the
        // mastery array is SEALED; this asserts it has EFFECT — i.e. that an
        // unsealed enemy really was casting at masteryDamageFrac(0) = 0.3.
        const attacker = (mastery: number | null) => ({
            name: 'A', hp: 500, maxHp: 500, chakra: 500, maxChakra: 500,
            stamina: 500, maxStamina: 500, shield: 0, statuses: [], pos: 0,
            character: {
                level: 80, stats: { ninjutsuOffense: 900, ninjutsuDefense: 200 }, jutsu: [],
                ...(mastery === null ? {} : { jutsuMastery: [{ jutsuId: 'j', level: mastery }] }),
            },
        });
        const defender = () => ({
            name: 'D', hp: 5000, maxHp: 5000, chakra: 500, maxChakra: 500,
            stamina: 500, maxStamina: 500, shield: 0, statuses: [], pos: 0,
            character: { level: 80, stats: { ninjutsuOffense: 200, ninjutsuDefense: 200 }, jutsu: [] },
        });
        const jutsu = { id: 'j', name: 'J', type: 'Ninjutsu', element: 'Fire', ap: 60, range: 3, effectPower: 30, tags: [] };

        const unsealed = applyJutsu(attacker(null) as never, defender() as never, jutsu as never, 1, 'central', 1);
        const sealed = applyJutsu(attacker(50) as never, defender() as never, jutsu as never, 1, 'central', 1);
        assert.ok(
            sealed.metadata.damage > unsealed.metadata.damage,
            `mastery must raise damage (${unsealed.metadata.damage} → ${sealed.metadata.damage})`,
        );
        // masteryDamageFrac is 0.3 at mastery 0 and 1.0 at 50, so the sealed cast
        // should land near 3.3x. Asserted as a band, not an exact figure, so a
        // tuning change to the ramp does not spuriously fail this.
        const ratio = sealed.metadata.damage / Math.max(1, unsealed.metadata.damage);
        assert.ok(ratio > 2.5 && ratio < 4, `expected roughly a 3.3x lift, got ${ratio.toFixed(2)}x`);
    });

    it('clamps to the cap, and does so BEFORE shield absorbs', () => {
        const attacker = {
            name: 'A', hp: 500, maxHp: 500, chakra: 500, maxChakra: 500,
            stamina: 500, maxStamina: 500, shield: 0, statuses: [], pos: 0,
            character: { level: 50, stats: { ninjutsuOffense: 900, ninjutsuDefense: 200 }, jutsu: [] },
        };
        const defender = (shield: number) => ({
            name: 'D', hp: 500, maxHp: 500, chakra: 500, maxChakra: 500,
            stamina: 500, maxStamina: 500, shield, statuses: [], pos: 0,
            character: { level: 50, stats: { ninjutsuOffense: 200, ninjutsuDefense: 200 }, jutsu: [] },
        });
        const jutsu = { id: 'j', name: 'J', type: 'Ninjutsu', element: 'Fire', ap: 60, range: 3, effectPower: 30, tags: [] };
        const CAP = 10;

        const raw = applyJutsu(attacker as never, defender(0) as never, jutsu as never, 1, 'central', 1);
        assert.ok(raw.metadata.damage > CAP, `fixture check: uncapped hit ${raw.metadata.damage} must exceed the cap`);

        const capped = applyJutsu(attacker as never, defender(0) as never, jutsu as never, 1, 'central', 1, CAP);
        assert.equal(capped.metadata.damage, CAP, 'damage is clamped to the cap');
        assert.equal(capped.metadata.rawDamage, raw.metadata.damage, 'rawDamage still reports the pre-cap figure');

        // PRE-shield is the load-bearing property: with a shield of 4, the
        // capped 10 is reduced to 6 HP loss. If the clamp were applied to the
        // post-shield number the player would lose the full 10.
        const withShield = applyJutsu(attacker as never, defender(4) as never, jutsu as never, 1, 'central', 1, CAP);
        assert.equal(withShield.opponent.hp, 500 - (CAP - 4), 'shield absorbs from the ALREADY-capped hit');
        assert.equal(withShield.opponent.shield, 0, 'and the shield is spent');
    });

    it('an easy-band opponent cannot SUDDEN-DEATH a healthy player in one turn', () => {
        // The onboarding guarantee is specifically about sudden death: a player
        // who STARTED the turn above half HP survives it. It is NOT immortality
        // — once they are worn below half the mercy floor stops applying and
        // they can be finished, exactly as on the client. Asserting "never dies
        // across 12 turns" would be asserting a rule the game does not have.
        const session = build(20);
        startRound(session);
        const player = () => session.actors.find((a) => a.ai === false)!;
        assert.equal(player().hp, player().maxHp, 'fixture check: starts at full HP');
        // The easy band HOLDS its burst jutsu for the opening rounds
        // (pveEasyBandHoldsBurst, wired into bestAffordableJutsu), so the first
        // landed hit is not necessarily on turn 1. Advance until the enemy
        // actually swings and assert the guarantee on THAT turn.
        let hpAtTurnStart = player().hp;
        let landed = false;
        for (let i = 0; i < 6 && session.status === 'active'; i++) {
            hpAtTurnStart = player().hp;
            runEnemyTurns(session, 1);
            if (player().hp < hpAtTurnStart) { landed = true; break; }
        }
        // NON-VACUITY: the enemy must actually have hit, or "survived" proves nothing.
        assert.ok(landed, 'the enemy must land damage within the opening turns');
        assert.equal(hpAtTurnStart, player().maxHp, 'the first landed hit must arrive while the player is still at full HP');
        assert.ok(player().hp > 0, 'a full-HP player must survive one easy-band enemy turn');
    });

    it('holds the easy-band per-turn ceiling on every single turn', () => {
        // The other half of the contract: even once the mercy floor lapses, no
        // ONE turn may take more than the band's per-turn fraction of the bar.
        const session = build(20);
        startRound(session);
        const player = () => session.actors.find((a) => a.ai === false)!;
        const maxHp = player().maxHp;
        const ceiling = Math.max(1, Math.floor(maxHp * 0.30)); // easy band
        let landedAny = false;
        for (let turn = 0; turn < 15 && session.status === 'active' && player().hp > 0; turn++) {
            const before = player().hp;
            runEnemyTurns(session, 1);
            const lost = before - player().hp;
            if (lost > 0) landedAny = true;
            assert.ok(lost <= ceiling, `turn ${turn}: lost ${lost} > easy-band ceiling ${ceiling}`);
        }
        assert.ok(landedAny, 'NON-VACUITY: the enemy must have landed at least one hit');
    });

    it('meters damage per enemy turn and resets each turn', () => {
        const session = build(20);
        startRound(session);
        runEnemyTurns(session, 3);
        const guard = session.pveGuard!;
        assert.ok(guard, 'the guard must be sealed');
        const player = session.actors.find((a) => a.ai === false)!;
        // Turn state is per enemy turn: after a reset the tally is bounded by
        // the band's per-turn ceiling, never an unbounded running total.
        const dealt = guard.dealtThisTurn[player.id] ?? 0;
        assert.ok(dealt <= Math.ceil(player.maxHp * 0.30), `easy-band per-turn ceiling exceeded: ${dealt}`);
        assert.ok(Object.prototype.hasOwnProperty.call(guard.turnStartHp, player.id), 'turn-start HP is snapshotted');
    });

    it('leaves the peer band uncapped — endgame PvE still hits like a real duel', () => {
        const peer = build(95);
        assert.equal(peer.pveGuard?.enemyLevel, 95);
        // pveHitCapFor returns undefined in the peer band, so no clamp is passed
        // at all. Asserted through behaviour: the peer fight can actually kill.
        startRound(peer);
        const startHp = peer.actors.find((a) => a.ai === false)!.hp;
        runEnemyTurns(peer, 40);
        const player = peer.actors.find((a) => a.ai === false)!;
        // NON-VACUITY: assert the KILL, not merely that the session ended — a
        // round-limit timeout would otherwise let this pass without the enemy
        // ever landing a hit (which is exactly how the first draft passed).
        assert.ok(player.hp < startHp, `the peer foe must land damage (hp ${startHp} → ${player.hp})`);
        assert.equal(player.hp, 0, 'an uncapped peer-band foe must be able to finish a player off');
    });

    it('does not arm the guard for sessions that never sealed one', () => {
        const session = build(20);
        delete session.pveGuard;
        startRound(session);
        // No guard → no clamp, no turn state written. This is the path every
        // tower / spire / clan-boss / mission / story run takes today.
        runEnemyTurns(session, 3);
        assert.equal(session.pveGuard, undefined, 'the engine must not create a guard on its own');
    });
});
