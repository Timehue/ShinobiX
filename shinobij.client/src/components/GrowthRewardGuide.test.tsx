import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GrowthRewardGuide } from './GrowthRewardGuide.js';
import { STAT_BUDGET_SPLIT_DAY } from '../../../shared/combat-growth-rules.js';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('reward guidance states both event-day limits and preserves the delayed-claim explanation', t => {
    const boundary = Date.parse(`${STAT_BUDGET_SPLIT_DAY}T00:00:00Z`);
    t.mock.timers.enable({ apis: ['Date'], now: boundary - 1 });
    const before = renderToStaticMarkup(<GrowthRewardGuide />);
    assert.match(before, /Rewards earned before November 2, 2026 \(00:00 UTC\) share one 60-point daily cap across missions, PvE and PvP/);
    assert.match(before, /From November 2, 2026 \(00:00 UTC\), hunt claims, field jobs and eligible AI wins share 120 stat points per UTC day/);
    assert.match(before, /From that date, eligible PvP wins have a separate 50-point daily cap/);
    assert.match(before, /Claiming an older reward later keeps its original day/);
    t.mock.timers.tick(2);
    assert.equal(renderToStaticMarkup(<GrowthRewardGuide />), before, 'both schedules remain visible across midnight and do not depend on the browser clock');
});

test('the written guide uses the server cutover date and explains the old shared budget', () => {
    const guide = readFileSync(new URL('../data/guides-content.json', import.meta.url), 'utf8');
    const date = new Date(`${STAT_BUDGET_SPLIT_DAY}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    assert.ok(guide.includes(`Rewards earned before ${date} at 00:00 UTC share one 60-point daily cap`));
    assert.ok(guide.includes("Claiming an older reward later keeps its original day's budget."));
    assert.ok(guide.includes('From that date, hunt claims, field jobs and eligible PvE wins share a daily budget of 120 stat points'));
});
