/*
 * PvE-ONLY relic power.
 *
 * Why this exists: gear STAT bonuses are folded in before the per-rank stat cap,
 * so a fully-capped fighter gains nothing from them — a simulation of a maxed
 * L100 build (all 12 stats at 2500, mastery 50, full BiS kit) showed every relic
 * moving damage by exactly 0. That made the relic slot dead weight for the
 * endgame players a rare chase drop is aimed at.
 *
 * The fix is a bonus channel that sits OUTSIDE the stat cap — and precisely
 * because it survives the cap, it is PvE-only: the balanced-PvP pillar forbids
 * combat power gained by grind or RNG. The separation is STRUCTURAL, not a flag:
 * api/pvp/move.ts never reads these fields, so PvP cannot apply them.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hydrateCharacterFromSave, type PvpFighter } from './session.js';
import { applyJutsu } from './move.js';
import { derivePveBonuses } from './_multipliers.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import { createSoloPveSession } from '../solo-pve/_session.js';

const STAT_FIELDS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];
// Best-in-slot endgame kit — the build for which stat bonuses are provably inert.
const BIS = {
    head: 'sennin-crown', body: 'sennin-chest', waist: 'sennin-waist',
    legs: 'sennin-legs', feet: 'sennin-feet', gloves: 'legendary-gloves',
    hand: 'void-leech-nodachi',
};
const BLAST = {
    id: 'blast', name: 'Blast', type: 'Ninjutsu', target: 'OPPONENT', method: 'SINGLE',
    ap: 60, effectPower: 40, range: 3, cooldown: 0, chakraCost: 0, staminaCost: 0,
    tags: [{ name: 'Damage', percent: 100 }],
};

function maxedFighter(relic: string | null): Record<string, unknown> {
    const stats: Record<string, number> = {};
    for (const f of STAT_FIELDS) stats[f] = 2500;
    const character: Record<string, unknown> = {
        name: 'Maxed', level: 100, specialty: 'Ninjutsu', stats,
        equipment: { ...BIS, ...(relic ? { relic } : {}) },
        maxHp: 10000, hp: 10000, maxChakra: 10000, chakra: 10000, maxStamina: 10000, stamina: 10000,
        jutsu: [BLAST], jutsuMastery: [{ jutsuId: 'blast', level: 50 }],
    };
    return hydrateCharacterFromSave(character, {}, { character, creatorItems: [] }, null);
}

function fighter(character: Record<string, unknown>, pos: number): PvpFighter {
    return {
        name: 'F', hp: 10000, maxHp: 10000, chakra: 10000, maxChakra: 10000,
        stamina: 10000, maxStamina: 10000, shield: 0, statuses: [], pos, character,
    };
}

function soloPveDamage(relic: string | null): number {
    const session = createSoloPveSession({
        sessionId: 's', ownerSlug: 'alice',
        encounter: { kind: 'generic-ai', id: 'rival', level: 100 },
        player: fighter(maxedFighter(relic), 62),
        enemy: fighter(maxedFighter(null), 63),
        now: 1_800_000_000_000, difficultyEnemyLevel: 100,
    } as never);
    const before = session.enemy.hp;
    const result = applySoloPveAction(session, { type: 'jutsu', jutsuId: 'blast' } as never, {} as never);
    return before - result.session.enemy.hp;
}

function pvpDamage(relic: string | null): number {
    const r = applyJutsu(fighter(maxedFighter(relic), 0), fighter(maxedFighter(null), 1), BLAST as never, 1, 'central', 1);
    return 10000 - r.opponent.hp;
}

describe('PvE-only relic power', () => {
    it('derives the two fields from the equipped relic', () => {
        const offense = derivePveBonuses({ equipment: { relic: 'relic-stormglass-pendulum' } }, { creatorItems: [] }, null);
        const defense = derivePveBonuses({ equipment: { relic: 'relic-gravewatch-fang' } }, { creatorItems: [] }, null);
        assert.equal(offense.pveDamagePct, 10);
        assert.equal(offense.pveDamageTakenPct, 0);
        assert.equal(defense.pveDamageTakenPct, 8);
        assert.equal(defense.pveDamagePct, 0);
    });

    it('is sealed onto the fighter by hydrateCharacterFromSave', () => {
        assert.equal(maxedFighter('relic-stormglass-pendulum').pveDamagePct, 10);
        assert.equal(maxedFighter('relic-gravewatch-fang').pveDamageTakenPct, 8);
        assert.equal(maxedFighter(null).pveDamagePct, 0);
    });

    it('RAISES PvE damage even at fully maxed stats — where stat bonuses do nothing', () => {
        const base = soloPveDamage(null);
        assert.ok(base > 0, 'baseline should deal damage');
        // +10% legendary, +6% epic, +3% free. Stat bonuses alone move this by 0.
        // The multiplier is applied inside the damage pipeline, so allow ±1 for
        // where the engine rounds rather than pinning an exact product.
        const expectPct = (relic: string, pct: number) => {
            const got = soloPveDamage(relic);
            const want = base * (1 + pct / 100);
            assert.ok(
                Math.abs(got - want) <= 1,
                `${relic} should deal ~+${pct}% in PvE: got ${got}, expected ~${want.toFixed(1)} (base ${base})`,
            );
        };
        expectPct('relic-stormglass-pendulum', 10);  // wild legendary
        expectPct('relic-ashfall-reliquary', 6);     // wild epic
        // The shop relic is the FLOOR of the pool: 1%, and spread across all four
        // offenses so no build is favoured (owner ruling 2026-08-16).
        expectPct('chakra-ring', 1);
    });

    it('changes NOTHING in PvP — the pillar guard', () => {
        const base = pvpDamage(null);
        for (const relic of [
            'relic-stormglass-pendulum', 'relic-drownstone-compass', 'relic-gravewatch-fang',
            'relic-hollow-gate-cinder', 'relic-ashfall-reliquary', 'chakra-ring',
        ]) {
            assert.equal(
                pvpDamage(relic), base,
                `${relic} must not change PvP damage — PvE power may never cross into PvP`,
            );
        }
    });

    /*
     * The Aura Sphere's level-300 perk (+5% PvE damage) used to be applied ONLY in
     * the client engines, so once PvE moved server-side it silently stopped
     * working in the fights that count. It now rides the same PvE channel as
     * relics — and stacks with one, since the sphere and the relic occupy
     * different slots by design.
     */
    const sphereChar = (level: number, relic?: string) => {
        const character: Record<string, unknown> = {
            name: 'Sage', level: 100, stats: { ninjutsuOffense: 100 },
            auraSphereLevel: level,
            equipment: { aura: 'aura-sphere', ...(relic ? { relic } : {}) },
        };
        return hydrateCharacterFromSave(character, {}, { character, creatorItems: [] }, null);
    };

    it('routes the Aura Sphere level-300 perk into server PvE', () => {
        assert.equal(sphereChar(299).pveDamagePct, 0, 'below 300 the perk is not unlocked');
        assert.equal(sphereChar(300).pveDamagePct, 5, 'at 300 the sphere grants +5% PvE damage');
    });

    it('grants the sphere perk only while the sphere is EQUIPPED', () => {
        const unequipped: Record<string, unknown> = {
            name: 'Sage', level: 100, stats: {}, auraSphereLevel: 300, equipment: {},
        };
        const hydrated = hydrateCharacterFromSave(unequipped, {}, { character: unequipped, creatorItems: [] }, null);
        assert.equal(hydrated.pveDamagePct, 0, 'an unequipped sphere grants nothing');
    });

    it('stacks the sphere perk with a relic — they are different slots', () => {
        assert.equal(sphereChar(300, 'relic-stormglass-pendulum').pveDamagePct, 15, '5 (sphere) + 10 (relic)');
    });

    it('keeps the sphere perk out of PvP like every other PvE bonus', () => {
        const stats: Record<string, number> = {};
        for (const f of STAT_FIELDS) stats[f] = 2500;
        const withSphere: Record<string, unknown> = {
            name: 'Sage', level: 100, specialty: 'Ninjutsu', stats,
            auraSphereLevel: 300, equipment: { ...BIS, aura: 'aura-sphere' },
            maxHp: 10000, hp: 10000, maxChakra: 10000, chakra: 10000, maxStamina: 10000, stamina: 10000,
            jutsu: [BLAST], jutsuMastery: [{ jutsuId: 'blast', level: 50 }],
        };
        const sealed = hydrateCharacterFromSave(withSphere, {}, { character: withSphere, creatorItems: [] }, null);
        const r = applyJutsu(fighter(sealed, 0), fighter(maxedFighter(null), 1), BLAST as never, 1, 'central', 1);
        assert.equal(10000 - r.opponent.hp, pvpDamage(null), 'the sphere must not raise PvP damage');
    });

    it('a defensive relic reduces what the AI deals to the player', () => {
        const hit = (relic: string | null) => {
            const session = createSoloPveSession({
                sessionId: 's', ownerSlug: 'alice',
                encounter: { kind: 'generic-ai', id: 'rival', level: 100 },
                player: fighter(maxedFighter(relic), 62),
                enemy: fighter(maxedFighter(null), 63),
                now: 1_800_000_000_000, difficultyEnemyLevel: 100,
            } as never);
            // The engine's own enemy phase drives the AI; measure the player's loss.
            const before = session.player.hp;
            const result = applySoloPveAction(session, { type: 'endTurn' } as never, {} as never);
            return before - result.session.player.hp;
        };
        const bare = hit(null);
        const warded = hit('relic-gravewatch-fang');
        if (bare > 0) assert.ok(warded < bare, `an 8% ward should blunt the AI's hit (${warded} < ${bare})`);
    });
});
