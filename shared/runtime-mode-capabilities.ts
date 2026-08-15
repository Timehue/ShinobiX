import {
    RUNTIME_MODE_REGISTRY,
    runtimeModeById,
    type RuntimeMode,
} from './runtime-mode-registry.js';
import {
    PUBLIC_CAPABILITY_IDS,
    type PublicCapabilities,
    type PublicCapabilityId,
    type PublicCapabilityReason,
    type PublicCapabilityState,
} from './public-capabilities.js';

const PUBLIC_CAPABILITY_ID_SET: ReadonlySet<string> = new Set(PUBLIC_CAPABILITY_IDS);

export type RuntimeModeCapabilityRequirement = Readonly<{
    runtimeModeId?: string;
    /** An additional or standalone public gate beyond the mode registry entry. */
    capabilityId?: PublicCapabilityId;
    /** Read-only navigation may omit the unsafe-HTTP mutation gate explicitly. */
    requiresMutation?: boolean;
}>;

export type RuntimeModeCapabilityAvailability = Readonly<{
    runtimeModeId: string | null;
    runtimeModeLabel: string | null;
    executable: boolean;
    capabilityIds: readonly PublicCapabilityId[];
    available: boolean;
    blockingCapabilityId: PublicCapabilityId | null;
    state: PublicCapabilityState;
    reason: PublicCapabilityReason;
}>;

export type RuntimeModeCapabilityMatrixRow = Readonly<{
    modeId: string;
    label: string;
    capabilityId: PublicCapabilityId | null;
    capabilityIds: readonly PublicCapabilityId[];
    blockingCapabilityId: PublicCapabilityId | null;
    available: boolean;
    state: PublicCapabilityState;
    reason: PublicCapabilityReason;
}>;

function isExecutable(mode: RuntimeMode | undefined): mode is RuntimeMode {
    return !!mode
        && mode.authorityEngine !== null
        && (mode.routes.length > 0 || (mode.transports?.length ?? 0) > 0);
}

function unavailableConfiguration(runtimeModeId: string | null): RuntimeModeCapabilityAvailability {
    return Object.freeze({
        runtimeModeId,
        runtimeModeLabel: null,
        executable: false,
        capabilityIds: Object.freeze([]),
        available: false,
        blockingCapabilityId: null,
        state: 'temporarily-unavailable',
        reason: 'configuration-unavailable',
    });
}

/**
 * Public gates required to expose a runtime-backed surface. Every surface
 * requires the global gameplay gate. New actions also require the unsafe-HTTP
 * mutation gate; a genuinely read-only surface must opt out explicitly.
 * Registry and caller-specific gates are additive.
 * `null` means a requested runtime id is missing or not executable.
 */
export function runtimeModeRequiredCapabilityIds(
    requirement: RuntimeModeCapabilityRequirement,
): readonly PublicCapabilityId[] | null {
    const hasRuntimeModeId = requirement.runtimeModeId !== undefined;
    const mode = hasRuntimeModeId
        ? runtimeModeById(requirement.runtimeModeId)
        : undefined;
    if (hasRuntimeModeId && !isExecutable(mode)) return null;
    if (requirement.capabilityId !== undefined && !PUBLIC_CAPABILITY_ID_SET.has(requirement.capabilityId)) return null;
    return Object.freeze([...new Set<PublicCapabilityId>([
        'gameplay',
        ...(requirement.requiresMutation === false ? [] : ['gameplayMutations'] as const),
        ...(mode?.capabilityKey ? [mode.capabilityKey] : []),
        ...(requirement.capabilityId && requirement.capabilityId !== mode?.capabilityKey
            ? [requirement.capabilityId]
            : []),
    ])]);
}

/** Fail-closed adapter for live providers where unavailable includes cold/stale truth. */
export function runtimeModeAdmissionAllowed(
    requirement: RuntimeModeCapabilityRequirement,
    capabilityAvailable: (id: PublicCapabilityId) => boolean,
): boolean {
    const capabilityIds = runtimeModeRequiredCapabilityIds(requirement);
    return capabilityIds !== null && capabilityIds.every(capabilityAvailable);
}

/**
 * Resolve the effective public availability of an executable runtime mode.
 * The registry owns its primary capability; callers may add one narrower gate
 * (for example Clan Boss party admission) without duplicating the core gate.
 */
export function runtimeModeCapabilityAvailability(
    capabilities: PublicCapabilities,
    requirement: RuntimeModeCapabilityRequirement,
): RuntimeModeCapabilityAvailability {
    const mode = requirement.runtimeModeId
        ? runtimeModeById(requirement.runtimeModeId)
        : undefined;
    const capabilityIds = runtimeModeRequiredCapabilityIds(requirement);
    if (capabilityIds === null) {
        return unavailableConfiguration(requirement.runtimeModeId ?? null);
    }
    const blockingCapabilityId = capabilityIds.find((id) => capabilities[id].state !== 'available') ?? null;
    const blocking = blockingCapabilityId ? capabilities[blockingCapabilityId] : null;

    return Object.freeze({
        runtimeModeId: mode?.id ?? null,
        runtimeModeLabel: mode?.label ?? null,
        // Standalone capabilities (Legacy) can be available without claiming to
        // be an executable combat mode. Invalid requested mode ids returned above.
        executable: !!mode,
        capabilityIds: Object.freeze(capabilityIds),
        available: blocking === null,
        blockingCapabilityId,
        state: blocking?.state ?? 'available',
        reason: blocking?.reason ?? 'available',
    });
}

/** Exact effective public projection for every executable registry mode. */
export function runtimeModeCapabilityMatrix(
    capabilities: PublicCapabilities,
): readonly RuntimeModeCapabilityMatrixRow[] {
    return Object.freeze(RUNTIME_MODE_REGISTRY
        .filter((mode) => isExecutable(mode))
        .map((mode) => {
            const availability = runtimeModeCapabilityAvailability(capabilities, { runtimeModeId: mode.id });
            return Object.freeze({
                modeId: mode.id,
                label: mode.label,
                capabilityId: mode.capabilityKey ?? null,
                capabilityIds: availability.capabilityIds,
                blockingCapabilityId: availability.blockingCapabilityId,
                available: availability.available,
                state: availability.state,
                reason: availability.reason,
            });
        }));
}
