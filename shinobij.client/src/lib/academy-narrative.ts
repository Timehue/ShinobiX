import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { CanonicalOnboardingStep } from "./onboarding-step";

export type AcademyVow = NonNullable<Character["academyVow"]>;

export type AcademyVowDefinition = {
    id: AcademyVow;
    title: string;
    quote: string;
    meaning: string;
    shiranuiResponse: string;
    companionCallback: string;
    sparCallback: string;
    keepsakeLine: string;
};

export const ACADEMY_VOWS: readonly AcademyVowDefinition[] = [
    {
        id: "unbound",
        title: "Remain Unbound",
        quote: "No one decides who I become.",
        meaning: "Meet every order, title, and prophecy on your own terms.",
        shiranuiResponse: "Good. If the Gate tries to decide who you should be, remind it that refusal is still an answer.",
        companionCallback: "The Gate couldn't decide who you are. If it tries again, I'll remind it that the choice is yours.",
        sparCallback: "No one decides who I become.",
        keepsakeLine: "The broken ring records a life that will not be classified.",
    },
    {
        id: "seeker",
        title: "Seek the Truth",
        quote: "I need to understand what the Gate saw.",
        meaning: "Follow contradictions, ask dangerous questions, and distrust easy answers.",
        shiranuiResponse: "Then look past every answer that arrives too neatly. The Gate is precise, and precision can still be a lie.",
        companionCallback: "You wanted the truth. I can't promise it'll be kind, but you won't have to face it alone.",
        sparCallback: "I need to understand what the Gate saw.",
        keepsakeLine: "The open ring honors the question no machine could close.",
    },
    {
        id: "guardian",
        title: "Guard Your People",
        quote: "My village comes first.",
        meaning: "Judge every victory by who gets to come home when it is over.",
        shiranuiResponse: "Then remember: a village is its people before it is its walls. Protecting one may someday mean arguing with the other.",
        companionCallback: "You promised to put the village first. I'll help you remember every person hidden inside that word.",
        sparCallback: "My village comes first.",
        keepsakeLine: "The sheltered flame marks a promise carried beyond the walls.",
    },
] as const;

const VOW_BY_ID = new Map(ACADEMY_VOWS.map((vow) => [vow.id, vow]));

export function isAcademyVow(value: unknown): value is AcademyVow {
    return value === "unbound" || value === "seeker" || value === "guardian";
}

export function academyVowDefinition(value: unknown): AcademyVowDefinition {
    return VOW_BY_ID.get(isAcademyVow(value) ? value : "unbound") ?? ACADEMY_VOWS[0];
}

export type AcademyStoryMomentId = "sparOmen" | "fieldTrace" | "returnCeremony";

/**
 * One source of truth for the three authored interruptions in the Academy path.
 * Keeping this pure makes the important negative cases explicit: opening the
 * World Map at the village (sector 0) is not a field discovery, and reaching a
 * sector does not count until the player acknowledges the trace.
 */
export function academyStoryMomentFor({
    step,
    screen,
    currentSector,
    incidentSeen,
    sectorVisited,
}: {
    step: CanonicalOnboardingStep;
    screen: Screen;
    currentSector: number;
    incidentSeen: boolean;
    sectorVisited: boolean;
}): AcademyStoryMomentId | null {
    if (step === "cafeteria" && !incidentSeen) return "sparOmen";
    if (step !== "sectorReturn") return null;
    if (screen === "worldMap" && currentSector >= 1 && !sectorVisited) return "fieldTrace";
    if (screen === "village" && sectorVisited) return "returnCeremony";
    return null;
}

export type AcademyCeremony = {
    rite: string;
    witness: string;
    opening: string;
    villagePromise: string;
};

const CEREMONIES: Record<string, AcademyCeremony> = {
    "Stormveil Village": {
        rite: "Stormveil First-Return Rite",
        witness: "Keeper of the Challenge Board",
        opening: "For one minute, the arena bell stays quiet. I turned the challenge board over so the blank wood could face you.",
        villagePromise: "Stormveil trusts you to answer a challenge without letting the crowd choose your reason.",
    },
    "Ashen Leaf Village": {
        rite: "Ashen Leaf First-Return Rite",
        witness: "Keeper of the Branch Register",
        opening: "I left one line in the Branch Register unfinished. This warm field seal is yours to carry instead.",
        villagePromise: "Ashen Leaf will record what you do. What you become is still yours to write.",
    },
    "Frostfang Village": {
        rite: "Frostfang First-Return Rite",
        witness: "Warden of the Storm Bell",
        opening: "The storm bell sounded once when you crossed back through the gate. I counted your name, and your companion's beside it.",
        villagePromise: "Frostfang trusts you to cross the rope line and bring everyone in your care home again.",
    },
    "Moonshadow Village": {
        rite: "Moonshadow First-Return Rite",
        witness: "Custodian of Sealed Roads",
        opening: "I closed one file without making a copy. The only record of that road is the seal in your hand.",
        villagePromise: "Moonshadow trusts you with a truth that does not belong in our archives. Not yet.",
    },
};

const FALLBACK_CEREMONY: AcademyCeremony = {
    rite: "First Field-Return Rite",
    witness: "Village Field Warden",
    opening: "I waited at the gate until you and your companion crossed the threshold together.",
    villagePromise: "Your village trusts you to cross its walls, make a judgment, and return with the truth.",
};

export function academyCeremony(village: string): AcademyCeremony {
    return CEREMONIES[village] ?? FALLBACK_CEREMONY;
}
