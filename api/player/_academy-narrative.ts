import { offerFirstContract, readFirstContract, isFirstContractRoute, firstContractReturnedLater } from '../../shared/first-contract.js';
export const ACADEMY_NARRATIVE_ACTIONS = ['incident', 'trace', 'seal', 'logbook', 'complete', 'skip', 'combat', 'discovery', 'companion', 'contract-acknowledge', 'contract-return'] as const;
export type AcademyNarrativeAction = typeof ACADEMY_NARRATIVE_ACTIONS[number];

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
    rawRoute?: unknown,
): AcademyNarrativeResult {
    if (rawRoute !== undefined && (action !== 'complete' || !isFirstContractRoute(rawRoute))) {
        return { ok: false, status: 400, error: 'Invalid first assignment route.' };
    }
    const step = onboardingStep(character);
    if (isFirstContractRoute(action) || action === 'contract-acknowledge' || action === 'contract-return') {
        const state = readFirstContract(character.firstContract);
        if (step !== 'done' || !state) return { ok: false, status: 409, error: 'Finish or skip the Academy before choosing your first assignment.' };
        const now = Date.now();
        if (isFirstContractRoute(action)) {
            if (state.completedAt || state.route === action) return { ok: true, character, changed: false };
            if (action === 'companion' && (!Array.isArray(character.pets) || !character.pets.length)) {
                return { ok: false, status: 409, error: 'Choose combat or discovery until you have a companion.' };
            }
            return { ok: true, character: { ...character, firstContract: { ...state, route: action, selectedAt: now } }, changed: true };
        }
        if (!state.completedAt) return { ok: false, status: 409, error: 'Complete your assignment before closing its journal entry.' };
        if (action === 'contract-return' && (!firstContractReturnedLater(state, now) || state.returnedAt)) return { ok: true, character, changed: false };
        if (action === 'contract-acknowledge' && state.acknowledgedAt) return { ok: true, character, changed: false };
        return { ok: true, character: { ...character, firstContract: { ...state, [action === 'contract-return' ? 'returnedAt' : 'acknowledgedAt']: now } }, changed: true };
    }
    if (action === "skip") {
        if (step === "done") return { ok: true, character, changed: false };
        return { ok: true, character: offerFirstContract({ ...character, onboardingStep: "done" }, 'skip'), changed: true };
    }
    if (action === 'logbook') {
        if (step === 'sectorReturn' || step === 'done') return { ok: true, character, changed: false };
        if ((step !== 'logbook' && step !== 'firstMission') || character.academyTrialClaimed !== true) {
            return { ok: false, status: 409, error: 'Claim the Academy Trial before continuing through the Logbook.' };
        }
        return { ok: true, character: { ...character, onboardingStep: 'sectorReturn' }, changed: true };
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
        // Opening the Logbook advances a client-owned step. A throttled autosave
        // can trail the real travel arrival; acknowledge both together only when
        // the server already holds the Academy Trial reward and field location.
        const pendingFieldHandoff = step === "logbook" && character.academyTrialClaimed === true;
        if ((step !== "sectorReturn" && !pendingFieldHandoff) || !Number.isSafeInteger(sector) || sector < 1 || sector !== storedSector) {
            return { ok: false, status: 409, error: "Travel to the marked field sector before recording its trace." };
        }
        return {
            ok: true,
            character: { ...character, onboardingStep: "sectorReturn", academySectorVisited: true, academyTraceSector: sector },
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
        const graduated: Character = offerFirstContract({ ...character, onboardingStep: "done" }, 'academy');
        if (isFirstContractRoute(rawRoute) && readFirstContract(graduated.firstContract)) {
            const selected = applyAcademyNarrativeAction(graduated, record, rawRoute);
            return selected.ok ? { ...selected, changed: true } : selected;
        }
        return { ok: true, character: graduated, changed: true };
    }
    return { ok: false, status: 400, error: "Unknown Academy narrative action." };
}
