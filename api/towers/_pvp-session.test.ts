import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    TOWER_PVP_AFK_STRIKES_TO_FORFEIT,
    TOWER_PVP_FLOOR,
    activateReadyTowerPvpMatch,
    advanceExpiredTowerPvpTurn,
    assignTowerPvpTeams,
    createTowerPvpMatch,
    projectTowerPvpMatchForViewer,
    projectTowerPvpTerminal,
    towerPvpCombatRoster,
    type TowerPvpFighterSeed,
} from './_pvp-session.js';
import { endTurn } from './_engine.js';
import { TURN_AFK_MS } from './_tower-mp.js';

const MATCH_ID = `tpvp-${'a'.repeat(32)}`;
const NOW = 1_800_000_000_000;

function fighter(slug: string, skill: number): TowerPvpFighterSeed {
    return {
        slug,
        displayName: slug.toUpperCase(),
        skill,
        character: {
            name: slug,
            level: 40,
            specialty: 'Taijutsu',
            maxHp: 1_000,
            maxChakra: 100,
            maxStamina: 100,
            stats: { strength: 200, speed: 160, defense: 150, intelligence: 120 },
            jutsu: [],
            pvpItems: [],
        },
    };
}

function seeds(): TowerPvpFighterSeed[] {
    return [fighter('alpha', 400), fighter('bravo', 300), fighter('charlie', 200), fighter('delta', 100)];
}

function match() {
    return createTowerPvpMatch({ matchId: MATCH_ID, fighters: seeds(), seed: 7, now: NOW });
}

