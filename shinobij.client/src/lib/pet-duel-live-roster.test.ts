import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pet, PetBreedingSession } from '../types/pet';
import {
    buildPetArenaLiveRoster,
    liveDuelRosterIssue,
    selectLiveDuelRoster,
} from './pet-duel-live-roster';

const pet = (id: string, extra: Partial<Pet> = {}) => ({ id, name: id, ...extra }) as Pet;

describe('live Pet Arena roster selection', () => {
    it('passes the Auto-pick reserve after the selected lead and mirrors every server busy state', () => {
        const lead = pet('lead');
        const training = pet('training', { training: { type: 'strength', endsAt: 2_000 } });
        const unclaimedExpedition = pet('expedition', { expedition: { endsAt: 500 } as Pet['expedition'] });
        const breeding = pet('breeding');
        const reserve = pet('reserve');
        const breedingSession = {
            state: 'breeding',
            parentIds: ['breeding', 'other'],
            readyAt: 2_000,
        } as PetBreedingSession;

        const candidates = [lead, training, unclaimedExpedition, breeding, reserve];
        assert.deepEqual(buildPetArenaLiveRoster(candidates, lead, '', breedingSession, 1_000), [lead, reserve]);
        assert.deepEqual(buildPetArenaLiveRoster(candidates, lead, 'training', breedingSession, 1_000), [lead, reserve]);
        assert.deepEqual(buildPetArenaLiveRoster(candidates, lead, 'expedition', breedingSession, 1_000), [lead, reserve]);
        assert.deepEqual(buildPetArenaLiveRoster(candidates, lead, 'breeding', breedingSession, 1_000), [lead, reserve]);
        assert.deepEqual(buildPetArenaLiveRoster(candidates, training, '', breedingSession, 1_000), []);
        assert.deepEqual(buildPetArenaLiveRoster(candidates, unclaimedExpedition, '', breedingSession, 1_000), []);
        assert.deepEqual(buildPetArenaLiveRoster(candidates, breeding, '', breedingSession, 1_000), []);
    });

    it('fails a 2v2 candidate pool closed when no distinct reserve exists', () => {
        const lead = pet('lead');
        const candidates = buildPetArenaLiveRoster([lead], lead, '');
        assert.deepEqual(candidates, [lead]);
        assert.equal(selectLiveDuelRoster(candidates, '2v2'), null);
        assert.match(liveDuelRosterIssue(candidates, '2v2') ?? '', /two distinct eligible pets/);
    });

    it('selects exact payloads for challengers, manual accepts, and ranked 1v1 callers', () => {
        const lead = pet('lead');
        const reserve = pet('reserve');
        assert.deepEqual(selectLiveDuelRoster([lead, reserve], '2v2'), [lead, reserve]);
        assert.deepEqual(selectLiveDuelRoster([lead, reserve], '1v1'), [lead]);
        assert.deepEqual(selectLiveDuelRoster([lead], '1v1'), [lead], 'ranked Coliseum still supplies one valid pet');
        assert.equal(selectLiveDuelRoster([lead, lead], '2v2'), null);
    });
});
