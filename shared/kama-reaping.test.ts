import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    KAMA_BASE_Y, KAMA_CLOCK_SLACK_MS, KAMA_LIMIT_MS, KAMA_READY_MS, KAMA_STALKS, kamaClassify, kamaDemoStrokes, kamaField, kamaGuideStroke, kamaGuideY,
    kamaGustStrength, kamaSeed, kamaStalkPose, readKamaStrokes, scoreKamaReaping, type KamaStroke,
} from './kama-reaping.js';
import { kunaiSeed } from './kunai-fishing.js';

const SEED = kamaSeed({ hookAt: 2400, template: 3 });
const field = kamaField(SEED);
const END = KAMA_READY_MS + KAMA_LIMIT_MS;

/** The field-percent point `fraction` of the way up stalk `index` at `at`. */
function pointOn(index: number, at: number, fraction: number) {
    const { base, tip } = kamaStalkPose(field, index, at);
    return { x: base.x + (tip.x - base.x) * fraction, y: base.y + (tip.y - base.y) * fraction };
}
/** A short level stroke through one stalk, `offset` (fraction of height) from its band. */
function strokeAt(index: number, at: number, offset = 0): KamaStroke {
    const point = pointOn(index, at, field.stalks[index].band + offset);
    return { kind: 'stroke', at, x1: point.x - 3, y1: point.y, x2: point.x + 3, y2: point.y };
}
/** A stroke along the line through the bands of two neighbouring stalks. */
function sweep(first: number, second: number, at: number): KamaStroke {
    const a = pointOn(first, at, field.stalks[first].band), b = pointOn(second, at, field.stalks[second].band);
    const dx = b.x - a.x, dy = b.y - a.y;
    return { kind: 'stroke', at, x1: a.x - dx * .05, y1: a.y - dy * .05, x2: b.x + dx * .05, y2: b.y + dy * .05 };
}

describe('kama field', () => {
    it('is deterministic for a seed and shares the kunai seed formula', () => {
        assert.deepEqual(kamaField(SEED), field);
        assert.equal(kamaSeed({ hookAt: 2400, template: 3 }), kunaiSeed({ hookAt: 2400, template: 3 }));
        assert.notDeepEqual(kamaField(SEED + 1), field);
    });

    it('stands five stalks in order across the field with bands in range', () => {
        assert.equal(field.stalks.length, KAMA_STALKS);
        for (const [index, stalk] of field.stalks.entries()) {
            assert.ok(stalk.x >= 11 && stalk.x <= 89, `stalk ${index} x ${stalk.x}`);
            assert.ok(stalk.height >= 50 && stalk.height <= 62);
            assert.ok(stalk.band >= .34 && stalk.band <= .52);
            if (index) assert.ok(stalk.x - field.stalks[index - 1].x >= 12, 'stalks never crowd together');
        }
    });

    it('keeps gusts inside the window, apart, and calm between them', () => {
        for (let seed = 1; seed < 200; seed++) {
            const { gusts } = kamaField(seed * 7919);
            assert.ok(gusts.length === 2 || gusts.length === 3);
            for (const [index, gust] of gusts.entries()) {
                assert.ok(gust.start >= KAMA_READY_MS + 1500 && gust.start + gust.duration <= END);
                if (index) assert.ok(gust.start >= gusts[index - 1].start + gusts[index - 1].duration + 600);
            }
        }
        const gust = field.gusts[0];
        assert.equal(kamaGustStrength(field, gust.start - 1), 0);
        assert.ok(kamaGustStrength(field, gust.start + gust.duration / 2) > .99);
    });
});

