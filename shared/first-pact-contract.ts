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
export const FIRST_PACT_PROGRESS_VERSION = 7;
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

/**
 * What an opposing stable is actually made of.
 *
 * Without this every encounter in the campaign resolved to the same call --
 * a level-mirrored team drawn at random from the tier's rarities -- so the
 * Court Menagerie and the Gilded Fang were the same four pets under different
 * names, and each encounter's `lesson` promised a mechanic the drawn roster
 * might not carry.
 *
 * `roles` is the lever that makes a lesson true, because the engine derives a
 * pet's utility technique from its role: a defender brings protect, a sage
 * brings weather, an assassin brings pivot, a tracker brings slow or mark. Ask
 * for the role and the mechanic arrives with it.
 *
 * Slots are ordered as the format is played: 0 and 1 take the field, 2 and 3
 * wait in reserve.
 */
export type FirstPactRosterSpec = Readonly<{
    roles?: readonly [string, string, string, string];
    elements?: readonly [string, string, string, string];
    /**
     * Fields the player's own four roles and elements back at them.
     *
     * The stat ceiling is why this exists. `growthShareBonus` is clamped at .35
     * against a champion base of .38, so .73 is the hardest any authored
     * opponent can ever be, and the Balancing's last round already sits at .62.
     * There is no headroom left to build a bigger boss out of, so the last
     * opponent in this campaign is not bigger: it is the player's own answer,
     * which is the one composition nobody can prepare against in advance.
     *
     * Authored rosters carry the flag and no roles; the roles are derived from
     * the submitted team at session start, on the server, from the pets it has
     * already verified the player owns.
     */
    mirrorsPlayer?: true;
    /**
     * Added to the tier's share of the per-level stat budget for this fight
     * only. Levels cannot escalate a late-game campaign -- the builder clamps
     * every pet to 100 and the player is already there -- so difficulty has to
     * move through the stat share instead. Champion tier's base share is .38
     * against a fully trained pet's 1.0, so +.24 on the last fight puts the
     * Court at roughly seven tenths of the player's growth rather than half.
     */
    growthShareBonus?: number;
}>;

