import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const host = read('./PetDuelLiveHost.tsx');
const arena = read('../screens/PetArena.tsx');
const ladder = read('../screens/PetLadder.tsx');

describe('live pet-duel roster UI contracts', () => {
    it('sends challengers only after selecting the exact requested-mode roster', () => {
        assert.match(host, /const roster = selectLiveDuelRoster\(myPets, mode\)/);
        assert.match(host, /if \(!roster\) return liveDuelRosterIssue\(myPets, mode\)/);
        assert.match(host, /challengeToDuel\(to, mode, roster\)/);
    });

    it('fails auto and manual accept closed when the invited mode is undersized', () => {
        assert.match(host, /selectLiveDuelRoster\(petsRef\.current, incoming\.mode\)/);
        assert.match(host, /declineDuel\(incoming\.id\)/);
        assert.match(host, /const roster = selectLiveDuelRoster\(myPets, invite\.mode\)/);
        assert.match(host, /disabled=\{!roster\}/);
        assert.match(host, /acceptDuel\(invite\.id, roster\)/);
    });

    it('passes Pet Arena Auto-pick candidates to the host without 2v2-to-1v1 degradation', () => {
        assert.match(arena, /const liveDuelPets = buildPetArenaLiveRoster\(combatEligiblePets, selectedPet, reservePetId, character\.petBreeding\)/);
        assert.match(arena, /!isLivePetDuelAvailable\(selectedPet, character\.petBreeding\)/);
        assert.match(arena, /myPets=\{liveDuelPets\}/);
        assert.match(arena, /partyMode && liveDuelPets\.length < 2/);
        assert.match(arena, /partyMode \? "2v2" : "1v1"/);
        assert.doesNotMatch(arena, /sending a 1v1 challenge instead|otherwise it falls back to 1v1/);
    });

    it('keeps the concurrently retired ranked admission outside the shared host', () => {
        assert.doesNotMatch(ladder, /PetDuelLiveHost|autoAcceptFrom=/);
        assert.match(ladder, /<PetLadderQueuePanel \/>/);
        assert.match(host, /live=\{bound\.duel\}/, 'the existing cinematic Socket.IO lockstep authority remains mounted');
    });
});
