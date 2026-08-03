import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { pickAiAction, startRound } from './_engine.js';
import { makeRng } from './_sim.js';
import { buildAiFightEncounter, type AiFightProfile } from '../missions/_ai-fight-encounter.js';
import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import type { TowerSession, TowerActor } from './_tower-session.js';

/*
 * Step A wiring: the four PvE band-BEHAVIOUR helpers in api/_pve-difficulty.ts
 * (pveEasyBandHoldsBurst / pveIsBurstJutsuAp / pveEasyBandAllowsLethal /
 * pveAiCompetence) reaching the engine's action picker.
 *
 * Unit parity of the helpers themselves lives in
 * scripts/pve-difficulty-parity.test.ts, and the buff list the Clear threshold
 * reads is pinned by scripts/pve-ai-tactics-parity.test.ts. What THIS file pins
 * is that they change what the AI actually DOES — and, just as importantly, that
 * they are a strict no-op for a session with no sealed `pveGuard` (every tower /
 * spire / clan-boss / mission / story run today) and for squad-side AI.
 *
 * Every assertion here is paired with a fixture check, because a picker test
 * fails vacuously the moment the option under test was never in the pool.
 */

const profile = AI_PROFILE_CATALOG['builtin-ai-academy-sparring'] as unknown as AiFightProfile;

/** A damage jutsu weak enough to be the AI's non-lethal alternative. The stock
 *  academy kit has only two identical 60-AP bursts plus an EMPTY_GROUND flicker
 *  (which the picker excludes), so the lethal gate has nothing to prefer without
 *  one — the fixture, not the gate, would decide the result. */
const WEAK_JAB = {
    id: 'weak-jab', name: 'Weak Jab', type: 'Ninjutsu', element: 'Fire',
    method: 'SINGLE', target: 'OPPONENT', ap: 40, range: 4, effectPower: 2, tags: [],
};

