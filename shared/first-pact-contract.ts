/**
 * Shared, dependency-free contract for Celestial Tower: The First Pact.
 *
 * The campaign is an endgame, single-player RPG surface. Exploration is
 * client-presented, while progression that unlocks or follows a Pet Showdown
 * result is kept on the server. Keeping the fixed rules here prevents the
 * world UI and the authoritative battle entry from drifting apart.
 */

export const FIRST_PACT_MIN_LEVEL = 100;
export const FIRST_PACT_FIELD_SIZE = 2;
export const FIRST_PACT_RESERVE_SIZE = 2;
export const FIRST_PACT_TEAM_SIZE = FIRST_PACT_FIELD_SIZE + FIRST_PACT_RESERVE_SIZE;
export const FIRST_PACT_PROGRESS_VERSION = 3;
export const FIRST_PACT_WORLD_WIDTH = 84;
export const FIRST_PACT_WORLD_HEIGHT = 56;

export const FIRST_PACT_DISTRICTS = [
    "arrival-court",
    "grand-colosseum",
    "kennel-ward",
    "market-scriptorium",
    "high-court",
    "bell-quarter",
    "guardian-gardens",
    "aqueduct",
    "gateworks",
] as const;

export type FirstPactDistrict = typeof FIRST_PACT_DISTRICTS[number];

export type FirstPactCoordinate = Readonly<{ x: number; y: number }>;

/** Shared district projection for checkpoints and presentation. The server
 * derives this value from coordinates instead of trusting a client label. */
export function firstPactDistrictAt(point: FirstPactCoordinate): FirstPactDistrict {
    const dx = point.x - 42;
    const dy = point.y - 28;
    if ((dx * dx) + (dy * dy) <= 121) return "grand-colosseum";
    if (point.y >= 47 && point.x >= 33 && point.x <= 52) return "arrival-court";
    if (point.x <= 29 && point.y <= 26) return "guardian-gardens";
    if (point.x <= 29 && point.y >= 27) return "kennel-ward";
    if (point.y <= 18 && point.x >= 29 && point.x <= 56) return "high-court";
    if (point.x >= 56 && point.y <= 23) return "bell-quarter";
    if (point.x >= 56 && point.y <= 40) return "market-scriptorium";
    if (point.x >= 56) return "gateworks";
    return "aqueduct";
}

export const FIRST_PACT_TOURNAMENT = [
    {
        id: "stable-qualifier",
        title: "The Open Sand",
        opponent: "Copper Jackals",
        tier: "warrior",
        requiredWins: 0,
        lesson: "Protect both field positions and rotate a reserve before stamina breaks.",
    },
    {
        id: "stable-semifinal",
        title: "Weather in the Ring",
        opponent: "Rainbell Menagerie",
        tier: "champion",
        requiredWins: 1,
        lesson: "Read the arena weather and preserve the reserve that can reverse the element wheel.",
    },
    {
        id: "stable-final",
        title: "A Name Worth Keeping",
        opponent: "The Gilded Fang",
        tier: "champion",
        requiredWins: 2,
        lesson: "Break the champion's protection pattern before its signature turn arrives.",
    },
] as const;

export type FirstPactTournamentEncounterId = typeof FIRST_PACT_TOURNAMENT[number]["id"];

/** The campaign route is deliberately separate from Sena's optional stable
 * tournament. A side quest can change Court Standing and the city around the
 * player, but can never silently advance or overwrite the main story. */
export const FIRST_PACT_MAIN_STEPS = [
    "cross-the-threshold",
    "meet-scribe-vey",
    "investigate-city-omens",
    "return-to-vey",
    "challenge-court-menagerie",
    "recover-withheld-record",
    "meet-engineer-tam",
    "challenge-lattice-guardian",
    "make-first-pact",
    "challenge-court-echo",
    "return-to-threshold",
    "complete",
] as const;

export type FirstPactMainStep = typeof FIRST_PACT_MAIN_STEPS[number];

export const FIRST_PACT_OMENS = ["bell", "aqueduct", "gardens"] as const;
export type FirstPactOmen = typeof FIRST_PACT_OMENS[number];

export const FIRST_PACT_ANCHOR_QUALITIES = ["reason", "future", "exit", "trust"] as const;
export type FirstPactAnchorQuality = typeof FIRST_PACT_ANCHOR_QUALITIES[number];

