import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { petBreedingRequirementsComplete, recordPetBreedingProgress, settlePetBreedingSession } from './_breeding-requirements.js';

const baseSession = { sessionId: 'breed-1', state: 'breeding' as const, parentIds: ['p1', 'p2'] as [string, string], parentNames: ['One', 'Two'] as [string, string], parentElement: 'Fire', startedAt: 0, readyAt: 100, rulesVersion: 1 };

describe('persistent hatch requirements', () => {
    it('materializes exactly care, adventure, and elemental requirements after 24h', () => {
        const settled = settlePetBreedingSession({ pets: [{ level: 1, maxLevel: 100 }], petBreeding: baseSession }, 100, (min) => min);
        const session = settled.character.petBreeding as { state: string; requirements: Array<{ category: string }> };
        assert.equal(settled.changed, true);
        assert.equal(session.state, 'egg');
        assert.deepEqual(session.requirements.map((requirement) => requirement.category), ['care', 'adventure', 'elementalBond']);
    });

    it('records matching events, element-gates interactions, and dedupes receipts', () => {
        const egg = settlePetBreedingSession({ pets: [{ level: 1, maxLevel: 100 }], petBreeding: baseSession }, 100, (min) => min).character;
        const wrong = recordPetBreedingProgress(egg, { kind: 'pet-interaction', petElement: 'Water' }, 101);
        assert.equal(wrong.changed, false);
        const mission = recordPetBreedingProgress(egg, { kind: 'mission-complete', receipt: 'mission:1' }, 101);
        const replay = recordPetBreedingProgress(mission.character, { kind: 'mission-complete', receipt: 'mission:1' }, 102);
        assert.equal(mission.changed, true);
        assert.equal(replay.changed, false);
        assert.equal(petBreedingRequirementsComplete(mission.character.petBreeding as never), false);
    });
});
