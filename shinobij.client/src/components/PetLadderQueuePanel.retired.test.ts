import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const panel = readFileSync(new URL('./PetLadderQueuePanel.tsx', import.meta.url), 'utf8');
const ladder = readFileSync(new URL('../screens/PetLadder.tsx', import.meta.url), 'utf8');
const asyncClient = readFileSync(new URL('../lib/pet-ladder-client.ts', import.meta.url), 'utf8');

describe('retired public Pet Ranked UI', () => {
    it('offers no live-ranked admission or ordinary realtime duel launch', () => {
        assert.doesNotMatch(panel, /joinPetLadderQueue|pollPetLadderQueue|challengeToDuel|Find a match|Leave queue/);
        assert.doesNotMatch(panel, /\/api\/pvp\/pet-ranked-queue/);
        assert.match(panel, /Ranked live queue unavailable/);
        assert.match(panel, /combat result and rating settlement share one server-owned match proof/);
        assert.doesNotMatch(ladder, /PetDuelLiveHost|queuedAgainst|autoAcceptFrom/);
    });

    it('retains the distinct asynchronous Pet Ladder surface', () => {
        assert.match(ladder, /<PetLadderQueuePanel/);
        assert.match(asyncClient, /\/api\/pet-ladder/);
    });
});