export const FIRST_PACT_TOURNAMENT = [
    {
        id: "stable-qualifier",
        title: "The Open Sand",
        opponent: "Copper Jackals",
        tier: "warrior",
        requiredWins: 0,
        lesson: "Protect both field positions and rotate a reserve before stamina breaks.",
        defeat: "The Jackals' handler collects his purse and tells Sena the yard was always going to close. She writes the result in the book herself, in ink, because the Court will read it either way.",
        roster: {
            roles: ["defender", "tracker", "defender", "assassin"],
            elements: ["Earth", "Earth", "Water", "Wind"],
        },
    },
    {
        id: "stable-semifinal",
        title: "Weather in the Ring",
        opponent: "Rainbell Menagerie",
        tier: "champion",
        requiredWins: 1,
        // Two sages, so the weather the lesson names is guaranteed to arrive.
        lesson: "Read the arena weather and preserve the reserve that can reverse the element wheel.",
        defeat: "Rain keeps falling on an empty sand. Sena says nothing about the weather and a great deal about the reserve you left standing.",
        roster: {
            roles: ["sage", "sage", "tracker", "assassin"],
            elements: ["Water", "Wind", "Lightning", "Water"],
            growthShareBonus: .03,
        },
    },
    {
        id: "stable-final",
        title: "A Name Worth Keeping",
        opponent: "The Gilded Fang",
        tier: "champion",
        requiredWins: 2,
        // Two defenders, so there is a protection pattern to break.
        lesson: "Break the champion's protection pattern before its signature turn arrives.",
        defeat: "The Fang's owner is congratulated on a yard he does not own yet. Sena is still at the rail when the crowd goes. She has not asked you to stop.",
        roster: {
            roles: ["defender", "defender", "assassin", "sage"],
            elements: ["Fire", "Earth", "Fire", "Lightning"],
            growthShareBonus: .06,
        },
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
        // A defender pair, so the restraint the lesson names is really there.
        lesson: "The Court calls obedience kindness. Rotate through its restraint pattern and keep both field positions free.",
        defeat: "The Menagerie is led out unhurried, the way a thing is led that was never in danger. A clerk asks whether you would like the finding read aloud. Vey answers for you.",
        roster: {
            roles: ["defender", "defender", "tracker", "sage"],
            elements: ["Earth", "Water", "Wind", "Fire"],
            growthShareBonus: .03,
        },
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
        // Assassins pivot, so the lattice really does move out from under you.
        lesson: "The intake punishes repetition. Change targets, elements, and field roles before the lattice learns your rhythm.",
        defeat: "The intake closes on its own schedule and the wardens step back inside it. Tam swears once, quietly, at a gate she helped build.",
        roster: {
            roles: ["assassin", "assassin", "tracker", "defender"],
            elements: ["Lightning", "Fire", "Lightning", "Earth"],
            growthShareBonus: .07,
        },
    },
    /*
     * The Balancing: the Court's final assize, fought as four rounds at the
     * southern Colosseum gate rather than one confrontation. Each round is a
     * different argument -- assessment, then the arena itself, then a wall that
     * will not die, then the Court's own reading of you -- and each is drawn
     * from a roster that guarantees the mechanic its lesson names.
     *
     * Rounds share `requiredStep`, so `requiredTrialWins` is what orders them.
     * Only the last round carries the story forward; the first three advance
     * the trial counter and leave the step where it is.
     */
    {
        id: "court-assessors",
        title: "Read Before Touched",
        opponent: "The Ninefold Assessors",
        tier: "champion",
        requiredStep: "challenge-court-echo",
        requiredTrialWins: 0,
        victoryStep: "challenge-court-echo",
        chapterOnWin: 4,
        standing: 200,
        lesson: "The Court measures before it strikes. Every mark it lands is a note taken; break the marked pet's rhythm before the note is used.",
        defeat: "The Assessors do not celebrate. They finish their notes, and one of them writes a word beside your name that you are not shown.",
        roster: {
            roles: ["tracker", "tracker", "assassin", "defender"],
            elements: ["Lightning", "Wind", "Lightning", "Earth"],
            growthShareBonus: .11,
        },
    },
    {
        id: "court-chorus",
        title: "The Kept Chorus",
        opponent: "Choir of the Standing Weather",
        tier: "champion",
        requiredStep: "challenge-court-echo",
        requiredTrialWins: 1,
        victoryStep: "challenge-court-echo",
        chapterOnWin: 4,
        standing: 250,
        lesson: "They will not fight you; they will change the room until the room fights you. Hold a reserve that answers the standing weather.",
        defeat: "The weather they raised stays up over an empty ring after the bout, because nobody has ordered it down.",
        roster: {
            roles: ["sage", "sage", "sage", "tracker"],
            elements: ["Water", "Fire", "Wind", "Water"],
            growthShareBonus: .15,
        },
    },
    {
        id: "court-wall",
        title: "The Obedient Wall",
        opponent: "The Wall That Was Told",
        tier: "champion",
        requiredStep: "challenge-court-echo",
        requiredTrialWins: 2,
        victoryStep: "challenge-court-echo",
        chapterOnWin: 4,
        standing: 300,
        lesson: "Nothing here dies while the pattern holds, and the pattern is obedience. Force a turn it was never ordered to take.",
        defeat: "The Wall is standing where it was told to stand. It is not breathing hard. Nothing here was ever asked to.",
        roster: {
            roles: ["defender", "defender", "defender", "sage"],
            elements: ["Earth", "Water", "Fire", "Earth"],
            growthShareBonus: .19,
        },
    },
    {
        id: "court-echo",
        title: "The First Pact",
        opponent: "Echo of the Balanced Court",
        tier: "champion",
        requiredStep: "challenge-court-echo",
        requiredTrialWins: 3,
        victoryStep: "return-to-threshold",
        chapterOnWin: 4,
        standing: 700,
        // One of each role: the Echo answers every argument the first three
        // rounds made separately, which is the whole point of it going last.
        lesson: "No companion is property. Win by trusting all four positions, including the reserves the Court dismisses as excess.",
        defeat: "The Echo returns your companions to you one at a time, correctly, and waits to see whether you will thank it. The Court will hear the claim again. It is in no hurry.",
        roster: {
            roles: ["defender", "sage", "assassin", "tracker"],
            elements: ["Fire", "Water", "Wind", "Lightning"],
            growthShareBonus: .24,
        },
    },
] as const satisfies readonly {
    id: string;
    title: string;
    opponent: string;
    /** The engine has no "legend" tier. Authoring one throws inside the team
     *  builder, because TIER_RARITIES has no entry to read. Kept narrow to the
     *  real union so a bigger boss is a compile error rather than a 500. */
    tier: "warrior" | "champion";
    requiredStep: FirstPactMainStep;
    /** Rounds of the final trial that must already be won. Absent for the
     *  single confrontations that are ordered by `requiredStep` alone. */
    requiredTrialWins?: number;
    victoryStep: FirstPactMainStep;
    chapterOnWin: 0 | 1 | 2 | 3 | 4;
    standing: number;
    lesson: string;
    /** What the opponent leaves behind when the player loses. */
    defeat: string;
    roster: FirstPactRosterSpec;
}[];