describe('kama cuts', () => {
    it('classifies by distance from the band', () => {
        assert.equal(kamaClassify(.40, .40), 'clean');
        assert.equal(kamaClassify(.44, .40), 'clean');
        assert.equal(kamaClassify(.46, .40), 'rough');
        assert.equal(kamaClassify(.34, .40), 'rough');
        assert.equal(kamaClassify(.30, .40), 'tear');
        assert.equal(kamaClassify(.50, .40), 'wasted');
    });

    it('scores a stroke at, near, below and above the band', () => {
        const strokes = [strokeAt(0, 1000), strokeAt(1, 1400, .06), strokeAt(2, 1800, -.15)];
        const result = scoreKamaReaping(SEED, strokes, END)!;
        assert.deepEqual(result.stalks.map(stalk => stalk.cut), ['clean', 'rough', 'tear', undefined, undefined]);
        assert.deepEqual(result.tally, { clean: 1, rough: 1, wasted: 0, tear: 1 });
        assert.equal(result.performance, 1);
        assert.equal(result.failed, false);
        const wasted = scoreKamaReaping(SEED, [strokeAt(3, 1000, .15)], END)!;
        assert.deepEqual(wasted.tally, { clean: 0, rough: 0, wasted: 1, tear: 0 });
        assert.equal(wasted.failed, false, 'a wasted cut still harvests');
    });

    it('cuts every stalk a long stroke crosses, once each', () => {
        const at = 1000, low = pointOn(0, at, .2).y;
        const across: KamaStroke = { kind: 'stroke', at, x1: 1, y1: low, x2: 99, y2: low };
        const result = scoreKamaReaping(SEED, [across, strokeAt(0, 1400)], END)!;
        assert.equal(result.stalks.filter(stalk => stalk.cut).length, KAMA_STALKS);
        assert.equal(result.stalks[0].at, at, 'the second stroke cannot re-cut stalk 0');
        assert.equal(result.finished, true, 'the run ends once every stalk is down');
    });

    it('pays the full 10 for three strokes that cut all five stalks clean', () => {
        const result = scoreKamaReaping(SEED, [sweep(0, 1, 1000), sweep(2, 3, 1400), strokeAt(4, 1800)], END)!;
        assert.deepEqual(result.tally, { clean: 5, rough: 0, wasted: 0, tear: 0 });
        assert.equal(result.performance, 10);
        assert.equal(result.failed, false);
    });

    it('fails on a miss-only run or two torn roots', () => {
        const missed = scoreKamaReaping(SEED, [], END)!;
        assert.equal(missed.failed, true);
        assert.equal(missed.performance, 0);
        const torn = scoreKamaReaping(SEED, [strokeAt(0, 1000, -.2), strokeAt(1, 1400, -.2), strokeAt(2, 1800)], END)!;
        assert.equal(torn.tally.tear, 2);
        assert.equal(torn.failed, true);
    });
});