function makeSave(): Record<string, unknown> {
    return {
        character: {
            name: 'Rill', level: 20, specialty: 'Ninjutsu', maxHp: 800, hp: 800,
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

function build(level: number): TowerSession {
    const session = buildAiFightEncounter({
        playerName: 'Rill', save: makeSave(), profile,
        runId: `aifight-band-${level}`, seed: 99, now: 1_770_000_000_000,
        scaling: { level, statBonus: 200 },
    });
    startRound(session);
    return session;
}

const bossOf = (s: TowerSession): TowerActor => s.actors.find(a => a.id === 'boss')!;
const heroOf = (s: TowerSession): TowerActor => s.actors.find(a => a.ai === false)!;
const pick = (s: TowerSession, actor: TowerActor) => pickAiAction(s, actor, makeRng(1));
const jutsuList = (a: TowerActor) => a.character.jutsu as Array<Record<string, unknown>>;
/** AP of the jutsu a 'jutsu' action selected (undefined for any other action). */
function pickedAp(s: TowerSession, actor: TowerActor): number | undefined {
    const action = pick(s, actor);
    if (action.type !== 'jutsu') return undefined;
    const j = jutsuList(actor).find(x => x.id === action.jutsuId);
    return Number(j?.ap ?? 0);
}
const status = (name: string, kind: 'positive' | 'negative') => ({ name, kind, rounds: 3 });

describe('PvE band AI behaviour (engine wiring)', () => {
    describe('easy-band burst hold', () => {
        it('withholds 60+ AP jutsu in the opening rounds, then releases them', () => {
            const session = build(20); // easy band
            const boss = bossOf(session);
            // FIXTURE CHECK: the kit really is burst-only, so "no burst picked"
            // is a decision by the hold and not an empty pool.
            assert.ok(
                jutsuList(boss).some(j => Number(j.ap) >= 60),
                'fixture check: the opponent carries a 60+ AP jutsu',
            );

            session.round = 1;
            assert.notEqual(pickedAp(session, boss), 60, 'round 1: burst held');
            session.round = 2;
            assert.notEqual(pickedAp(session, boss), 60, 'round 2: burst held');
            // NON-VACUITY: it must actually cast once the hold lapses, or the two
            // assertions above would pass for a foe that simply cannot reach.
            session.round = 3;
            assert.equal(pickedAp(session, boss), 60, 'round 3: the hold lapses and the burst lands');
        });

        it('is easy-band only — a medium-band foe opens with its burst', () => {
            const session = build(45);
            session.round = 1;
            assert.equal(pickedAp(session, bossOf(session)), 60, 'medium band never holds');
        });

        it('is a no-op for a session that sealed no pveGuard', () => {
            // The byte-identical guarantee for towers / spire / clan boss /
            // missions / story, none of which seal a guard.
            const session = build(20);
            delete session.pveGuard;
            session.round = 1;
            assert.equal(pickedAp(session, bossOf(session)), 60, 'no guard → no hold');
        });

        it('is a no-op for squad-side AI in a guarded session', () => {
            // Async allies and AFK humans run the same picker; the band layer is
            // scoped to side === 'enemy' so they keep the plain policy.
            const session = build(20);
            const hero = heroOf(session);
            hero.character.jutsu = [...jutsuList(bossOf(session))];
            // The level-20 save's own pools are far under the burst's cost, so
            // without this the resource filter — not the band — decides the pick.
            hero.chakra = hero.maxChakra = 5000;
            hero.stamina = hero.maxStamina = 5000;
            session.round = 1;
            assert.equal(pickedAp(session, hero), 60, 'squad-side AI is untouched by the band');
        });
    });

    describe('easy-band lethal intent', () => {
        it('prefers a non-lethal option against a healthy player, and finishes a low one', () => {
            const session = build(20);
            const boss = bossOf(session);
            const hero = heroOf(session);
            jutsuList(boss).push(WEAK_JAB);
            session.round = 3; // past the burst hold, so the strong option is in the pool

            hero.hp = hero.maxHp; // 100% — well above the 25% lethal-intent floor
            const spared = pick(session, boss);
            assert.equal(spared.type, 'jutsu');
            assert.equal(spared.type === 'jutsu' ? spared.jutsuId : '', WEAK_JAB.id,
                'a healthy player is not deliberately executed');

            hero.hp = Math.floor(hero.maxHp * 0.1); // at/below 25% — the finish is allowed
            const finisher = pick(session, boss);
            assert.equal(finisher.type === 'jutsu' ? Number(jutsuList(boss).find(j => j.id === (finisher as { jutsuId: string }).jutsuId)?.ap) : 0, 60,
                'a nearly-dead player can be finished with the strongest jutsu');
        });

        it('never disarms the AI — with only lethal options it still casts', () => {
            // The stock kit has no weak alternative. The gate must fall back to
            // the best jutsu rather than leaving the foe passive.
            const session = build(20);
            const boss = bossOf(session);
            session.round = 3;
            heroOf(session).hp = heroOf(session).maxHp;
            assert.equal(pickedAp(session, boss), 60, 'no non-lethal option → cast anyway');
        });

        it('is easy-band only — a medium-band foe takes the strongest option', () => {
            const session = build(45);
            const boss = bossOf(session);
            jutsuList(boss).push(WEAK_JAB);
            session.round = 1;
            heroOf(session).hp = heroOf(session).maxHp;
            assert.equal(pickedAp(session, boss), 60, 'medium band always allows lethal intent');
        });
    });

    describe('competence: clear the player\'s buffs', () => {
        it('clears once meaningful buffs reach the band threshold', () => {
            const session = build(45); // medium → clearBuffThreshold 2
            const hero = heroOf(session);

            hero.statuses = [status('Increase Damage Given', 'positive')];
            assert.notEqual(pick(session, bossOf(session)).type, 'clear', 'one buff is under the threshold');

            hero.statuses.push(status('Absorb', 'positive'));
            const action = pick(session, bossOf(session));
            assert.equal(action.type, 'clear', 'two buffs meet the medium-band threshold');
            assert.equal(action.type === 'clear' ? action.targetId : '', hero.id);
        });

        it('ignores buffs not worth a 60-AP Clear', () => {
            const session = build(45);
            heroOf(session).statuses = [
                status('Cosmetic Sparkle', 'positive'),
                status('Some Other Buff', 'positive'),
                status('Yet Another', 'positive'),
            ];
            assert.notEqual(pick(session, bossOf(session)).type, 'clear', 'trivial positives do not bait a Clear');
        });

        it('never fires in the easy band, however many buffs stack up', () => {
            const session = build(20); // easy → threshold Infinity
            heroOf(session).statuses = [
                status('Increase Damage Given', 'positive'), status('Absorb', 'positive'),
                status('Reflect', 'positive'), status('Lifesteal', 'positive'),
            ];
            assert.notEqual(pick(session, bossOf(session)).type, 'clear', 'a new player is never answered by a Clear');
        });

        it('respects the clear cooldown', () => {
            const session = build(45);
            heroOf(session).statuses = [status('Increase Damage Given', 'positive'), status('Absorb', 'positive')];
            const boss = bossOf(session);
            assert.equal(pick(session, boss).type, 'clear', 'fixture check: it would clear');
            boss.cooldowns['clear'] = 5;
            assert.notEqual(pick(session, boss).type, 'clear', 'on cooldown → falls through');
        });
    });

    describe('competence: cleanse self', () => {
        it('sheds its own debuffs at the band threshold', () => {
            const session = build(45); // medium → cleanseSelfThreshold 3
            const boss = bossOf(session);

            boss.statuses = [status('Poison', 'negative'), status('Wound', 'negative')];
            assert.notEqual(pick(session, boss).type, 'cleanse', 'two debuffs are under the threshold');

            boss.statuses.push(status('Drain', 'negative'));
            assert.equal(pick(session, boss).type, 'cleanse', 'three debuffs meet the medium-band threshold');
        });

        it('never fires in the easy band', () => {
            const session = build(20);
            const boss = bossOf(session);
            boss.statuses = [
                status('Poison', 'negative'), status('Wound', 'negative'),
                status('Drain', 'negative'), status('Stun', 'negative'),
            ];
            assert.notEqual(pick(session, boss).type, 'cleanse', 'easy band leaves the threshold Infinite');
        });

        it('is a no-op for a session that sealed no pveGuard', () => {
            const session = build(45);
            delete session.pveGuard;
            const boss = bossOf(session);
            heroOf(session).statuses = [status('Increase Damage Given', 'positive'), status('Absorb', 'positive')];
            boss.statuses = [status('Poison', 'negative'), status('Wound', 'negative'), status('Drain', 'negative')];
            const action = pick(session, boss);
            assert.notEqual(action.type, 'clear', 'no guard → no Clear');
            assert.notEqual(action.type, 'cleanse', 'no guard → no Cleanse');
        });
    });
});