/** `as const satisfies` narrows each entry to its own literal type, so the
 *  optional round marker is absent from the members that omit it. One typed
 *  reader keeps every call site honest without widening the id union. */
export function firstPactTrialWinsRequired(
    entry: typeof FIRST_PACT_MAIN_ENCOUNTERS[number],
): number | undefined {
    return (entry as { requiredTrialWins?: number }).requiredTrialWins;
}

/**
 * The Court's writs, served across the city while the campaign is running.
 *
 * The campaign used to be a corridor: two confrontations, then the Colosseum,
 * with the districts as scenery you walked through between conversations. The
 * writs put the Court in those districts. Each one is served on a quarter the
 * player already has a reason to be in, answered by the citizen who lives
 * there, and drawn from a roster shaped by what that quarter is for.
 *
 * They are not required individually and they can be taken in any order. What
 * they are is the standing the Court demands before it will hear an unedited
 * claim, which is why the Balancing is locked until enough of them are answered.
 */
export const FIRST_PACT_DISTRICT_WRITS = [
    {
        id: "writ-silencing",
        title: "The Silencing Detail",
        opponent: "The Silencing Detail",
        district: "bell-quarter",
        giver: "bellwarden-isu",
        tier: "champion",
        standing: 175,
        summons: "They came at dawn with muzzles sized for animals that have not been measured. The bell rang before they reached the roost, and nobody pulled it.",
        lesson: "They will silence the loudest of yours first. Lead with the one they expect to hear, and answer from the reserve they did not.",
        defeat: "The detail files the bout as inconclusive and stays camped below the roost. Isu keeps the bell rope in her hand and does not go home.",
        roster: {
            roles: ["tracker", "tracker", "defender", "sage"],
            elements: ["Wind", "Lightning", "Wind", "Earth"],
            growthShareBonus: .08,
        },
    },
    {
        id: "writ-audit",
        title: "The Standing Audit",
        opponent: "The Court Auditors",
        district: "market-scriptorium",
        giver: "market-rho",
        tier: "champion",
        standing: 175,
        summons: "An auditor counted my stock this morning, then counted the beasts hauling it and used the same column for both. I asked her to use a different column. She asked me to move.",
        lesson: "An auditor spends the fight proving your reserves are surplus. Use all four and the argument writes itself.",
        defeat: "The auditor rules that her count stands and schedules a second visit. Rho starts moving stock she has no intention of surrendering.",
        roster: {
            roles: ["sage", "tracker", "assassin", "defender"],
            elements: ["Fire", "Water", "Fire", "Water"],
            growthShareBonus: .10,
        },
    },
    {
        id: "writ-pruning",
        title: "The Pruning Order",
        opponent: "The Pruning Order",
        district: "guardian-gardens",
        giver: "garden-keeper",
        tier: "champion",
        standing: 175,
        summons: "An order came to cut back everything that grew in a direction the plan did not allow. The plan is four hundred years old. So is the tree.",
        lesson: "They cut what reaches. Keep reaching, and make the second rank the thing that finishes the turn.",
        defeat: "The Order marks the tree and leaves the marks up. Old Kaio spends the evening washing chalk off bark that is older than the plan.",
        roster: {
            roles: ["defender", "sage", "sage", "assassin"],
            elements: ["Earth", "Earth", "Water", "Wind"],
            growthShareBonus: .12,
        },
    },
    {
        id: "writ-impound",
        title: "The Impound",
        opponent: "The Impound Detail",
        district: "kennel-ward",
        giver: "kennel-hand",
        tier: "champion",
        standing: 175,
        summons: "They have paper for four of ours. Sena is at the Colosseum and the paper is dated today, which is how they like to do it. I can hold the gate. I cannot hold the gate alone.",
        lesson: "An impound is patient and it does not tire. Break something before its fourth turn or it takes the yard by arithmetic.",
        defeat: "The detail withdraws to the ward gate with the paper still in hand. Pell holds the gate. He will be holding it when you come back.",
        roster: {
            roles: ["defender", "defender", "tracker", "assassin"],
            elements: ["Lightning", "Fire", "Earth", "Lightning"],
            growthShareBonus: .14,
        },
    },
] as const satisfies readonly {
    id: string;
    title: string;
    opponent: string;
    district: FirstPactDistrict;
    giver: string;
    /** The engine has no "legend" tier. Authoring one throws inside the team
     *  builder, because TIER_RARITIES has no entry to read. Kept narrow to the
     *  real union so a bigger boss is a compile error rather than a 500. */
    tier: "warrior" | "champion";
    standing: number;
    summons: string;
    lesson: string;
    /** What the opponent leaves behind when the player loses. */
    defeat: string;
    roster: FirstPactRosterSpec;
}[];

