import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { Character } from '../types/character';
import { aiFightExitScreen, aiFightNonWinMessage } from './ai-fight-result';

test('a knockout returns to the hospital; a surviving or recovered fighter keeps the original destination', () => {
    assert.equal(aiFightExitScreen(true, 'worldMap'), 'hospital');
    assert.equal(aiFightExitScreen(false, 'worldMap'), 'worldMap');
    assert.equal(aiFightExitScreen(false, 'dungeon'), 'dungeon');
    assert.equal(aiFightExitScreen(false), undefined);
});

test('the result explains the confirmed consequence and never invents hospitalization', () => {
    const admitted = { hp: 0, hospitalized: true } as Character;
    const survivor = { hp: 42, hospitalized: false } as Character;
    assert.match(aiFightNonWinMessage('settled', admitted, false), /HP reached zero.*hospital/);
    assert.match(aiFightNonWinMessage('settled', survivor, false), /42 HP remaining/);
    assert.doesNotMatch(aiFightNonWinMessage('settled', survivor, true), /hospital/);
    assert.match(aiFightNonWinMessage('pending', admitted, false), /Confirming/);
    assert.match(aiFightNonWinMessage('failed', admitted, false), /Retry/);
    assert.doesNotMatch(aiFightNonWinMessage('failed', admitted, false), /brought to the hospital/);
});

test('a lost spar says it was a spar and that it cost nothing, never "you left the fight"', () => {
    const sparred = { hp: 600, hospitalized: false } as Character;
    const lost = aiFightNonWinMessage('settled', sparred, false, true);
    assert.match(lost, /lost this spar/);
    assert.match(lost, /never sends anyone to the hospital/);
    assert.match(lost, /600 HP/);
    assert.doesNotMatch(lost, /left the fight/);
    assert.match(aiFightNonWinMessage('settled', sparred, true, true), /spar ended in a draw/);
    // The server's answer still wins: an admission (from anything) is reported as one.
    assert.match(aiFightNonWinMessage('settled', { hp: 0, hospitalized: true } as Character, false, true), /brought to the hospital/);
});
