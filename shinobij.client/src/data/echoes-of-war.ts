// Echoes of War — the Chronicle Showdown story campaign inside the Celestial
// Tower. Ten preserved people from the Sunken Court, one unfinished Showdown
// each. This file is the typed SHELL: ids, floors, deck metadata, rewards, and
// unlock helpers. The scene dialogue is authored in echoes-of-war-scenes.ts
// (build-time only) and ships as an on-demand content-addressed JSON asset via
// scripts/generate-story-content.mts + lib/echoes-content-loader.ts, so the
// campaign script stays out of the budgeted route chunk.
//
// ZERO imports on purpose: api/card-clash/_echoes-catalog.test.ts imports this
// file directly under node/tsx to hold the client display data and the server
// encounter table (decks, floors, rewards) in lockstep.

export type EchoesScenePage = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
};

export type EchoesOpponent = {
    id: string;
    floor: number;
    /** Spoken name only; the VN reader resolves /portraits/<slug>.webp from it. */
    name: string;
    title: string;
    /** Board display name of the opponent's deck (mirrors the server table). */
    deckName: string;
    /** One-line player-facing description of how the deck plays. */
    deckTheme: string;
    difficultyLabel: "Introductory" | "Moderate" | "Difficult" | "Boss";
    isBoss?: true;
    /** Encounter-detail blurb. No late-floor spoilers. */
    shortDescription: string;
    /** Shown on the locked node instead of the story. */
    lockedHint: string;
    portrait: string;
    /** Backdrop for this floor's story scenes. */
    sceneImage: string;
    /** Shown on the detail screen after the story is complete: what this
     * floor added to the record. */
    chronicleNote: string;
};

/** The four scene scripts for one opponent. Authored in
 * data/echoes-of-war-scenes.ts (build-time only) and delivered at runtime as
 * on-demand content-addressed story JSON; see lib/echoes-content-loader.ts. */
export type EchoesOpponentScenes = {
    preShowdown: EchoesScenePage[];
    defeat: EchoesScenePage[];
    firstVictory: EchoesScenePage[];
    rematch: EchoesScenePage[];
};

/** An Age of the Sunken Court's fall: a contiguous run of floors the player
 * uncovers as one movement, each with a bespoke opener-style intro VN that
 * names the age's affliction and why its memories still linger. Structural
 * metadata lives here (needed synchronously for the selection screen); the
 * intro VN PROSE ships through the content-JSON pipeline as ECHOES_ERA_INTROS
 * (data/echoes-of-war-scenes.ts), keyed by era id. */
export type EchoesEra = {
    id: string;
    /** Roman-numeral age label, e.g. "Age I". */
    ageLabel: string;
    title: string;
    /** One-line evocation shown under the title on the plate. */
    tagline: string;
    /** Contiguous, inclusive floor range this age covers. */
    floors: readonly number[];
    /** Wide establishing banner for the age plate. */
    plateImage: string;
    band: EchoesBand;
};

/** The intro VN pages for one age (mirrors EchoesScenePage). */
export type EchoesEraIntro = EchoesScenePage[];

/** Display mirror of the server reward table (api/card-clash/_echoes-catalog.ts).
 * The parity test fails the build if these drift. */
export const ECHOES_REWARD_DISPLAY = {
    repeatWin: 15,
    firstClearBonus: 35,
    bossFirstClearBonus: 50,
    basicPackCost: 100,
} as const;

export const ECHOES_FLOOR_COUNT = 10;

/** Player-facing landing copy for the mode. Held as DATA (not inline JSX) so it
 * rides the same canon + tone gates as the scene text: these strings are folded
 * into the tone `pages` scan and the Gate-origin `echoesPages` corpus. The
 * "not their souls" line is the sentence that reconciles the whole mode with
 * the no-preserved-soul rule (hollow-rifts.ts), so it must be guarded, and the
 * two-age framing (the Sunken Court that BUILT the Gate, and the village age
 * that still feeds it) must not drift into an origin reversal or an invented
 * parade of civilizations canon cannot pay off. */