describe('Tower MPvP session authority', () => {
    it('assigns exact balanced 2v2 teams independently of queue order', () => {
        const roster = assignTowerPvpTeams([seeds()[2]!, seeds()[0]!, seeds()[3]!, seeds()[1]!]);
        assert.deepEqual(roster.filter(member => member.teamId === 'amber').map(member => member.slug), ['alpha', 'delta']);
        assert.deepEqual(roster.filter(member => member.teamId === 'violet').map(member => member.slug), ['bravo', 'charlie']);
        assert.equal(new Set(roster.map(member => member.actorId)).size, 4);
        assert.equal(new Set(roster.map(member => member.controllerId)).size, 4);
    });

    it('rejects duplicate or incomplete rosters before a session is minted', () => {
        assert.throws(() => assignTowerPvpTeams(seeds().slice(0, 3)), /exactly 4/);
        const duplicate = seeds();
        duplicate[3] = fighter('alpha', 1);
        assert.throws(() => assignTowerPvpTeams(duplicate), /unique/);
    });

    it('mints a neutral embedded no-reward arena with consumables disabled', () => {
        const created = match();
        assert.equal(created.status, 'ready');
        assert.equal(created.combat.towerId, 'tower-mpvp-v1');
        assert.equal(created.combat.encounterFloor?.id, 0);
        assert.equal(created.combat.floorProvenance, undefined);
        assert.equal(created.combat.sealedCatalogFloor, undefined);
        assert.equal(created.combat.rewardSettlementState, 'settled');
        assert.ok(created.combat.actors.every(actor => actor.ai === false && actor.ownerSlug));
        assert.ok(created.combat.actors.every(actor => Object.keys(actor.itemCharges ?? {}).length === 0));
        assert.equal(created.rules.rewards, 'none');
        assert.equal(created.rules.consumables, 'disabled');
    });

    it('projects canonical N-actor teams and player-owned controllers', () => {
        const created = match();
        const refs = towerPvpCombatRoster(created);
        assert.equal(refs.length, 4);
        assert.deepEqual(refs.map(ref => String(ref.teamId)), [
            'tower-pvp:amber', 'tower-pvp:amber', 'tower-pvp:violet', 'tower-pvp:violet',
        ]);
        assert.ok(refs.every(ref => String(ref.controllerId).startsWith('player:')));
    });

    it('returns a viewer-relative combat frame without mutating stored authority', () => {
        const created = match();
        created.combat.groundEffects.push({ id: 'zone', owner: 'p1', name: 'zone', tiles: [4], rounds: 1, tags: [] });
        created.combat.winner = 'enemy';
        const violet = projectTowerPvpMatchForViewer(created, 'bravo');
        assert.ok(violet);
        assert.deepEqual(violet.viewer, { teamId: 'violet', actorId: 'violet-0' });
        assert.equal(violet.combat.actors.find(actor => actor.ownerSlug === 'bravo')?.side, 'squad');
        assert.equal(violet.combat.actors.find(actor => actor.ownerSlug === 'alpha')?.side, 'enemy');
        assert.equal(violet.combat.groundEffects[0]?.owner, 'p2');
        assert.equal(violet.combat.winner, 'squad');
        assert.equal(created.combat.actors.find(actor => actor.ownerSlug === 'bravo')?.side, 'enemy');
        assert.equal(created.combat.groundEffects[0]?.owner, 'p1');
    });

    it('starts only when all four members are ready', () => {
        const created = match();
        created.roster.slice(0, 3).forEach(member => { member.ready = true; });
        assert.equal(activateReadyTowerPvpMatch(created, NOW + 1), false);
        assert.equal(created.combat.turnQueue.length, 0);
        created.roster[3]!.ready = true;
        assert.equal(activateReadyTowerPvpMatch(created, NOW + 2), true);
        assert.equal(created.status, 'active');
        assert.deepEqual(created.combat.turnQueue, ['amber-0', 'amber-1', 'violet-0', 'violet-1']);
        assert.equal(created.combat.turnStartedAt, NOW + 2);
    });

    it('gives one AFK pass then defeats only the repeat offender', () => {
        const created = match();
        created.roster.forEach(member => { member.ready = true; });
        activateReadyTowerPvpMatch(created, NOW);
        assert.equal(advanceExpiredTowerPvpTurn(created, NOW + TURN_AFK_MS + 1), true);
        assert.equal(created.afkStrikes.alpha, 1);
        assert.equal(created.combat.actors.find(actor => actor.ownerSlug === 'alpha')?.hp, 1_000);

        // Finish the other three human turns to return to alpha next round.
        endTurn(created.combat, TOWER_PVP_FLOOR);
        endTurn(created.combat, TOWER_PVP_FLOOR);
        endTurn(created.combat, TOWER_PVP_FLOOR);
        const secondTurn = NOW + TURN_AFK_MS + 10;
        created.combat.turnStartedAt = secondTurn;
        assert.equal(advanceExpiredTowerPvpTurn(created, secondTurn + TURN_AFK_MS + 1), true);
        assert.equal(created.afkStrikes.alpha, TOWER_PVP_AFK_STRIKES_TO_FORFEIT);
        assert.equal(created.combat.actors.find(actor => actor.ownerSlug === 'alpha')?.hp, 0);
        assert.equal(created.status, 'active', 'delta remains alive for amber');
    });

    it('adjudicates round-cap timeouts by remaining vitality instead of side bias', () => {
        const created = match();
        created.combat.status = 'done';
        created.combat.winner = 'enemy'; // engine default timeout side before projection
        created.combat.log.push('Round limit reached — floor failed.');
        for (const actor of created.combat.actors) actor.hp = actor.side === 'squad' ? 800 : 300;
        assert.equal(projectTowerPvpTerminal(created), true);
        assert.equal(created.winner, 'amber');
        assert.equal(created.combat.winner, 'squad');
        assert.match(created.combat.log.at(-1) ?? '', /remaining vitality/);
    });

    it('projects simultaneous defeat as a draw', () => {
        const created = match();
        created.combat.actors.forEach(actor => { actor.hp = 0; });
        created.combat.status = 'done';
        created.combat.winner = 'enemy';
        projectTowerPvpTerminal(created);
        assert.equal(created.winner, 'draw');
    });
});
