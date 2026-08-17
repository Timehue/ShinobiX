/*
 * The relic-survey wanderer quest (`wq-relic-survey`).
 *
 * Every other wanderer errand tracks a LIFETIME counter, so "one tile in each
 * country" could not be expressed honestly — a flat tile count cannot tell
 * volcano from snow, and the quest catalog's own rule is that a label must state
 * what its counter actually measures. This quest tracks a SET of biomes instead,
 * exposed as a length so the ordinary baseline+target completion check needs no
 * survey-specific branch.
 *
 * It is also the only place the game explains that relics are biome-locked, so
 * the walkthrough naming each country's relic is content, not decoration.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { WANDERER_QUESTS, RESET_ON_ACCEPT_METRICS, SURVEY_RESET_FIELDS, wandererQuestComplete } from './_wanderer-quest.js';
import { withRelicSurveyProgress } from '../world/_explore.js';
import { sectorBiomeOf } from '../../shared/sector-geo.js';
import { sanitizeCharacterSave } from '../save/[name].js';

// One wild sector per biome.
const BIOME_SECTOR = { central: 1, forest: 9, shadow: 17, snow: 26, volcano: 33 } as const;

describe('relic survey quest', () => {
    it('asks for all five countries', () => {
        const def = WANDERER_QUESTS['wq-relic-survey'];
        assert.equal(def.metric, 'relicSurveyCount');
        assert.equal(def.target, 5, 'one per biome');
        assert.equal(new Set(Object.values(BIOME_SECTOR).map(sectorBiomeOf)).size, 5,
            'the world still has exactly the five biomes the target assumes');
    });

    it('records each distinct country walked, and never double-counts one', () => {
        let character: Record<string, unknown> = {};
        for (const sector of Object.values(BIOME_SECTOR)) character = withRelicSurveyProgress(character, sector);
        assert.equal(character.relicSurveyCount, 5);
        assert.deepEqual(
            [...(character.relicSurvey as string[])].sort(),
            ['central', 'forest', 'shadow', 'snow', 'volcano'],
        );
        // Walking the same country again changes nothing at all.
        const before = JSON.stringify(character);
        character = withRelicSurveyProgress(character, BIOME_SECTOR.volcano);
        assert.equal(JSON.stringify(character), before, 'a repeat country must not advance the survey');
    });

    it('completes only once every country is walked', () => {
        const def = WANDERER_QUESTS['wq-relic-survey'];
        let character: Record<string, unknown> = {};
        for (const [i, sector] of Object.values(BIOME_SECTOR).entries()) {
            character = withRelicSurveyProgress(character, sector);
            const done = wandererQuestComplete(0, Number(character.relicSurveyCount), def.target);
            assert.equal(done, i === 4, `after ${i + 1} countries, complete should be ${i === 4}`);
        }
    });

    it('is reset-on-accept, so a well-travelled player still has to walk it', () => {
        const def = WANDERER_QUESTS['wq-relic-survey'];
        assert.ok(RESET_ON_ACCEPT_METRICS.has(def.metric),
            'without this, someone who had already seen all five would complete it instantly');
        assert.deepEqual(SURVEY_RESET_FIELDS[def.metric], ['relicSurvey'],
            'the backing set must be cleared too, not just the counter');
    });

    it('ignores a sector outside the world', () => {
        const character = withRelicSurveyProgress({}, 9_999);
        assert.equal(character.relicSurveyCount, undefined, 'no survey progress from a bad sector');
    });
});

/*
 * The survey counter is the quest objective, so it is exactly the field a
 * tampered client would want to write. Both it and its backing set are
 * `server-mirror-char` in the ownership manifest, which forces the STORED value
 * on every save write.
 */
describe('relic survey progress is server-owned', () => {
    const wrap = (character: Record<string, unknown>) => ({ character });
    const base = { name: 'Walker', level: 20, inventory: [], itemStacks: [], equipment: {} };

    it('discards a client-forged survey and keeps the stored one', () => {
        const stored = wrap({ ...base, relicSurvey: ['forest', 'snow'], relicSurveyCount: 2 });
        const forged = wrap({
            ...base,
            relicSurvey: ['forest', 'snow', 'volcano', 'shadow', 'central'],
            relicSurveyCount: 5,
        });
        const out = sanitizeCharacterSave(forged, stored).character as Record<string, unknown>;
        assert.deepEqual(out.relicSurvey, ['forest', 'snow'], 'a client cannot walk countries by editing its save');
        assert.equal(out.relicSurveyCount, 2);
    });

    it('preserves server-written progress when the client omits it', () => {
        const stored = wrap({ ...base, relicSurvey: ['forest', 'snow'], relicSurveyCount: 2 });
        const out = sanitizeCharacterSave(wrap({ ...base }), stored).character as Record<string, unknown>;
        assert.deepEqual(out.relicSurvey, ['forest', 'snow'], 'an ordinary save must not wipe the survey');
        assert.equal(out.relicSurveyCount, 2);
    });
});
