import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMBAT_RUNTIME_INVENTORY,
  TERMINAL_MIGRATION_STATUSES,
  WORLD_MAP_AI_FLOW_CONTRACTS,
} from './combat-runtime-inventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');
const sharedWorldAiFight = readFileSync(join(ROOT, 'shared', 'world-ai-fight.ts'), 'utf8');
const clientSource = (file) => readFileSync(join(ROOT, 'shinobij.client', 'src', file), 'utf8');

function registered(route) {
  return server.includes(`route('${route}'`) || server.includes(`route(\"${route}\"`);
}

describe('machine-checkable combat runtime inventory', () => {
  it('tracks every owner-required player-facing combat mode', () => {
    const required = [
      'Casual PvP', 'Ranked PvP', 'Player challenges', 'Generic catalog AI',
      'Temporary or creator AI', 'World-context hunt trails',
      'World-context wanderers', 'Generic Apex hunts', 'Generic explore ambushes',
      'Generic village-guard raids', 'Dungeon Warden', 'Creator-event practice fights',
      'E/D combat missions', 'C/B/A/S combat missions',
      'Academy spar', 'Story battles and bosses', 'Weekly Boss', 'Endless',
      'Hollow Gate shinobi', 'Hollow Gate pet', 'Battle Towers', 'Endless Spire',
      'Clan Boss', 'Anbu infiltration', 'Sector war shinobi combat',
      'Sector war card combat', 'Pet Arena and Coliseum', 'Card Clash',
    ];
    const modes = COMBAT_RUNTIME_INVENTORY.map((row) => row.mode);
    assert.equal(new Set(modes).size, modes.length, 'Inventory mode names must be unique.');
    assert.deepEqual([...modes].sort(), [...required].sort());
  });

  it('uses explicit terminal statuses instead of stale partial labels', () => {
    const allowed = new Set(['keep', ...TERMINAL_MIGRATION_STATUSES]);
    const failures = COMBAT_RUNTIME_INVENTORY
      .filter((row) => !allowed.has(row.status))
      .map((row) => `${row.mode}: ${row.status}`);
    assert.deepEqual(failures, [], `Unknown or partial migration status(es):\n${failures.join('\n')}`);
  });

  it('only calls routes that the real Express server registers', () => {
    const missing = [];
    for (const row of COMBAT_RUNTIME_INVENTORY) {
      for (const route of [row.startRoute, row.actionRoute, row.stateRoute, row.settlementRoute, row.lifecycleRoute].filter(Boolean)) {
        if (!registered(route)) missing.push(`${row.mode}: ${route}`);
      }
    }
    assert.deepEqual(missing, [], `Inventory claims unreachable route(s):\n${missing.join('\n')}`);
  });

  it('imports every claimed start handler and has a real client caller', () => {
    const failures = [];
    for (const row of COMBAT_RUNTIME_INVENTORY) {
      for (const handler of [row.handler, row.settlementHandler, row.lifecycleHandler].filter(Boolean)) {
        if (!server.includes(`./api/${handler}.js`)) failures.push(`${row.mode}: missing handler import ${handler}`);
      }
      const sources = row.client.map((file) => ({ file, source: clientSource(file) }));
      if (row.requiresStartCaller !== false && !sources.some(({ source }) => source.includes(`/api${row.startRoute}`))) {
        failures.push(`${row.mode}: no listed client calls /api${row.startRoute}`);
      }
      for (const route of [row.settlementRoute, row.lifecycleRoute].filter(Boolean)) {
        if (!sources.some(({ source }) => source.includes(`/api${route}`))) failures.push(`${row.mode}: no listed client calls /api${route}`);
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('does not mark a terminal migration because a dead route exists', () => {
    const failures = [];
    const terminal = new Set(TERMINAL_MIGRATION_STATUSES);
    for (const row of COMBAT_RUNTIME_INVENTORY.filter((entry) => terminal.has(entry.status))) {
      assert.equal(row.current, row.target, `${row.mode}: terminal row must run on its target runtime`);
      for (const route of [row.actionRoute, row.stateRoute].filter(Boolean)) {
        const marker = `/api${route}`;
        if (!row.client.some((file) => clientSource(file).includes(marker))) failures.push(`${row.mode}: no active client caller for ${marker}`);
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('keeps World-context and generic World Map AI on explicit Solo-PvE contracts', () => {
    assert.ok(Object.isFrozen(WORLD_MAP_AI_FLOW_CONTRACTS));
    assert.ok(Object.isFrozen(WORLD_MAP_AI_FLOW_CONTRACTS.worldContext));
    assert.ok(Object.isFrozen(WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog));

    const expected = new Map([
      ['World-context hunt trails', {
        contract: WORLD_MAP_AI_FLOW_CONTRACTS.worldContext,
        worldKinds: ['hunt-pack', 'hunt-target'],
        lifecycleRoute: '/missions/hunt-trail',
        lifecycleHandler: 'missions/hunt-trail',
        requiredClients: ['screens/HunterBoard.tsx', 'screens/WorldMap.tsx', 'lib/world-hunt-api.ts'],
      }],
      ['World-context wanderers', {
        contract: WORLD_MAP_AI_FLOW_CONTRACTS.worldContext,
        worldKinds: ['wanderer', 'wanderer-ambush', 'patrol', 'bounty-hunter', 'questbook-boss', 'story-reckoning'],
        requiredClients: ['screens/WorldMap.tsx'],
      }],
      ['Generic Apex hunts', {
        contract: WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog,
        catalogSelector: 'apex-ai-*',
        requiredClients: ['screens/HunterBoard.tsx'],
      }],
      ['Generic explore ambushes', {
        contract: WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog,
        battleKind: 'explore',
        requiredClients: ['screens/WorldMap.tsx'],
      }],
      ['Generic village-guard raids', {
        contract: WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog,
        battleKind: 'raidAi',
        requiredClients: ['screens/WorldMap.tsx'],
      }],
    ]);

    for (const [mode, descriptor] of expected) {
      const row = COMBAT_RUNTIME_INVENTORY.find((entry) => entry.mode === mode);
      assert.ok(row, `${mode}: missing inventory row`);
      assert.equal(row.startRoute, '/missions/ai-fight-start', `${mode}: wrong start route`);
      assert.equal(row.actionRoute, '/solo-pve/action', `${mode}: wrong action route`);
      assert.equal(row.stateRoute, '/solo-pve/state', `${mode}: wrong state route`);
      assert.equal(row.current, 'solo-pve', `${mode}: wrong current runtime`);
      assert.equal(row.target, 'solo-pve', `${mode}: wrong target runtime`);
      assert.equal(row.status, 'migrated', `${mode}: migration is not terminal`);
      for (const [key, value] of Object.entries(descriptor.contract)) {
        assert.equal(row[key], value, `${mode}: wrong ${key}`);
      }
      if (descriptor.worldKinds) assert.deepEqual(row.worldKinds, descriptor.worldKinds, `${mode}: wrong World kind coverage`);
      if (descriptor.catalogSelector) assert.equal(row.catalogSelector, descriptor.catalogSelector, `${mode}: wrong catalog selector`);
      if (descriptor.battleKind) assert.equal(row.battleKind, descriptor.battleKind, `${mode}: wrong battle kind`);
      if (descriptor.lifecycleRoute) assert.equal(row.lifecycleRoute, descriptor.lifecycleRoute, `${mode}: wrong lifecycle route`);
      if (descriptor.lifecycleHandler) assert.equal(row.lifecycleHandler, descriptor.lifecycleHandler, `${mode}: wrong lifecycle handler`);
      for (const client of descriptor.requiredClients) assert.ok(row.client.includes(client), `${mode}: missing ${client}`);
    }

    const inventoriedWorldKinds = COMBAT_RUNTIME_INVENTORY
      .filter((row) => row.flowDescriptor === 'world-context')
      .flatMap((row) => row.worldKinds ?? [])
      .sort();
    const sourceBlock = sharedWorldAiFight.match(/WORLD_AI_FIGHT_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
    assert.ok(sourceBlock, 'shared World AI kind contract is unreadable');
    const sourceWorldKinds = [...sourceBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
    assert.deepEqual(inventoriedWorldKinds, sourceWorldKinds, 'Inventory must classify every shared World AI kind exactly once.');
  });

  it('pins Dungeon Warden and creator-event fights to sealed Solo-PvE', () => {
    const app = clientSource('App.tsx');
    const aiFightStart = readFileSync(join(ROOT, 'api', 'missions', 'ai-fight-start.ts'), 'utf8');
    const genericAuthority = readFileSync(join(ROOT, 'api', 'missions', '_generic-ai-fight-authority.ts'), 'utf8');
    const aiFightOutcome = readFileSync(join(ROOT, 'api', 'missions', '_ai-fight-outcome.ts'), 'utf8');
    const reportAiFight = readFileSync(join(ROOT, 'api', 'missions', 'report-ai-fight.ts'), 'utf8');
    const dungeon = COMBAT_RUNTIME_INVENTORY.find((entry) => entry.mode === 'Dungeon Warden');
    const creator = COMBAT_RUNTIME_INVENTORY.find((entry) => entry.mode === 'Creator-event practice fights');

    for (const row of [dungeon, creator]) {
      assert.ok(row, 'required sealed fight inventory row is missing');
      assert.equal(row.startRoute, '/missions/ai-fight-start');
      assert.equal(row.actionRoute, '/solo-pve/action');
      assert.equal(row.stateRoute, '/solo-pve/state');
      assert.equal(row.current, 'solo-pve');
      assert.equal(row.target, 'solo-pve');
      assert.equal(row.status, 'migrated');
    }
    assert.equal(dungeon.battleKind, 'dungeon');
    assert.equal(dungeon.startProof, 'dungeonRunToken');
    assert.match(app, /battleKind:\s*["']dungeon["']/);
    assert.match(app, /dungeonRunToken/);
    assert.match(genericAuthority, /battleKind\s*===\s*['"]dungeon['"]/);
    assert.match(aiFightStart, /dungeonRunToken:\s*genericAuthority\.dungeonRunToken/);
    assert.match(reportAiFight, /sealedBattleKind\s*===\s*['"]dungeon['"]/);

    assert.equal(creator.battleKind, 'practice');
    assert.equal(creator.rewardPolicy, 'none');
    assert.match(app, /battleKind:\s*["']practice["']/);
    assert.match(genericAuthority, /battleKind\s*===\s*['"]practice['"]/);
    assert.match(aiFightOutcome, /battleKind\s*!==\s*['"]practice['"]\s*&&\s*battleKind\s*!==\s*['"]dungeon['"]/);
    assert.match(reportAiFight, /aiFightPaysReward\(outcome,\s*sealedBattleKind\)/);
  });
});