/**
 * The pact choice ties the Court's last age to all four modern village arcs.
 * Each answer is defensible, but it gives the Court a different weakness to
 * exploit in the final confrontation. The consequence is spoken later rather
 * than previewed on the choice button.
 */
export const FIRST_PACT_VOWS = [
    {
        id: "open-road",
        choice: "They may leave me. Their place beside me stays open.",
        anchors: ["exit"] as const,
        consequence: "The Court leaves the west gate open and waits for one witness to take the exit you promised.",
        returnCopy: "One companion pauses at the threshold and looks back. It crosses only after choosing your road again. You kept the exit open.",
    },
    {
        id: "shared-reason",
        choice: "I tell them why I fight. Trust is theirs to give.",
        anchors: ["reason", "trust"] as const,
        consequence: "The Court heard your reason and shaped its opening exchange around the command it expects you to give.",
        returnCopy: "The Court learned your reason and still could not make that reason theirs. Your companions cross because their trust remained a choice.",
    },
    {
        id: "kept-future",
        choice: "Record where they disagreed with me. Their future is not mine to edit.",
        anchors: ["future"] as const,
        consequence: "The Court repeats every disagreement Vey preserved and expects four possible futures to split your formation.",
        returnCopy: "Vey's copy keeps every disagreement beside your vow. Four futures leave the city together, with none edited into your command.",
    },
] as const satisfies readonly {
    id: string;
    choice: string;
    anchors: readonly FirstPactAnchorQuality[];
    consequence: string;
    returnCopy: string;
}[];

export type FirstPactVowId = typeof FIRST_PACT_VOWS[number]["id"];

export const FIRST_PACT_MAIN_BEATS = [
    "meet-scribe",
    "omen-bell",
    "omen-aqueduct",
    "omen-gardens",
    "report-omens",
    "recover-record",
    "meet-engineer",
    "forge-first-pact-open-road",
    "forge-first-pact-shared-reason",
    "forge-first-pact-kept-future",
    "complete-crossing",
] as const;
export type FirstPactMainBeat = typeof FIRST_PACT_MAIN_BEATS[number];

export const FIRST_PACT_MAIN_ENCOUNTERS = [
    {
        id: "court-menagerie",
        title: "The Courtesy of Teeth",
        opponent: "The Court Menagerie",
        tier: "champion",
        requiredStep: "challenge-court-menagerie",
        victoryStep: "recover-withheld-record",
        chapterOnWin: 2,
        standing: 250,
        lesson: "The Court calls obedience kindness. Rotate through its restraint pattern and keep both field positions free.",
    },
    {
        id: "lattice-guardian",
        title: "What the Gate Keeps",
        opponent: "Lattice Wardens",
        tier: "champion",
        requiredStep: "challenge-lattice-guardian",
        victoryStep: "make-first-pact",
        chapterOnWin: 3,
        standing: 350,
        lesson: "The intake punishes repetition. Change targets, elements, and field roles before the lattice learns your rhythm.",
    },
    {
        id: "court-echo",
        title: "The First Pact",
        opponent: "Echo of the Balanced Court",
        tier: "champion",
        requiredStep: "challenge-court-echo",
        victoryStep: "return-to-threshold",
        chapterOnWin: 4,
        standing: 700,
        lesson: "No companion is property. Win by trusting all four positions, including the reserves the Court dismisses as excess.",
    },
] as const satisfies readonly {
    id: string;
    title: string;
    opponent: string;
    tier: "warrior" | "champion" | "legend";
    requiredStep: FirstPactMainStep;
    victoryStep: FirstPactMainStep;
    chapterOnWin: 0 | 1 | 2 | 3 | 4;
    standing: number;
    lesson: string;
}[];

export type FirstPactMainEncounterId = typeof FIRST_PACT_MAIN_ENCOUNTERS[number]["id"];
export type FirstPactEncounterId = FirstPactTournamentEncounterId | FirstPactMainEncounterId;

export type FirstPactWorldPosition = {
    x: number;
    y: number;
    district: FirstPactDistrict;
};

export type FirstPactProgress = {
    version: typeof FIRST_PACT_PROGRESS_VERSION;
    enteredAt: number;
    lastVisitedAt: number;
    chapter: 0 | 1 | 2 | 3 | 4;
    mainStep: FirstPactMainStep;
    courtStanding: number;
    flags: string[];
    lastPosition: FirstPactWorldPosition;
    mainQuest: {
        omens: FirstPactOmen[];
        battleProofs: string[];
        pactVow?: FirstPactVowId;
        completedAt?: number;
    };
    stableQuest: {
        status: "not-started" | "accepted" | "complete";
        acceptedAt?: number;
        tournamentWins: 0 | 1 | 2 | 3;
        battleProofs: string[];
        completedAt?: number;
    };
};

