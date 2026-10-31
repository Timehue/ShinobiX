import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiFightStartErrorMessage } from './ai-fight-start-error';

test('invalid world starts explain recovery without raw server codes', () => {
    assert.match(aiFightStartErrorMessage(new Error('world-sector-mismatch'), 60), /sector 60.*Return to the map/);
    assert.match(aiFightStartErrorMessage(new Error('world-ambush-ineligible')), /no longer available.*progress has been retained/);
    assert.match(aiFightStartErrorMessage(new Error('world-chain-start-unconfirmed')), /Retry.*saved chain has been retained/);
    assert.equal(aiFightStartErrorMessage(new Error('You are in the hospital.')), 'You are in the hospital.');
});
