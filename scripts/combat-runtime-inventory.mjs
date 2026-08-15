/**
 * Deterministic flat audit projection of the current runtime-mode registry.
 *
 * The former 28-row COMBAT_RUNTIME_INVENTORY API was retired when its sole code
 * consumer moved to this versioned registry projection. This module imports
 * TypeScript intentionally and must therefore run through the repository's
 * `node --import tsx` test commands on the supported Node 22 toolchain.
 */
import {
  RUNTIME_COMPATIBILITY_KEYS,
  RUNTIME_MODE_REGISTRY,
  WORLD_MAP_AI_FLOW_CONTRACTS,
} from '../shared/runtime-mode-registry.ts';

export const TERMINAL_MIGRATION_STATUSES = Object.freeze(['complete', 'migrated']);
export { WORLD_MAP_AI_FLOW_CONTRACTS };

const routeFor = (mode, role) => mode.routes.find((route) => route.roles.includes(role));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function compatibilityFields(metadata) {
  if (!metadata) return {};
  return Object.fromEntries(
    RUNTIME_COMPATIBILITY_KEYS
      .filter((key) => Object.hasOwn(metadata, key))
      .map((key) => [key, Array.isArray(metadata[key]) ? [...metadata[key]] : metadata[key]]),
  );
}

export function projectRuntimeMode(mode) {
  const compatibility = compatibilityFields(mode.compatibility);
  const start = routeFor(mode, 'start');
  const action = routeFor(mode, 'action');
  const state = routeFor(mode, 'state');
  const settlement = routeFor(mode, 'settlement');
  const lifecycle = routeFor(mode, 'lifecycle');

  // Compatibility metadata is deliberately first. Canonical registry fields
  // always win even when an allowed legacy key (for example settlementRoute)
  // shares its name with the modern projection.
  return deepFreeze({
    ...compatibility,
    id: mode.id,
    label: mode.label,
    category: mode.category,
    routes: mode.routes.map((route) => ({
      ...route,
      roles: [...route.roles],
    })),
    startRoute: start?.path ?? null,
    actionRoute: action?.path ?? null,
    stateRoute: state?.path ?? null,
    settlementRoute: settlement?.path ?? null,
    lifecycleRoute: lifecycle?.path ?? null,
    handler: start?.handler ?? null,
    settlementHandler: settlement?.handler ?? null,
    lifecycleHandler: lifecycle?.handler ?? null,
    clientEntries: [...mode.clientEntries],
    authorityEngine: mode.authorityEngine,
    intendedAuthorityEngine: mode.intendedAuthorityEngine ?? null,
    matchStatus: mode.status,
    migrationStatus: mode.migrationStatus ?? null,
    participantModel: mode.participantModel,
    rewardPolicy: mode.rewardPolicy,
    replayKind: mode.replayKind,
    orchestrationOwner: mode.orchestrationOwner ?? null,
    capabilityKey: mode.capabilityKey ?? null,
    intentionallySeparateFrom: [...mode.intentionallySeparateFrom],
    statusDetail: mode.statusDetail ?? null,
    requiresStartCaller: start != null,
  });
}

export const RUNTIME_MODE_INVENTORY = deepFreeze(RUNTIME_MODE_REGISTRY.map(projectRuntimeMode));