export const ECHOES_HERO_COPY = {
    eyebrow: "Celestial Tower · Chapter One · The Sunken Court",
    /** Rendered as the landing subtitle. */
    subtitle: "The tower keeps the memories of the fallen, not their souls. The Sunken Court built the Hollow Gate and fell to it. Finish the Showdowns the Court never held, and you will know the machine that is feeding on your villages now.",
    /** Rendered as the landing footnote. */
    footnote: "The Sunken Court was the first age the Gate consumed. The villages are the second. Each age holds the memories that never got their Showdown. Chronicle Points, earned here, buy the Basic Card Pack in the Card Shop.",
} as const;

/** The tower interior key art (ladder hero + lock/loading backdrops). */
export const ECHOES_TOWER_HERO = "/scenes/story/echoes-tower-hero.webp";

/** Visual band of the climb: warm dust below, lantern amber in the middle,
 * chakra-leak teal near the top, and the council crimson for the boss floor.
 * Drives per-band theming classes in the screen CSS. */
export type EchoesBand = "low" | "mid" | "high" | "court";
export function echoesBandForFloor(floor: number): EchoesBand {
    return floor >= 10 ? "court" : floor >= 7 ? "high" : floor >= 4 ? "mid" : "low";
}

/** Every floor carries its own landing scene (VN + battle backdrop),
 * generated by scripts/gen-echoes-art.mjs from the authored scene captions. */
const scene = (slug: string) => `/scenes/story/echoes-${slug}.webp`;

