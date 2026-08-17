/*
 * The ranked pet duel is resolved ONCE.
 *
 * The bug this file exists to keep closed: ranked used to be fought twice. The
 * server rated the match with `runPetDuel` over the token's server seed; the
 * screen showed the player `runPetDuelCinematic` over `petBattleSeed`, a
 * clock-derived number the challenger generated and shipped inside the
 * challenge. Different engine, different seed, same rating — a watched victory
 * could be recorded as a loss and nothing distinguished it from an honest one.
 *
 * So the invariants worth gates are:
 *   - the resolution is PURE over the token (the settle path re-derives it and
 *     refuses to pay when it disagrees with the recorded intent, so drift here
 *     would start rejecting honest matches);
 *   - it is SYMMETRIC — both participants must be told the same winner
 *     regardless of which of them asks;
 *   - the winner is an account NAME, never a side, for the same reason;
 *   - neither handler re-derives it with a different engine, which is the exact
 *     shape of the original defect.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRankedPetDuel } from './_ranked-duel.js';
import { PET_RANKED_AUTHORITY, type RankedPetMatchToken } from './_ranked-authority.js';

const pet = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: `Pet ${id}`,
    element: 'Fire',
    role: 'assassin',
    rarity: 'rare',
    level: 40,
    hp: 900,
    attack: 120,
    defense: 70,
    speed: 80,
    jutsus: [
        { name: 'Ember Jab', power: 90, kind: 'damage' },
        { name: 'Cinder Wall', power: 70, kind: 'barrier' },
    ],
    ...over,
});

const token = (over: Partial<RankedPetMatchToken> = {}): RankedPetMatchToken => ({
    authority: PET_RANKED_AUTHORITY,
    pairId: '11111111-1111-4111-8111-111111111111',
    a: 'Akari',
    b: 'Boro',
    aRating: 1000,
    bRating: 1000,
    aPet: pet('a-pet'),
    bPet: pet('b-pet', { element: 'Water', attack: 240, hp: 1500, speed: 120 }),
    seed: 12345,
    createdAt: 1,
    ...over,
});

describe('ranked pet duel resolution', () => {
    it('is pure over the token — same input, byte-identical script', () => {
        const first = resolveRankedPetDuel(token());
        const second = resolveRankedPetDuel(token());
        assert.equal(first.winnerName, second.winnerName);
        assert.deepEqual(first.script, second.script, 'a re-derivation must reproduce the fight exactly');
    });

    it('is symmetric — swapping which participant is "a" changes nothing', () => {
        // Both players call /api/pet/ranked-watch with the same token, and
        // battle-result re-derives it for whichever of them reports first. If
        // the answer depended on argument order, the two would be told
        // different things about the same fight.
        const forward = resolveRankedPetDuel(token());
        const swapped = resolveRankedPetDuel(token({
            a: 'Boro', b: 'Akari',
            aPet: pet('b-pet', { element: 'Water', attack: 240, hp: 1500, speed: 120 }),
            bPet: pet('a-pet'),
            aRating: 1000, bRating: 1000,
        }));
        assert.equal(forward.winnerName, swapped.winnerName);
        assert.deepEqual(forward.script, swapped.script);
    });

    it('names one of the two participants, and never draws', () => {
        for (const seed of [1, 7, 512, 99991, 0x7ffffff]) {
            const { winnerName } = resolveRankedPetDuel(token({ seed }));
            assert.ok(winnerName === 'Akari' || winnerName === 'Boro', `unexpected winner ${winnerName}`);
        }
    });

    it('lets the seed decide — the fight is not a constant', () => {
        // Two evenly matched pets across many seeds must not always produce the
        // same winner; that would mean the seed was not reaching the engine.
        const even = (seed: number) => resolveRankedPetDuel(token({
            seed, aPet: pet('a-pet'), bPet: pet('b-pet'),
        })).winnerName;
        const winners = new Set([1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233].map(even));
        assert.equal(winners.size, 2, 'the seed must be able to change the outcome');
    });

    it('plays 1v1 — the token seals one pet per side', () => {
        const { script } = resolveRankedPetDuel(token());
        assert.equal(script.initialState.player.length, 1);
        assert.equal(script.initialState.enemy.length, 1);
        assert.ok(script.events.length > 0, 'a watchable fight needs an event log');
    });
});

/** Drop `//` and block comments so a source gate matches CODE, not prose. */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('nothing re-fights a ranked match with a second engine', () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

    it('battle-result rates through resolveRankedPetDuel and imports no legacy sim', () => {
        const src = read(join('api', 'pet', 'battle-result.ts'));
        assert.ok(src.includes("from './_ranked-duel.js'"), 'the rating must come from the shared resolver');
        assert.equal(/from '\.\.\/_pet-sim\/pet-duel-sim\.js'/.test(src), false,
            'battle-result must not import the legacy duel sim — that WAS the divergence');
        assert.equal(/runPetDuel\(/.test(src), false, 'and must not call it');
    });

    it('the watch endpoint survives its opponent settling first', () => {
        // The live proof is retired the moment ONE participant settles. A
        // watcher reading only that key would lose the fight exactly when their
        // opponent reported first — which is the common case for the loser, who
        // is usually the one still watching. The settlement intent holds the
        // same token until BOTH have settled.
        const src = read(join('api', 'pet', 'ranked-watch.ts'));
        assert.ok(src.includes('petRankedSettlementIntentKey'),
            'it must fall back to the settlement intent');
        assert.ok(src.includes('isRankedPetSettlementIntent'),
            'and validate it rather than trusting the shape');
    });

    it('the arena screen watches the rated fight instead of simulating one', () => {
        const src = read(join('shinobij.client', 'src', 'screens', 'PetArena.tsx'));
        const rankedAt = src.indexOf('if (opponent.ranked) {');
        assert.ok(rankedAt > 0, 'the ranked branch must still exist');
        // Comments are stripped before matching: this branch NAMES the retired
        // engines in prose to explain why they are gone, and a test that cannot
        // tell an explanation from a call would forbid documenting the fix.
        const branch = stripComments(src.slice(rankedAt, src.indexOf('const battleSeal1v1', rankedAt)));
        assert.ok(branch.includes('fetchRankedPetDuel'), 'it must fetch the server-resolved fight');
        assert.equal(/runPetDuelCinematic|runPetDuel\(|createLiveDuel/.test(branch), false,
            'a ranked fight must never be simulated on the client');
    });
});
