import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { endTurn, runAiUntilHuman } from './_engine.js';
import { makeRng } from './_sim.js';
import { buildAuthoritativeSoloEncounter, dynamicBossFloor, weeklyBossEnemyTemplate } from '../_authoritative-pve.js';
import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import {
    WEEKLY_BOSS_MAX_HIT_FRACTION,
    WEEKLY_BOSS_MAX_TURN_FRACTION,
    WEEKLY_BOSS_GUARDED_DAMAGE_MULT,
    WEEKLY_BOSS_OPEN_DAMAGE_MULT,
    isWeeklyBossOpenRound,
} from '../_pve-difficulty.js';
import type { TowerSession } from './_tower-session.js';
import type { TowerFloor } from './_floor-catalog.js';

/*
 * The weekly boss's own PvE clamp, end to end.
 *
 * The weekly boss moved onto this engine, but BOTH halves of its difficulty
 * design lived only on the client: the 8%/hit + 15%/turn boss→player ceiling and
 * the guard-up/guard-down cycle. So the server boss dealt its raw stat sheet —
 * a near-one-shot on a level-100 boss — and had no guard cycle at all.
 *
 * What this file pins is the WIRING: that the ceiling reaches the damage the
 * engine actually applies, that it is metered per enemy turn, that the cycle
 * reaches player→boss damage, and that both are a strict no-op for every mode
 * that did not seal a weekly guard.
 */

const bossProfile = AI_PROFILE_CATALOG['builtin-ai-central-champion'];

