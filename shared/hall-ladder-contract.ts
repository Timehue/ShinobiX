/**
 * Hall Ladder: the Card Hall's climb of named AI duelists. Each duelist is
 * fought three times, each bout harder than the last, and beating the third
 * opens the next duelist. Each duelist also teaches one rule of the game, taken
 * from the Card Clash tutorial (the client's HallLadder view picks the lines).
 *
 * Progress is one server-owned number on the save (`character.hallLadder`):
 * how many bouts, counted from the first, have been won. ai-start checks that
 * the requested bout is open and seals it into the session; the ai-move settle
 * moves the count on a win of the frontier bout. The client sends only the
 * bout index. A cleared bout can be fought again; it moves nothing.
 *
 * The FIRST win of each bout pays Chronicle Points (hallLadderFirstClearCp,
 * owner request 2026-11-26), credited in the same settle write that moves the
 * record. A rematch of a bout already won pays nothing, so the easy early bouts
 * cannot be farmed. Otherwise a ladder win settles like any other Card Hall AI
 * showdown.
 */
import type { ChronicleAiDifficulty } from "./chronicle-duel.js";

export interface HallLadderBout {
    difficulty: ChronicleAiDifficulty;
    /** Extra starting Health for the duelist (added to the usual 10,000). */
    opponentLifeBonus: number;
}

export interface HallLadderDuelist {
    id: string;
    name: string;
    title: string;
    /** Board name for the duelist's deck. */
    deckName: string;
    bouts: readonly [HallLadderBout, HallLadderBout, HallLadderBout];
}

export const HALL_LADDER_BOUTS_PER_DUELIST = 3;

const bout = (difficulty: ChronicleAiDifficulty, opponentLifeBonus = 0): HallLadderBout =>
    Object.freeze({ difficulty, opponentLifeBonus });

/** The ladder in climbing order. Ids are stable: the server maps each to a deck. */
const DUELISTS: HallLadderDuelist[] = [
    {
        id: "apprentice", name: "Kiri", title: "The Hall Apprentice", deckName: "First Lessons",
        bouts: [bout("easy"), bout("easy", 1_000), bout("medium")],
    },
    {
        id: "scrollkeeper", name: "Tobei", title: "The Scroll Keeper", deckName: "Old Ledgers",
        bouts: [bout("easy"), bout("medium"), bout("medium", 2_000)],
    },
    {
        id: "swifthand", name: "Suzume", title: "The Swift Hand", deckName: "Quick Feathers",
        bouts: [bout("medium"), bout("medium", 2_000), bout("hard")],
    },
    {
        id: "stonewall", name: "Gensai", title: "The Stone Wall", deckName: "Unbroken Line",
        bouts: [bout("medium", 2_000), bout("hard"), bout("hard", 2_000)],
    },
    {
        id: "hiddenmist", name: "Ayame", title: "Of the Hidden Mist", deckName: "Veiled Answers",
        bouts: [bout("hard"), bout("hard", 2_000), bout("hard", 3_000)],
    },
    {
        id: "champion", name: "Kurogane", title: "Champion of the Card Hall", deckName: "Champion's Due",
        bouts: [bout("hard", 2_000), bout("hard", 3_000), bout("hard", 4_000)],
    },
];
export const HALL_LADDER_DUELISTS: readonly HallLadderDuelist[] = Object.freeze(DUELISTS.map((duelist) => Object.freeze(duelist)));

/** A duelist's bundled art, served from public/: the portrait, or the
 *  full-body cutout that stands on their floor of the Hall Tower. */
export const hallLadderArt = (id: string, figure = false) => `/chronicle/ladder/${id}${figure ? "-figure" : ""}.webp`;

/** A ladder duelist's portrait by name, for the board's opponent portrait. */
export function hallLadderPortraitFor(name: string | undefined): string | undefined {
    const duelist = HALL_LADDER_DUELISTS.find((entry) => entry.name === name);
    return duelist && hallLadderArt(duelist.id);
}

export const HALL_LADDER_TOTAL_BOUTS = HALL_LADDER_DUELISTS.length * HALL_LADDER_BOUTS_PER_DUELIST;

/** The save record. `cleared` counts bouts won in ladder order. */
export type HallLadderRecord = { cleared: number };

/** Read the record off a save character, tolerating any stored junk. */
export function hallLadderOf(character: Record<string, unknown> | null | undefined): HallLadderRecord {
    const raw = character?.hallLadder as { cleared?: unknown } | undefined;
    const cleared = Math.floor(Number(raw?.cleared));
    return { cleared: Number.isFinite(cleared) ? Math.min(HALL_LADDER_TOTAL_BOUTS, Math.max(0, cleared)) : 0 };
}

export interface HallLadderBoutRef {
    index: number;
    duelist: HallLadderDuelist;
    duelistIndex: number;
    /** 0, 1 or 2 within the duelist. */
    round: number;
    bout: HallLadderBout;
}

export function hallLadderBout(index: unknown): HallLadderBoutRef | null {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= HALL_LADDER_TOTAL_BOUTS) return null;
    const duelistIndex = Math.floor(index / HALL_LADDER_BOUTS_PER_DUELIST);
    const round = index % HALL_LADDER_BOUTS_PER_DUELIST;
    const duelist = HALL_LADDER_DUELISTS[duelistIndex];
    return { index, duelist, duelistIndex, round, bout: duelist.bouts[round] };
}

/** The next bout to win, or null once the whole ladder is cleared. */
export function hallLadderFrontier(record: HallLadderRecord): number | null {
    return record.cleared < HALL_LADDER_TOTAL_BOUTS ? record.cleared : null;
}

/** Every cleared bout and the frontier bout are open; nothing beyond it. */
export function hallLadderBoutOpen(record: HallLadderRecord, index: number): boolean {
    return !!hallLadderBout(index) && index <= record.cleared;
}

/** Chronicle Points for the first win of each bout. Every number lives here. */
export const HALL_LADDER_CP = Object.freeze({
    /** Bouts 1 and 2 against any duelist. */
    bout: 10,
    /** The third bout, which beats the duelist and opens the next floor. */
    duelist: 30,
    /** The third bout against the champion at the top of the tower. */
    champion: 60,
});

/** What the first win of a bout pays; 0 for an index off the ladder. */
export function hallLadderFirstClearCp(index: number): number {
    const ref = hallLadderBout(index);
    if (!ref) return 0;
    if (ref.round < HALL_LADDER_BOUTS_PER_DUELIST - 1) return HALL_LADDER_CP.bout;
    return ref.duelistIndex === HALL_LADDER_DUELISTS.length - 1 ? HALL_LADDER_CP.champion : HALL_LADDER_CP.duelist;
}

/** A win moves the ladder only when it is the frontier bout. */
export function settleHallLadderWin(record: HallLadderRecord, index: number): { record: HallLadderRecord; advanced: boolean } {
    if (!hallLadderBout(index) || index !== record.cleared) return { record, advanced: false };
    return { record: { cleared: record.cleared + 1 }, advanced: true };
}
