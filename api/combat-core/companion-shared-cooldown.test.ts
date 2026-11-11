import test from 'node:test';
import assert from 'node:assert/strict';
import { companionCooldownKey, pickCompanionMove, sealCompanionFromSave, type CompanionMove, type CompanionSeal } from './companion.js';
import { tacticsPreset } from '../../shared/pet-tactics-roster.js';
import { createSoloPveSession } from '../solo-pve/_session.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import type { PvpFighter } from '../pvp/session.js';
import { companionActor } from '../towers/_companion.js';
import { createTowerSession, getActor, type TowerActor } from '../towers/_tower-session.js';
import { runAiUntilHuman, startRound } from '../towers/_engine.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';

// Starter kits reuse one move in two or three slots. Those slots now show
// different names, but a companion must still treat them as one cooldown,
// exactly as it did when they shared a name.

const NOW = 1_800_000_000_000;
const ELEMENTS = ['fire', 'water', 'wind', 'lightning', 'earth'] as const;
/** No saved build, or one of the species' two saved presets. Preset 1 of the
 * water starter has no strike, so its native basic sits beside the renamed
 * Final Art that shares its cooldown. */
const BUILDS = [null, 0, 1] as const;
function starter(element: string, level: number, ranked: number | null) {
    const templateId = 'starter-' + element;
    return { id: 'owned-' + element, templateId, name: 'Pet', level, hp: 700, attack: 80, defense: 60, speed: 50, happiness: 100,
        growthBaseStats: { hp: 500, attack: 60, defense: 50, speed: 40 }, growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0 },
        ...(ranked !== null ? { rankedBuild: { ...tacticsPreset(templateId, ranked), ownedPetId: 'owned-' + element } } : {}) };
}
const sealed = (element: string, level: number, ranked: number | null = null): CompanionSeal => {
    const pet = starter(element, level, ranked);
    const seal = sealCompanionFromSave({ pets: [pet], activePetId: pet.id }, NOW);
    assert.ok(seal, element);
    return seal;
};
/** The kit as it was sealed before the rename: every slot under its shared name. */
const unrenamed = (moves: CompanionMove[]): CompanionMove[] =>
    moves.map(({ cooldownKey, ...move }) => ({ ...move, name: cooldownKey ?? move.name }));

test('renamed starter slots carry the shared cooldown key into the companion seal', () => {
    const lightning = sealed('lightning', 50).moves;
    const names = lightning.map(move => move.name);
    assert.equal(new Set(names).size, names.length, names.join(', '));
    const arc = lightning.find(move => move.name === 'Arc Crunch');
    assert.ok(arc, names.join(', '));
    assert.equal(companionCooldownKey(arc), 'Jolt Bite');
    assert.equal(companionCooldownKey(lightning.find(move => move.name === 'Jolt Bite')!), 'Jolt Bite');
    const waterSupport = sealed('water', 50, 1).moves.map(move => [move.name, companionCooldownKey(move)]);
    assert.deepEqual(waterSupport.filter(([, key]) => key === 'Tidal Crash'), [['Tidal Crash', 'Tidal Crash'], ['Tsunami Crash', 'Tidal Crash']],
        JSON.stringify(waterSupport));
    for (const element of ELEMENTS) for (const level of [50, 75]) for (const ranked of BUILDS) {
        // A saved ranked build can replace the native basic, leaving a key with
        // no partner; it then behaves as the slot's own cooldown, as before.
        const moves = sealed(element, level, ranked).moves;
        const names = moves.map(move => move.name);
        assert.equal(new Set(names).size, names.length, `${element} L${level} ranked=${ranked}: ${names.join(', ')}`);
        for (const move of moves) assert.notEqual(move.cooldownKey, move.name, `${element} L${level}: ${move.name}`);
    }
});