function makeSave(maxHp: number): Record<string, unknown> {
    return {
        character: {
            name: 'Rill', level: 60, specialty: 'Ninjutsu', maxHp, hp: maxHp,
            stats: {
                strength: 200, speed: 200, intelligence: 200, willpower: 200,
                ninjutsuOffense: 400, ninjutsuDefense: 200,
                taijutsuOffense: 200, taijutsuDefense: 200,
                bukijutsuOffense: 200, bukijutsuDefense: 200,
                genjutsuOffense: 200, genjutsuDefense: 200,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
        },
        savedBloodlines: [], creatorJutsus: [],
    };
}

function build(guarded: boolean, playerMaxHp = 10_000): TowerSession {
    return buildAuthoritativeSoloEncounter({
        playerName: 'Rill',
        save: makeSave(playerMaxHp),
        floor: dynamicBossFloor({ id: 9_200, name: 'Weekly Boss', bossAiId: 'builtin-ai-central-champion', objective: 'survive', roundBudget: 20 }),
        bossTemplate: weeklyBossEnemyTemplate(bossProfile as unknown as Record<string, unknown>, { id: 'builtin-ai-central-champion', name: 'Weekly Boss' }),
        runId: `weekly-guard-${guarded}`,
        seed: 99,
        now: 1_770_000_000_000,
        towerId: 'weekly-boss',
        ...(guarded ? { pveGuardKind: 'weeklyBoss' as const } : {}),
    });
}

function human(session: TowerSession) {
    return session.actors.find(a => a.ai === false)!;
}

/** Pass the human's turn and let the boss act, `rounds` times. */
function runBossTurns(session: TowerSession, rounds: number): void {
    const floor = session.encounterFloor as TowerFloor;
    const rng = makeRng(session.seed);
    for (let i = 0; i < rounds && session.status === 'active'; i++) {
        const me = human(session);
        if (!me || me.hp <= 0) break;
        endTurn(session, floor);
        if (session.status !== 'active') break;
        runAiUntilHuman(session, floor, rng);
    }
}

describe('weekly boss — boss→player clamp', () => {
    it('is armed from the moment the session is built, and holds a fragile player', () => {
        // The guard is sealed inside buildAuthoritativeSoloEncounter, before the
        // startRound + runAiUntilHuman it runs INLINE — the trap that bit the
        // towers in step B.
        //
        // A FRAGILE player and the unguarded PRECONDITION are what make this
        // bite. Asserting "the boss stayed under the ceiling" against a sturdy
        // player passes whether or not the clamp runs, because the boss never
        // reaches the ceiling — a vacuous test. The precondition also corrected a
        // wrong assumption: the boss deals 0 on the first turn or two because it
        // is closing distance, so a one-turn window proves nothing either.
        const FRAGILE = 500;
        const ROUNDS = 3;
        const guarded = build(true, FRAGILE);
        const raw = build(false, FRAGILE);
        assert.equal(guarded.pveGuard?.kind, 'weeklyBoss', 'the guard must be sealed by the time the session is handed out');

        runBossTurns(guarded, ROUNDS);
        runBossTurns(raw, ROUNDS);

        const perTurn = Math.floor(human(guarded).maxHp * WEEKLY_BOSS_MAX_TURN_FRACTION);
        const rawLost = human(raw).maxHp - human(raw).hp;
        assert.ok(rawLost > perTurn,
            `precondition failed: the unguarded boss dealt only ${rawLost} across ${ROUNDS} turns, already under the ${perTurn} per-turn ceiling — this test would prove nothing`);

        const guardedLost = human(guarded).maxHp - human(guarded).hp;
        assert.ok(guardedLost <= perTurn * ROUNDS,
            `the boss dealt ${guardedLost} across ${ROUNDS} turns, over the ${perTurn * ROUNDS} the per-turn ceiling allows`);
        assert.ok(guardedLost < rawLost, 'the guard must actually reduce what a fragile player takes');
    });

    it('holds every boss turn to the per-turn ceiling', () => {
        const session = build(true);
        const me = human(session);
        const maxHp = me.maxHp;
        const perTurn = Math.floor(maxHp * WEEKLY_BOSS_MAX_TURN_FRACTION);
        let landedAny = false;
        for (let round = 0; round < 6 && session.status === 'active'; round++) {
            const before = human(session).hp;
            runBossTurns(session, 1);
            const dealt = before - human(session).hp;
            if (dealt > 0) landedAny = true;
            assert.ok(dealt <= perTurn, `a boss turn dealt ${dealt}, over the ${perTurn} per-turn ceiling`);
        }
        // Non-vacuity: a guard that clamps nothing because the boss never swung
        // would pass every assertion above.
        assert.ok(landedAny, 'the boss must actually land damage for this to prove anything');
    });

    it('leaves the player alive for many rounds instead of near-one-shotting them', () => {
        // The whole point: the boss is a grind, not a coin flip. Unclamped, a
        // level-100 boss's raw sheet is ~9k on a 10k-HP fighter.
        const session = build(true);
        runBossTurns(session, 5);
        assert.ok(human(session).hp > 0, 'a 10k-HP fighter must survive five boss turns');
    });

    it('is a strict NO-OP for a session that sealed no weekly guard', () => {
        const session = build(false);
        assert.equal(session.pveGuard, undefined, 'other modes must be byte-identical');
    });

    it('a guarded run takes strictly less damage than an unguarded one', () => {
        // The clamp must actually bite on this encounter, or the tests above are
        // measuring a boss that was already gentle.
        const guarded = build(true);
        const raw = build(false);
        runBossTurns(guarded, 4);
        runBossTurns(raw, 4);
        const guardedLost = human(guarded).maxHp - human(guarded).hp;
        const rawLost = human(raw).maxHp - human(raw).hp;
        assert.ok(rawLost > guardedLost, `unguarded lost ${rawLost}, guarded lost ${guardedLost} — the clamp is not biting`);
    });
});

describe('weekly boss — player→boss guard cycle', () => {
    it('opens on round 1 and every CYCLE-th round after', () => {
        assert.equal(isWeeklyBossOpenRound(1), true);
        assert.equal(isWeeklyBossOpenRound(2), false);
        assert.equal(isWeeklyBossOpenRound(4), false);
        assert.equal(isWeeklyBossOpenRound(5), true);
        assert.equal(isWeeklyBossOpenRound(9), true);
    });

    it('the open-round bonus and the guarded soak are on opposite sides of 1', () => {
        // A sanity pin on the pair: if these ever land on the same side, the
        // cycle stops being a decision and becomes a flat multiplier.
        assert.ok(WEEKLY_BOSS_OPEN_DAMAGE_MULT > 1);
        assert.ok(WEEKLY_BOSS_GUARDED_DAMAGE_MULT < 1);
        assert.ok(WEEKLY_BOSS_MAX_HIT_FRACTION < WEEKLY_BOSS_MAX_TURN_FRACTION,
            'the per-hit ceiling must be tighter than the per-turn one, or chaining is unbounded');
    });
});