const ENCOUNTER_SET = new Set<string>(FIRST_PACT_TOURNAMENT.map((entry) => entry.id));
const MAIN_STEP_SET = new Set<string>(FIRST_PACT_MAIN_STEPS);
const OMEN_SET = new Set<string>(FIRST_PACT_OMENS);
const MAIN_ENCOUNTER_SET = new Set<string>(FIRST_PACT_MAIN_ENCOUNTERS.map((entry) => entry.id));
const VOW_SET = new Set<string>(FIRST_PACT_VOWS.map((entry) => entry.id));

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function createFirstPactProgress(now = Date.now()): FirstPactProgress {
    return {
        version: FIRST_PACT_PROGRESS_VERSION,
        enteredAt: now,
        lastVisitedAt: now,
        chapter: 0,
        mainStep: "cross-the-threshold",
        courtStanding: 0,
        flags: [],
        lastPosition: { x: 42, y: 50, district: "arrival-court" },
        mainQuest: { omens: [], battleProofs: [] },
        stableQuest: { status: "not-started", tournamentWins: 0, battleProofs: [] },
    };
}

export function normalizeFirstPactProgress(value: unknown, now = Date.now()): FirstPactProgress {
    const base = createFirstPactProgress(now);
    if (!value || typeof value !== "object" || Array.isArray(value)) return base;
    const source = value as Record<string, unknown>;
    const positionSource = source.lastPosition && typeof source.lastPosition === "object" && !Array.isArray(source.lastPosition)
        ? source.lastPosition as Record<string, unknown>
        : {};
    const questSource = source.stableQuest && typeof source.stableQuest === "object" && !Array.isArray(source.stableQuest)
        ? source.stableQuest as Record<string, unknown>
        : {};
    const mainSource = source.mainQuest && typeof source.mainQuest === "object" && !Array.isArray(source.mainQuest)
        ? source.mainQuest as Record<string, unknown>
        : {};
    const wins = finiteInt(questSource.tournamentWins, 0, 0, 3) as 0 | 1 | 2 | 3;
    const proofSource = Array.isArray(questSource.battleProofs) ? questSource.battleProofs : [];
    const battleProofs = [...new Set(proofSource
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.slice(0, 96))
        .filter(Boolean))].slice(-8);
    const requestedStatus = String(questSource.status ?? "");
    const status = wins >= 3 || requestedStatus === "complete"
        ? "complete"
        : requestedStatus === "accepted" ? "accepted" : "not-started";
    const positionX = finiteInt(positionSource.x, base.lastPosition.x, 0, FIRST_PACT_WORLD_WIDTH - 1);
    const positionY = finiteInt(positionSource.y, base.lastPosition.y, 0, FIRST_PACT_WORLD_HEIGHT - 1);
    const requestedMainStep = String(source.mainStep ?? "");
    // v1 briefly used mainStep for the stable side quest. Those values migrate
    // to the first real campaign objective instead of leaving an impossible
    // state that no main-story interaction understands.
    const mainStep = (MAIN_STEP_SET.has(requestedMainStep)
        ? requestedMainStep
        : Number(source.chapter) >= 4 ? "return-to-threshold" : "meet-scribe-vey") as FirstPactMainStep;
    const mainProofs = [...new Set((Array.isArray(mainSource.battleProofs) ? mainSource.battleProofs : [])
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.slice(0, 96))
        .filter(Boolean))].slice(-12);
    const omens = [...new Set((Array.isArray(mainSource.omens) ? mainSource.omens : [])
        .filter((entry): entry is FirstPactOmen => typeof entry === "string" && OMEN_SET.has(entry)))];
    const pactVow = VOW_SET.has(String(mainSource.pactVow ?? ""))
        ? String(mainSource.pactVow) as FirstPactVowId
        : undefined;

    return {
        version: FIRST_PACT_PROGRESS_VERSION,
        enteredAt: finiteInt(source.enteredAt, now, 0, Number.MAX_SAFE_INTEGER),
        lastVisitedAt: finiteInt(source.lastVisitedAt, now, 0, Number.MAX_SAFE_INTEGER),
        chapter: finiteInt(source.chapter, 0, 0, 4) as 0 | 1 | 2 | 3 | 4,
        mainStep,
        courtStanding: finiteInt(source.courtStanding, 0, 0, 10_000),
        flags: [...new Set((Array.isArray(source.flags) ? source.flags : [])
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.slice(0, 80))
            .filter(Boolean))].slice(-64),
        lastPosition: {
            x: positionX,
            y: positionY,
            district: firstPactDistrictAt({ x: positionX, y: positionY }),
        },
        mainQuest: {
            omens,
            battleProofs: mainProofs,
            ...(pactVow ? { pactVow } : {}),
            ...(mainSource.completedAt == null ? {} : { completedAt: finiteInt(mainSource.completedAt, now, 0, Number.MAX_SAFE_INTEGER) }),
        },
        stableQuest: {
            status,
            ...(questSource.acceptedAt == null ? {} : { acceptedAt: finiteInt(questSource.acceptedAt, now, 0, Number.MAX_SAFE_INTEGER) }),
            tournamentWins: wins,
            battleProofs,
            ...(questSource.completedAt == null ? {} : { completedAt: finiteInt(questSource.completedAt, now, 0, Number.MAX_SAFE_INTEGER) }),
        },
    };
}

