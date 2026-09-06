import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    addSign,
    applyOffering,
    applySpark,
    footfallKey,
    isoWeekKey,
    isTraceSector,
    parseShrineState,
    parseSigns,
    pruneSigns,
    MAX_SIGNS_PER_SECTOR,
    TRAIL_SIGN_TTL_MS,
    type TrailSign,
} from './_traces.js';
import { shrineForSector, shrineById, shrineTier, SHRINE_DEFS, SHRINE_TIERS } from '../../shared/shrines.js';
import { MAX_WILD_SECTOR } from '../../shared/sector-geo.js';

const NOW = 1_752_600_000_000; // 2025-07-15T18:40Z-ish, fixed for determinism

function sign(name: string, at: number, extra: Partial<TrailSign> = {}): TrailSign {
    return { id: `id-${name}-${at}`, name, tile: 40, text: 'was here', at, sparks: 0, sparkedBy: [], ...extra };
}

describe('sector traces — trail signs', () => {
    it('prunes signs past the 72h TTL', () => {
        const fresh = sign('aki', NOW - 1000);
        const stale = sign('ben', NOW - TRAIL_SIGN_TTL_MS - 1);
        assert.deepEqual(pruneSigns([fresh, stale], NOW), [fresh]);
    });

    it('one active sign per player per sector — posting again replaces yours', () => {
        const first = sign('aki', NOW - 5000);
        const second = sign('aki', NOW);
        const out = addSign([first], second, NOW);
        assert.equal(out.length, 1);
        assert.equal(out[0].at, NOW);
    });

    it('evicts the oldest sign past the per-sector cap', () => {
        let signs: TrailSign[] = [];
        for (let i = 0; i < MAX_SIGNS_PER_SECTOR; i += 1) {
            signs = addSign(signs, sign(`p${i}`, NOW - 1000 * (MAX_SIGNS_PER_SECTOR - i)), NOW);
        }
        assert.equal(signs.length, MAX_SIGNS_PER_SECTOR);
        const out = addSign(signs, sign('newest', NOW), NOW);
        assert.equal(out.length, MAX_SIGNS_PER_SECTOR);
        assert.ok(!out.some((s) => s.name === 'p0'), 'oldest sign should be evicted');
        assert.ok(out.some((s) => s.name === 'newest'));
    });

    it('spark: dedupes per player and rejects self-sparks', () => {
        const signs = [sign('aki', NOW - 1000)];
        const own = applySpark(signs, signs[0].id, 'aki', NOW);
        assert.deepEqual(own, { ok: false, reason: 'own-sign' });

        const first = applySpark(signs, signs[0].id, 'ben', NOW);
        assert.ok(first.ok && first.sparks === 1);
        const again = applySpark(signs, signs[0].id, 'ben', NOW);
        assert.deepEqual(again, { ok: false, reason: 'already-sparked' });

        const missing = applySpark(signs, 'nope', 'cho', NOW);
        assert.deepEqual(missing, { ok: false, reason: 'not-found' });
    });

    it('parseSigns round-trips valid records and drops junk', () => {
        const good = sign('aki', NOW);
        const parsed = parseSigns([good, null, 'junk', { id: 1 }, { ...sign('ben', NOW), tile: 999 }]);
        assert.equal(parsed.length, 2);
        assert.deepEqual(parsed[0], good);
        assert.equal(parsed[1].tile, 77, 'out-of-range tile clamps to the board default');
    });
});

describe('sector traces — footfall + sector guard', () => {
    it('footfall key is per sector per UTC day', () => {
        assert.equal(footfallKey(42, Date.UTC(2026, 6, 16, 12)), 'world:footfall:42:2026-07-16');
    });

    it('trace sectors are the wild sectors only', () => {
        assert.ok(isTraceSector(1) && isTraceSector(60) && isTraceSector(MAX_WILD_SECTOR));
        for (const bad of [0, MAX_WILD_SECTOR + 1, 99, -3, 4.5, NaN, 'x', null]) assert.ok(!isTraceSector(bad), `${String(bad)} should be rejected`);
    });
});