test('companion move choice is unchanged by the rename under every cooldown state', () => {
    let compared = 0;
    for (const element of ELEMENTS) for (const level of [50, 75]) for (const ranked of BUILDS) {
        const moves = sealed(element, level, ranked).moves, before = unrenamed(moves);
        const keys = [...new Set(moves.map(companionCooldownKey))];
        for (let mask = 0; mask < 1 << keys.length; mask++) {
            const cooldowns = Object.fromEntries(keys.filter((_, i) => mask & 1 << i).map(key => [key, 2]));
            for (const hp of [.3, .9]) for (const preparation of [undefined, { ordinaryActions: 0, requiredActions: 2 }]) {
                const now = pickCompanionMove(moves, cooldowns, hp, false, preparation);
                const then = pickCompanionMove(before, cooldowns, hp, false, preparation);
                assert.equal(now ? moves.indexOf(now) : -1, then ? before.indexOf(then) : -1, `${element} L${level} ${JSON.stringify(cooldowns)} hp ${hp}`);
                compared++;
            }
        }
    }
    assert.ok(compared > 500, String(compared));
});

const fighter = (name: string, pos: number): PvpFighter => ({ name, pos, hp: 10000, maxHp: 10000,
    chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, shield: 0, statuses: [],
    character: { level: 50, specialty: 'Taijutsu', stats: {}, jutsu: [], equipment: {}, pvpItems: [] } });
/** Only the basic and the renamed advanced strike, so the companion's first
 * pick is the stronger renamed one and its cooldown decides the second. */
const strikesOnly = (): CompanionSeal => {
    const seal = sealed('lightning', 50);
    return { ...seal, moves: seal.moves.filter(move => move.name === 'Jolt Bite' || move.name === 'Arc Crunch') };
};

test('solo PvE stores a renamed strike under the cooldown it shares', () => {
    const companion = strikesOnly();
    assert.equal(companion.moves.length, 2);
    const summoned = applySoloPveAction(createSoloPveSession({ sessionId: 'shared-cooldown', ownerSlug: 'owner',
        encounter: { kind: 'test', id: 'shared-cooldown' }, player: fighter('Owner', 0), enemy: fighter('Enemy', 2),
        companion, now: NOW }), { type: 'summon' }).session;
    const session = applySoloPveAction(summoned, { type: 'wait' }).session;
    const used = session.events.filter(event => event.actor === 'companion' && event.target === 'enemy');
    assert.ok(used.length > 0);
    const cooldowns = session.companion?.cooldowns ?? {};
    assert.ok(Object.hasOwn(cooldowns, 'Jolt Bite'), JSON.stringify(cooldowns));
    assert.ok(!Object.hasOwn(cooldowns, 'Arc Crunch'), JSON.stringify(cooldowns));
    assert.ok(!session.log.some(line => line.includes('uses Jolt Bite')), 'the shared cooldown blocks the basic after Arc Crunch');
});

test('tower combat stores a renamed strike under the cooldown it shares', () => {
    const floor: TowerFloor = { id: 1, name: 'Shared', biome: 'forest', objective: 'defeat-all', roundBudget: 10,
        map: { width: 12, height: 10 }, fieldRule: { kind: 'none' }, enemies: [], firstClearReward: {} };
    const actor = (id: string, side: TowerActor['side'], pos: number): TowerActor => ({ ...fighter(id, pos),
        id, side, ai: side === 'enemy', ownerSlug: side === 'squad' ? 'owner' : null, cooldowns: {} });
    const session = createTowerSession({ towerId: 'narrative-group', runId: 'shared-cooldown', floor: 1, seed: 1,
        partySize: 1, now: NOW, objectiveKind: 'defeat-all', actors: [actor('owner', 'squad', 0),
            companionActor(strikesOnly(), 1), actor('enemy', 'enemy', 2)],
        map: { width: 12, height: 10, blockedTiles: [], hazardTiles: [], objectiveTiles: [] } });
    startRound(session);
    session.turnQueue = ['companion-0', 'owner', 'enemy']; session.activeIndex = 0; session.activeAp = 100;
    runAiUntilHuman(session, floor, () => .9);
    assert.ok(getActor(session, 'enemy')!.hp < 10000);
    const cooldowns = getActor(session, 'companion-0')!.cooldowns ?? {};
    assert.ok(Object.hasOwn(cooldowns, 'Jolt Bite'), JSON.stringify(cooldowns));
    assert.ok(!Object.hasOwn(cooldowns, 'Arc Crunch'), JSON.stringify(cooldowns));
    assert.ok(!session.log.some(line => line.includes('uses Jolt Bite')), 'the shared cooldown blocks the basic after Arc Crunch');
});
