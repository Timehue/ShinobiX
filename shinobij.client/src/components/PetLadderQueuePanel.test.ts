import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const panel = readFileSync(new URL('./PetLadderQueuePanel.tsx', import.meta.url), 'utf8');
const ladder = readFileSync(new URL('../screens/PetLadder.tsx', import.meta.url), 'utf8');
const asyncClient = readFileSync(new URL('../lib/pet-ladder-client.ts', import.meta.url), 'utf8');

/*
 * Live Pet Ranked was retired because the queue launched an ordinary no-reward
 * realtime duel: the fight a player watched and the Elo they were awarded came
 * from two different engines over two different seeds. That defect is fixed —
 * one server resolution, replayed to both players and rated from the same
 * derivation — so the queue is live again.
 *
 * What this file guards is the reason it was retired, not the retirement: the
 * panel must never decide a ranked outcome locally.
 */
describe('live Pet Ranked UI', () => {
    it('never simulates or judges a ranked fight in the browser', () => {
        assert.doesNotMatch(panel, /runPetDuel|runPetDuelCinematic|Math\.random/);
        // The winner shown is the server's, read off the watch response.
        assert.match(panel, /fetchRankedPetDuel/);
        assert.match(panel, /watched\.winnerName === character\.name/);
        // No local fallback: showing an unrated fight is the original bug.
        assert.match(panel, /Your rating is untouched/);
    });

    it('drives the server handshake rather than inventing match state', () => {
        assert.match(panel, /petRankedQueue\("poll", character\.name\)/);
        assert.match(panel, /startRankedPetMatch/);
        assert.match(panel, /settleRankedPetMatch/);
        // Only the initiator mints the sealed token.
        assert.match(panel, /state\.state !== "paired" \|\| !state\.initiator/);
    });

    it('retains the distinct asynchronous Pet Ladder surface', () => {
        assert.match(ladder, /<PetLadderQueuePanel/);
        assert.match(asyncClient, /\/api\/pet-ladder/);
        // The live queue must not drag the legacy duel host back in.
        assert.doesNotMatch(ladder, /PetDuelLiveHost|queuedAgainst|autoAcceptFrom/);
    });
});