describe('sector shrines', () => {
    it('shrine config: unique ids, unique sectors, lookups agree', () => {
        assert.equal(new Set(SHRINE_DEFS.map((d) => d.id)).size, SHRINE_DEFS.length);
        assert.equal(new Set(SHRINE_DEFS.map((d) => d.sector)).size, SHRINE_DEFS.length);
        for (const def of SHRINE_DEFS) {
            assert.equal(shrineForSector(def.sector), def);
            assert.equal(shrineById(def.id), def);
        }
        assert.equal(shrineForSector(1), undefined);
    });

    it('the hundred-glyph shrine states the Ancient and Legacy canon', () => {
        const ancient = shrineById('ancients');
        assert.ok(ancient);
        assert.match(ancient.lore, /weathered dedication dates the shrine/i);
        assert.match(ancient.lore, /Sunken Court.+hundred worn glyphs/i);
        assert.match(ancient.lore, /later brass plaque interprets them as action-pattern Legac(?:y|ies)/i);
        assert.match(ancient.lore, /Ancients who refused cession.+Withheld/i);
        assert.match(ancient.blessing, /freely chosen.+witnessed/i);
        assert.doesNotMatch(`${ancient.lore} ${ancient.blessing}`, /find their path in you|bloodline|soul|reincarn/i);
    });

    it('tier thresholds are monotonic and map totals to the right tier', () => {
        for (let i = 1; i < SHRINE_TIERS.length; i += 1) assert.ok(SHRINE_TIERS[i].at > SHRINE_TIERS[i - 1].at);
        assert.equal(shrineTier(0), 0);
        assert.equal(shrineTier(SHRINE_TIERS[1].at), 1);
        assert.equal(shrineTier(SHRINE_TIERS[1].at - 1), 0);
        assert.equal(shrineTier(Number.MAX_SAFE_INTEGER), SHRINE_TIERS.length - 1);
    });

    it('offerings accumulate per player and sort the weekly board', () => {
        let state = parseShrineState(null);
        state = applyOffering(state, 'aki', 100, NOW);
        state = applyOffering(state, 'ben', 300, NOW);
        state = applyOffering(state, 'aki', 300, NOW);
        assert.equal(state.total, 700);
        assert.equal(state.weekTotal, 700);
        assert.deepEqual(state.topWeek[0], { name: 'aki', amount: 400 });
        assert.deepEqual(state.topWeek[1], { name: 'ben', amount: 300 });
    });

    it('weekly board rolls over on ISO-week change, lifetime total persists', () => {
        let state = parseShrineState(null);
        state = applyOffering(state, 'aki', 500, NOW);
        const nextWeek = NOW + 8 * 24 * 60 * 60 * 1000;
        assert.notEqual(isoWeekKey(NOW), isoWeekKey(nextWeek));
        state = applyOffering(state, 'ben', 200, nextWeek);
        assert.equal(state.total, 700);
        assert.equal(state.weekTotal, 200);
        assert.deepEqual(state.topWeek, [{ name: 'ben', amount: 200 }]);
        assert.equal(state.lastWeek?.week, isoWeekKey(NOW));
        assert.deepEqual(state.lastWeek?.topWeek[0], { name: 'aki', amount: 500 });
    });

    it('parseShrineState survives junk without throwing', () => {
        for (const junk of [null, 'x', 42, [], { total: 'NaN', topWeek: 'nope', lastWeek: { week: 5 } }]) {
            const state = parseShrineState(junk);
            assert.equal(typeof state.total, 'number');
            assert.deepEqual(state.topWeek, []);
            assert.equal(state.lastWeek, null);
        }
    });

    it('isoWeekKey handles year boundaries (ISO week of the Thursday)', () => {
        assert.equal(isoWeekKey(Date.UTC(2026, 0, 1)), '2026-W01');   // Thu 2026-01-01
        assert.equal(isoWeekKey(Date.UTC(2027, 0, 1)), '2026-W53');   // Fri 2027-01-01 → ISO week 53 of 2026
    });
});
