import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { passRankExam } from './_pass.js';

describe('rank exam authority', () => {
    const ready = { level: 20, elements: ['Fire'], totalStatsTrained: 400, totalMissionsCompleted: 20, totalAiKills: 20, totalTilesExplored: 50, jutsuMastery: [{ level: 3 }], examsPassed: [] };
    it('requires every canonical Genin condition', () => {
        assert.equal(passRankExam(ready, 'genin').ok, true);
        assert.equal(passRankExam({ ...ready, totalStatsTrained: 399 }, 'genin').ok, false);
    });
    it('enforces exam order and proof-backed leadership', () => {
        const special = { level: 80, totalPvpKills: 100, examsPassed: ['genin', 'chunin', 'jonin'] };
        assert.equal(passRankExam(special, 'specialJonin').ok, false);
        assert.equal(passRankExam(special, 'specialJonin', { isElder: true }).ok, true);
        assert.equal(passRankExam({ level: 50, totalPvpKills: 10, totalVillageRaids: 20, defeatedAiIds: ['builtin-ai-rogue-ninja'], examsPassed: [] }, 'jonin').ok, false);
    });
    it('records Special Jonin prestige without awarding or blocking character power', () => {
        const stats = {
            strength: 800, speed: 790, intelligence: 10, willpower: 10,
            bukijutsuOffense: 10, bukijutsuDefense: 10, taijutsuOffense: 10, taijutsuDefense: 10,
            genjutsuOffense: 10, genjutsuDefense: 10, ninjutsuOffense: 10, ninjutsuDefense: 10,
        };
        const mastery = [{ jutsuId: 'ember', level: 42 }];
        const veteran = {
            level: 80,
            rankTitle: 'Special Jonin',
            totalPvpKills: 100,
            examsPassed: ['genin', 'chunin', 'jonin'],
            stats,
            unspentStats: 17,
            jutsuMastery: mastery,
            ryo: 900,
        };
        const result = passRankExam(veteran, 'specialJonin', { isKage: true });
        assert.equal(result.ok, true);
        assert.equal(result.character.level, 80);
        assert.equal(result.character.rankTitle, 'Special Jonin');
        assert.deepEqual(result.character.stats, stats);
        assert.equal(result.character.unspentStats, 17);
        assert.deepEqual(result.character.jutsuMastery, mastery);
        assert.equal(result.character.ryo, 900);
        assert.deepEqual(result.character.examsPassed, ['genin', 'chunin', 'jonin', 'specialJonin']);
    });
});
