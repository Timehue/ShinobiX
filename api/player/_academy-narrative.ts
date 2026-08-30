export type AcademyNarrativeAction = "incident" | "trace" | "seal" | "complete" | "skip";

type Character = Record<string, unknown>;
type SaveRecord = Record<string, unknown>;

export type AcademyNarrativeResult =
    | { ok: true; character: Character; changed: boolean }
    | { ok: false; status: number; error: string };

/** Completing the ceremony means the player is physically back in their safe
 * hub too, not merely looking at the Village screen with a wild-sector save. */
export function academyNarrativeRecordPatch(
    record: SaveRecord,
    action: AcademyNarrativeAction,
): SaveRecord | undefined {
    return action === "complete" && (Number(record.currentSector) !== 0 || record.pendingTravel != null)
        ? { currentSector: 0, pendingTravel: null }
        : undefined;
}

function onboardingStep(character: Character): string {
    const raw = typeof character.onboardingStep === "string" ? character.onboardingStep : "";
    if (raw === "spar") return "academySpar";
    if (raw === "tour" || raw === "storyUnlocked") return "done";
    return raw;
}

/**
 * Applies only presentation/progression acknowledgements. The current save is
 * supplied under the player-save lock, so passive HP regeneration can advance
 * beside the Academy story without forcing a stale full-save overwrite.
 */
export function applyAcademyNarrativeAction(
    character: Character,
    record: SaveRecord,
    action: AcademyNarrativeAction,
    rawSector?: unknown,
): AcademyNarrativeResult {
    const step = onboardingStep(character);
    if (action === "skip") {
        if (step === "done") return { ok: true, character, changed: false };
        return { ok: true, character: { ...character, onboardingStep: "done" }, changed: true };
    }
    if (action === "incident") {
        if (character.academyIncidentSeen === true) return { ok: true, character, changed: false };
        if (step !== "cafeteria" || character.academySparClaimed !== true) {
            return { ok: false, status: 409, error: "Finish the Academy spar before acknowledging its aftermath." };
        }
        return { ok: true, character: { ...character, academyIncidentSeen: true }, changed: true };
    }
    if (action === "trace") {
        if (character.academySectorVisited === true) return { ok: true, character, changed: false };
        const sector = Math.floor(Number(rawSector));
        const storedSector = Math.floor(Number(record.currentSector));
        if (step !== "sectorReturn" || !Number.isSafeInteger(sector) || sector < 1 || sector !== storedSector) {
            return { ok: false, status: 409, error: "Travel to the marked field sector before recording its trace." };
        }
        return {
            ok: true,
            character: { ...character, academySectorVisited: true, academyTraceSector: sector },
            changed: true,
        };
    }
    if (action === "seal") {
        if (character.academyFieldSeal === true) return { ok: true, character, changed: false };
        if (step !== "sectorReturn" || character.academySectorVisited !== true) {
            return { ok: false, status: 409, error: "Return with the field trace before accepting its seal." };
        }
        return { ok: true, character: { ...character, academyFieldSeal: true }, changed: true };
    }
    if (action === "complete") {
        if (step === "done" && character.academyFieldSeal === true) return { ok: true, character, changed: false };
        if (step !== "sectorReturn" || character.academySectorVisited !== true || character.academyFieldSeal !== true) {
            return { ok: false, status: 409, error: "Accept the field seal before completing the Academy path." };
        }
        return { ok: true, character: { ...character, onboardingStep: "done" }, changed: true };
    }
    return { ok: false, status: 400, error: "Unknown Academy narrative action." };
}
