import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { Character } from '../types/character';
import { aiFightBrokeAway, aiFightExitScreen, aiFightHistoryOutcome, aiFightLeftLabel, aiFightNonWinMessage, aiFightWinRewardText } from './ai-fight-result';
import type { AiFightSettleResult } from './ai-fight-settle';

test('leaving a fight alive never reads as a knockout', () => {
    assert.equal(aiFightLeftLabel('escaped'), 'Escaped');
    assert.equal(aiFightLeftLabel('abandoned'), 'Retreated');
    assert.equal(aiFightLeftLabel('lapsed'), 'Fight expired');
    assert.equal(aiFightLeftLabel('knockout'), null);
    assert.equal(aiFightLeftLabel(undefined), null);
    assert.equal(aiFightLeftLabel('escaped', true), null, 'an escape that cost the last HP is still a defeat');

    const survivor = { hp: 9, hospitalized: false } as Character;
    assert.equal(aiFightNonWinMessage('settled', survivor, false, false, 'escaped'), 'You escaped with 9 HP. No reward was earned.');
    assert.equal(aiFightNonWinMessage('settled', survivor, false, false, 'abandoned'), 'You left the fight with 9 HP. No reward was earned.');
    assert.match(aiFightNonWinMessage('settled', { hp: 0, hospitalized: true } as Character, false, false, 'escaped'), /hospital/);

    assert.equal(aiFightHistoryOutcome('enemy', 'escaped'), 'flee');
    assert.equal(aiFightHistoryOutcome('enemy', 'abandoned'), 'flee');
    assert.equal(aiFightHistoryOutcome('enemy', 'knockout'), 'loss');
    assert.equal(aiFightHistoryOutcome('squad', undefined), 'win');
    assert.equal(aiFightHistoryOutcome('draw', undefined), 'draw');

    assert.equal(aiFightBrokeAway({ outcome: 'loss', terminalReason: 'escaped', character: survivor }), true);
    assert.equal(aiFightBrokeAway({ outcome: 'forfeit', character: survivor }), true);
    assert.equal(aiFightBrokeAway({ outcome: 'loss', terminalReason: 'knockout', character: survivor }), false);
    assert.equal(aiFightBrokeAway({ outcome: 'loss', terminalReason: 'escaped', character: { hospitalized: true } as Character }), false);
    assert.equal(aiFightBrokeAway({ outcome: 'win', terminalReason: 'escaped' }), false);
});

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

test('an escape says the player got away, including when the escape cost their last HP', () => {
    const standing = { hp: 90, hospitalized: false } as Character;
    assert.equal(aiFightNonWinMessage('settled', standing, false, false, 'escaped'), 'You escaped with 90 HP. No reward was earned.');
    assert.match(aiFightNonWinMessage('settled', standing, false, true, 'escaped'), /You left this spar.*keep your 90 HP/);
    const spent = aiFightNonWinMessage('settled', { hp: 0, hospitalized: true } as Character, false, false, 'escaped');
    assert.match(spent, /You got away, but the escape took your last HP.*hospital/);
    assert.doesNotMatch(aiFightNonWinMessage('settled', standing, false, false, 'escaped'), /did not win/);
});

test('a lost spar says it was a spar and that it cost nothing, never "you left the fight"', () => {
    const sparred = { hp: 600, hospitalized: false } as Character;
    const lost = aiFightNonWinMessage('settled', sparred, false, true, 'knockout');
    assert.match(lost, /lost this spar/);
    assert.match(lost, /never sends anyone to the hospital/);
    assert.match(lost, /600 HP/);
    assert.doesNotMatch(lost, /left the fight/);
    assert.match(aiFightNonWinMessage('settled', sparred, true, true), /spar ended in a draw/);
    // The server's answer still wins: an admission (from anything) is reported as one.
    assert.match(aiFightNonWinMessage('settled', { hp: 0, hospitalized: true } as Character, false, true), /brought to the hospital/);
});

test('an abandoned spar remains a retreat while a real knockout keeps defeat presentation', () => {
    const sparred = { hp: 600, hospitalized: false } as Character;
    assert.equal(aiFightLeftLabel('abandoned', false), 'Retreated');
    assert.equal(aiFightNonWinMessage('settled', sparred, false, true, 'abandoned'),
        'You left the fight with 600 HP. No reward was earned.');
    assert.equal(aiFightLeftLabel('knockout', false), null);
    assert.match(aiFightNonWinMessage('settled', sparred, false, true, 'knockout'), /lost this spar/);
    assert.equal(aiFightLeftLabel('abandoned', true), null);
    assert.match(aiFightNonWinMessage('settled', { hp: 0, hospitalized: true } as Character, false, false, 'knockout'),
        /HP reached zero.*hospital/);
});
