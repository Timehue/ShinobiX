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
});
