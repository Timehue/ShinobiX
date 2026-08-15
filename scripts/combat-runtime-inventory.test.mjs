import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INTENTIONAL_ENGINE_SEPARATIONS,
  RUNTIME_AUTHORITY_ENGINES,
  RUNTIME_COMPATIBILITY_KEYS,
  RUNTIME_MODE_REGISTRY,
  RUNTIME_ORCHESTRATORS,
  runtimeModeById,
} from '../shared/runtime-mode-registry.ts';
import {
  RUNTIME_MODE_INVENTORY,
  TERMINAL_MIGRATION_STATUSES,
  WORLD_MAP_AI_FLOW_CONTRACTS,
  projectRuntimeMode,
} from './combat-runtime-inventory.mjs';
import {
  COMBAT_ROUTE_CENSUS,
  EXPECTED_RUNTIME_CAPABILITY_BINDINGS,
  EXPECTED_RUNTIME_MODE_FACTS,
  EXPECTED_RUNTIME_MODE_METADATA,
  EXPECTED_RUNTIME_MODE_CONTRACTS,
} from './combat-runtime-inventory.fixture.mjs';
import { renderRuntimeModeDocs } from './generate-runtime-mode-docs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');
const sharedWorldAiFight = readFileSync(join(ROOT, 'shared', 'world-ai-fight.ts'), 'utf8');
const clientCache = new Map();

const clientSource = (file) => {
  if (!clientCache.has(file)) clientCache.set(file, readFileSync(join(ROOT, 'shinobij.client', 'src', file), 'utf8'));
  return clientCache.get(file);
};

const handlerImports = new Map(
  [...server.matchAll(/import\s+(\w+)\s+from\s+['"]\.\/api\/([^'"]+)\.js['"]/g)]
    .map((match) => [match[1], match[2]]),
);
const routeMounts = new Map(
  [...server.matchAll(/route\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g)]
    .map((match) => [match[1], match[2]]),
);

const expectedContractById = new Map(EXPECTED_RUNTIME_MODE_CONTRACTS.map((contract) => [contract.id, contract]));
const expectedAssignedRoutePaths = new Set(
  EXPECTED_RUNTIME_MODE_CONTRACTS.flatMap((contract) => contract.routeSignatures)
    .map((signature) => signature.slice(0, signature.indexOf(':'))),
);

const isCombatCensusPath = (path) => COMBAT_ROUTE_CENSUS.exactPaths.includes(path)
  || COMBAT_ROUTE_CENSUS.prefixes.some((prefix) => path.startsWith(prefix));

const sourceFilesUnder = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(path);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });

const clientRouteLiterals = new Set(
  sourceFilesUnder(join(ROOT, 'shinobij.client', 'src'))
    .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/['"`](\/api\/[a-z0-9][a-z0-9_./:-]*)(?=[?'"`]|\$\{)/gi)])
    .map((match) => match[1].slice('/api'.length))
    .filter((path) => !path.endsWith('/')), // dynamic prefixes are checked from the Express side of the census
);

const assertDeepFrozen = (value, label, seen = new Set()) => {
  if (value == null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.ok(Object.isFrozen(value), `${label}: nested projection value must be frozen`);
  for (const [key, nested] of Object.entries(value)) assertDeepFrozen(nested, `${label}.${key}`, seen);
};

const routeSignatures = (mode) => mode.routes
  .map((route) => `${route.path}:${[...route.roles].sort().join('+')}`)
  .sort();

const transportSignatures = (mode) => (mode.transports ?? [])
  .map((transport) => [
    transport.kind,
    transport.channel,
    transport.serverHandler,
    transport.clientAdapter,
    [...transport.roles].sort().join('+'),
    transport.persistence,
  ].join(':'))
  .sort();

describe('executable multi-engine runtime registry', () => {
  it('keeps the generated runtime-mode document deterministic and complete', () => {
    const rendered = renderRuntimeModeDocs();
    assert.equal(rendered, renderRuntimeModeDocs(), 'renderer must be deterministic');
    assert.equal(
      readFileSync(join(ROOT, 'docs', 'generated', 'runtime-mode-registry.md'), 'utf8'),
      rendered,
      'generated registry doc is stale; run npm run generate:runtime-mode-docs',
    );
    assert.ok(rendered.endsWith('\n'));
    assert.equal(rendered.includes('\r'), false);

    for (const mode of RUNTIME_MODE_REGISTRY) {
      assert.equal(
        rendered.split(`<code>${mode.id}</code><br>${mode.label}`).length - 1,
        1,
        `${mode.id}: expected exactly one authority overview row`,
      );
      for (const route of mode.routes) {
        const callerRequirement = route.clientCallerRequired === false
          ? 'server-internal'
          : 'client caller required';
        assert.ok(
          rendered.includes(`<code>${route.roles.join(', ')}</code> <code>${route.path}</code> → <code>${route.handler}</code> (${callerRequirement})`),
          `${mode.id}: missing generated route tuple for ${route.path}`,
        );
      }
      for (const transport of mode.transports ?? []) {
        assert.ok(
          rendered.includes(`<code>${transport.roles.join(', ')}</code> <code>${transport.kind}</code> <code>${transport.channel}</code> → <code>${transport.serverHandler}</code> / <code>${transport.clientAdapter}</code> (${transport.persistence})`),
          `${mode.id}: missing generated transport tuple for ${transport.channel}`,
        );
      }
      for (const entry of mode.clientEntries) {
        assert.ok(rendered.includes(`<code>${entry}</code>`), `${mode.id}: missing generated client entry ${entry}`);
      }
      if (mode.status !== 'match') {
        assert.ok(rendered.includes(mode.statusDetail), `${mode.id}: missing generated status detail`);
      }
    }
  });

  it('tracks every verified mode with unique stable ids and labels', () => {
    const ids = RUNTIME_MODE_REGISTRY.map((mode) => mode.id);
    const labels = RUNTIME_MODE_REGISTRY.map((mode) => mode.label);
    const expectedIds = EXPECTED_RUNTIME_MODE_CONTRACTS.map((contract) => contract.id);
    const expectedFactIds = Object.keys(EXPECTED_RUNTIME_MODE_FACTS);
    const expectedMetadataIds = Object.keys(EXPECTED_RUNTIME_MODE_METADATA);
    assert.equal(new Set(ids).size, ids.length, 'Runtime mode ids must be unique.');
    assert.equal(new Set(labels).size, labels.length, 'Runtime mode labels must be unique.');
    assert.equal(new Set(expectedIds).size, expectedIds.length, 'Independent expected mode ids must be unique.');
    assert.deepEqual([...ids].sort(), [...expectedIds].sort());
    assert.deepEqual([...ids].sort(), [...expectedFactIds].sort(), 'Every mode needs an independent semantic fact row.');
    assert.deepEqual([...ids].sort(), [...expectedMetadataIds].sort(), 'Every mode needs independent category/replay/orchestration facts.');
    assert.ok(Object.isFrozen(RUNTIME_MODE_REGISTRY));
    for (const mode of RUNTIME_MODE_REGISTRY) {
      assert.equal(runtimeModeById(mode.id), mode);
      assertDeepFrozen(mode, mode.id);
      assert.deepEqual(
        routeSignatures(mode),
        [...expectedContractById.get(mode.id).routeSignatures].sort(),
        `${mode.id}: mounted route/action/settlement contract drifted`,
      );
      assert.deepEqual(
        transportSignatures(mode),
        [...expectedContractById.get(mode.id).transportSignatures].sort(),
        `${mode.id}: non-HTTP transport contract drifted`,
      );
    }
  });

  it('independently pins authority, intended owner, participants, reward policy, and status for every mode', () => {
    for (const mode of RUNTIME_MODE_REGISTRY) {
      assert.deepEqual(
        {
          authorityEngine: mode.authorityEngine,
          intendedAuthorityEngine: mode.intendedAuthorityEngine ?? null,
          participantModel: mode.participantModel,
          rewardPolicy: mode.rewardPolicy,
          status: mode.status,
        },
        EXPECTED_RUNTIME_MODE_FACTS[mode.id],
        `${mode.id}: semantic ownership fact drifted`,
      );
    }
  });

  it('independently pins operational capability bindings', () => {
    const actual = Object.fromEntries(
      RUNTIME_MODE_REGISTRY
        .filter((mode) => mode.capabilityKey)
        .map((mode) => [mode.id, mode.capabilityKey]),
    );
    assert.deepEqual(actual, EXPECTED_RUNTIME_CAPABILITY_BINDINGS);
  });

  it('independently pins category, replay, and orchestration ownership', () => {
    for (const mode of RUNTIME_MODE_REGISTRY) {
      assert.deepEqual(
        {
          category: mode.category,
          replayKind: mode.replayKind,
          orchestrationOwner: mode.orchestrationOwner ?? null,
        },
        EXPECTED_RUNTIME_MODE_METADATA[mode.id],
        `${mode.id}: category/replay/orchestration fact drifted`,
      );
    }
  });

  it('declares participant, reward, settlement, replay, and truthful match status for every mode', () => {
    const statuses = new Set();
    const participantModels = new Set(['solo', 'two-player', 'party', 'solo-or-party', 'headless', 'asynchronous-defense']);
    const rewardPolicies = new Set(['none', 'server-progression', 'server-settled', 'server-capped', 'parent-mode-settlement']);
    const routeRoles = new Set(['start', 'action', 'state', 'settlement', 'lifecycle', 'catalog', 'recovery', 'leaderboard', 'communication', 'observation', 'record']);
    const failures = [];

    for (const mode of RUNTIME_MODE_REGISTRY) {
      statuses.add(mode.status);
      if (!participantModels.has(mode.participantModel)) failures.push(`${mode.id}: invalid participant model ${mode.participantModel}`);
      if (!rewardPolicies.has(mode.rewardPolicy)) failures.push(`${mode.id}: invalid reward policy ${mode.rewardPolicy}`);
      if (!mode.replayKind) failures.push(`${mode.id}: missing replay/record declaration`);
      if (mode.rewardPolicy !== 'none' && !mode.routes.some((route) => route.roles.includes('settlement'))) {
        failures.push(`${mode.id}: reward-bearing mode has no settlement route`);
      }
      for (const route of mode.routes) {
        for (const role of route.roles) {
          if (!routeRoles.has(role)) failures.push(`${mode.id}: ${route.path} has invalid route role ${role}`);
        }
      }
      for (const transport of mode.transports ?? []) {
        if (transport.kind !== 'socket.io') failures.push(`${mode.id}: invalid transport kind ${transport.kind}`);
        if (!transport.channel.endsWith(':*')) failures.push(`${mode.id}: transport channel must name an event family`);
        if (!['memory-only', 'durable'].includes(transport.persistence)) failures.push(`${mode.id}: invalid transport persistence`);
        for (const role of transport.roles) {
          if (!routeRoles.has(role)) failures.push(`${mode.id}: ${transport.channel} has invalid transport role ${role}`);
        }
      }
      if (mode.status !== 'match' && !mode.statusDetail) failures.push(`${mode.id}: non-match status has no factual explanation`);
      const isSurfaceGap = mode.status === 'surface-gap';
      if ((mode.authorityEngine === null) !== isSurfaceGap) {
        failures.push(`${mode.id}: null mounted authority is reserved exactly for surface gaps`);
      }
      if (isSurfaceGap && !mode.intendedAuthorityEngine) {
        failures.push(`${mode.id}: surface gap needs one explicit intended authority`);
      }
      if (isSurfaceGap && mode.routes.some((route) => route.roles.some((role) => ['start', 'action', 'state', 'settlement'].includes(role)))) {
        failures.push(`${mode.id}: surface gap falsely claims a mounted combat lifecycle`);
      }
      if (isSurfaceGap && (mode.transports ?? []).length > 0) {
        failures.push(`${mode.id}: surface gap falsely claims a mounted non-HTTP transport`);
      }
    }

    assert.deepEqual(failures, [], failures.join('\n'));
    assert.ok(statuses.has('match'));
    assert.ok(statuses.has('defect'));
    assert.ok(statuses.has('surface-gap'));
  });

  it('maps every claimed route to the exact mounted Express handler', () => {
    const failures = [];
    for (const mode of RUNTIME_MODE_REGISTRY) {
      for (const route of mode.routes) {
        const symbol = routeMounts.get(route.path);
        if (!symbol) {
          failures.push(`${mode.id}: ${route.path} is not mounted`);
          continue;
        }
        const importedHandler = handlerImports.get(symbol);
        if (importedHandler !== route.handler) {
          failures.push(`${mode.id}: ${route.path} maps to ${importedHandler ?? symbol}, registry says ${route.handler}`);
        }
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('reverse-censuses mounted Express and production-client combat routes with explicit exclusions', () => {
    const failures = [];
    const exclusionEntries = Object.entries(COMBAT_ROUTE_CENSUS.exclusions);
    const exclusionPaths = new Set(exclusionEntries.map(([path]) => path));
    const mountedCombatPaths = [...routeMounts.keys()].filter(isCombatCensusPath);

    for (const path of mountedCombatPaths) {
      const assigned = expectedAssignedRoutePaths.has(path);
      const excluded = exclusionPaths.has(path);
      if (assigned === excluded) {
        failures.push(`${path}: mounted combat route must be assigned or explicitly excluded, never both/neither`);
      }
    }

    for (const [path, reason] of exclusionEntries) {
      if (!isCombatCensusPath(path)) failures.push(`${path}: exclusion sits outside the independently declared census scope`);
      if (!routeMounts.has(path)) failures.push(`${path}: stale exclusion is not mounted by Express`);
      if (expectedAssignedRoutePaths.has(path)) failures.push(`${path}: assigned route must not remain excluded`);
      if (typeof reason !== 'string' || reason.trim().length < 24) failures.push(`${path}: exclusion needs a concrete review reason`);
    }

    for (const path of clientRouteLiterals) {
      if (!isCombatCensusPath(path)) continue;
      if (!routeMounts.has(path)) {
        failures.push(`${path}: production client names a combat route that Express does not mount`);
        continue;
      }
      if (!expectedAssignedRoutePaths.has(path) && !exclusionPaths.has(path)) {
        failures.push(`${path}: production client combat route is absent from modes and exclusions`);
      }
    }

    assert.ok(mountedCombatPaths.length >= 75, 'Combat-route census unexpectedly shrank.');
    assert.ok(clientRouteLiterals.size >= 70, 'Production-client route literal census unexpectedly shrank.');
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('backs every claimed player-facing route with a real listed client caller', () => {
    const failures = [];
    for (const mode of RUNTIME_MODE_REGISTRY) {
      for (const file of mode.clientEntries) {
        if (!existsSync(join(ROOT, 'shinobij.client', 'src', file))) failures.push(`${mode.id}: missing client entry ${file}`);
      }
      const sources = mode.clientEntries
        .filter((file) => existsSync(join(ROOT, 'shinobij.client', 'src', file)))
        .map((file) => clientSource(file));
      for (const route of mode.routes.filter((entry) => entry.clientCallerRequired !== false)) {
        const marker = `/api${route.path}`;
        if (!sources.some((source) => source.includes(marker))) failures.push(`${mode.id}: no listed client calls ${marker}`);
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('backs every declared realtime combat transport with mounted server and client adapters', () => {
    const failures = [];
    const socketMountSource = readFileSync(join(ROOT, 'api', '_realtime', 'socket.ts'), 'utf8');
    for (const mode of RUNTIME_MODE_REGISTRY) {
      for (const transport of mode.transports ?? []) {
        const handlerPath = join(ROOT, 'api', `${transport.serverHandler}.ts`);
        const adapterPath = join(ROOT, 'shinobij.client', 'src', transport.clientAdapter);
        if (!existsSync(handlerPath)) {
          failures.push(`${mode.id}: missing transport handler ${transport.serverHandler}`);
          continue;
        }
        if (!existsSync(adapterPath)) {
          failures.push(`${mode.id}: missing transport adapter ${transport.clientAdapter}`);
          continue;
        }
        const eventPrefix = transport.channel.slice(0, -1);
        const handlerSource = readFileSync(handlerPath, 'utf8');
        const adapterSource = readFileSync(adapterPath, 'utf8');
        if (!handlerSource.includes(eventPrefix)) failures.push(`${mode.id}: server handler does not implement ${transport.channel}`);
        if (!adapterSource.includes(eventPrefix)) failures.push(`${mode.id}: client adapter does not implement ${transport.channel}`);
        if (!mode.clientEntries.includes(transport.clientAdapter)) failures.push(`${mode.id}: transport adapter is absent from clientEntries`);
        const wireExport = handlerSource.match(/export function (wire[A-Za-z0-9_]+)\(/)?.[1];
        if (!wireExport || !socketMountSource.includes(`${wireExport}(io, socket)`)) {
          failures.push(`${mode.id}: ${transport.serverHandler} is not wired into the Socket.IO mount`);
        }
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('pins ordinary Pet Arena AI to HTTP receipts and live PvP to the realtime cinematic authority', () => {
    const startSource = readFileSync(join(ROOT, 'api', 'pet', 'battle-start.ts'), 'utf8');
    const resultSource = readFileSync(join(ROOT, 'api', 'pet', 'battle-result.ts'), 'utf8');
    const replaySource = readFileSync(join(ROOT, 'api', 'pet', '_duel-replay.ts'), 'utf8');
    const socketSource = readFileSync(join(ROOT, 'api', '_realtime', 'pet-duel-socket.ts'), 'utf8');
    const socketSessionSource = readFileSync(join(ROOT, 'api', '_realtime', 'pet-duel-session.ts'), 'utf8');
    const arenaSource = clientSource('screens/PetArena.tsx');
    const rosterSource = clientSource('lib/pet-duel-live-roster.ts');
    const petModeIds = [
      'pet-arena-ai-1v1',
      'pet-arena-ai-2v2',
      'pet-arena-pvp-1v1',
      'pet-arena-pvp-2v2',
    ];

    for (const id of petModeIds) {
      const mode = runtimeModeById(id);
      assert.ok(mode, `${id}: ordinary Pet Arena mode is missing`);
      assert.deepEqual(
        {
          authorityEngine: mode.authorityEngine,
          intendedAuthorityEngine: mode.intendedAuthorityEngine ?? null,
          participantModel: mode.participantModel,
          rewardPolicy: mode.rewardPolicy,
          status: mode.status,
        },
        EXPECTED_RUNTIME_MODE_FACTS[id],
      );
      assert.equal(
        mode.replayKind,
        id.includes('-ai-')
          ? 'server-replayed-cinematic-input-log-with-receipt'
          : 'memory-only-server-replayed-lockstep-cinematic-log',
      );
    }

    assert.match(startSource, /const mode = body\.mode === '2v2' \? '2v2' : '1v1'/);
    assert.match(startSource, /SERVER_ARENA_PETS/, 'AI opponents must come from the server roster.');
    assert.match(startSource, /isAiOpponent \? \{[\s\S]*?mode,[\s\S]*?seed,/, 'AI modes must seal cinematic replay parameters.');
    assert.match(replaySource, /createLiveCinematicDuel/);
    assert.match(replaySource, /createLivePartyCinematicDuel/);
    assert.match(resultSource, /outcome = tokenData\.authoritativeOutcome/);
    assert.match(resultSource, /dailyPetWins >= DAILY_ARENA_WIN_CAP/);
    assert.match(resultSource, /recordPetArenaVictory\(/);
    assert.match(resultSource, /\{ petDuelWins: 1 \}/);
    assert.match(arenaSource, /mintCasualPetBattleToken\([^\n]+"2v2"/);
    assert.match(arenaSource, /mintCasualPetBattleToken\([^\n]+"1v1"/);
    assert.match(arenaSource, /opponentMode === "ai"/);
    assert.match(arenaSource, /const pvpParty = Boolean\(/);
    assert.match(arenaSource, /sendDirectPetChallenge/);
    assert.match(arenaSource, /liveDuelRef\.current\?\.challenge/);
    assert.match(arenaSource, /buildPetArenaLiveRoster\(combatEligiblePets, selectedPet, reservePetId, character\.petBreeding\)/,
      'Pet Arena must build the live roster through the exact-cardinality helper.');
    assert.match(arenaSource, /myPets=\{liveDuelPets\}/,
      'The live host must receive the selected lead plus the resolved reserve.');
    assert.match(rosterSource, /eligibleCarriedPets\.find\(\(pet\) => \([\s\S]*?pet\.id !== authoritativeLead\.id/,
      'Auto-pick must select another eligible carried pet as the reserve.');
    assert.match(rosterSource, /selectLiveDuelRoster\(pets, mode\)/,
      'Client challenge and accept paths must share exact roster validation.');
    assert.match(socketSource, /const required = mode === ['"]2v2['"] \? 2 : 1/,
      'The server must bind roster cardinality to the requested live-duel mode.');
    assert.match(socketSource, /requestedPets\.length !== required/,
      'The server must reject undersized and oversized live rosters.');
    assert.doesNotMatch(socketSource, /requestedPets[\s\S]{0,400}\.slice\(0,\s*required\)/,
      'The server must not truncate a mismatched roster into a different encounter contract.');
    assert.match(socketSource, /randomUUID\(\)/, 'Realtime duel identity must be server minted.');
    assert.match(socketSource, /randomInt\(1, 0x7fffffff\)/, 'Realtime duel seed must be server minted.');
    assert.match(socketSource, /loadAuthoritativePetRoster/, 'Both live rosters must be loaded from server saves.');
    assert.match(socketSource, /replayLockstepPetDuel/, 'A client terminal hint must be replayed by the server.');
    assert.match(socketSessionSource, /const sessions = new Map/, 'The live duel record is memory-only.');
    assert.doesNotMatch(socketSource, /petRankedRating|recordPetArenaVictory|writeSaveProjected/, 'Ordinary realtime PvP must not be mistaken for a rewarded or ranked settlement.');
  });

  it('records Card Clash free-play durable Legacy progression as server-owned', () => {
    const mode = runtimeModeById('card-clash-freeplay');
    const freeplayLegacySource = readFileSync(join(ROOT, 'api', 'card-clash', '_freeplay-legacy.ts'), 'utf8');
    assert.deepEqual(
      {
        authorityEngine: mode.authorityEngine,
        intendedAuthorityEngine: mode.intendedAuthorityEngine ?? null,
        participantModel: mode.participantModel,
        rewardPolicy: mode.rewardPolicy,
        status: mode.status,
      },
      EXPECTED_RUNTIME_MODE_FACTS['card-clash-freeplay'],
    );
    assert.equal(mode.replayKind, 'expiring-chronicle-projection');
    assert.match(freeplayLegacySource, /bumpLegacyStats\(/);
    assert.match(freeplayLegacySource, /\{ cardClashWins: 1 \}/);
    assert.match(freeplayLegacySource, /receiptId: credit\.receiptId/);
  });

  it('models Battle Towers as a solo-host or admitted-party runtime', () => {
    const mode = runtimeModeById('battle-towers');
    const startSource = readFileSync(join(ROOT, 'api', 'towers', 'start.ts'), 'utf8');
    assert.deepEqual(
      {
        authorityEngine: mode.authorityEngine,
        intendedAuthorityEngine: mode.intendedAuthorityEngine ?? null,
        participantModel: mode.participantModel,
        rewardPolicy: mode.rewardPolicy,
        status: mode.status,
      },
      EXPECTED_RUNTIME_MODE_FACTS['battle-towers'],
    );
    assert.equal(mode.replayKind, 'expiring-tower-run-and-log');
    assert.match(startSource, /authoritativeParty\s*\?[\s\S]*?: \[hostName\]/);
  });

  it('locks the owner-authoritative engine boundaries without hiding live defects', () => {
    const E = RUNTIME_AUTHORITY_ENGINES;
    const sectorWarSource = readFileSync(join(ROOT, 'api', 'village', 'sector-war.ts'), 'utf8');
    const rankedPetStartSource = readFileSync(join(ROOT, 'api', 'pet', 'ranked-start.ts'), 'utf8');
    const petBattleResultSource = readFileSync(join(ROOT, 'api', 'pet', 'battle-result.ts'), 'utf8');
    const petLadderSource = clientSource('screens/PetLadder.tsx');
    const petLadderQueuePanelSource = clientSource('components/PetLadderQueuePanel.tsx');
    const petRankedQueueSource = readFileSync(join(ROOT, 'api', 'pvp', 'pet-ranked-queue.ts'), 'utf8');
    const petArenaSource = clientSource('screens/PetArena.tsx');
    const petBattleStartSource = readFileSync(join(ROOT, 'api', 'pet', 'battle-start.ts'), 'utf8');
    const dungeonPetAuthoritySource = readFileSync(join(ROOT, 'api', 'pet', '_dungeon-battle.ts'), 'utf8');
    const dungeonProofSource = readFileSync(join(ROOT, 'api', 'dungeon', '_encounter-proof.ts'), 'utf8');
    const dungeonRunSource = readFileSync(join(ROOT, 'api', 'dungeon', '_run.ts'), 'utf8');
    const cardAiStartSource = readFileSync(join(ROOT, 'api', 'card-clash', 'ai-start.ts'), 'utf8');
    const cardAiMoveSource = readFileSync(join(ROOT, 'api', 'card-clash', 'ai-move.ts'), 'utf8');
    const hollowGateSettleSource = readFileSync(join(ROOT, 'api', 'hollow-gate', 'combat-settle.ts'), 'utf8');
    const petSocketSource = readFileSync(join(ROOT, 'api', '_realtime', 'pet-duel-socket.ts'), 'utf8');
    const gauntletHandlerSource = readFileSync(join(ROOT, 'api', 'pet', 'gauntlet.ts'), 'utf8');
    const gauntletRuntimeSource = readFileSync(join(ROOT, 'api', '_pet-sim', 'gauntlet-sim.ts'), 'utf8');
    const coreEngines = [E.PVP, E.SOLO_PVE, E.TOWER, E.PET_SHOWDOWN, E.PET_WARFRONT, E.CHRONICLE, E.PET_GAUNTLET_GRID, E.PET_CINEMATIC_DUEL];
    assert.equal(new Set(coreEngines).size, coreEngines.length, 'Owner-required engines must have separate authority ids.');
    assert.ok(INTENTIONAL_ENGINE_SEPARATIONS[E.SOLO_PVE].includes(E.TOWER));
    assert.ok(INTENTIONAL_ENGINE_SEPARATIONS[E.PET_SHOWDOWN].includes(E.PET_WARFRONT));
    assert.ok(INTENTIONAL_ENGINE_SEPARATIONS[E.PET_WARFRONT].includes(E.PET_SHOWDOWN));
    assert.ok(INTENTIONAL_ENGINE_SEPARATIONS[E.PET_GAUNTLET_GRID].includes(E.PET_SHOWDOWN));
    assert.ok(INTENTIONAL_ENGINE_SEPARATIONS[E.PET_CINEMATIC_DUEL].includes(E.LEGACY_PET_DUEL));

    for (const mode of RUNTIME_MODE_REGISTRY) {
      const separationOwner = mode.intendedAuthorityEngine ?? mode.authorityEngine;
      assert.equal(
        mode.intentionallySeparateFrom,
        INTENTIONAL_ENGINE_SEPARATIONS[separationOwner],
        `${mode.id}: separation policy must follow the intended owner`,
      );
      assert.equal(
        mode.intentionallySeparateFrom.includes(separationOwner),
        false,
        `${mode.id}: a mode cannot be intentionally separate from its intended owner`,
      );
    }

    for (const mode of RUNTIME_MODE_REGISTRY.filter((entry) => entry.category === 'solo-pve')) {
      assert.equal(mode.authorityEngine, E.SOLO_PVE, `${mode.id}: ordinary Solo PvE drifted engines`);
    }
    for (const mode of RUNTIME_MODE_REGISTRY.filter((entry) => entry.category === 'tower')) {
      assert.equal(mode.authorityEngine, E.TOWER, `${mode.id}: Tower mode drifted engines`);
    }
    for (const mode of RUNTIME_MODE_REGISTRY.filter((entry) => entry.category === 'card')) {
      assert.equal(mode.authorityEngine, E.CHRONICLE, `${mode.id}: Card mode drifted engines`);
    }

    const garrison = runtimeModeById('sector-war-shinobi-garrison');
    assert.equal(garrison.status, 'surface-gap');
    assert.equal(garrison.authorityEngine, null);
    assert.equal(garrison.intendedAuthorityEngine, E.PVP);
    assert.deepEqual(garrison.routes, []);
    assert.doesNotMatch(sectorWarSource, /resolveMercBattle|sealTowerFighter/);
    assert.match(sectorWarSource, /case 'garrison': return res\.status\(410\)/);

    const dungeonPet = runtimeModeById('dungeon-pet-cinematic');
    assert.equal(dungeonPet.status, 'match');
    assert.equal(dungeonPet.authorityEngine, E.PET_CINEMATIC_DUEL);
    assert.equal(dungeonPet.replayKind, 'server-replayed-cinematic-input-log-and-parent-run-receipt');
    assert.match(petBattleStartSource, /resolveDungeonPetAuthority/);
    assert.match(petBattleStartSource, /buildDungeonRareBeast/);
    assert.match(dungeonPetAuthoritySource, /DUNGEON_RARE_BEAST_ID = 'dungeon-rare-beast'/);
    assert.match(petBattleResultSource, /applyDungeonPetTerminal/);
    assert.match(dungeonRunSource, /dungeonPetWasWon\(active\)/);
    assert.match(dungeonRunSource, /dungeon-pet-proof-required/);

    const rankedPet = runtimeModeById('pet-ranked-live-defect');
    assert.equal(rankedPet.status, 'surface-gap');
    assert.equal(rankedPet.authorityEngine, null);
    assert.equal(rankedPet.intendedAuthorityEngine, E.PET_CINEMATIC_DUEL);
    assert.deepEqual(rankedPet.routes, []);
    assert.match(petLadderSource, /<PetLadderQueuePanel/);
    assert.doesNotMatch(petLadderSource, /PetDuelLiveHost|autoAcceptFrom|queuedAgainst/);
    assert.doesNotMatch(petLadderQueuePanelSource, /challengeToDuel|\/api\/pvp\/pet-ranked-queue|Find a match/);
    assert.match(petLadderQueuePanelSource, /Ranked live queue unavailable/);
    assert.match(petRankedQueueSource, /res\.status\(410\)/);
    assert.doesNotMatch(petRankedQueueSource, /withKvLock|randomUUID|petRankedQueueMatchKey/);
    assert.doesNotMatch(petSocketSource, /petRankedRating|recordPetArenaVictory|writeSaveProjected/);

    const rankedCompat = runtimeModeById('pet-ranked-legacy-compat');
    assert.equal(rankedCompat.status, 'defect');
    assert.equal(rankedCompat.authorityEngine, E.LEGACY_PET_DUEL);
    assert.match(rankedPetStartSource, /_ranked-authority\.js/);
    assert.doesNotMatch(rankedPetStartSource, /_ranked-engine\.js/);
    assert.match(petArenaSource, /runPetDuelCinematic\(canonicalPlayerPet, canonicalOpponentPet/);
    assert.match(petBattleResultSource, /runPetDuel/);

    const hollowGatePet = runtimeModeById('hollow-gate-pet-cinematic');
    assert.equal(hollowGatePet.status, 'owner-decision');
    assert.equal(hollowGatePet.authorityEngine, E.PET_CINEMATIC_DUEL);
    assert.match(petBattleStartSource, /hollowGateCombatBindingKey\(runId\)/);
    assert.match(petBattleStartSource, /validateHollowGatePetClaim\(\{[\s\S]*?activeEncounter: run\?\.activeEncounter/);
    assert.match(petBattleStartSource, /binding\?\.runId !== runId/);
    assert.match(petBattleResultSource, /replayCasualPetDuel/);
    assert.match(petBattleResultSource, /hollowGatePetResultKey\(playerName, battleToken\)/);
    assert.match(petBattleResultSource, /reward: 0/);
    assert.match(hollowGateSettleSource, /`hg-pet-result:\$\{playerName\}:\$\{petReceipt\}`/);
    assert.match(hollowGateSettleSource, /verifiedPetResult\.runId !== runId/);

    const tactical = runtimeModeById('tactical-arena');
    assert.equal(tactical.status, 'surface-gap');
    assert.equal(tactical.authorityEngine, null);
    assert.equal(tactical.intendedAuthorityEngine, E.PET_WARFRONT);
    assert.equal(tactical.routes.length, 0);

    const clan2v2 = runtimeModeById('clan-war-pvp-2v2');
    assert.equal(clan2v2.status, 'surface-gap');
    assert.equal(clan2v2.authorityEngine, null);
    assert.equal(clan2v2.intendedAuthorityEngine, E.PVP);

    const dungeonCard = runtimeModeById('dungeon-card');
    assert.equal(dungeonCard.status, 'match');
    assert.equal(dungeonCard.authorityEngine, E.CHRONICLE);
    assert.equal(dungeonCard.intendedAuthorityEngine, undefined);
    assert.equal(dungeonCard.replayKind, 'expiring-chronicle-projection-and-parent-run-proof-receipt');
    assert.match(cardAiStartSource, /resolveDungeonCardAuthority/);
    assert.match(cardAiStartSource, /dungeonCardMatchId/);
    assert.match(cardAiMoveSource, /applyDungeonCardTerminal/);
    assert.match(dungeonProofSource, /DUNGEON_CARD_AUTHORITY_VERSION = 1/);
    assert.match(dungeonRunSource, /dungeonCardWasWon\(active\)/);
    assert.match(dungeonRunSource, /dungeon-card-proof-required/);

    const gauntlet = runtimeModeById('pet-gauntlet');
    assert.equal(gauntlet.authorityEngine, E.PET_GAUNTLET_GRID);
    assert.match(gauntletHandlerSource, /replayGauntlet/);
    assert.match(gauntletRuntimeSource, /runPetGridBattle/);
  });

  it('keeps every pet authority explicitly separate from every other pet authority', () => {
    const petAuthorities = [
      RUNTIME_AUTHORITY_ENGINES.PET_SHOWDOWN,
      RUNTIME_AUTHORITY_ENGINES.PET_WARFRONT,
      RUNTIME_AUTHORITY_ENGINES.PET_GAUNTLET_GRID,
      RUNTIME_AUTHORITY_ENGINES.PET_CINEMATIC_DUEL,
      RUNTIME_AUTHORITY_ENGINES.LEGACY_PET_DUEL,
      RUNTIME_AUTHORITY_ENGINES.CLIENT_LOCAL_PET_DUEL,
    ];
    for (const authority of petAuthorities) {
      for (const other of petAuthorities) {
        if (authority === other) continue;
        assert.ok(
          INTENTIONAL_ENGINE_SEPARATIONS[authority]?.includes(other),
          `${authority} must remain explicitly separate from ${other}`,
        );
      }
    }
  });

  it('models Sector War as orchestration and never as a gameplay engine', () => {
    const authorityIds = new Set(Object.values(RUNTIME_AUTHORITY_ENGINES));
    assert.equal(authorityIds.has(RUNTIME_ORCHESTRATORS.SECTOR_WAR), false);

    const sectorModes = RUNTIME_MODE_REGISTRY.filter((mode) => mode.orchestrationOwner === RUNTIME_ORCHESTRATORS.SECTOR_WAR);
    assert.deepEqual(
      sectorModes.map((mode) => mode.id).sort(),
      ['sector-war-card', 'sector-war-pet', 'sector-war-shinobi-garrison', 'sector-war-shinobi-human', 'village-war-mercenary'].sort(),
    );
    assert.deepEqual(
      new Set(sectorModes.map((mode) => mode.authorityEngine)),
      new Set([null, RUNTIME_AUTHORITY_ENGINES.PVP, RUNTIME_AUTHORITY_ENGINES.TOWER, RUNTIME_AUTHORITY_ENGINES.CHRONICLE, RUNTIME_AUTHORITY_ENGINES.PET_SHOWDOWN]),
    );

    const retiredGarrison = runtimeModeById('sector-war-shinobi-garrison');
    assert.equal(retiredGarrison.status, 'surface-gap');
    assert.equal(retiredGarrison.authorityEngine, null);
    assert.equal(retiredGarrison.intendedAuthorityEngine, RUNTIME_AUTHORITY_ENGINES.PVP);
    assert.deepEqual(retiredGarrison.routes, []);
  });
});

describe('current flat runtime-mode audit projection', () => {
  it('projects every registry row without creating a second authority list', () => {
    assert.equal(RUNTIME_MODE_INVENTORY.length, RUNTIME_MODE_REGISTRY.length);
    assert.ok(Object.isFrozen(RUNTIME_MODE_INVENTORY));
    assert.ok(Object.isFrozen(RUNTIME_COMPATIBILITY_KEYS));
    for (const mode of RUNTIME_MODE_REGISTRY) {
      const row = RUNTIME_MODE_INVENTORY.find((entry) => entry.id === mode.id);
      assert.ok(row, `${mode.id}: missing audit projection row`);
      assertDeepFrozen(row, `projection.${mode.id}`);
      if (mode.compatibility) {
        assert.deepEqual(
          Object.keys(mode.compatibility).filter((key) => !RUNTIME_COMPATIBILITY_KEYS.includes(key)),
          [],
          `${mode.id}: production compatibility metadata escaped the allowlist`,
        );
      }
      assert.equal(row.label, mode.label);
      assert.equal(row.authorityEngine, mode.authorityEngine);
      assert.equal(row.intendedAuthorityEngine, mode.intendedAuthorityEngine ?? null);
      assert.equal(row.matchStatus, mode.status);
      assert.equal(row.migrationStatus, mode.migrationStatus ?? null);
      assert.equal(row.participantModel, mode.participantModel);
      assert.equal(row.rewardPolicy, mode.rewardPolicy);
      assert.deepEqual(row.transports, mode.transports ?? []);
      assert.notEqual(row.transports, mode.transports, `${mode.id}: projection must clone transport arrays`);
      assert.equal(Object.hasOwn(row, 'status'), false, `${mode.id}: projection must not overload migration and match status`);
    }
    assert.deepEqual(TERMINAL_MIGRATION_STATUSES, ['complete', 'migrated']);
  });

  it('filters compatibility metadata, lets canonical fields win, and freezes cloned nested values', () => {
    const sourceWorldKinds = ['fixture-kind'];
    const mode = {
      id: 'canonical-id',
      label: 'Canonical label',
      category: 'solo-pve',
      authorityEngine: RUNTIME_AUTHORITY_ENGINES.SOLO_PVE,
      clientEntries: ['canonical-client.ts'],
      routes: [
        { path: '/canonical/start', handler: 'canonical/start', roles: ['start'] },
        { path: '/canonical/lifecycle', handler: 'canonical/lifecycle', roles: ['lifecycle'] },
        { path: '/canonical/settle', handler: 'canonical/settle', roles: ['settlement'] },
      ],
      transports: [{
        kind: 'socket.io',
        channel: 'fixture:*',
        serverHandler: '_realtime/fixture',
        clientAdapter: 'lib/fixture.ts',
        roles: ['action', 'state'],
        persistence: 'memory-only',
      }],
      participantModel: 'solo',
      rewardPolicy: 'server-settled',
      replayKind: 'canonical-record',
      intentionallySeparateFrom: [RUNTIME_AUTHORITY_ENGINES.PVP],
      status: 'match',
      compatibility: {
        settlementRoute: '/poisoned/settlement',
        settlementHandler: 'poisoned/settlement',
        lifecycleRoute: '/poisoned/lifecycle',
        lifecycleHandler: 'poisoned/lifecycle',
        worldKinds: sourceWorldKinds,
        id: 'poisoned-id',
        status: 'poisoned-status',
        arbitraryNestedValue: { mutable: true },
      },
    };

    const row = projectRuntimeMode(mode);
    assert.equal(row.id, 'canonical-id');
    assert.equal(row.settlementRoute, '/canonical/settle');
    assert.equal(row.settlementHandler, 'canonical/settle');
    assert.equal(row.lifecycleRoute, '/canonical/lifecycle');
    assert.equal(row.lifecycleHandler, 'canonical/lifecycle');
    assert.equal(row.matchStatus, 'match');
    assert.equal(Object.hasOwn(row, 'status'), false);
    assert.equal(Object.hasOwn(row, 'arbitraryNestedValue'), false);
    assert.deepEqual(row.worldKinds, ['fixture-kind']);
    assert.notEqual(row.worldKinds, sourceWorldKinds, 'projection must clone compatibility arrays before freezing');
    assert.notEqual(row.routes, mode.routes, 'projection must clone canonical route arrays before freezing');
    assert.notEqual(row.routes[0], mode.routes[0], 'projection must clone canonical nested route values before freezing');
    assert.notEqual(row.transports, mode.transports, 'projection must clone canonical transport arrays before freezing');
    assert.notEqual(row.transports[0], mode.transports[0], 'projection must clone canonical nested transport values before freezing');
    assert.equal(Object.isFrozen(sourceWorldKinds), false, 'projection must not freeze caller-owned compatibility values');
    assert.equal(Object.isFrozen(mode.routes), false, 'projection must not freeze caller-owned canonical values');
    assertDeepFrozen(row, 'projection.fixture');
    assert.throws(() => row.routes[0].roles.push('action'), TypeError);
    assert.throws(() => row.worldKinds.push('mutated'), TypeError);
  });

  it('loads the TypeScript-backed audit only through explicit repository tsx commands', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.match(packageJson.scripts.test, /^node --import tsx /);
    assert.match(packageJson.scripts['test:ci'], /^node --import tsx /);
    assert.match(packageJson.scripts['check:runtime-mode-docs'], /^node --import tsx /);
  });

  it('retains World-context and generic World Map AI semantic coverage', () => {
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

    for (const [label, descriptor] of expected) {
      const row = RUNTIME_MODE_INVENTORY.find((entry) => entry.label === label);
      assert.ok(row, `${label}: missing audit projection row`);
      assert.equal(row.startRoute, '/missions/ai-fight-start', `${label}: wrong start route`);
      assert.equal(row.actionRoute, '/solo-pve/action', `${label}: wrong action route`);
      assert.equal(row.stateRoute, '/solo-pve/state', `${label}: wrong state route`);
      assert.equal(row.authorityEngine, RUNTIME_AUTHORITY_ENGINES.SOLO_PVE, `${label}: wrong current runtime`);
      assert.equal(row.intendedAuthorityEngine, null, `${label}: unexpected intended-owner override`);
      assert.equal(row.migrationStatus, 'migrated', `${label}: migration status changed`);
      for (const [key, value] of Object.entries(descriptor.contract)) assert.equal(row[key], value, `${label}: wrong ${key}`);
      if (descriptor.worldKinds) assert.deepEqual(row.worldKinds, descriptor.worldKinds, `${label}: wrong World kind coverage`);
      if (descriptor.catalogSelector) assert.equal(row.catalogSelector, descriptor.catalogSelector, `${label}: wrong catalog selector`);
      if (descriptor.battleKind) assert.equal(row.battleKind, descriptor.battleKind, `${label}: wrong battle kind`);
      if (descriptor.lifecycleRoute) assert.equal(row.lifecycleRoute, descriptor.lifecycleRoute, `${label}: wrong lifecycle route`);
      if (descriptor.lifecycleHandler) assert.equal(row.lifecycleHandler, descriptor.lifecycleHandler, `${label}: wrong lifecycle handler`);
      for (const client of descriptor.requiredClients) assert.ok(row.clientEntries.includes(client), `${label}: missing ${client}`);
    }

    const inventoriedWorldKinds = RUNTIME_MODE_INVENTORY
      .filter((row) => row.flowDescriptor === 'world-context')
      .flatMap((row) => row.worldKinds ?? [])
      .sort();
    const sourceBlock = sharedWorldAiFight.match(/WORLD_AI_FIGHT_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
    assert.ok(sourceBlock, 'shared World AI kind contract is unreadable');
    const sourceWorldKinds = [...sourceBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
    assert.deepEqual(inventoriedWorldKinds, sourceWorldKinds, 'Registry must classify every shared World AI kind exactly once.');
  });

  it('retains Dungeon Warden and creator-event sealed Solo-PvE semantics', () => {
    const app = clientSource('App.tsx');
    const aiFightStart = readFileSync(join(ROOT, 'api', 'missions', 'ai-fight-start.ts'), 'utf8');
    const genericAuthority = readFileSync(join(ROOT, 'api', 'missions', '_generic-ai-fight-authority.ts'), 'utf8');
    const aiFightOutcome = readFileSync(join(ROOT, 'api', 'missions', '_ai-fight-outcome.ts'), 'utf8');
    const reportAiFight = readFileSync(join(ROOT, 'api', 'missions', 'report-ai-fight.ts'), 'utf8');
    const dungeon = RUNTIME_MODE_INVENTORY.find((entry) => entry.id === 'dungeon-warden');
    const creator = RUNTIME_MODE_INVENTORY.find((entry) => entry.id === 'creator-event-practice');

    for (const row of [dungeon, creator]) {
      assert.ok(row, 'required sealed fight audit row is missing');
      assert.equal(row.startRoute, '/missions/ai-fight-start');
      assert.equal(row.actionRoute, '/solo-pve/action');
      assert.equal(row.stateRoute, '/solo-pve/state');
      assert.equal(row.authorityEngine, RUNTIME_AUTHORITY_ENGINES.SOLO_PVE);
      assert.equal(row.intendedAuthorityEngine, null);
      assert.equal(row.migrationStatus, 'migrated');
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