export type FirstPactWritId = typeof FIRST_PACT_DISTRICT_WRITS[number]["id"];

/**
 * What the Court demands before it will sit.
 *
 * Reachable standing at the end of Chapter III is 1,050: the story beats and
 * the two confrontations. The writs are worth 700 between them and Sena's
 * tournament another 500, so this threshold cannot be met by the corridor
 * alone and cannot force any single errand either -- there is more than one
 * way to 1,600, which is the point.
 */
export const FIRST_PACT_BALANCING_STANDING = 1_600;

/** How many rounds the Balancing runs. */
export const FIRST_PACT_TRIAL_ROUNDS = FIRST_PACT_MAIN_ENCOUNTERS.filter(
    (entry) => firstPactTrialWinsRequired(entry) !== undefined,
).length;

export type FirstPactMainEncounterId = typeof FIRST_PACT_MAIN_ENCOUNTERS[number]["id"];
/** Everything /api/pet/showdown will open a First Pact session for: the stable
 *  tournament, the campaign's confrontations, and the Court's district writs. */
export type FirstPactEncounterId =
    | FirstPactTournamentEncounterId
    | FirstPactMainEncounterId
    | FirstPactWritId
    | FirstPactStandingCourtRoundId;

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
    /** Rounds of the Balancing already won. Its proofs are kept apart from the
     *  main quest's so a replayed round cannot consume a main-path proof slot. */
    finalTrial: {
        wins: number;
        battleProofs: string[];
    };
    /** District writs already answered, in the order they were taken. */
    writs: string[];
    writProofs: string[];
    /** Answered writs whose finding the player has since paid to have entered
     *  into the permanent record. Always a subset of `writs`. */
    findings: string[];
    /** The rerun. `round` is the current sitting of a live run, `best` the
     *  furthest ever reached, `clears` the number of full gauntlets answered.
     *  Kept entirely apart from `finalTrial`, so re-fighting the Balancing can
     *  never touch the story's record of having fought it once. */
    standingCourt: {
        round: number;
        best: number;
        clears: number;
        battleProofs: string[];
    };
};