describe('kama input helpers', () => {
    it('glides the guide line over every band height and cuts just the chosen stalk', () => {
        const heights = Array.from({ length: 240 }, (_, i) => kamaGuideY(i * 10));
        for (const stalk of field.stalks) {
            const band = KAMA_BASE_Y - stalk.height * stalk.band;
            assert.ok(Math.min(...heights) <= band && Math.max(...heights) >= band, `band at ${band} is reachable`);
        }
        for (let index = 0; index < KAMA_STALKS; index++) {
            for (const at of [1000, 3200, 6100, 9000]) {
                const stroke = kamaGuideStroke(field, index, at);
                assert.ok(readKamaStrokes([stroke], END), 'a guide stroke is always valid input');
                const result = scoreKamaReaping(SEED, [stroke], END)!;
                assert.deepEqual(result.stalks.map((stalk, i) => Boolean(stalk.cut) === (i === index)), Array(KAMA_STALKS).fill(true), `stalk ${index} at ${at}`);
            }
        }
    });

    it('lets the Reap button take two stalks per stroke, so a perfect guide run cuts all five', () => {
        // Before this, a guide stroke cut only the chosen stalk: three strokes, five
        // stalks, so keyboard and tap players could never reap more than 3 of 5.
        for (const seed of [SEED, 4242, 987654, 31337, 123]) {
            const reapField = kamaField(seed);
            let strokes: KamaStroke[] = [], at = KAMA_READY_MS + 50, target = 2;
            for (let n = 0; n < 3; n++) {
                const stalks = scoreKamaReaping(seed, strokes, END, true)!.stalks;
                // Like the client: start on the middle stalk, then fall to the first one standing.
                if (n > 0) target = stalks.findIndex(stalk => !stalk.cut);
                // Press when the guide is closest to the chosen stalk's band (a well-timed player).
                const band = KAMA_BASE_Y - reapField.stalks[target].height * reapField.stalks[target].band;
                let best = at + 150;
                for (let t = at + 150; t < at + 150 + 2400; t++) if (Math.abs(kamaGuideY(t) - band) < Math.abs(kamaGuideY(best) - band)) best = t;
                const stroke = kamaGuideStroke(reapField, target, best, stalks);
                assert.ok(readKamaStrokes([...strokes, stroke], END), `seed ${seed}: guide stroke ${n + 1} is valid input`);
                strokes = [...strokes, stroke]; at = best;
            }
            const result = scoreKamaReaping(seed, strokes, END)!;
            assert.equal(result.stalks.filter(stalk => stalk.cut).length, KAMA_STALKS, `seed ${seed}: all five reaped`);
            assert.equal(result.tally.clean, KAMA_STALKS, `seed ${seed}: ${JSON.stringify(result.tally)}`);
            assert.equal(result.performance, 10);
        }
    });

    it('never lets a paired guide stroke clip a third standing stalk', () => {
        for (const seed of [SEED, 4242, 987654]) {
            const reapField = kamaField(seed), fresh = reapField.stalks.map(() => ({}));
            for (let index = 0; index < KAMA_STALKS; index++) for (let at = 700; at < END; at += 97) {
                const cut = scoreKamaReaping(seed, [kamaGuideStroke(reapField, index, at, fresh)], END)!.stalks.filter(stalk => stalk.cut).length;
                assert.ok(cut >= 1 && cut <= 2, `seed ${seed} stalk ${index} at ${at}: cut ${cut}`);
            }
        }
    });

    it('animates relaxed mode as three clean sweeps', () => {
        for (const seed of [SEED, 4242, 987654]) {
            const demo = kamaDemoStrokes(kamaField(seed));
            const result = scoreKamaReaping(seed, demo, END)!;
            assert.deepEqual(result.tally, { clean: 5, rough: 0, wasted: 0, tear: 0 }, `seed ${seed}`);
        }
    });
});

describe('kama run lifecycle', () => {
    it('stays open until three strokes, every stalk down, or the time limit', () => {
        assert.equal(scoreKamaReaping(SEED, [strokeAt(0, 1000)], 2000), null);
        assert.equal(scoreKamaReaping(SEED, [strokeAt(0, 1000)], 2000, true)?.finished, false);
        assert.equal(scoreKamaReaping(SEED, [strokeAt(0, 1000)], END)?.finished, true);
        assert.equal(scoreKamaReaping(SEED, [strokeAt(0, 1000), strokeAt(1, 1400), strokeAt(2, 1800)], 2000)?.finished, true);
    });

    it('rejects malformed or impossible strokes', () => {
        const good = strokeAt(0, 1000);
        const bad: unknown[] = [
            'strokes', {}, [good, good, good, good],
            [{ ...good, kind: 'slash' }], [{ ...good, at: Number.NaN }], [{ ...good, x2: 101 }], [{ ...good, y1: -1 }],
            [{ ...good, at: KAMA_READY_MS - 1 }], [{ ...good, at: END + 1 }],
            [good, { ...strokeAt(1, 1000), at: 1100 }],
            [{ ...good, x2: good.x1 + .5, y2: good.y1 }],
            [null], [[good]],
        ];
        for (const events of bad) assert.equal(readKamaStrokes(events, END), null, JSON.stringify(events));
        // The last stroke resolves the run at once, so a client clock a few ms ahead
        // of the server must not refuse a finished row (the kunai scorer's slack).
        assert.deepEqual(readKamaStrokes([good], good.at - KAMA_CLOCK_SLACK_MS), [good], 'clock skew within the slack is accepted');
        assert.equal(readKamaStrokes([good], good.at - KAMA_CLOCK_SLACK_MS - 1), null, 'a stroke cannot come from further in the future');
        assert.deepEqual(readKamaStrokes([{ ...good, extra: 1 }], END), [good], 'extra fields are dropped');
    });
});
