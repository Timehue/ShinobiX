import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE_LEGACY_SOURCES } from '../../shared/legacy-card-sources.js';
import { CHRONICLE_STORY_SOURCES } from '../../shared/story-card-sources.js';
import { CHRONICLE_PET_WITNESS_SOURCES } from '../../shared/pet-witness-card-sources.js';
import { getChronicleCard } from '../../shared/chronicle-duel.js';
import {
    CHRONICLE_PROGRESSION_CARD_IDS,
    LEGACY_PROGRESSION_CARD_IDS,
    PET_WITNESS_PROGRESSION_CARD_IDS,
    STORY_PROGRESSION_CARD_IDS,
    backfillStoryProgressionCards,
    backfillChronicleProgressionCards,
    chronicleProgressionCardsForCharacter,
    grantChronicleProgressionCards,
    legacyProgressionCardId,
    storyProgressionCardId,
    storyProgressionCardsForCharacter,
    petWitnessProgressionCardId,
} from './_progression-cards.js';

describe('Chronicle progression entitlements', () => {
    it('maps every reviewed story boss and every Legacy exactly once to a catalog card', () => {
        assert.equal(STORY_PROGRESSION_CARD_IDS.length, CHRONICLE_STORY_SOURCES.length);
        assert.equal(LEGACY_PROGRESSION_CARD_IDS.length, CHRONICLE_LEGACY_SOURCES.length);
        assert.equal(PET_WITNESS_PROGRESSION_CARD_IDS.length, CHRONICLE_PET_WITNESS_SOURCES.length);
        assert.equal(new Set(CHRONICLE_PROGRESSION_CARD_IDS).size, CHRONICLE_PROGRESSION_CARD_IDS.length);
        for (const source of CHRONICLE_STORY_SOURCES) {
            const id = storyProgressionCardId(source.aiProfileId);
            assert.equal(id, `story-${source.aiProfileId}`);
            assert.ok(id && getChronicleCard(id), `${id} must exist in the Chronicle catalog`);
        }
        for (const source of CHRONICLE_LEGACY_SOURCES) {
            const id = legacyProgressionCardId(source.id);
            assert.equal(id, `legacy-${source.id}`);
            assert.ok(id && getChronicleCard(id), `${id} must exist in the Chronicle catalog`);
        }
        for (const source of CHRONICLE_PET_WITNESS_SOURCES) {
            const id = petWitnessProgressionCardId(source.element);
            assert.equal(id, source.id);
            assert.ok(id && getChronicleCard(id), `${id} must exist in the Chronicle catalog`);
        }
    });

    it('derives only the completed village story cards and backfills them once', () => {
        const character = {
            village: 'Ashen Leaf Village',
            storyProgress: 2,
            tileCards: ['tc-01'],
        };
        const expected = CHRONICLE_STORY_SOURCES
            .filter((source) => source.village === character.village)
            .slice(0, 2)
            .map((source) => `story-${source.aiProfileId}`);
        assert.deepEqual(storyProgressionCardsForCharacter(character), expected);
        const first = backfillStoryProgressionCards(character);
        assert.deepEqual(first.granted, expected);
        assert.deepEqual(first.character.tileCards, ['tc-01', ...expected]);
        const replay = backfillStoryProgressionCards(first.character);
        assert.deepEqual(replay.granted, []);
        assert.deepEqual(replay.character.tileCards, first.character.tileCards);
    });

    it('a transferred character back-fills only its story village\'s cards', () => {
        const storyCards = (village: string) => CHRONICLE_STORY_SOURCES
            .filter((source) => source.village === village)
            .map((source) => `story-${source.aiProfileId}`);
        const home = 'Ashen Leaf Village';
        const destination = 'Frostfang Village';
        assert.equal(storyCards(home).length, 9);
        assert.equal(storyCards(destination).length, 9);
        // What api/village/transfer.ts leaves behind: a new `village`, the home
        // story kept in `storyVillage`, and the same story progress.
        const transferred = { village: destination, storyVillage: home, storyProgress: 9, tileCards: [] };
        assert.deepEqual(storyProgressionCardsForCharacter(transferred), storyCards(home));
        const repaired = backfillChronicleProgressionCards(transferred);
        assert.deepEqual(repaired.granted, storyCards(home));
        for (const id of storyCards(destination)) {
            assert.equal((repaired.character.tileCards as string[]).includes(id), false, `${id} was never earned`);
        }
    });

    it('without storyVillage the current village still decides (saves from before the field)', () => {
        const character = { village: 'Moonshadow Village', storyProgress: 3, tileCards: [] };
        const expected = CHRONICLE_STORY_SOURCES
            .filter((source) => source.village === 'Moonshadow Village')
            .slice(0, 3)
            .map((source) => `story-${source.aiProfileId}`);
        assert.deepEqual(storyProgressionCardsForCharacter(character), expected);
        assert.deepEqual(storyProgressionCardsForCharacter({ ...character, storyVillage: '' }), expected);
        assert.deepEqual(storyProgressionCardsForCharacter({ ...character, storyVillage: 42 }), expected);
    });

    it('ignores forged ids and never duplicates an owned progression card', () => {
        const valid = STORY_PROGRESSION_CARD_IDS[0];
        const result = grantChronicleProgressionCards(
            { tileCards: [valid, valid, 'tc-02'] },
            [valid, 'story-forged', 'legacy-forged'],
        );
        assert.deepEqual(result.granted, []);
        assert.deepEqual(result.character.tileCards, [valid, valid, 'tc-02']);
        assert.equal(storyProgressionCardId('forged'), null);
        assert.equal(legacyProgressionCardId('forged'), null);
    });

    it('backfills the Sage witness at acceptance and the matching Legacy card at awakening', () => {
        const accepted = chronicleProgressionCardsForCharacter({
            legacy: { legacyId: 'first-flame', stage: 1 },
        });
        assert.deepEqual(accepted, ['story-wandering-sage']);
        const awakened = backfillChronicleProgressionCards({
            legacy: { legacyId: 'first-flame', stage: 2 },
            tileCards: [],
        });
        assert.deepEqual(awakened.granted, ['story-wandering-sage', 'legacy-first-flame']);
    });
});
