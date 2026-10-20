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
        shiranuiResponse: "Then make your own choices. You do not have to accept the life someone else plans for you.",
        companionCallback: "The Gate couldn't decide who you are. If it tries again, I'll remind it that the choice is yours.",
        sparCallback: "No one decides who I become.",
        keepsakeLine: "The broken ring on your seal marks your promise to choose your own future.",
    },
    {
        id: "seeker",
        title: "Seek the Truth",
        quote: "I need to understand what the Gate saw.",
        meaning: "Follow contradictions, ask dangerous questions, and distrust easy answers.",
        shiranuiResponse: "Then investigate the Gate. Find evidence and question what people tell you, including me.",
        companionCallback: "You wanted the truth. I can't promise it'll be kind, but you won't have to face it alone.",
        sparCallback: "I need to understand what the Gate saw.",
        keepsakeLine: "The open ring on your seal marks your promise to uncover the truth about the Gate.",
    },
    {
        id: "guardian",
        title: "Guard Your People",
        quote: "My village comes first.",
        meaning: "Judge every victory by who gets to come home when it is over.",
        shiranuiResponse: "Then protect the people who live there. Sometimes that may mean questioning your village's leaders.",
        companionCallback: "You promised to protect your village's people. I'll help you bring them home safely.",
        sparCallback: "My village comes first.",
        keepsakeLine: "The sheltered flame on your seal marks your promise to protect your village's people.",
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
    fieldReport: string;
    opening: string;
    villagePromise: string;
};

const CEREMONIES: Record<string, AcademyCeremony> = {
    "Stormveil Village": {
        rite: "Stormveil First-Return Rite",
        witness: "Keeper of the Challenge Board",
        fieldReport: "You describe three moving rings around an old road marker. Your companion confirms that they shifted when you repeated your vow.",
        opening: "I recorded the ring pattern and sent someone to mark the road stone for investigation. Take this field seal in recognition of your first assignment.",
        villagePromise: "Stormveil trusts you to answer a challenge without letting the crowd choose your reason.",
    },
    "Ashen Leaf Village": {
        rite: "Ashen Leaf First-Return Rite",
        witness: "Keeper of the Branch Register",
        fieldReport: "You describe three moving rings around an old road marker. Your companion confirms that they shifted when you repeated your vow.",
        opening: "I made a clay copy of the ring pattern for the road surveyor. Take this field seal in recognition of your first assignment.",
        villagePromise: "Ashen Leaf will record what you do. What you become is still yours to write.",
    },
    "Frostfang Village": {
        rite: "Frostfang First-Return Rite",
        witness: "Warden of the Storm Bell",
        fieldReport: "You describe three moving rings around an old road marker. Your companion confirms that they shifted when you repeated your vow.",
        opening: "I marked the sector on the rescue chart and warned the next patrol not to touch the light. The storm bell sounded once when you returned. I counted both your names.",
        villagePromise: "Frostfang trusts you to cross the rope line and bring everyone in your care home again.",
    },
    "Moonshadow Village": {
        rite: "Moonshadow First-Return Rite",
        witness: "Custodian of Sealed Roads",
        fieldReport: "You describe three moving rings around an old road marker. Your companion confirms that they shifted when you repeated your vow.",
        opening: "I recorded the location and the ring pattern. I have kept your name, your companion's name, and your vow out of the public report to protect you both. Take this field seal.",
        villagePromise: "Keep the details of your encounter private while we investigate the Gate.",
    },
};

const FALLBACK_CEREMONY: AcademyCeremony = {
    rite: "First Field-Return Rite",
    witness: "Village Field Warden",
    fieldReport: "You describe three moving rings around an old road marker. Your companion confirms that they shifted when you repeated your vow.",
    opening: "I waited at the gate until you and your companion crossed the threshold together.",
    villagePromise: "Your village trusts you to cross its walls, make a judgment, and return with the truth.",
};

export function academyCeremony(village: string): AcademyCeremony {
    return CEREMONIES[village] ?? FALLBACK_CEREMONY;
}