const ENCOUNTER_SET = new Set<string>(FIRST_PACT_TOURNAMENT.map((entry) => entry.id));
const MAIN_STEP_SET = new Set<string>(FIRST_PACT_MAIN_STEPS);
const OMEN_SET = new Set<string>(FIRST_PACT_OMENS);
const MAIN_ENCOUNTER_SET = new Set<string>(FIRST_PACT_MAIN_ENCOUNTERS.map((entry) => entry.id));
const VOW_SET = new Set<string>(FIRST_PACT_VOWS.map((entry) => entry.id));
const WRIT_SET = new Set<string>(FIRST_PACT_DISTRICT_WRITS.map((entry) => entry.id));

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
        finalTrial: { wins: 0, battleProofs: [] },
        writs: [],
        writProofs: [],
        findings: [],
        standingCourt: { round: 0, best: 0, clears: 0, battleProofs: [] },
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
    // A save written before the Balancing existed has no trial state. It
    // defaults to zero rounds won, which puts a returning Chapter IV player at
    // the first round rather than stranding them on a step with no encounter.
    const trialSource = source.finalTrial && typeof source.finalTrial === "object" && !Array.isArray(source.finalTrial)
        ? source.finalTrial as Record<string, unknown>
        : {};
    const trialWins = finiteInt(trialSource.wins, 0, 0, FIRST_PACT_TRIAL_ROUNDS);
    const trialProofs = [...new Set((Array.isArray(trialSource.battleProofs) ? trialSource.battleProofs : [])
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
    const answered = [...new Set((Array.isArray(source.writs) ? source.writs : [])
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry) => WRIT_SET.has(entry)))];
    const standingSource = source.standingCourt && typeof source.standingCourt === "object" && !Array.isArray(source.standingCourt)
        ? source.standingCourt as Record<string, unknown>
        : {};

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
        finalTrial: { wins: trialWins, battleProofs: trialProofs },
        writs: answered,
        writProofs: [...new Set((Array.isArray(source.writProofs) ? source.writProofs : [])
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.slice(0, 96))
            .filter(Boolean))].slice(-8),
        // A finding cannot exist for a writ this character never answered, so
        // the answered list is the filter rather than the id set alone.
        findings: [...new Set((Array.isArray(source.findings) ? source.findings : [])
            .filter((entry): entry is string => typeof entry === "string")
            .filter((entry) => WRIT_SET.has(entry) && answered.includes(entry)))],
        standingCourt: {
            // A run in progress is clamped to a real sitting: a stored round at
            // or past the end of the gauntlet is a finished run, which starts
            // over at the top rather than pointing at a sitting that is not there.
            round: finiteInt(standingSource.round, 0, 0, FIRST_PACT_STANDING_COURT_LENGTH - 1),
            best: finiteInt(standingSource.best, 0, 0, FIRST_PACT_STANDING_COURT_LENGTH),
            clears: finiteInt(standingSource.clears, 0, 0, 9_999),
            battleProofs: [...new Set((Array.isArray(standingSource.battleProofs) ? standingSource.battleProofs : [])
                .filter((entry): entry is string => typeof entry === "string")
                .map((entry) => entry.slice(0, 96))
                .filter(Boolean))].slice(-8),
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

export function firstPactWritEncounter(id: unknown) {
    const safe = String(id ?? "");
    return FIRST_PACT_DISTRICT_WRITS.find((entry) => entry.id === safe) ?? null;
}

/** Widening reader for an encounter's roster. The three authored tables are
 *  `as const`, which narrows each entry's roster to exactly the keys it wrote,
 *  so the optional ones are not visible on the union without this. */
export function firstPactRosterOf(entry: { roster: unknown }): FirstPactRosterSpec {
    return entry.roster as FirstPactRosterSpec;
}

export function firstPactEncounter(id: unknown) {
    return firstPactTournamentEncounter(id)
        ?? firstPactMainEncounter(id)
        ?? firstPactWritEncounter(id)
        ?? firstPactStandingCourtRound(id);
}

/** Writs are served once the Court has a claim to answer, and each is answered
 *  once. Order is the player's; the districts are not a queue. */
export function firstPactWritOpen(progress: FirstPactProgress, id: unknown): boolean {
    const writ = firstPactWritEncounter(id);
    if (!writ) return false;
    if (progress.chapter < 2) return false;
    return !progress.writs.includes(writ.id);
}

/**
 * What a finished crossing has earned, as title keys the server resolves
 * against its own registry.
 *
 * Kept here, beside the progress it reads, so the rule is one pure function
 * both the endpoint and its tests can call -- and so a client can show the
 * player what a second run through a different vow would be worth without
 * being trusted to award any of it.
 */
export function firstPactEarnedTitleKeys(progress: FirstPactProgress): string[] {
    if (progress.mainStep !== "complete") return [];
    const keys = ["complete"];
    if (progress.mainQuest.pactVow) keys.push(progress.mainQuest.pactVow);
    const everyWrit = FIRST_PACT_DISTRICT_WRITS.every((writ) => progress.writs.includes(writ.id));
    if (everyWrit && progress.stableQuest.status === "complete") keys.push("thorough");
    return keys;
}

/**
 * Aura Stones a finished crossing is worth.
 *
 * Deliberately calibrated against how scarce this currency already is rather
 * than against how long the campaign takes. An A Rank bloodline costs 100, and
 * the ranked ladder -- the competitive faucet -- pays its season podium 10, 6
 * and 3 per THIRTY DAYS. So a full crossing is a quarter of one A Rank, once
 * ever, per character: a real contribution to the ladder rather than a way
 * around it.
 *
 * The optional content carries a third of it, which is the other reason the
 * writs and Vale Stable exist.
 */
export const FIRST_PACT_AURA_BASE = 15;
export const FIRST_PACT_AURA_EVERY_WRIT = 5;
export const FIRST_PACT_AURA_STABLE_KEPT = 5;

export function firstPactAuraStoneReward(progress: FirstPactProgress): number {
    if (progress.mainStep !== "complete") return 0;
    let stones = FIRST_PACT_AURA_BASE;
    if (FIRST_PACT_DISTRICT_WRITS.every((writ) => progress.writs.includes(writ.id))) {
        stones += FIRST_PACT_AURA_EVERY_WRIT;
    }
    if (progress.stableQuest.status === "complete") stones += FIRST_PACT_AURA_STABLE_KEPT;
    return stones;
}

/**
 * What it costs to have one writ's finding entered into the permanent record.
 *
 * Court Standing used to be a threshold and nothing else: it opened the
 * Balancing at 1,600 and was never spent, so a player who answered every writ
 * and saved Vale Stable finished with roughly 4,100 of a currency that bought
 * nothing. This is what the surplus is for. Entering all four costs 2,400,
 * which is most of what the optional content pays and none of what the
 * corridor does.
 */
export const FIRST_PACT_FINDING_COST = 600;

/**
 * Standing the Court will let you spend right now.
 *
 * The Balancing gate reads the same number, so an unguarded sink is a trap: a
 * player could buy findings down below 1,600 and find the door shut with no
 * writs left to earn it back. Until the Court has actually sat, the threshold
 * is reserved and only the surplus above it is spendable. Once the trial has
 * begun the gate is behind them and the whole balance is theirs.
 */
export function firstPactStandingReserve(progress: FirstPactProgress): number {
    if (progress.mainStep === "complete" || progress.finalTrial.wins > 0) return 0;
    return FIRST_PACT_BALANCING_STANDING;
}

export function firstPactStandingSpendable(progress: FirstPactProgress): number {
    return Math.max(0, progress.courtStanding - firstPactStandingReserve(progress));
}

/** A finding can be entered for a writ that was answered and not yet entered. */
export function firstPactFindingOpen(progress: FirstPactProgress, id: unknown): boolean {
    const writ = firstPactWritEncounter(id);
    if (!writ) return false;
    return progress.writs.includes(writ.id) && !progress.findings.includes(writ.id);
}

/** Writs answered but not yet entered, in the order they were answered. */
export function firstPactOpenFindings(progress: FirstPactProgress): string[] {
    return progress.writs.filter((id) => !progress.findings.includes(id));
}

/**
 * Buy one finding its place in the record.
 *
 * Server-safe and total: it re-derives the price and the reserve from the
 * progress it was handed, so the browser supplies a writ id and nothing else.
 */
export function enterFirstPactFinding(
    progress: FirstPactProgress,
    id: unknown,
    now = Date.now(),
): { progress: FirstPactProgress; advanced: boolean } {
    const writ = firstPactWritEncounter(id);
    if (!writ || !firstPactFindingOpen(progress, writ.id)) return { progress, advanced: false };
    if (firstPactStandingSpendable(progress) < FIRST_PACT_FINDING_COST) return { progress, advanced: false };
    const next: FirstPactProgress = {
        ...progress,
        lastVisitedAt: now,
        courtStanding: Math.max(0, progress.courtStanding - FIRST_PACT_FINDING_COST),
        flags: [...new Set([...progress.flags, `entered-${writ.id}`])],
        findings: [...progress.findings, writ.id],
    };
    return { progress: next, advanced: true };
}

/**
 * The Standing Court.
 *
 * The campaign's one road was one-way: writs, tournament and Balancing are all
 * consumed on completion, so a finished crossing left a walkable city with
 * nothing in it. This is the way back in, and it is deliberately the shape of a
 * tournament rerun rather than a second playthrough. No story beats, no writs,
 * no walking the districts again. You go to the sand and the Court sits.
 *
 * Five sittings, run start to finish. The first four are the Balancing's own
 * arguments at a harder weight, so the gauntlet is recognisable. The fifth is
 * new, and it is the point of the whole thing.
 *
 * LOSING RESETS THE RUN. Nothing is taken away and nothing is spent; the run
 * starts again at the first sitting. That is the entire difficulty budget, and
 * it has to be, because the stat ceiling is nearly reached already:
 * `growthShareBonus` clamps at .35 over a champion base of .38, so .73 is the
 * hardest an authored opponent can ever be and the story's last round is at
 * .62. A rerun cannot be made hard by making it bigger.
 */
export const FIRST_PACT_STANDING_COURT_STANDING = 400;

export type FirstPactStandingCourtRound = Readonly<{
    /** Literal, so an encounter id stays a checked union everywhere it travels. */
    id: FirstPactStandingCourtRoundId;
    round: number;
    title: string;
    opponent: string;
    tier: "warrior" | "champion";
    lesson: string;
    defeat: string;
    roster: FirstPactRosterSpec;
}>;

/**
 * The rerun's first four sittings: an id of their own, the Balancing round they
 * re-argue, and the weight they re-argue it at. The story runs .11 / .15 / .19
 * / .24; every one of these runs above all of it.
 *
 * Ids are written out rather than derived, because a template string would
 * collapse `FirstPactEncounterId` from a union to `string` and every consumer
 * of it would stop being checked. The rest is derived, so a lesson or a roster
 * edited in the campaign is the same argument here and cannot drift.
 */
const STANDING_COURT_SITTINGS = [
    { id: "standing-court-assessors", from: "court-assessors", weight: .20 },
    { id: "standing-court-chorus", from: "court-chorus", weight: .24 },
    { id: "standing-court-wall", from: "court-wall", weight: .28 },
    { id: "standing-court-echo", from: "court-echo", weight: .32 },
] as const;

export const FIRST_PACT_STANDING_COURT_ROUNDS: readonly FirstPactStandingCourtRound[] = [
    ...STANDING_COURT_SITTINGS.map((sitting, index): FirstPactStandingCourtRound => {
        const source = FIRST_PACT_MAIN_ENCOUNTERS.find((entry) => entry.id === sitting.from);
        if (!source) throw new Error(`Standing Court sitting ${sitting.id} re-argues a round that no longer exists.`);
        return {
            id: sitting.id,
            round: index,
            title: source.title,
            opponent: source.opponent,
            tier: source.tier,
            lesson: source.lesson,
            defeat: source.defeat,
            roster: { ...source.roster, growthShareBonus: sitting.weight },
        };
    }),
    {
        id: "standing-court-arbiter",
        round: STANDING_COURT_SITTINGS.length,
        title: "The Court Argues From a Person",
        opponent: "The Arbiter",
        tier: "champion",
        /*
         * The Arbiter's stated position, spoken once in the High Court square
         * after the crossing closes, is that a Court which argues from a person
         * is only that person. Fielding a team personally is therefore the
         * Court breaking its own founding rule, and it only does that because
         * it lost. The rerun is not a difficulty setting; it is the consequence
         * of having won.
         */
        lesson: "The Court has stopped arguing and started answering. It brought your own four positions to do it, so there is nothing on that sand you did not choose yourself.",
        defeat: "The Arbiter files the result without comment and steps down off the sand, and the four that beat you are led away in the order you would have led them. Nothing is taken. The docket opens again at the top.",
        roster: { mirrorsPlayer: true, growthShareBonus: .35 },
    },
];

export type FirstPactStandingCourtRoundId =
    | typeof STANDING_COURT_SITTINGS[number]["id"]
    | "standing-court-arbiter";

const STANDING_COURT_SET = new Set<string>(FIRST_PACT_STANDING_COURT_ROUNDS.map((entry) => entry.id));

/** How many sittings a full run is. */
export const FIRST_PACT_STANDING_COURT_LENGTH = FIRST_PACT_STANDING_COURT_ROUNDS.length;

export function firstPactStandingCourtRound(id: unknown): FirstPactStandingCourtRound | null {
    const safe = String(id ?? "");
    if (!STANDING_COURT_SET.has(safe)) return null;
    return FIRST_PACT_STANDING_COURT_ROUNDS.find((entry) => entry.id === safe) ?? null;
}

/** The Court will not sit again for a claimant who never closed the crossing. */
export function firstPactStandingCourtOpen(progress: FirstPactProgress): boolean {
    return progress.mainStep === "complete";
}

export function expectedFirstPactStandingCourtRound(progress: FirstPactProgress): FirstPactStandingCourtRound | null {
    if (!firstPactStandingCourtOpen(progress)) return null;
    return FIRST_PACT_STANDING_COURT_ROUNDS[progress.standingCourt.round] ?? null;
}

/**
 * The player's own four roles and elements, as an opposing roster.
 *
 * Derived on the server from pets it has already verified the player owns, so a
 * client cannot ask the Court to bring something easier. A pet with no stored
 * role still has to fill its slot, and the four campaign roles cycle to fill it:
 * an unroled team meets one of everything rather than nothing at all.
 */
export function firstPactMirrorRoster(
    pets: readonly { role?: unknown; element?: unknown }[],
    growthShareBonus?: number,
): FirstPactRosterSpec {
    const fallbackRoles = ["defender", "sage", "assassin", "tracker"] as const;
    const fallbackElements = ["Fire", "Water", "Wind", "Lightning"] as const;
    const at = (index: number) => {
        const pet = pets[index];
        const role = String(pet?.role ?? "").trim();
        const element = String(pet?.element ?? "").trim();
        return {
            role: role || fallbackRoles[index % fallbackRoles.length],
            element: element || fallbackElements[index % fallbackElements.length],
        };
    };
    const slots = [at(0), at(1), at(2), at(3)];
    return {
        roles: [slots[0].role, slots[1].role, slots[2].role, slots[3].role],
        elements: [slots[0].element, slots[1].element, slots[2].element, slots[3].element],
        ...(growthShareBonus === undefined ? {} : { growthShareBonus }),
    };
}

/**
 * Settle one sitting of the Standing Court.
 *
 * Unlike every other settle function in this contract, a LOSS is meaningful
 * here: it ends the run and puts the player back at the first sitting. That is
 * the whole of the difficulty, so it must never be silently dropped.
 */
export function settleFirstPactStandingCourtRound(
    progress: FirstPactProgress,
    roundId: string,
    outcome: "win" | "loss",
    proofId: string,
    now = Date.now(),
): { progress: FirstPactProgress; advanced: boolean } {
    const safeProof = String(proofId).slice(0, 96);
    if (!safeProof || progress.standingCourt.battleProofs.includes(safeProof)) return { progress, advanced: false };
    const expected = expectedFirstPactStandingCourtRound(progress);
    if (!expected || expected.id !== roundId) return { progress, advanced: false };

    const proofs = [...progress.standingCourt.battleProofs, safeProof].slice(-8);
    if (outcome !== "win") {
        return {
            progress: {
                ...progress,
                lastVisitedAt: now,
                standingCourt: { ...progress.standingCourt, round: 0, battleProofs: proofs },
            },
            advanced: true,
        };
    }

    const cleared = expected.round + 1;
    const finished = cleared >= FIRST_PACT_STANDING_COURT_LENGTH;
    return {
        progress: {
            ...progress,
            lastVisitedAt: now,
            ...(finished
                ? {
                    courtStanding: Math.min(10_000, progress.courtStanding + FIRST_PACT_STANDING_COURT_STANDING),
                    flags: [...new Set([...progress.flags, "answered-standing-court"])],
                }
                : {}),
            standingCourt: {
                round: finished ? 0 : cleared,
                best: Math.max(progress.standingCourt.best, cleared),
                clears: progress.standingCourt.clears + (finished ? 1 : 0),
                battleProofs: proofs,
            },
        },
        advanced: true,
    };
}

/** Standing still owed before the Court will sit, or 0 once it will. */
export function firstPactBalancingOwed(progress: FirstPactProgress): number {
    return Math.max(0, FIRST_PACT_BALANCING_STANDING - progress.courtStanding);
}

export function expectedFirstPactTournamentEncounter(progress: FirstPactProgress) {
    if (progress.stableQuest.status !== "accepted") return null;
    return FIRST_PACT_TOURNAMENT.find((entry) => entry.requiredWins === progress.stableQuest.tournamentWins) ?? null;
}

export function expectedFirstPactMainEncounter(progress: FirstPactProgress) {
    return FIRST_PACT_MAIN_ENCOUNTERS.find((entry) => {
        const required = firstPactTrialWinsRequired(entry);
        if (entry.requiredStep !== progress.mainStep) return false;
        if (required === undefined) return true;
        // The Court does not sit for a claimant it can afford to ignore, and it
        // only reconsiders once, at the door: standing is checked to open the
        // trial, never between its sittings.
        if (progress.finalTrial.wins === 0 && progress.courtStanding < FIRST_PACT_BALANCING_STANDING) return false;
        return required === progress.finalTrial.wins;
    }) ?? null;
}

/** Which round of the Balancing is open, or null outside the final trial. */
export function firstPactTrialRound(progress: FirstPactProgress): { round: number; of: number } | null {
    const encounter = expectedFirstPactMainEncounter(progress);
    const required = encounter ? firstPactTrialWinsRequired(encounter) : undefined;
    if (required === undefined) return null;
    return { round: required + 1, of: FIRST_PACT_TRIAL_ROUNDS };
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
    if (!safeProof || outcome !== "win") return { progress, advanced: false };
    const expected = expectedFirstPactMainEncounter(progress);
    if (!expected || expected.id !== encounterId) return { progress, advanced: false };

    const trialRound = firstPactTrialWinsRequired(expected) !== undefined;
    const proofs = trialRound ? progress.finalTrial.battleProofs : progress.mainQuest.battleProofs;
    if (proofs.includes(safeProof)) return { progress, advanced: false };

    const next: FirstPactProgress = {
        ...progress,
        lastVisitedAt: now,
        chapter: expected.chapterOnWin,
        mainStep: expected.victoryStep,
        courtStanding: Math.min(10_000, progress.courtStanding + expected.standing),
        flags: [...new Set([...progress.flags, `defeated-${encounterId}`])],
        ...(trialRound
            ? {
                finalTrial: {
                    wins: Math.min(FIRST_PACT_TRIAL_ROUNDS, progress.finalTrial.wins + 1),
                    battleProofs: [...progress.finalTrial.battleProofs, safeProof].slice(-8),
                },
            }
            : {
                mainQuest: { ...progress.mainQuest, battleProofs: [...progress.mainQuest.battleProofs, safeProof].slice(-12) },
            }),
    };
    return { progress: next, advanced: true };
}

export function settleFirstPactWritEncounter(
    progress: FirstPactProgress,
    writId: string,
    outcome: "win" | "loss",
    proofId: string,
    now = Date.now(),
): { progress: FirstPactProgress; advanced: boolean } {
    const safeProof = String(proofId).slice(0, 96);
    if (!safeProof || outcome !== "win" || progress.writProofs.includes(safeProof)) return { progress, advanced: false };
    const writ = firstPactWritEncounter(writId);
    if (!writ || !firstPactWritOpen(progress, writId)) return { progress, advanced: false };
    const next: FirstPactProgress = {
        ...progress,
        lastVisitedAt: now,
        courtStanding: Math.min(10_000, progress.courtStanding + writ.standing),
        flags: [...new Set([...progress.flags, `answered-${writ.id}`])],
        writs: [...progress.writs, writ.id],
        writProofs: [...progress.writProofs, safeProof].slice(-8),
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
