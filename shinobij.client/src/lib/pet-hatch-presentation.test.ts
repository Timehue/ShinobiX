import test from 'node:test';
import assert from 'node:assert/strict';
import type { Character } from '../types/character';
import { petHatchPresentationBlocked } from './pet-hatch-presentation';

const character = { name: 'Player', pets: [] } as unknown as Character;
test('ready eggs wait for combat and events, then reveal in the same lobby once the activity ends', () => {
    for (const screen of ['village', 'home', 'petArena', 'petColiseum', 'petLadder', 'missions', 'shinobiTiles'] as const) {
        assert.equal(petHatchPresentationBlocked(character, screen, true), true);
        assert.equal(petHatchPresentationBlocked(character, screen, false), false);
    }
    for (const screen of ['dungeon', 'hollowGateShrine', 'eventTiles', 'tilecardsDuel'] as const) {
        assert.equal(petHatchPresentationBlocked(character, screen, false), true);
    }
});
test('festival races and caravans finish before the reveal', () => {
    const racing = { ...character, sunscarRally: { current: { status: 'racing' } } } as unknown as Character;
    const ended = { ...character, sunscarRally: { current: { status: 'finished' } } } as unknown as Character;
    assert.equal(petHatchPresentationBlocked(racing, 'sunscarFestival', false), true);
    assert.equal(petHatchPresentationBlocked(ended, 'sunscarFestival', false), false);
});
