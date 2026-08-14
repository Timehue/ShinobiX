/*
 * War pet duels — the shared resolver behind clan war, sector war, ranked and
 * the pet ladder's coliseum challenge.
 *
 * These modes decide territory and rating with no player present, so the two
 * properties that matter are: the fight is re-derivable forever from its
 * inputs, and it is the SAME fight the mode recorded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWarDuel } from './war-duel.js';
import { buildWarTeam, WAR_TEAM_SIZE } from './war-team.js';
import { SHOWDOWN_BENCH_SIZE, SHOWDOWN_FORMAT_SIZE } from '../../shared/pet-showdown-contract.js';
import type { Pet } from '../_pet-sim/pet-types.js';

function mkPet(id: string, over: Record<string, unknown> = {}): Pet {
    return {
        id, name: id, rarity: 'standard', level: 30, hp: 800, attack: 120, defense: 90, speed: 60,
        element: 'Fire', role: 'tracker', unlockedForPve: true,
        jutsus: [
            { name: 'Jab', power: 90, cooldown: 1, currentCooldown: 0, kind: 'damage' },
            { name: 'Bolt', power: 140, cooldown: 2, currentCooldown: 0, kind: 'damage' },
        ],
        ...over,
    } as unknown as Pet;
}

const team = (prefix: string, n = WAR_TEAM_SIZE) => Array.from({ length: n }, (_, i) => mkPet(`${prefix}${i}`));

test('a war duel is 2v2 with a two-pet bench, whatever arrives', () => {
    // The format is FIXED, not inferred from how many pets the submission flow
    // happened to send. Sizing off the array made these modes 1v1-with-no-bench
    // by accident, which switched off rotation and trapping entirely.
    const r = resolveWarDuel({
        sessionId: 'fmt', seed: 4242,
        fromName: 'A', toName: 'B',
        fromPets: team('a'), toPets: team('b'),
    });
    const fielded = r.script.initialState.player.filter((p) => !p.benched).length;
    const benched = r.script.initialState.player.filter((p) => p.benched).length;
    assert.equal(fielded, SHOWDOWN_FORMAT_SIZE['2v2'], 'two on the field');
    assert.equal(benched, SHOWDOWN_BENCH_SIZE, 'two in reserve');
});

test('a single pet still fights — it just fights without reserves', () => {
    // A player with one eligible pet must not be refused the match.
    const r = resolveWarDuel({
        sessionId: 'solo', seed: 77,
        fromName: 'A', toName: 'B',
        fromPets: [mkPet('lonely')], toPets: team('b'),
    });
    assert.equal(r.script.initialState.player.length, 1);
    assert.ok(r.outcome === 'from' || r.outcome === 'to');
});

test('same inputs re-derive the same verdict AND the same log, forever', () => {
    const input = {
        sessionId: 'det', seed: 31337,
        fromName: 'A', toName: 'B',
        fromPets: team('a'), toPets: team('b'),
    };
    const a = resolveWarDuel(input);
    const b = resolveWarDuel(input);
    assert.equal(a.outcome, b.outcome);
    assert.equal(a.rounds, b.rounds);
    assert.deepEqual(a.script.events, b.script.events);
});

test('the script agrees with the verdict the mode records', () => {
    // The war record stores only the winner; the watch endpoint re-derives the
    // log. If these disagreed, players would watch a fight that contradicts the
    // territory or rating it moved.
    const r = resolveWarDuel({
        sessionId: 'agree', seed: 909,
        fromName: 'A', toName: 'B',
        fromPets: team('a'), toPets: team('b'),
    });
    const end = [...r.script.events].reverse().find((e) => e.t === 'end') as { outcome: 'win' | 'loss' } | undefined;
    assert.ok(end, 'the log ends on a verdict');
    assert.equal(end.outcome === 'win' ? 'from' : 'to', r.outcome);
});

test('a consumable is inert, but equipped GEAR still fights', () => {
    // Async duels have no settlement transaction, so a consumable charge could
    // never be honestly collected — the seal strips exactly that slot. Gear is
    // part of the pet its owner built and applies as it does in the live arena.
    const plain = team('a');
    const armed = plain.map((p, i) => (i === 0
        ? ({ ...p, loadout: { consumable: 'consum-second-wind' } } as Pet)
        : p));
    for (const seed of [5, 61, 404, 9001]) {
        const bare = resolveWarDuel({ sessionId: 'c', seed, fromName: 'A', toName: 'B', fromPets: plain, toPets: team('b') });
        const withItem = resolveWarDuel({ sessionId: 'c', seed, fromName: 'A', toName: 'B', fromPets: armed, toPets: team('b') });
        assert.equal(withItem.outcome, bare.outcome, `seed ${seed}`);
    }
});

test('sector terrain becomes the arena weather, and only for a known biome', () => {
    // The home-ground bonus in Showdown's native terms: the sector's climate
    // stands over the field, visible and contestable.
    const base = { sessionId: 't', seed: 1234, fromName: 'A', toName: 'B', fromPets: team('a'), toPets: team('b') };
    assert.equal(resolveWarDuel({ ...base, terrain: 'volcano' }).script.initialState.weather?.element, 'Fire');
    assert.equal(resolveWarDuel({ ...base, terrain: 'snow' }).script.initialState.weather?.element, 'Water');
    assert.equal(resolveWarDuel({ ...base, terrain: 'forest' }).script.initialState.weather?.element, 'Earth');
    assert.equal(resolveWarDuel({ ...base, terrain: 'shadow' }).script.initialState.weather?.element, 'Lightning');
    // Unknown or absent terrain is neutral — no invented sky.
    assert.equal(resolveWarDuel({ ...base, terrain: 'meadow' }).script.initialState.weather, undefined);
    assert.equal(resolveWarDuel({ ...base, terrain: null }).script.initialState.weather, undefined);
});

test('buildWarTeam leads with the chosen pet and fills from the roster', () => {
    const character = { pets: [mkPet('p0'), mkPet('p1'), mkPet('p2'), mkPet('p3'), mkPet('p4')], activePetId: 'p4' };
    const picked = buildWarTeam(character as unknown as Record<string, unknown>, ['p2']);
    assert.ok(picked);
    assert.equal(picked!.length, WAR_TEAM_SIZE, 'a full team');
    assert.equal(String(picked![0].id), 'p2', 'the champion the player sent leads');
    assert.equal(new Set(picked!.map((p) => String(p.id))).size, picked!.length, 'no pet fielded twice');
});

test('buildWarTeam returns null only when there is no pet at all', () => {
    assert.equal(buildWarTeam({ pets: [] } as unknown as Record<string, unknown>), null);
    const one = buildWarTeam({ pets: [mkPet('solo')] } as unknown as Record<string, unknown>);
    assert.equal(one?.length, 1, 'a one-pet roster fields one pet rather than being refused');
});
