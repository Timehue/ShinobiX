import test from 'node:test';
import assert from 'node:assert/strict';
import { stopChronicleGame, STOP_DUELISTS } from './_life-chronicle-game.js';
import { CHRONICLE_RULES_VERSION } from '../../shared/chronicle-duel.js';
import { WORLD_HOUR_MS, WORLD_DAY_MS } from '../../shared/world-clock.js';
import { chronicleStopActors, chronicleStopPlan, chronicleStopWindow, nextChronicleStop, CHRONICLE_STOP_SEATS, CHRONICLE_STOP_PAINTING } from '../../shared/sector-chronicle-stop.js';
import { lifeActorPosition, lifeActivityAt } from '../../shared/sector-life-motion.js';
import { isWalkableTile, walkPath } from '../../shared/sector-walk-mask.js';
import { sectorExits } from '../../shared/sector-links.js';
import { lifeSceneView, lifeRestTile, parseLifeState } from '../../shared/sector-life.js';
import { addChronicleStop } from './_life-chronicle.js';

const start = 20 * WORLD_HOUR_MS, window = chronicleStopWindow(start)!, game = stopChronicleGame(window);
test('roadside matches use current Chronicle rules with stable real AI results and no fabricated winner', () => {
    for (const seed of [0, 4, 20, 24, 28, 44, 48, 52, 68]) {
        const current = stopChronicleGame(seed);
        assert.equal(current.rulesVersion, CHRONICLE_RULES_VERSION);
        assert(current.turns.length > 1 && current.turns.length <= 80);
        assert(current.finished, `seed ${seed}: ordinary legal starter mirrors finish`);
        assert(current.winner === undefined || (STOP_DUELISTS as readonly string[]).includes(current.winner));
        assert.deepEqual(stopChronicleGame(seed), current);
        for (const turn of current.turns) {
            assert((STOP_DUELISTS as readonly string[]).includes(turn.player));
            assert(turn.life.every(points => Number.isFinite(points) && points > 0));
            assert.deepEqual(Object.keys(turn).sort(), ['life', 'player', 'turn']);
        }
    }
});
test('a cold worker reconstructs the same shared match after cache eviction',()=>{
    const first=structuredClone(stopChronicleGame(window));
    for(const seed of [1000,1001,1002,1003,1004])stopChronicleGame(seed);
    assert.deepEqual(stopChronicleGame(window),first);
});
test('whole matches fit quiet shifts and every entry, seat and exit walk follows actual ground', () => {
    for (let hour = 0; hour < 24; hour++) assert.equal(chronicleStopWindow(hour * WORLD_HOUR_MS) !== undefined, [0, 4, 20].includes(hour));
    const state = nextChronicleStop(undefined, start, 'clear', game)!;
    const plan = chronicleStopPlan(state, game), actors = chronicleStopActors(state, game, plan.matchAt);
    assert.equal(actors.length, 2);
    for (const actor of actors) {
        assert.equal(actor.name, STOP_DUELISTS[Number(actor.id.slice(-1))]);
        assert(actor.hideAt! < start + WORLD_HOUR_MS, 'departure finishes before the next shift');
        assert(sectorExits(42).some(exit => exit.tile === actor.motion!.frames[0][1]));
        assert(sectorExits(42).some(exit => exit.tile === actor.motion!.frames.at(-1)![1]));
        for (let i = 1; i < actor.motion!.frames.length; i++) {
            const a = actor.motion!.frames[i - 1], b = actor.motion!.frames[i];
            assert(b[0] > a[0]); assert(walkPath(42, a[1], b[1])!.length <= 2);
        }
        assert(actor.motion!.frames.every(([,tile])=>![98,99,100,101,111,113].includes(tile)), 'players must leave room around the seller and tabletop');
        for (let elapsed = 0; elapsed < actor.hideAt! - start; elapsed += 500) {
            const pose = lifeActorPosition(42, actor, start + elapsed);
            assert(isWalkableTile(42, Math.round(pose.row) * 12 + Math.round(pose.col)));
        }
        const pose = lifeActorPosition(42, actor, plan.matchAt + 1000);
        assert.equal(pose.row * 12 + pose.col, actor.workTile);
    }
    assert.equal(chronicleStopActors(state, game, start + WORLD_HOUR_MS).length, 0);
});
test('rain closes once from the observed route, never restores a finished match, and does not paint cards before arrival', () => {
    const initial = nextChronicleStop(undefined, start, 'clear', game)!;
    const plan = chronicleStopPlan(initial, game);
    for (const at of [start + 5000, plan.matchAt + 1000]) {
        const before = chronicleStopActors(initial, game, at), closed = nextChronicleStop(initial, at, 'rain', game)!;
        assert.equal(closed.closedAt, at);
        assert.equal(nextChronicleStop(closed, at + 1000, 'clear', game), closed);
        for (const [index, actor] of before.entries()) {
            const pose = lifeActorPosition(42, actor, at);
            assert.equal(closed.origins![index], Math.round(pose.row) * 12 + Math.round(pose.col));
        }
        const view = lifeSceneView(42, parseLifeState(null, at), at, 'rain');
        const packed = addChronicleStop(view, closed, game, at);
        assert.equal(packed.painting, at < plan.matchAt - 6000 ? undefined : CHRONICLE_STOP_PAINTING);
        const leaving = addChronicleStop(view, closed, game, at + 6001);
        assert.equal(leaving.painting, undefined);
        assert(leaving.actors.filter(a => a.id.startsWith('chronicle:')).every(a => a.activity === 'Continuing along the road'));
    }
    assert.equal(nextChronicleStop(undefined, WORLD_DAY_MS + 5 * WORLD_HOUR_MS, 'clear', game), undefined);
});
test('malformed or obsolete cosmetic state cannot route a traveler through the table or seller',()=>{
    for(const raw of [{window:window-1},{window,closedAt:start-1,origins:[110,112]},{window,closedAt:start+1000,origins:[99,99]}, {window,closedAt:Number.NaN,origins:[110,112]}]) {
        assert.deepEqual(nextChronicleStop(raw,start+2000,'clear',game),{window});
    }
});
test('the real match determines turn and result speech, and the painted table only appears with both players there', () => {
    const state = nextChronicleStop(undefined, start, 'clear', game)!, plan = chronicleStopPlan(state, game);
    for (const [index, turn] of game.turns.entries()) {
        const at = plan.matchAt + index * plan.turnMs + 1;
        const view = addChronicleStop(lifeSceneView(42, parseLifeState(null, at), at, 'clear'), state, game, at);
        assert.equal(view.painting, CHRONICLE_STOP_PAINTING); assert.equal(view.paintingUntil, plan.cardsUntil);
        assert.equal(view.actors.filter(a => a.id.startsWith('chronicle:')).length, 2);
        assert(view.actors.length <= 5); assert(!view.actors.some(a => a.id.startsWith('crew:')));
        for (const actor of view.actors.filter(a => a.id.startsWith('chronicle:'))) {
            assert.equal(actor.activity, `Chronicle turn ${turn.turn}: ${turn.player}`);
            assert(actor.line.includes(`${turn.life[0]} and ${turn.life[1]}`));
            assert.equal(lifeActivityAt(actor, at).line, actor.line);
        }
    }
    const ended = chronicleStopActors(state, game, plan.packAt + 1);
    assert(ended.every(actor => game.winner ? actor.line.includes(`${game.winner} won`) : actor.line.includes('draw')));
    // A safety stop or interrupted exhibition never claims a win or a draw.
    assert(chronicleStopActors(state, { ...game, finished: false, winner: undefined }, plan.packAt + 1).every(actor => !/won|draw/.test(actor.line)));
});
test('regular travelers reserve both mats, and a tea customer walks aside and returns after the match', () => {
    assert.equal(new Set(Array.from({length:6},(_,i)=>lifeRestTile(42,i))).size,6,'reserved game approaches must leave enough separate rest points');
    for (let i = 0; i < 6; i++) assert(!(CHRONICLE_STOP_SEATS as readonly number[]).includes(lifeRestTile(42, i)));
    const state = nextChronicleStop(undefined, start, 'clear', game)!, plan = chronicleStopPlan(state, game);
    const at = plan.matchAt + 10_000, base = lifeSceneView(42, { ...parseLifeState(null, at), step: 3, updatedAt: start - 1000 }, at, 'clear');
    const view = addChronicleStop(base, state, game, at), visitor = view.actors.find(a => a.id === 'visitor:42')!;
    assert(visitor.motion); assert.equal(visitor.motion.frames[0][1], 110);
    assert.equal(visitor.motion.frames.at(-1)![1], 110);
    const pose = lifeActorPosition(42, visitor, at);
    assert(!(CHRONICLE_STOP_SEATS as readonly number[]).includes(pose.row * 12 + pose.col));
    for (let i = 1; i < visitor.motion.frames.length; i++) assert(walkPath(42, visitor.motion.frames[i - 1][1], visitor.motion.frames[i][1])!.length <= 2);
    const newCustomer = addChronicleStop({ ...base, updatedAt: at - 1000 }, state, game, at).actors.find(a => a.id === 'visitor:42')!;
    assert(!(CHRONICLE_STOP_SEATS as readonly number[]).includes(newCustomer.motion!.frames[0][1]), 'a newly arrived customer starts away from occupied mats');
});