export function acceptStableQuest(progress: FirstPactProgress, now = Date.now()): FirstPactProgress {
    if (progress.mainStep === "cross-the-threshold" || progress.stableQuest.status !== "not-started") return progress;
    return {
        ...progress,
        lastVisitedAt: now,
        flags: [...new Set([...progress.flags, "met-keeper-sena"])],
        stableQuest: { ...progress.stableQuest, status: "accepted", acceptedAt: now },
    };
}

export function firstPactTournamentEncounter(id: unknown) {
    const safe = String(id ?? "");
    if (!ENCOUNTER_SET.has(safe)) return null;
    return FIRST_PACT_TOURNAMENT.find((entry) => entry.id === safe) ?? null;
}

export function firstPactMainEncounter(id: unknown) {
    const safe = String(id ?? "");
    if (!MAIN_ENCOUNTER_SET.has(safe)) return null;
    return FIRST_PACT_MAIN_ENCOUNTERS.find((entry) => entry.id === safe) ?? null;
}

export function firstPactVow(id: unknown) {
    const safe = String(id ?? "");
    if (!VOW_SET.has(safe)) return null;
    return FIRST_PACT_VOWS.find((entry) => entry.id === safe) ?? null;
}

export function firstPactEncounter(id: unknown) {
    return firstPactTournamentEncounter(id) ?? firstPactMainEncounter(id);
}

export function expectedFirstPactTournamentEncounter(progress: FirstPactProgress) {
    if (progress.stableQuest.status !== "accepted") return null;
    return FIRST_PACT_TOURNAMENT.find((entry) => entry.requiredWins === progress.stableQuest.tournamentWins) ?? null;
}

export function expectedFirstPactMainEncounter(progress: FirstPactProgress) {
    return FIRST_PACT_MAIN_ENCOUNTERS.find((entry) => entry.requiredStep === progress.mainStep) ?? null;
}

function withMainFlag(progress: FirstPactProgress, flag: string, now: number): FirstPactProgress {
    return { ...progress, lastVisitedAt: now, flags: [...new Set([...progress.flags, flag])] };
}

/** Server-safe, ordered story reducer. The browser may request a beat, but it
 * cannot skip a chapter: every transition proves the exact predecessor state. */
