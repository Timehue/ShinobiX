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
export const FIRST_PACT_PROGRESS_VERSION = 8;
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
        lesson: "Keep both active positions covered. Rotate a reserve before either active pet runs out of stamina.",
        defeat: "The Jackals' handler pockets his purse and tells Sena to clear the yard before final bell. Sena writes down the loss herself and asks whether your reserves can run again.",
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
        lesson: "Watch the arena weather. Keep a reserve whose element can reverse the matchup when it changes.",
        defeat: "Rain keeps falling after the sand empties. Sena checks all four harnesses at the rail and tells the assessor Vale is taking the next bell.",
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
        lesson: "Break the champion's guard pattern before its signature turn arrives.",
        defeat: "Officials congratulate the Fang's owner on taking Vale's yard before the order is signed. Sena stays at the rail and tells Orin to keep the entry open.",
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
        consequence: "The Court opens the west gate and tries to split your formation by offering one companion the exit you promised.",
        returnCopy: "One companion pauses at the threshold, looks back, and then crosses after you. The road remained open, and the choice remained theirs.",
    },
    {
        id: "shared-reason",
        choice: "I tell them why I fight. Trust is theirs to give.",
        anchors: ["reason", "trust"] as const,
        consequence: "The Court repeats your reason as an order and shapes its opening exchange around the response it expects.",
        returnCopy: "At the threshold, the Court repeats your reason in its command voice. One companion waits until the order ends, then crosses beside you for the reason you shared.",
    },
    {
        id: "kept-future",
        choice: "Record where they disagreed with me. Their future is not mine to edit.",
        anchors: ["future"] as const,
        consequence: "The Court repeats every disagreement Vey recorded and uses each one to pull your four companions toward a different position.",
        returnCopy: "Vey leaves every disagreement uncrossed beside your vow. Your four reach the threshold at different paces, wait until all are ready, and cross together.",
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
        lesson: "The Menagerie locks one active position at a time. Rotate before the restraint lands and keep both positions available.",
        defeat: "The handlers lead the Menagerie out at an easy pace. A clerk offers to read the Court's ownership finding. Vey tells her to save her breath.",
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
        lesson: "Both assassins can strike and withdraw behind the healthiest reserve. Keep a counter ready for the pet that pivots in.",
        defeat: "The intake lock closes and the wardens step back behind it. Tam checks the pressure dial, swears once, and starts resetting the bypass.",
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
        lesson: "The Assessors mark a pet before striking it. Rotate or change that pet's action before they use the mark.",
        defeat: "The Assessors finish their notes without looking up. One writes a word beside your name, covers it with a thumb, and hands the page to Orin.",
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
        lesson: "The Chorus changes the arena weather instead of attacking directly. Keep a reserve whose element answers the current weather.",
        defeat: "The Chorus leaves the summoned weather hanging over the empty ring. Orin waits for an order to clear it; none comes.",
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
        lesson: "The Wall recovers while its guard order remains unbroken. Force it to change roles before you spend your strongest turn.",
        defeat: "The Wall returns to its starting marks without waiting for praise. Its handlers check the spacing and never address the animals by name.",
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
        lesson: "Use all four companions and let the reserves answer openings the Court considers expendable.",
        defeat: "The Echo returns your companions one at a time and waits for your response. Orin keeps the hearing open for another attempt.",
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
        summons: "They brought muzzles before dawn, though nobody measured my rookbeasts. The bell rang while the detail was still on the stairs. I need them away from the roost before the next ringing.",
        lesson: "The detail targets the loudest active pet first. Draw that restraint, then answer with the reserve they ignored.",
        defeat: "The detail calls the bout inconclusive and camps below the roost. Isu keeps one hand on the bell rope and sends her relief warden home.",
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
        summons: "The auditor put my haulers in the STOCK column beside the feed sacks. I asked for a separate count. She ordered me off my own counter. Help me clear it before she returns.",
        lesson: "The auditors treat reserves as surplus. Rotate all four companions so their count cannot erase either reserve.",
        defeat: "The auditor keeps her count and schedules another visit. Rho moves the feed sacks indoors and leaves the haulers in the yard with their name boards.",
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
        summons: "The order says every branch outside the old plan must go. This tree and that plan are both four hundred years old, but only one is still growing. Keep their saws off it.",
        lesson: "The Order strikes whatever reaches from the front. Let the second active position finish the turn while the first draws the cut.",
        defeat: "The Order leaves its cut marks on the trunk. Kaio brings a brush and water, then starts washing the chalk off before the detail has cleared the path.",
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
        summons: "The detail has an order for four beasts, signed today while Sena is at the Colosseum. I can keep this gate shut for a minute. I need you to make that minute enough.",
        lesson: "The impound completes its claim on the fourth turn. Break its formation before then.",
        defeat: "The detail falls back to the ward gate with the order still valid. Pell resets the bar, braces it with his shoulder, and tells you to hurry back.",
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

export const FIRST_PACT_AFTERMATH_IDS = [
    "writ-silencing",
    "writ-audit",
    "writ-pruning",
    "writ-impound",
    "vale-stable",
] as const;
export type FirstPactAftermathId = typeof FIRST_PACT_AFTERMATH_IDS[number];

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
        /** The sealed Lattice formation that arrived at the vow. */
        latticeCompanionIds?: string[];
        /** The four companions whose sealed Lattice victory preceded the vow. */
        pactCompanionIds?: string[];
        /** Their server-owned names at the moment the vow was accepted, aligned
         *  with `pactCompanionIds`. A null slot means the surviving record could
         *  not recover that historical name. */
        pactCompanionNames?: Array<string | null>;
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
    /** Optional return visits made after the Balancing. These change no reward
     * or completion gate; they only remember which surviving details were seen. */
    aftermathVisits: FirstPactAftermathId[];
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
        aftermathVisits: [],
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
    const sealedCompanionIds = (value: unknown) => {
        const ids = [...new Set((Array.isArray(value) ? value : [])
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim().slice(0, 96))
            .filter(Boolean))];
        return ids.length === FIRST_PACT_TEAM_SIZE ? ids : undefined;
    };
    const latticeCompanionIds = sealedCompanionIds(mainSource.latticeCompanionIds);
    const pactCompanionIds = pactVow ? sealedCompanionIds(mainSource.pactCompanionIds) : undefined;
    const pactCompanionNames = pactCompanionIds
        ? (Array.isArray(mainSource.pactCompanionNames) && mainSource.pactCompanionNames.length === FIRST_PACT_TEAM_SIZE
            ? mainSource.pactCompanionNames.map((entry) => {
                if (typeof entry !== "string") return null;
                const name = entry.trim().slice(0, 48);
                return name || null;
            })
            : pactCompanionIds.map(() => null))
        : undefined;
    const answered = [...new Set((Array.isArray(source.writs) ? source.writs : [])
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry) => WRIT_SET.has(entry)))];
    const findings = [...new Set((Array.isArray(source.findings) ? source.findings : [])
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry) => WRIT_SET.has(entry) && answered.includes(entry)))];
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
            ...(latticeCompanionIds ? { latticeCompanionIds } : {}),
            ...(pactCompanionIds ? { pactCompanionIds } : {}),
            ...(pactCompanionNames ? { pactCompanionNames } : {}),
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
        findings,
        aftermathVisits: [...new Set((Array.isArray(source.aftermathVisits) ? source.aftermathVisits : [])
            .filter((entry): entry is FirstPactAftermathId => typeof entry === "string"
                && (entry === "vale-stable" ? status === "complete" : findings.includes(entry))))],
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