export const ECHOES_OPPONENTS: readonly EchoesOpponent[] = [
    {
        id: "echoes-1-tovin", floor: 1, name: "Tovin", title: "The Bell Keeper",
        deckName: "The Unrung Bell",
        deckTheme: "Defense and Snares. He waits you out and answers late.",
        difficultyLabel: "Introductory",
        shortDescription: "The man blamed for the bell that never rang. He has been waiting a very long time for someone to sit down.",
        lockedHint: "The lowest memory is always open.",
        portrait: "/portraits/tovin.webp",
        sceneImage: scene("tovin"),
        chronicleNote: "The evacuation bell rope was cut clean, from the tower walk above. The keeper below pulled a rope attached to nothing.",
    },
    {
        id: "echoes-2-vetta", floor: 2, name: "Vetta", title: "The Grain Merchant",
        deckName: "Grain and Ledger",
        deckTheme: "Cheap monsters and card advantage. She trades one thing for another, always.",
        difficultyLabel: "Introductory",
        shortDescription: "She accused a gate guard of stealing grain during the shortages. He challenged her before the whole market. He never got his match.",
        lockedHint: "Finish the Bell Keeper's Showdown to open this memory.",
        portrait: "/portraits/vetta.webp",
        sceneImage: scene("vetta"),
        chronicleNote: "Food deliveries were being redirected toward the workers assigned below the city. The official ration totals never explained how much those crews consumed.",
    },
    {
        id: "echoes-3-aya", floor: 3, name: "Aya", title: "The Courier",
        deckName: "Dead Sprint",
        deckTheme: "Fast, cheap attackers pushed past their weight. Speed over safety.",
        difficultyLabel: "Introductory",
        shortDescription: "She left an urgent route on the night of the evacuation. An officer called her a coward for it. The city fell before she could answer him.",
        lockedHint: "Finish the Grain Merchant's Showdown to open this memory.",
        portrait: "/portraits/aya.webp",
        sceneImage: scene("aya"),
        chronicleNote: "The undelivered message reported that the aqueduct beneath the restricted district had run dry, despite weeks of rain.",
    },
    {
        id: "echoes-4-ansel", floor: 4, name: "Ansel", title: "The Ledger Clerk",
        deckName: "Amended Records",
        deckTheme: "Draw, discard, and recovery from the discard pile. Numbers moved twice.",
        difficultyLabel: "Moderate",
        shortDescription: "He altered ration records, and a colleague took the blame. Both halves of that sentence are true, and he has been precise about it ever since.",
        lockedHint: "Finish the Courier's Showdown to open this memory.",
        portrait: "/portraits/ansel.webp",
        sceneImage: scene("ansel"),
        chronicleNote: "Ration demand rose because the crews below the city drew several times a normal share. Men came up from those shifts pale, shaking, and unable to recall their own names.",
    },
    {
        id: "echoes-5-sela", floor: 5, name: "Sela", title: "The Healer",
        deckName: "The Last Dose",
        deckTheme: "Healing, protection, and revival. Saving one thing at the cost of another.",
        difficultyLabel: "Moderate",
        shortDescription: "Two healers argued over the city's last medicine. She won the right to decide. The treatment failed, and the word she used afterward was we.",
        lockedHint: "Finish the Ledger Clerk's Showdown to open this memory.",
        portrait: "/portraits/sela.webp",
        sceneImage: scene("sela"),
        chronicleNote: "The patients had no infection to cure. They were emptied of chakra itself, and no medicine restores what something else is still draining.",
    },
    {
        id: "echoes-6-korin", floor: 6, name: "Korin", title: "The Watch Captain",
        deckName: "Sealed District",
        deckTheme: "Walls, seals, and summons turned back at the gate. Lockdown.",
        difficultyLabel: "Moderate",
        shortDescription: "He sealed the east lower gate during the evacuation, on schedule, with people still outside it. He can recite the order word for word. He always does.",
        lockedHint: "Finish the Healer's Showdown to open this memory.",
        portrait: "/portraits/korin.webp",
        sceneImage: scene("korin"),
        chronicleNote: "The hill terraces were empty before the order to seal the lower district was issued. The gate was never about saving the whole city. It chose a half.",
    },
    {
        id: "echoes-7-nima", floor: 7, name: "Nima", title: "The Archivist",
        deckName: "The Burned Shelf",
        deckTheme: "The discard pile is her second hand. What burns keeps coming back.",
        difficultyLabel: "Difficult",
        shortDescription: "History says she burned the civilization's last records. History is working from incomplete sources. She saw to that personally.",
        lockedHint: "Finish the Watch Captain's Showdown to open this memory.",
        portrait: "/portraits/nima.webp",
        sceneImage: scene("nima"),
        chronicleNote: "An investigator proved the lower works consumed far more than the city ever received back. Something between the intake and the lamps was drinking the difference. His figures burned.",
    },
    {
        id: "echoes-8-eren", floor: 8, name: "Eren", title: "The Chronicle Arbiter",
        deckName: "Signed Verdict",
        deckTheme: "Negation and counters. Your plan is refused before it resolves.",
        difficultyLabel: "Difficult",
        shortDescription: "Every public Showdown in the Court ran through his seal. One match above all was certified fair. It was not.",
        lockedHint: "Finish the Archivist's Showdown to open this memory.",
        portrait: "/portraits/eren.webp",
        sceneImage: scene("eren"),
        chronicleNote: "Public questions about the Hollow Gate were treated as threats to order. The match meant to examine it was decided before either deck was shuffled.",
    },
    {
        id: "echoes-9-lyra", floor: 9, name: "Lyra", title: "The Gate Engineer",
        deckName: "Gate Feedback",
        deckTheme: "Big output, ugly costs. Power drawn from somewhere it should not be.",
        difficultyLabel: "Difficult",
        shortDescription: "She kept the Hollow Gate running for eleven years, then spent the rest of her life trying to say one true thing about it at a fair table.",
        lockedHint: "Finish the Chronicle Arbiter's Showdown to open this memory.",
        portrait: "/portraits/lyra.webp",
        sceneImage: scene("lyra"),
        chronicleNote: "The Hollow Gate drew directly on the population. The people were not starving beside the machine. They were the fuel.",
    },
    {
        id: "echoes-10-halden", floor: 10, name: "Halden", title: "The Last Chancellor",
        deckName: "One More Day",
        deckTheme: "Board wipes, drains, and monsters that grow from your losses. The boss of the chapter.",
        difficultyLabel: "Boss", isBoss: true,
        shortDescription: "The man who knew what the Gate was doing and kept it running anyway, one defensible day at a time. The record has been waiting for him longest of all.",
        lockedHint: "Finish the Gate Engineer's Showdown to open the last memory.",
        portrait: "/portraits/halden.webp",
        sceneImage: scene("halden"),
        chronicleNote: "The Hollow Gate did not destroy the Sunken Court in a night. It dimmed the Court for a generation, and every day it ran made the day without it costlier, until there were no days left.",
    },
];

export function echoesOpponentById(id: string): EchoesOpponent | null {
    return ECHOES_OPPONENTS.find((opponent) => opponent.id === id) ?? null;
}

