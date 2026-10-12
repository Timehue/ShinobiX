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

    it('routes current Pet Arena challenges to the human command room and excludes the retired host', () => {
        assert.doesNotMatch(arena, /PetDuelLiveHost|buildPetArenaLiveRoster|partyMode/);
        assert.match(arena, /function sendDirectPetChallenge[\s\S]*?setShowTactics\(true\)/);
        assert.match(arena, /<PetTacticsArena/);
    });

    it('keeps live ranked admission outside the shared duel host', () => {
        assert.doesNotMatch(ladder, /PetDuelLiveHost|autoAcceptFrom=/);
        assert.match(ladder, /<PetLadderQueuePanel /);
        assert.match(host, /live=\{bound\.duel\}/, 'the existing cinematic Socket.IO lockstep authority remains mounted');
    });
});