/** Keep the four companions from the server-settled Lattice victory that leads
 * directly to the vow. The caller supplies the sealed battle formation. */
export function recordFirstPactLatticeCompanions(
    progress: FirstPactProgress,
    companionIds: readonly string[],
): FirstPactProgress {
    if (progress.mainQuest.latticeCompanionIds || progress.mainStep !== "make-first-pact"
        || !progress.flags.includes("defeated-lattice-guardian")) return progress;
    const ids = [...new Set(companionIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().slice(0, 96))
        .filter(Boolean))];
    if (ids.length !== FIRST_PACT_TEAM_SIZE) return progress;
    return { ...progress, mainQuest: { ...progress.mainQuest, latticeCompanionIds: ids } };
}

/** Seal the names that the server currently has for the already-bound pact
 * companions. The ids choose the order; a pet list can fill a name, never
 * choose a companion or replace an existing snapshot. */
export function recordFirstPactCompanionNames(
    progress: FirstPactProgress,
    pets: readonly { id?: unknown; name?: unknown; nickname?: unknown }[],
): FirstPactProgress {
    const ids = progress.mainQuest.pactCompanionIds;
    if (!progress.mainQuest.pactVow || !ids || progress.mainQuest.pactCompanionNames) return progress;
    const byId = new Map(pets
        .map((pet) => [String(pet.id ?? "").trim().slice(0, 96), pet] as const)
        .filter(([id]) => id));
    const names = ids.map((id) => {
        const pet = byId.get(id);
        const nickname = typeof pet?.nickname === "string" ? pet.nickname.trim().slice(0, 48) : "";
        const name = typeof pet?.name === "string" ? pet.name.trim().slice(0, 48) : "";
        return nickname || name || null;
    });
    return { ...progress, mainQuest: { ...progress.mainQuest, pactCompanionNames: names } };
}

export function firstPactAvailableAftermath(progress: FirstPactProgress): FirstPactAftermathId[] {
    const unlocked = progress.findings.filter((id): id is FirstPactAftermathId =>
        (FIRST_PACT_AFTERMATH_IDS as readonly string[]).includes(id));
    return progress.stableQuest.status === "complete" ? [...unlocked, "vale-stable"] : unlocked;
}

/** Optional return visits are available only after the Balancing. They grant
 * nothing and never gate `complete-crossing`. */
export function visitFirstPactAftermath(
    progress: FirstPactProgress,
    id: unknown,
    now = Date.now(),
): { progress: FirstPactProgress; visited: boolean; replayed: boolean } {
    if (progress.mainStep !== "return-to-threshold" && progress.mainStep !== "complete") {
        return { progress, visited: false, replayed: false };
    }
    const safe = String(id) as FirstPactAftermathId;
    if (!firstPactAvailableAftermath(progress).includes(safe)) {
        return { progress, visited: false, replayed: false };
    }
    if (progress.aftermathVisits.includes(safe)) {
        return { progress, visited: false, replayed: true };
    }
    return {
        progress: {
            ...progress,
            lastVisitedAt: now,
            aftermathVisits: [...progress.aftermathVisits, safe],
        },
        visited: true,
        replayed: false,
    };
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
        lesson: "The Arbiter mirrors the roles and elements of the four you brought. Change active positions and target order before the reflection settles into your formation.",
        defeat: "The Arbiter files the result and steps off the sand. The mirrored four leave in your usual order. Nothing is taken, and the docket returns to its first sitting.",
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
            mainQuest: {
                ...progress.mainQuest,
                pactVow: vow.id,
                ...(progress.mainQuest.latticeCompanionIds
                    ? { pactCompanionIds: progress.mainQuest.latticeCompanionIds }
                    : {}),
            },
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