export function advanceFirstPactMainBeat(
    progress: FirstPactProgress,
    beat: FirstPactMainBeat,
    now = Date.now(),
): { progress: FirstPactProgress; advanced: boolean } {
    let next = progress;
    if (beat === "meet-scribe" && progress.mainStep === "meet-scribe-vey") {
        next = { ...withMainFlag(progress, "chronicle-opened", now), chapter: 1, mainStep: "investigate-city-omens", courtStanding: progress.courtStanding + 50 };
    } else if (beat.startsWith("omen-") && progress.mainStep === "investigate-city-omens") {
        const omen = beat.slice(5) as FirstPactOmen;
        if (!OMEN_SET.has(omen) || progress.mainQuest.omens.includes(omen)) return { progress, advanced: false };
        const omens = [...progress.mainQuest.omens, omen];
        next = {
            ...withMainFlag(progress, `witnessed-${omen}-omen`, now),
            mainStep: omens.length === FIRST_PACT_OMENS.length ? "return-to-vey" : progress.mainStep,
            courtStanding: progress.courtStanding + 25,
            mainQuest: { ...progress.mainQuest, omens },
        };
    } else if (beat === "report-omens" && progress.mainStep === "return-to-vey" && progress.mainQuest.omens.length === FIRST_PACT_OMENS.length) {
        next = { ...withMainFlag(progress, "omens-entered-unaltered", now), chapter: 2, mainStep: "challenge-court-menagerie", courtStanding: progress.courtStanding + 75 };
    } else if (beat === "recover-record" && progress.mainStep === "recover-withheld-record") {
        next = { ...withMainFlag(progress, "withheld-record-recovered", now), mainStep: "meet-engineer-tam", courtStanding: progress.courtStanding + 100 };
    } else if (beat === "meet-engineer" && progress.mainStep === "meet-engineer-tam") {
        next = { ...withMainFlag(progress, "gateworks-route-open", now), chapter: 3, mainStep: "challenge-lattice-guardian" };
    } else if (beat.startsWith("forge-first-pact-") && progress.mainStep === "make-first-pact") {
        const vow = firstPactVow(beat.slice("forge-first-pact-".length));
        if (!vow) return { progress, advanced: false };
        next = {
            ...withMainFlag(progress, `pact-vow-${vow.id}`, now),
            chapter: 4,
            mainStep: "challenge-court-echo",
            courtStanding: progress.courtStanding + 150,
            mainQuest: { ...progress.mainQuest, pactVow: vow.id },
        };
    } else if (beat === "complete-crossing" && progress.mainStep === "return-to-threshold") {
        next = {
            ...withMainFlag(progress, "first-pact-complete", now),
            chapter: 4,
            mainStep: "complete",
            courtStanding: Math.min(10_000, progress.courtStanding + 400),
            mainQuest: { ...progress.mainQuest, completedAt: now },
        };
    }
    return { progress: next, advanced: next !== progress };
}

export function settleFirstPactMainEncounter(
    progress: FirstPactProgress,
    encounterId: FirstPactMainEncounterId,
    outcome: "win" | "loss",
    proofId: string,
    now = Date.now(),
): { progress: FirstPactProgress; advanced: boolean } {
    const safeProof = String(proofId).slice(0, 96);
    if (!safeProof || outcome !== "win" || progress.mainQuest.battleProofs.includes(safeProof)) return { progress, advanced: false };
    const expected = expectedFirstPactMainEncounter(progress);
    if (!expected || expected.id !== encounterId) return { progress, advanced: false };
    const next: FirstPactProgress = {
        ...progress,
        lastVisitedAt: now,
        chapter: expected.chapterOnWin,
        mainStep: expected.victoryStep,
        courtStanding: Math.min(10_000, progress.courtStanding + expected.standing),
        flags: [...new Set([...progress.flags, `defeated-${encounterId}`])],
        mainQuest: { ...progress.mainQuest, battleProofs: [...progress.mainQuest.battleProofs, safeProof].slice(-12) },
    };
    return { progress: next, advanced: true };
}

export function settleFirstPactTournamentEncounter(
    progress: FirstPactProgress,
    encounterId: FirstPactTournamentEncounterId,
    outcome: "win" | "loss",
    proofId: string,
    now = Date.now(),
): { progress: FirstPactProgress; advanced: boolean } {
    const safeProof = String(proofId).slice(0, 96);
    if (!safeProof || progress.stableQuest.battleProofs.includes(safeProof)) {
        return { progress, advanced: false };
    }
    const expected = expectedFirstPactTournamentEncounter(progress);
    if (!expected || expected.id !== encounterId || outcome !== "win") {
        return { progress, advanced: false };
    }

    const tournamentWins = Math.min(3, progress.stableQuest.tournamentWins + 1) as 0 | 1 | 2 | 3;
    const complete = tournamentWins === 3;
    const next: FirstPactProgress = {
        ...progress,
        lastVisitedAt: now,
        courtStanding: Math.min(10_000, progress.courtStanding + (complete ? 300 : 100)),
        flags: complete ? [...new Set([...progress.flags, "stable-saved"])] : progress.flags,
        stableQuest: {
            ...progress.stableQuest,
            status: complete ? "complete" : "accepted",
            tournamentWins,
            battleProofs: [...progress.stableQuest.battleProofs, safeProof].slice(-8),
            ...(complete ? { completedAt: now } : {}),
        },
    };
    return { progress: next, advanced: true };
}
