import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMBAT_RUNTIME_INVENTORY } from './combat-runtime-inventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');
const clientSource = (file) => readFileSync(join(ROOT, 'shinobij.client', 'src', file), 'utf8');

function registered(route) {
  return server.includes(`route('${route}'`) || server.includes(`route(\"${route}\"`);
}

describe('machine-checkable combat runtime inventory', () => {
  it('tracks every owner-required player-facing combat mode', () => {
    const required = [
      'Casual PvP', 'Ranked PvP', 'Player challenges', 'Generic catalog AI',
      'Temporary or creator AI', 'Hunts and apex hunts', 'Explore ambushes',
      'Village guards and wanderers', 'E/D combat missions', 'C/B/A/S combat missions',
      'Academy spar', 'Story battles and bosses', 'Weekly Boss', 'Endless',
      'Hollow Gate shinobi', 'Hollow Gate pet', 'Battle Towers', 'Endless Spire',
      'Clan Boss', 'Anbu infiltration', 'Sector war shinobi combat',
      'Pet Arena and Coliseum', 'Card Clash',
    ];
    const modes = new Set(COMBAT_RUNTIME_INVENTORY.map((row) => row.mode));
    assert.deepEqual(required.filter((mode) => !modes.has(mode)), []);
  });

  it('only calls routes that the real Express server registers', () => {
    const missing = [];
    for (const row of COMBAT_RUNTIME_INVENTORY) {
      for (const route of [row.startRoute, row.actionRoute, row.stateRoute].filter(Boolean)) {
        if (!registered(route)) missing.push(`${row.mode}: ${route}`);
      }
    }
    assert.deepEqual(missing, [], `Inventory claims unreachable route(s):\n${missing.join('\n')}`);
  });

  it('imports every claimed start handler and has a real client caller', () => {
    const failures = [];
    for (const row of COMBAT_RUNTIME_INVENTORY) {
      if (!server.includes(`./api/${row.handler}.js`)) failures.push(`${row.mode}: missing handler import ${row.handler}`);
      const sources = row.client.map((file) => ({ file, source: clientSource(file) }));
      if (row.requiresStartCaller !== false && !sources.some(({ source }) => source.includes(`/api${row.startRoute}`))) {
        failures.push(`${row.mode}: no listed client calls /api${row.startRoute}`);
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('does not mark a migration complete because a dead route exists', () => {
    const failures = [];
    for (const row of COMBAT_RUNTIME_INVENTORY.filter((entry) => entry.status === 'complete')) {
      assert.equal(row.current, row.target, `${row.mode}: complete row must run on its target runtime`);
      for (const route of [row.actionRoute, row.stateRoute].filter(Boolean)) {
        const marker = `/api${route}`;
        if (!row.client.some((file) => clientSource(file).includes(marker))) failures.push(`${row.mode}: no active client caller for ${marker}`);
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });
});
