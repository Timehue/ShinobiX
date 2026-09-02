import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { castHeaderLine, resolveCastFlavor } from './cast-flavor.js';

describe('cast flavor — %user / %target resolution', () => {
    it('resolves %target to the OPPONENT for an outward cast', () => {
        const jutsu = { battleDescription: 'Fireball strikes %target.', target: 'OPPONENT' };
        assert.equal(resolveCastFlavor(jutsu, 'Raiko', 'Mira'), 'Fireball strikes Mira.');
    });

    /*
     * The bug this module exists for: the live authored "Overload" is a SELF
     * cast whose flavor was the editor's default "Overload hits %target", so the
     * log read "Raiko uses Overload: Overload hits Mira" while buffing Raiko and
     * never touching Mira. A self cast targets its caster.
     */
    it('resolves %target to the CASTER for a SELF cast', () => {
        const jutsu = { battleDescription: 'Overload hits %target', target: 'SELF' };
        assert.equal(resolveCastFlavor(jutsu, 'Raiko', 'Mira'), 'Overload hits Raiko');
    });

    it('resolves %user to the caster regardless of target', () => {
        for (const target of ['SELF', 'OPPONENT', 'EMPTY_GROUND']) {
            assert.equal(
                resolveCastFlavor({ battleDescription: '%user moves.', target }, 'Raiko', 'Mira'),
                'Raiko moves.',
            );
        }
    });

    it('keeps a ground cast pointed outward', () => {
        const jutsu = { battleDescription: 'The ground opens under %target.', target: 'EMPTY_GROUND' };
        assert.equal(resolveCastFlavor(jutsu, 'Raiko', 'Mira'), 'The ground opens under Mira.');
    });

    it('returns empty for missing, blank or non-string flavor', () => {
        assert.equal(resolveCastFlavor({ target: 'SELF' }, 'Raiko', 'Mira'), '');
        assert.equal(resolveCastFlavor({ battleDescription: '   ', target: 'SELF' }, 'Raiko', 'Mira'), '');
        assert.equal(resolveCastFlavor({ battleDescription: 42, target: 'SELF' }, 'Raiko', 'Mira'), '');
    });

    it('substitutes every occurrence, not just the first', () => {
        const jutsu = { battleDescription: '%user crushes %target with %user\'s fist, and %target falls.', target: 'OPPONENT' };
        assert.equal(
            resolveCastFlavor(jutsu, 'Raiko', 'Mira'),
            "Raiko crushes Mira with Raiko's fist, and Mira falls.",
        );
    });
});

describe('cast header line', () => {
    it('appends resolved flavor after the header', () => {
        const jutsu = { name: 'Overload', battleDescription: '%user forces their gates wide.', target: 'SELF' };
        assert.equal(castHeaderLine(jutsu, 'Raiko', 'Mira'), 'Raiko uses Overload: Raiko forces their gates wide.');
    });

    /*
     * The "X uses Y" shape is load-bearing: groupBattleLogActions in
     * shinobij.client/src/lib/battle-log-format.ts splits a round's log into
     * owner-attributed action blocks by matching it. A flavorless jutsu must
     * still produce a parseable header.
     */
    it('collapses to a bare header when there is no authored flavor', () => {
        assert.equal(castHeaderLine({ name: 'Overload', target: 'SELF' }, 'Raiko', 'Mira'), 'Raiko uses Overload:');
    });

    it('falls back to a generic noun when the jutsu has no name', () => {
        assert.equal(castHeaderLine({ target: 'SELF' }, 'Raiko', 'Mira'), 'Raiko uses a jutsu:');
    });
});
