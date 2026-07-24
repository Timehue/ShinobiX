import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { chronicleUnlocked, claimStarterCards, STARTER_CARDS_MIN_LEVEL } from './_starter-cards.js';
import { CHRONICLE_STARTER_GRANT_IDS, countChronicleCards, getChronicleCard } from '../../shared/chronicle-duel.js';

describe('claimStarterCards', () => {
    it('grants the full traveler\'s codex (the existing starter floor) to an empty collection', () => {
        const result = claimStarterCards({ level: 20, tileCards: [] });
        assert.ok(result.ok);
        assert.equal(result.granted.length, CHRONICLE_STARTER_GRANT_IDS.length);
        assert.equal((result.character.tileCards as string[]).length, CHRONICLE_STARTER_GRANT_IDS.length);
        assert.equal(result.character.starterCardsClaimed, true);
        // The claim must grant EXACTLY the same multiset the lazy first-duel
        // floor grants (_deck.ts) — identical economy, just delivered by the
        // scribe with ceremony. If this drifts, players get double freebies.
        const granted = countChronicleCards(result.granted);
        const floor = countChronicleCards(CHRONICLE_STARTER_GRANT_IDS);
        assert.deepEqual([...granted.entries()].sort(), [...floor.entries()].sort());
        for (const id of result.granted) {
            assert.ok(getChronicleCard(id), `${id} must exist in the catalog`);
        }
    });

    it('is a quantity floor: only tops up copies the player is missing', () => {
        const starterCounts = countChronicleCards(CHRONICLE_STARTER_GRANT_IDS);
        const [someId, someCount] = [...starterCounts.entries()][0];
        const result = claimStarterCards({ level: 20, tileCards: [someId, someId, someId] });
        assert.ok(result.ok);
        const grantedCounts = countChronicleCards(result.granted);
        assert.equal(grantedCounts.get(someId) ?? 0, Math.max(0, someCount - 3),
            'already-owned copies must not be granted again');
        // Total owned after claim still meets the floor exactly for that id.
        const owned = countChronicleCards(result.character.tileCards as string[]);
        assert.ok((owned.get(someId) ?? 0) >= someCount);
    });

    it('rejects a second claim (one-time latch)', () => {
        const first = claimStarterCards({ level: 20, tileCards: [] });
        assert.ok(first.ok);
        const second = claimStarterCards(first.character);
        assert.equal(second.ok, false);
        assert.equal(!second.ok && second.reason, 'already-claimed');
    });

    it('rejects players below the scribe\'s level band', () => {
        const result = claimStarterCards({ level: STARTER_CARDS_MIN_LEVEL - 1, tileCards: [] });
        assert.equal(result.ok, false);
        assert.equal(!result.ok && result.reason, 'level');
    });

    it('never clobbers non-starter cards already in the collection', () => {
        const result = claimStarterCards({ level: 30, tileCards: ['tc-142'] });
        assert.ok(result.ok);
        const owned = result.character.tileCards as string[];
        assert.ok(owned.includes('tc-142'), 'existing collection must survive the claim');
        assert.equal(owned.length, 1 + result.granted.length);
    });
});

describe('chronicleUnlocked (the card-game lock)', () => {
    it('is locked until the codex latch is set — regardless of owned cards', () => {
        assert.equal(chronicleUnlocked(null), false);
        assert.equal(chronicleUnlocked(undefined), false);
        assert.equal(chronicleUnlocked({}), false);
        assert.equal(chronicleUnlocked({ tileCards: ['tc-01', 'tc-02'] }), false, 'owning cards is not the unlock; the scribe event is');
        assert.equal(chronicleUnlocked({ starterCardsClaimed: 'yes' }), false, 'only the boolean true counts');
    });
    it('unlocks with the latch, and claiming the codex sets it', () => {
        assert.equal(chronicleUnlocked({ starterCardsClaimed: true }), true);
        const claimed = claimStarterCards({ level: 20, tileCards: [] });
        assert.ok(claimed.ok);
        assert.equal(chronicleUnlocked(claimed.character), true, 'the claim result must satisfy the lock it opens');
    });
});
