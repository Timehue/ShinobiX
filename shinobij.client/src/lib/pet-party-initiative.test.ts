import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pet, PetJutsu } from '../types/pet';
import { createLivePartyCinematicDuel, stepCinematicDuel } from './pet-duel-cinematic';
import { createLivePartyCinematicDuel as createServerParty, stepCinematicDuel as stepServer } from '../../../api/_pet-sim/pet-duel-cinematic';
import { DUEL_TPS } from './pet-duel-sim';

const source = (kind: PetJutsu['kind'], version: Pet['battleLoadoutVersion']): Pet => ({
    id: 'party-cover-fixture', name: 'Companion', rarity: 'standard', level: 75, xp: 0, maxLevel: 100,
    hp: 5000, attack: 100, defense: 40, speed: 40, element: 'None', battleLoadoutVersion: version,
    jutsus: [{ name: 'Earned Art', kind, power: 100, cooldown: 2, currentCooldown: 0,
        abilityId: 'species:earned-art:basic' }],
});

for (const [name, create, step] of [['client', createLivePartyCinematicDuel, stepCinematicDuel], ['server', createServerParty, stepServer]] as const) {
    const fixture = (version: Pet['battleLoadoutVersion'] = 'progression-v3', bothBlocked = false) => {
        const sim = create(source('damage', version), source('damage', version), source('damage', version),
            source(bothBlocked ? 'damage' : 'burn', version), 23, 1, 1, false, false, false, true, false);
        const owner = sim.fighters.find(fighter => fighter.id === 'player-0')!;
        const defeated = sim.fighters.find(fighter => fighter.id === 'player-1')!;
        const covered = sim.fighters.find(fighter => fighter.id === 'enemy-0')!;
        const recipient = sim.fighters.find(fighter => fighter.id === 'enemy-1')!;
        defeated.hp = 0; defeated.state = 'dead';
        for (const fighter of [owner, covered, recipient]) {
            fighter.state = 'idle'; fighter.routeActive = false; fighter.reposLeft = 0;
            fighter.abilities[0].cdLeft = 0; fighter.basicCdLeft = 0; fighter.dodgeCd = DUEL_TPS * 10;
        }
        // This cover pocket is captured from the representative team trace.
        owner.x = -13.515625; owner.y = 5.6875;
        covered.x = -10.12890625; covered.y = 7.1640625;
        recipient.x = -10.578125; recipient.y = 1.29296875;
        for (const fighter of [owner, covered]) { fighter.maxSpeed = 0; fighter.maxForce = 0; }
        if (bothBlocked) { recipient.maxSpeed = 0; recipient.maxForce = 0; }
        for (const fighter of [covered, recipient]) {
            const distance = Math.hypot(owner.x - fighter.x, owner.y - fighter.y);
            fighter.faceX = (owner.x - fighter.x) / distance; fighter.faceY = (owner.y - fighter.y) / distance;
        }
        const distance = Math.hypot(covered.x - owner.x, covered.y - owner.y);
        owner.faceX = (covered.x - owner.x) / distance; owner.faceY = (covered.y - owner.y) / distance;
        sim.laneInitiative = ['player', 'player', 'enemy', 'player'];
        return { sim, owner, recipient, covered };
    };
    const oscillate = (state: ReturnType<typeof fixture>, ticks: number) => {
        for (let tick = 0; tick < ticks; tick++) {
            // Prior-frame improvement alternates forever; cumulative progress does not.
            state.owner.x = -13.515625 + (tick % 2 ? .04 : -.04);
            state.owner.y = 5.6875;
            step(state.sim);
        }
    };
    test(name + ': a cover-oscillating party owner yields only after the non-closing window to a real clear angle', () => {
        for (const version of ['legacy-v1', 'progression-v3'] as const) {
            const state = fixture(version);
            oscillate(state, DUEL_TPS * 1.5);
            assert.equal(state.sim.events.some(event => event.actorId === state.recipient.id && event.type === 'windup'), false);
            oscillate(state, DUEL_TPS * 4);
            const attempts = state.sim.events.filter(event => event.actorId === state.recipient.id && event.type === 'windup');
            if (version === 'legacy-v1') assert.equal(attempts.length, 0, 'retained arbitration and detector stay unchanged');
            else {
                assert.ok(attempts.length > 0, 'the clear-angle recipient can spend the otherwise blocked beat');
                assert.ok(state.sim.events.some(event => event.actorId === state.recipient.id && event.type === 'hit'));
                assert.equal(state.sim.forcedEngage, false, 'the global counterplay override is not needed');
                assert.ok((state.owner.earnedApproachYieldedUntil ?? 0) > 0);
            }
        }
    });
    test(name + ': mutually blocked party fighters cannot exchange initiative frame by frame or hit through cover', () => {
        const state = fixture('progression-v3', true);
        const owners = new Set<string>();
        for (let tick = 0; tick < DUEL_TPS * 5; tick++) {
            oscillate(state, 1); owners.add(state.sim.laneInitiative[0]);
        }
        assert.deepEqual([...owners], ['player']);
        assert.equal(state.sim.events.some(event => event.type === 'hit'), false);
        assert.equal(state.sim.events.some(event => event.actorId === state.recipient.id && event.type === 'windup'), false);
    });
    test(name + ': an active action, exit, airborne attack, recovered angle, or cooldown keeps its party beat', () => {
        for (const guard of ['action', 'exit', 'projectile', 'recovered-angle', 'cooldown'] as const) {
            const state = fixture();
            state.sim.t = 1; // The waiting recipient is evaluated before the owner.
            state.owner.earnedApproachBlockedUntil = DUEL_TPS * 20;
            if (guard === 'action') { state.owner.state = 'windup'; state.owner.stateLeft = DUEL_TPS * 10; }
            if (guard === 'exit') { state.owner.routeActive = true; state.owner.reposLeft = DUEL_TPS * 10; }
            if (guard === 'projectile') state.sim.projectiles.push({ id: state.sim.nextProjId.n++, ownerId: state.owner.id,
                team: state.owner.team, targetId: state.covered.id, abilityIdx: 0, x: state.owner.x, y: state.owner.y,
                speed: 0, ttl: DUEL_TPS * 10, kind: 'damage' });
            if (guard === 'recovered-angle') {
                state.covered.x = state.recipient.x; state.covered.y = state.recipient.y;
                state.owner.abilities[0].cls = 'ranged'; state.owner.abilities[0].range = 8;
            }
            if (guard === 'cooldown') { state.owner.abilities[0].cdLeft = DUEL_TPS * 10; state.owner.basicCdLeft = DUEL_TPS * 10; }
            step(state.sim);
            assert.equal(state.sim.laneInitiative[0], 'player', guard);
            assert.equal(state.sim.events.some(event => event.actorId === state.recipient.id && event.type === 'windup'), false, guard);
        }
    });
}