const eraScene = (slug: string) => `/scenes/story/echoes-${slug}.webp`;

/** The four Ages of the Sunken Court's fall. The player uncovers them in order;
 * each is a clickable plate that plays a bespoke intro VN (ECHOES_ERA_INTROS)
 * the first time it is opened. Floor ranges are contiguous and cover 1..10 with
 * no gaps or overlaps (asserted by the catalog test). The ten opponents are
 * unchanged — the Ages are how the long fall is read, not who the echoes are. */
export const ECHOES_ERAS: readonly EchoesEra[] = [
    {
        id: "echoes-age-1", ageLabel: "Age I", title: "The Unheard",
        tagline: "The ones history blamed first.",
        floors: [1, 2, 3], plateImage: eraScene("age-1"), band: "low",
    },
    {
        id: "echoes-age-2", ageLabel: "Age II", title: "The Buried",
        tagline: "When the ledgers learned to lie.",
        floors: [4, 5, 6], plateImage: eraScene("age-2"), band: "mid",
    },
    {
        id: "echoes-age-3", ageLabel: "Age III", title: "The Silenced",
        tagline: "When the Gate had a name, and naming it was a crime.",
        floors: [7, 8, 9], plateImage: eraScene("age-3"), band: "high",
    },
    {
        id: "echoes-age-4", ageLabel: "Age IV", title: "The Last Day",
        tagline: "One man, and one more day.",
        floors: [10], plateImage: eraScene("age-4"), band: "court",
    },
];

export function echoesEraById(id: string): EchoesEra | null {
    return ECHOES_ERAS.find((era) => era.id === id) ?? null;
}

export function echoesEraForFloor(floor: number): EchoesEra | null {
    return ECHOES_ERAS.find((era) => era.floors.includes(floor)) ?? null;
}

export function echoesEraOpponents(era: EchoesEra): EchoesOpponent[] {
    return ECHOES_OPPONENTS.filter((opponent) => era.floors.includes(opponent.floor));
}

/** An Age is unlocked once its FIRST floor is reachable (i.e. the floor below
 * the age is cleared). Age I is always open. */
export function echoesEraUnlocked(progress: EchoesClientProgress, era: EchoesEra): boolean {
    return echoesFloorUnlockedClient(progress, Math.min(...era.floors));
}

/** Cleared memories within an age (for the plate's progress readout). */
export function echoesEraCleared(progress: EchoesClientProgress, era: EchoesEra): number {
    return echoesEraOpponents(era).filter((opponent) => (progress[opponent.id]?.wins ?? 0) > 0).length;
}

export type EchoesClientProgress = Record<string, { wins: number; firstClearAt?: number }>;

/** Read the server-owned campaign record off the character, defensively. */
export function echoesClientProgress(raw: unknown): EchoesClientProgress {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: EchoesClientProgress = {};
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object") continue;
        const wins = Math.max(0, Math.floor(Number((entry as { wins?: unknown }).wins) || 0));
        if (ECHOES_OPPONENTS.some((opponent) => opponent.id === id)) out[id] = { wins };
    }
    return out;
}

export function echoesFloorCleared(progress: EchoesClientProgress, floor: number): boolean {
    const def = ECHOES_OPPONENTS.find((opponent) => opponent.floor === floor);
    return !!def && (progress[def.id]?.wins ?? 0) > 0;
}

export function echoesHighestUnlockedFloorClient(progress: EchoesClientProgress): number {
    let floor = 1;
    while (floor < ECHOES_OPPONENTS.length && echoesFloorCleared(progress, floor)) floor += 1;
    return floor;
}

/** Floors open strictly in order (mirror of the server rule); Floor 1 is
 * always open. */
export function echoesFloorUnlockedClient(progress: EchoesClientProgress, floor: number): boolean {
    if (!Number.isInteger(floor) || floor < 1 || floor > ECHOES_OPPONENTS.length) return false;
    return floor <= echoesHighestUnlockedFloorClient(progress);
}

export function echoesStoriesCompleted(progress: EchoesClientProgress): number {
    return ECHOES_OPPONENTS.filter((opponent) => (progress[opponent.id]?.wins ?? 0) > 0).length;
}
