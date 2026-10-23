import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { Character } from '../types/character';
import { aiFightExitScreen, aiFightNonWinMessage, aiFightWinRewardText } from './ai-fight-result';
import type { AiFightSettleResult } from './ai-fight-settle';

test('zero-ryo receipts preserve stat growth and distinguish a limit from practice', () => {
    const receipt: AiFightSettleResult = { settled: true, outcome: 'win', ryo: 0, statPoints: 2,
        capped: true, replayed: false, character: null, fetchMissionsCredited: [] };
    const growthOnly = aiFightWinRewardText(receipt, false, false);
    assert.match(growthOnly, /\+2 stat points/);
    assert.match(growthOnly, /prevented a ryo payout/);
    assert.doesNotMatch(growthOnly, /Practice|no rewards/);
    assert.match(aiFightWinRewardText({ ...receipt, ryo: 25 }, false, false), /\+25 ryo.*reduced this payout/);
    const noGrowth = { ...receipt, statPoints: 0 };
    assert.doesNotMatch(aiFightWinRewardText(noGrowth, false, false), /Practice/);
    assert.match(aiFightWinRewardText({ ...noGrowth, capped: false }, true, false), /Practice bout/);
    assert.match(aiFightWinRewardText({ ...noGrowth, replayed: true }, false, true), /already collected/);
    assert.doesNotMatch(aiFightWinRewardText({ ...receipt, settled: false }, false, false), /\+2/);
});

test('a win states the shared daily stat-point budget, so a spent budget explains zero stat points', () => {
    const receipt: AiFightSettleResult = { settled: true, outcome: 'win', ryo: 120, statPoints: 0,
        statBudget: { day: '2026-10-22', spent: 60, cap: 60 }, capped: false, replayed: false, character: null, fetchMissionsCredited: [] };
    assert.equal(aiFightWinRewardText(receipt, false, false), '+120 ryo · Stat points today: 60 / 60');
    assert.match(aiFightWinRewardText({ ...receipt, ryo: 0 }, false, false), /^Stat points today: 60 \/ 60$/);
    assert.match(aiFightWinRewardText({ ...receipt, ryo: 0 }, true, false), /Practice bout/, 'a spar never shows the budget');
});

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
