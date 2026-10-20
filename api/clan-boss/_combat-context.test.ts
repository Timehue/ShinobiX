import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTowerEncounter } from '../towers/_encounter.js';
import { checkTowerWinner, endTurn, startRound } from '../towers/_engine.js';
import { CLAN_BOSS_FLOORS, getFloor } from '../towers/_floor-catalog.js';
import { clanBossOutcomeLog } from '../../shared/clan-boss-operation.js';

const character = { level: 100, maxHp: 10_000, maxChakra: 10_000, maxStamina: 10_000, stats: {}, jutsu: [] };
function encounter(partySize: number, mode: 'clan-boss' | 'celestial' = 'clan-boss', floor = CLAN_BOSS_FLOORS[3]!, runId = 'cboss-context') {
    return buildTowerEncounter({ floor, runId, towerId: mode, seed: 7, partySize, now: 1,
        squad: Array.from({ length: partySize }, (_, i) => ({ id: `sq-${i}`, name: `Hero${i}`, ownerSlug: `hero${i}`, ai: false, character: structuredClone(character) })) });
}

describe('Clan Boss strength and terminal context', () => {
    it('keeps authored enemy strength for solo through four-player clan assaults only', () => {
        const reference = encounter(3).actors.filter(actor => actor.side === 'enemy');
        for (const size of [1, 2, 3, 4]) {
            const enemies = encounter(size).actors.filter(actor => actor.side === 'enemy');
            assert.deepEqual(enemies.map(actor => [actor.maxHp, actor.character.towerDmgScale]), reference.map(actor => [actor.maxHp, actor.character.towerDmgScale]));
        }
        const ordinary = encounter(1, 'celestial');
        assert.ok(ordinary.actors.filter(actor => actor.side === 'enemy').every(actor => Number(actor.character.towerDmgScale) < 1), 'ordinary party discounts are unchanged');
    });

    for (const mode of ['clan-boss', 'celestial'] as const) it(`uses clan victory and wipe logs for ${mode} accepted assaults`, () => {
        for (const victory of [true, false]) {
            const session = encounter(1, mode);
            session.phaseState.pendingPhases = [];
            for (const actor of session.actors) if (actor.side === (victory ? 'enemy' : 'squad')) actor.hp = 0;
            checkTowerWinner(session, CLAN_BOSS_FLOORS[3]!);
            assert.equal(session.status, 'done');
            assert.equal(session.log.at(-1), victory ? 'Clan Boss assault cleared!' : 'Squad wiped — assault ended.');
        }
    });

    it('uses clan round-limit wording and retains normal Tower context', () => {
        const floor = CLAN_BOSS_FLOORS[3]!, session = encounter(1);
        session.roundCap = 1; startRound(session);
        for (let i = 0; i < 30 && session.status === 'active'; i++) endTurn(session, floor);
        assert.equal(session.status, 'done'); assert.equal(session.log.at(-1), 'Round limit reached — assault ended.');
        const towerFloor = getFloor(1)!, tower = encounter(1, 'celestial', towerFloor, 'tower-context');
        for (const actor of tower.actors) if (actor.side === 'enemy') actor.hp = 0;
        checkTowerWinner(tower, towerFloor);
        assert.equal(tower.log.at(-1), 'Floor 1 cleared!');
        const reserved = encounter(1, 'celestial', floor, 'tower-not-clan'); reserved.phaseState.pendingPhases = [];
        for (const actor of reserved.actors) if (actor.side === 'enemy') actor.hp = 0;
        checkTowerWinner(reserved, floor);
        assert.equal(reserved.log.at(-1), 'Floor 9004 cleared!', 'a floor number alone never changes mode');
    });

    it('projects legacy result lines without touching actor actions or raw history', () => {
        const raw = ['Floor 9004 cleared!', 'Hero used Floor 9004 cleared!', 'Squad wiped — floor failed.'];
        assert.deepEqual(raw.map(line => clanBossOutcomeLog(line, 9004)), ['Clan Boss assault cleared!', raw[1], 'Squad wiped — assault ended.']);
        assert.equal(raw[0], 'Floor 9004 cleared!');
        assert.equal(clanBossOutcomeLog('Floor 1 cleared!', 9004), 'Floor 1 cleared!');
    });
});
