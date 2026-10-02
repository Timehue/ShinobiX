/*
 * Weather affinity parity: the Tower engine must read a jutsu's weather
 * element the way PvP (api/pvp/move.ts) and Solo PvE (api/solo-pve/_engine.ts)
 * do: `jutsu.weatherElement ?? jutsu.element`. The client's `weatherElementOf`
 * (shinobij.client/src/lib/elements.ts) uses the same rule.
 *
 * Bloodline techniques carry an explicit `weatherElement`: a base element the
 * creator picked, or "None" to opt out of weather entirely. Tower sealing
 * keeps the field (see api/bloodlines/_combat-integration.test.ts), so a Tower
 * fight that ignores it would buff a cosmetic Crystal jutsu as nothing and an
 * opted-out Fire jutsu as Fire.
 *
 * Hunt encounters are the Tower sessions that carry weather: attachHuntCombat
 * copies the Solo session's sealed weather onto the Tower battle. These cases
 * drive that real path and compare damage against the same cast with no
 * weather, under one RNG seed, so the weather term is the only difference.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession } from '../solo-pve/_session.js';
import { attachHuntCombat } from '../solo-pve/_hunt-combat.js';
import { weatherMultiplier } from '../combat-core/formulas.js';
import { applyAction } from './_engine.js';
import { makeRng } from './_sim.js';

const NOW = 1_800_000_000_000;
const POSITIVE = 'Fire';
const NEGATIVE = 'Water';
const ENEMY_HP = 1_000_000;

// The full stat block and a trained technique: the shared damage formula reads
// the general stats and scales EP by mastery, so a thinner fixture deals 0.
const STATS = {
    strength: 500, speed: 500, intelligence: 500, willpower: 500,
    bukijutsuOffense: 500, bukijutsuDefense: 500, taijutsuOffense: 500, taijutsuDefense: 500,
    genjutsuOffense: 500, genjutsuDefense: 500, ninjutsuOffense: 500, ninjutsuDefense: 500,
};
const PROBE_ID = 'weather-probe';

function fighter(name: string): PvpFighter {
    return {
        name, hp: 1000, maxHp: 1000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
        shield: 0, statuses: [], pos: 62,
        character: {
            name, level: 100, specialty: 'Taijutsu', stats: { ...STATS },
            jutsu: [], jutsuMastery: [{ jutsuId: PROBE_ID, level: 50 }], pvpItems: [], equipment: {},
        },
    };
}

type WeatherCase = { element: string; weatherElement?: string };

/** Damage dealt by one cast of the case's jutsu in a fresh single-creature hunt. */
function castDamage(jutsu: WeatherCase, weathered: boolean): number {
    const session = createSoloPveSession({
        sessionId: 'hunt-weather-parity', ownerSlug: 'hunter',
        encounter: { kind: 'generic-ai', id: 'hunt-wild-boar', level: 20 },
        player: fighter('Hunter'), enemy: fighter('Wild Boar'), now: NOW,
    });
    if (weathered) {
        session.environment.weatherPositiveElement = POSITIVE;
        session.environment.weatherNegativeElement = NEGATIVE;
    }
    attachHuntCombat(session, {
        kind: 'hunt-target', sourceId: 'hunt-wild-boar', missionId: 'hunt-wild-boar',
        huntRunId: 'weather-parity-run', sector: 25, stage: 0, displayName: 'Wild Boar',
        huntFormation: { version: 1, kind: 'single', count: 1 },
    });
    const battle = session.huntCombat!.battle;
    assert.deepEqual(battle.weather, weathered
        ? { positiveElement: POSITIVE, negativeElement: NEGATIVE }
        : { positiveElement: undefined, negativeElement: undefined });

    const player = battle.actors.find((actor) => actor.id === 'player')!;
    const enemy = battle.actors.find((actor) => actor.side === 'enemy')!;
    player.character.jutsu = [{
        id: PROBE_ID, name: 'Weather Probe', type: 'Taijutsu', target: 'OPPONENT', method: 'SINGLE',
        // 60 AP: a 40-AP technique is a zero-damage utility by rule.
        effectPower: 60, ap: 60, range: 30, chakraCost: 0, staminaCost: 0, cooldown: 0, tags: [],
        ...jutsu,
    }];
    // Enough HP that no cast is clamped, so the two variants stay comparable.
    enemy.hp = ENEMY_HP;
    enemy.maxHp = ENEMY_HP;

    const result = applyAction(battle, battle.encounterFloor!,
        { actorId: player.id, type: 'jutsu', jutsuId: PROBE_ID, targetId: enemy.id },
        makeRng(20261002));
    assert.equal(result.applied, true, result.reason ?? 'the cast resolves');
    return ENEMY_HP - enemy.hp;
}

function assertWeatherScales(jutsu: WeatherCase): void {
    const neutral = castDamage(jutsu, false);
    const weathered = castDamage(jutsu, true);
    assert.ok(neutral > 0, 'the probe cast must land for the comparison to mean anything');
    // The same rule as PvP, Solo and the client's weatherElementOf.
    const expected = weatherMultiplier(jutsu.weatherElement ?? jutsu.element, POSITIVE, NEGATIVE);
    // The engine rounds after multiplying, so allow a point of rounding on each side.
    assert.ok(Math.abs(weathered - neutral * expected) <= 2,
        `expected ~${(neutral * expected).toFixed(1)} damage (×${expected}) under ${POSITIVE}+/${NEGATIVE}- weather, `
        + `got ${weathered} against ${neutral} unweathered`);
}

describe('Tower weather term reads weatherElement like PvP and Solo', () => {
    it('buffs a plain Fire jutsu in Fire weather (the junction is live on the hunt path)', () => {
        assertWeatherScales({ element: 'Fire' });
    });

    it('buffs a Crystal bloodline jutsu whose weather element is Fire', () => {
        assertWeatherScales({ element: 'Crystal', weatherElement: 'Fire' });
    });

    it('does not buff a Fire-looking jutsu whose creator opted out of weather ("None")', () => {
        assertWeatherScales({ element: 'Fire', weatherElement: 'None' });
    });

    it('scores a Water-looking jutsu by its Fire weather element, not as the opposed element', () => {
        assertWeatherScales({ element: 'Water', weatherElement: 'Fire' });
    });
});
