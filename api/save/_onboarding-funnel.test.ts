import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { observeOnboardingFunnel, ACADEMY_PATH_STEPS } from './_onboarding-funnel.js';

const events = (input: Parameters<typeof observeOnboardingFunnel>[0]) =>
    observeOnboardingFunnel(input).map((o) => o.event);

const chr = (over: Record<string, unknown> = {}) => ({ level: 12, ...over });

describe('onboarding funnel observation', () => {
    it('starts the funnel only on entry to the first Academy beat', () => {
        assert.deepEqual(
            events({ beforeCharacter: chr(), afterCharacter: chr({ onboardingStep: 'academyIntro' }) }),
            ['academy.started', 'academy.step.reached'],
        );
        // a later beat is a step, not another start
        assert.deepEqual(
            events({ beforeCharacter: chr({ onboardingStep: 'training' }), afterCharacter: chr({ onboardingStep: 'jutsu' }) }),
            ['academy.step.reached'],
        );
    });

    it('names the step it reached, so the histogram is per beat', () => {
        const [observation] = observeOnboardingFunnel({
            beforeCharacter: chr({ onboardingStep: 'inventory' }),
            afterCharacter: chr({ onboardingStep: 'academySpar' }),
        });
        assert.equal(observation.event, 'academy.step.reached');
        assert.equal(observation.step, 'academySpar');
        assert.equal(observation.level, 12);
    });

    it('counts completion for a walker, never for a pre-onboarding veteran', () => {
        assert.ok(events({
            beforeCharacter: chr({ onboardingStep: 'sectorReturn' }),
            afterCharacter: chr({ onboardingStep: 'done' }),
        }).includes('academy.completed'));

        // A veteran has no stored step at all; the client normalizer reads that
        // as 'done'. They must not be counted as having completed onboarding.
        assert.deepEqual(events({ beforeCharacter: chr(), afterCharacter: chr() }), []);
        assert.ok(!events({ beforeCharacter: chr(), afterCharacter: chr({ onboardingStep: 'done' }) })
            .includes('academy.completed'));
    });

    it('normalizes the legacy step aliases instead of dropping those saves', () => {
        // 'spar' -> 'academySpar': an alias change must not read as a new beat.
        assert.deepEqual(events({
            beforeCharacter: chr({ onboardingStep: 'spar' }),
            afterCharacter: chr({ onboardingStep: 'academySpar' }),
        }), []);
        assert.deepEqual(events({
            beforeCharacter: chr({ onboardingStep: 'tour' }),
            afterCharacter: chr({ onboardingStep: 'training' }),
        }), []);
    });

    it('ignores an unknown step rather than inventing a beat', () => {
        assert.deepEqual(events({
            beforeCharacter: chr({ onboardingStep: 'training' }),
            afterCharacter: chr({ onboardingStep: 'not-a-real-step' }),
        }), []);
    });

    it('sees the first equipped jutsu and the first equipped item', () => {
        assert.deepEqual(events({
            beforeCharacter: chr({ equippedJutsuIds: [] }),
            afterCharacter: chr({ equippedJutsuIds: ['fireball'] }),
        }), ['loadout.first_jutsu_equipped']);

        assert.deepEqual(events({
            beforeCharacter: chr({ equipment: {} }),
            afterCharacter: chr({ equipment: { weapon: 'rustfang-kunai' } }),
        }), ['loadout.first_item_equipped']);

        // blank entries are not equipment
        assert.deepEqual(events({
            beforeCharacter: chr({ equippedJutsuIds: [''], equipment: { weapon: '' } }),
            afterCharacter: chr({ equippedJutsuIds: ['  '], equipment: { weapon: null } }),
        }), []);
    });

    it('does not re-count a loadout that was already populated', () => {
        assert.deepEqual(events({
            beforeCharacter: chr({ equippedJutsuIds: ['fireball'] }),
            afterCharacter: chr({ equippedJutsuIds: ['fireball', 'shadow-clone'] }),
        }), []);
    });

    it('reads currentSector from the TOP LEVEL, not the character', () => {
        assert.deepEqual(events({
            beforeCharacter: chr(), afterCharacter: chr(),
            beforeTopLevel: {}, afterTopLevel: { currentSector: 'frostfang-3' },
        }), ['sector.first_entered']);

        // it is a top-level field: the same key on the character is not it
        assert.deepEqual(events({
            beforeCharacter: chr(), afterCharacter: chr({ currentSector: 'frostfang-3' }),
        }), []);
    });

    it('observes nothing at all for an ordinary autosave', () => {
        const same = chr({ onboardingStep: 'done', equippedJutsuIds: ['fireball'], equipment: { weapon: 'kunai' } });
        assert.deepEqual(events({
            beforeCharacter: same, afterCharacter: same,
            beforeTopLevel: { currentSector: 's1' }, afterTopLevel: { currentSector: 's1' },
        }), []);
    });
});

describe('onboarding funnel stays wired and in sync', () => {
    it('mirrors the client canonical Academy Path exactly', () => {
        // The order lives in the client normalizer's header comment; parse it so
        // a reordered or renamed beat fails here instead of silently skewing the
        // funnel.
        const src = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'onboarding-step.ts'), 'utf8');
        const flow = src.slice(src.indexOf('academyIntro'), src.indexOf('// Legacy saves'));
        const declared = flow.split('->').map((part) => part.replace(/[^A-Za-z]/g, '')).filter(Boolean);
        assert.deepEqual(declared, [...ACADEMY_PATH_STEPS]);
    });

    it('is called from the save handler, after the write', () => {
        const save = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');
        assert.match(save, /observeOnboardingFunnel\(\{/);
        assert.match(save, /recordBetaFunnelStep\(step\.event, identityName/);
        assert.ok(save.indexOf('await Promise.all([') < save.indexOf('observeOnboardingFunnel({'),
            'the funnel must be observed after the save is persisted');
    });
});
