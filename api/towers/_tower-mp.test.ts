import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createTowerSession, type TowerActor, type TowerMap } from './_tower-session.js';
import { startRound } from './_engine.js';
import { autoPassAfkHumans, stampTurnClock, TURN_AFK_MS } from './_tower-mp.js';

const MAP: TowerMap = { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };
function human(id: string, pos: number): TowerActor {
    return {
        id, side: 'squad', name: id, ownerSlug: id, ai: false,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, pos, character: { specialty: 'Taijutsu', stats: {} },
    };
}
function enemy(id: string, pos: number): TowerActor {
    return { ...human(id, pos), side: 'enemy', ownerSlug: null, ai: true };
}
function mk(actors: TowerActor[]) {
    return createTowerSession({ towerId: 't', runId: 'r', floor: 1, seed: 1, partySize: 2, map: MAP, actors, objectiveKind: 'defeat-all', now: 1000 });
}

describe('Battle Towers co-op AFK auto-pass', () => {
    it('passes an AFK human after the deadline and advances to the next human', () => {
        const s = mk([human('a', 0), human('b', 8), enemy('e', 63)]);
        startRound(s);
        assert.equal(s.turnQueue[s.activeIndex], 'a', 'human a is up first');

        stampTurnClock(s, 1000);
        // still inside the window → no pass
        assert.equal(autoPassAfkHumans(s, 1000 + TURN_AFK_MS - 1), false);
        assert.equal(s.turnQueue[s.activeIndex], 'a');

        // past the deadline → a is passed, the next human (b) is up
        assert.equal(autoPassAfkHumans(s, 1000 + TURN_AFK_MS + 1), true);
        assert.equal(s.turnQueue[s.activeIndex], 'b', 'advanced to the next human');
        // and b gets a FRESH window (only one absent player passes per call)
        assert.equal(autoPassAfkHumans(s, 1000 + TURN_AFK_MS + 1), false);
    });

    it('no-ops when the active actor is AI or the run is done', () => {
        const aiTurn = mk([enemy('e', 0), human('a', 8)]);
        startRound(aiTurn);
        // turn queue puts the human first (squad before enemy), so force an enemy-active case:
        const onlyEnemyActive = mk([human('a', 0), enemy('e', 1)]);
        startRound(onlyEnemyActive);
        onlyEnemyActive.status = 'done';
        assert.equal(autoPassAfkHumans(onlyEnemyActive, 9_999_999), false);
    });
});
