/*
 * The server derives the wanderer roster itself (shared/wanderer-roster.ts) —
 * it never trusts the id/archetype/verb/level the client reports. These pin:
 *   • the roll is a WORLD fact: same (sector, bucket) → same cast for every
 *     character, locked content or not;
 *   • a forged id (wrong bucket, sector, index, or a claimed archetype/verb
 *     that doesn't match the roll) resolves to nothing;
 *   • resolveNaturalWorldWanderer (the Solo-PvE + pet-duel authority) is the
 *     shared roll, relocation included.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    naturalWandererMatches,
    parseNaturalWandererId,
    resolveNaturalWanderer,
    rollWanderers,
    wandererDayBucketFromMs,
    wandererRelocationSector,
    WANDERER_SECTOR_COUNT,
} from './_wanderer-encounter.js';
import { resolveNaturalWorldWanderer } from '../missions/_world-ai-fight.js';

const BUCKET = 5000;
const NOW = BUCKET * 6 * 60 * 60 * 1000 + 4321; // inside bucket 5000

function populated(verb?: string) {
    for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector++) {
        for (const w of rollWanderers(sector, BUCKET)) {
            if (!verb || w.verb === verb) return w;
        }
    }
    throw new Error(`no ${verb ?? ''} wanderer rolled in bucket ${BUCKET}`);
}

describe('shared wanderer roll on the server', () => {
    it('same (sector, bucket) yields an identical roster regardless of character', () => {
        const sealed = { starterCardsClaimed: false, pets: [] };
        const open = { starterCardsClaimed: true, pets: [{ id: 'p' }] };
        let seen = 0;
        for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector++) {
            for (let index = 0; index <= 1; index++) {
                const id = `w-${sector}-${BUCKET}-${index}`;
                const a = resolveNaturalWorldWanderer(id, sealed, sector, NOW);
                const b = resolveNaturalWorldWanderer(id, open, sector, NOW);
                assert.deepEqual(a, b, id);
                if (a) seen++;
            }
        }
        assert.ok(seen > 10, 'the bucket actually rolled wanderers');
        assert.equal(wandererDayBucketFromMs(NOW), BUCKET);
    });

    it('resolveNaturalWorldWanderer IS the shared roll (archetype, verb, name, level)', () => {
        const w = populated();
        const parsed = parseNaturalWandererId(w.id)!;
        const resolved = resolveNaturalWorldWanderer(w.id, {}, parsed.sector, NOW);
        assert.deepEqual(resolved, { id: w.archetype, verb: w.verb, name: w.name, level: w.level });
    });

    it('rejects a forged id: stale or future bucket, bad sector, index past the roll', () => {
        const w = populated();
        const p = parseNaturalWandererId(w.id)!;
        const cases: Array<[string, string]> = [
            [`w-${p.sector}-${BUCKET - 1}-${p.index}`, 'stale bucket'],
            [`w-${p.sector}-${BUCKET + 1}-${p.index}`, 'future bucket'],
            [`w-0-${BUCKET}-0`, 'sector 0'],
            [`w-${WANDERER_SECTOR_COUNT + 1}-${BUCKET}-0`, 'sector past the world'],
            [`w-${p.sector}-${BUCKET}-2`, 'index past the cap'],
            ['legacy-emissary-hollow-warden', 'synthetic id'],
            ['merc-abc', 'merc id'],
        ];
        for (const [id, why] of cases) {
            assert.equal(resolveNaturalWanderer(id, NOW), null, why);
            assert.equal(resolveNaturalWorldWanderer(id, {}, p.sector, NOW), null, why);
        }
        // A slot the roll never filled.
        for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector++) {
            if (rollWanderers(sector, BUCKET).length === 1) {
                assert.equal(resolveNaturalWanderer(`w-${sector}-${BUCKET}-1`, NOW), null, 'empty roster slot');
                break;
            }
        }
    });

    it('rejects a claimed archetype / verb / level that does not match the roll', () => {
        const w = populated();
        assert.equal(naturalWandererMatches(w.id, NOW, { archetype: w.archetype, verb: w.verb, level: w.level, name: w.name }), true);
        assert.equal(naturalWandererMatches(w.id, NOW, { verb: w.verb === 'attack' ? 'gift' : 'attack' }), false, 'verb');
        assert.equal(naturalWandererMatches(w.id, NOW, { archetype: w.archetype === 'bandit' ? 'sage' : 'bandit' }), false, 'archetype');
        assert.equal(naturalWandererMatches(w.id, NOW, { level: w.level + 40 }), false, 'level');
        assert.equal(naturalWandererMatches(w.id, NOW + 6 * 60 * 60 * 1000, { verb: w.verb }), false, 'next window');
    });

    it('honours relocation: a moved wanderer is found in its destination, not its home', () => {
        const w = populated();
        const p = parseNaturalWandererId(w.id)!;
        const dest = wandererRelocationSector(w.id, p.sector);
        assert.notEqual(dest, p.sector);
        const character = { wandererMoves: { [w.id]: dest } };
        assert.equal(resolveNaturalWanderer(w.id, NOW, character, p.sector), null, 'no longer at home');
        assert.deepEqual(resolveNaturalWanderer(w.id, NOW, character, dest), w, 'present at its destination');
        assert.deepEqual(resolveNaturalWanderer(w.id, NOW, {}, p.sector), w, 'unmoved: at home');
        assert.equal(resolveNaturalWanderer(w.id, NOW, {}, dest), null, 'unmoved: not at the destination');
    });
});
