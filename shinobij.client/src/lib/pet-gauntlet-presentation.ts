import type { PetVisualQualityConfig } from "./pet-visual-quality";
import { PET_VISUAL_QUALITY_PRESETS } from "./pet-visual-quality";

export type GauntletBoardTeam = "player" | "enemy";

/**
 * The Gauntlet board uses -Z for the far/enemy half and +Z for the near/player
 * half. Fighters must look through the centre line, never toward the camera or
 * the outside edge. Keeping the direction in a pure helper makes both teams —
 * and every model-specific yaw correction layered on top — easy to certify.
 */
export function gauntletTeamFacing(team: GauntletBoardTeam): readonly [number, number] {
    return team === "player" ? [0, -1] : [0, 1];
}

/** A stable presentation-only identity that tolerates old/malformed pet saves. */
export function gauntletPetPresentationKey(pet: { id?: unknown; templateId?: unknown; name?: unknown }): string {
    for (const value of [pet.id, pet.templateId, pet.name]) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "unknown-pet";
}

/**
 * A six-to-ten fighter GLB scene is materially heavier than the two/four-pet
 * Coliseum. On compact or memory-constrained devices, cap that scene at the
 * performance preset even when an older stored preference says Balanced or
 * Cinematic. Explicit URL overrides remain available to visual QA at the call
 * site; this helper only expresses the runtime safety policy.
 */
export function resolveGauntletBoardQuality(
    requested: PetVisualQualityConfig,
    unitCount: number,
    viewportWidth: number,
    deviceMemoryGb: number,
): PetVisualQualityConfig {
    const pressured = Math.max(0, Math.floor(unitCount)) >= 6;
    const compact = Number.isFinite(viewportWidth) && viewportWidth <= 640;
    const constrainedMemory = Number.isFinite(deviceMemoryGb) && deviceMemoryGb <= 4;
    return pressured && (compact || constrainedMemory)
        ? PET_VISUAL_QUALITY_PRESETS.low
        : requested;
}
