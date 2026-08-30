/*
 * Intro-cinematic script — pure data for the post-account-creation cinematic
 * (features/intro-cinematic/IntroCinematic.tsx). A spirit fox draws the newly
 * created shinobi to a fading waterfall shrine, warns that the human-built
 * Hollow Gate lattice is active again, gifts the starter companion (the pet-selection
 * beat that used to live in the tutorial's StarterPetSelect overlay), speaks a
 * few lines of village lore (replacing the retired VillageLoreScreen wall of
 * text), and sends the player off with "Please... save this land."
 *
 * Lines support two placeholders, resolved by resolveCinematicLine():
 *   {name} — the player's character name
 *   {pet}  — the chosen companion's name (post-gift lines only)
 */
import { academyVowDefinition, type AcademyVow } from "../../lib/academy-narrative";

export const FOX_NAME = "Shiranui";

export type CinematicLine = {
    /** narrator lines render as unlabeled italics; fox lines get a speaker pill. */
    speaker: "narrator" | "fox";
    /** Speaker-pill override (the fox is "???" until it introduces itself). */
    label?: string;
    text: string;
    /** Show the Hollow Gate vision panel while this line plays. */
    vision?: boolean;
    /** Shake the stage while this line plays (the Gate stirring). */
    rumble?: boolean;
    /** The fox's spirit is guttering — dims the fox art for the farewell. */
    fading?: boolean;
    /** Open the veil onto the player's chosen village and hold that world. */
    worldReveal?: boolean;
};

// ── Beat 1-3: awakening → warning → gift offer (before pet selection) ────────
export const PRE_GIFT_LINES: CinematicLine[] = [
    { speaker: "narrator", text: "Cold spray touches your face. Water strikes stone somewhere close." },
    { speaker: "narrator", text: "You remember the village gate, a pull behind your ribs, and then the road disappearing under white light." },
    { speaker: "narrator", text: "A white fox sits beside your dropped pack, one paw planted on the strap." },
    { speaker: "fox", label: "???", text: "Easy. Sit up slowly. I had enough strength to bring you here, not enough to catch you twice." },
    { speaker: "fox", label: "???", text: "Check your hands. Good. Now say your name to yourself. If you still remember it, we are doing better than I feared." },
    { speaker: "fox", text: `I am ${FOX_NAME}. I keep this waterfall shrine and the old road beneath it. These days I mostly keep the roof from falling in.` },
    { speaker: "fox", text: "An old machine beneath the road tried to identify you and pull you in. When it failed, it tried again. I brought you here before it could succeed." },
    { speaker: "fox", vision: true, text: "People of the Sunken Court built it to end famine, war, and winter. It does not hunger. It measures. The city is gone, but their machine, the Hollow Gate, is still working." },
    { speaker: "fox", vision: true, rumble: true, text: "Four intakes beneath the villages are feeding it again. Each takes a human choice and turns it into something useful. Useful is not the same as kind." },
    { speaker: "fox", text: "The Gate could not decide where you belong. That is not destiny. It is an error in the records. Before anyone fixes that error for you, tell me what matters." },
];

// The player's answer is a narrative identity, not a build choice. It earns an
// immediate response here, returns after the spar, and is engraved into the
// first field seal so the choice has visible continuity without changing power.
export function buildVowResponseLines(vow: AcademyVow): CinematicLine[] {
    return [
        { speaker: "fox", text: academyVowDefinition(vow).shiranuiResponse },
        { speaker: "fox", text: "Hold to that answer. Machines have long memories, but they do not understand promises." },
        { speaker: "fox", text: "You should not take that road alone. Five young companions shelter here, one for each chakra nature. Choose the one willing to choose you, {name}." },
    ];
}

// ── Beat 4: brief village lore, spoken by the fox (2 lines per village).
// Replaces the retired VillageLoreScreen wall of text; keyed by the same
// village names data/sectors.ts `villages` uses.
export const VILLAGE_LORE_LINES: Record<string, [string, string]> = {
    "Stormveil Village": [
        "Stormveil settles public grievances on a challenge board beside the arena. Post a reason, answer a bell, and everyone in the village will have an opinion by supper.",
        "Its people are proud that nobody is chained. Listen to what fighters remember after a bout, especially when they remember the score but not the cause.",
    ],
    "Ashen Leaf Village": [
        "Ashen Leaf will ask your name, your craft, and what you intend to become. Think before you answer the last one. The Branch Register remembers exact words.",
        "Its families keep old promises with real tenderness. Watch what the keepers prune when a new future grows beyond those promises.",
    ],
    "Frostfang Village": [
        "Frostfang will count you at the gate and count you again at every storm bell. No one is left behind there, and that promise has saved thousands.",
        "A promise that strong can become a locked door. Pay attention when someone asks to leave and the whole village answers for them.",
    ],
    "Moonshadow Village": [
        "Moonshadow keeps people safe with aliases, sealed files, and truths handed over in curtained booths. Everyone there knows the value of a secret.",
        "Before you give anyone a true name, ask who keeps the copy. In Moonshadow, trust always leaves a receipt.",
    ],
};

const FALLBACK_LORE_LINES: [string, string] = [
    "Your village waits beyond the veil, a home of hard roads and harder lessons.",
    "Earn its people's trust, and they will stand with you against what is coming.",
];

// ── Beats 5-6: post-gift thanks → lore → farewell ────────────────────────────
export function buildPostGiftLines(village: string, vow: AcademyVow = "unbound"): CinematicLine[] {
    const [loreA, loreB] = VILLAGE_LORE_LINES[village] ?? FALLBACK_LORE_LINES;
    const vowDef = academyVowDefinition(vow);
    return [
        { speaker: "fox", text: "{pet}. Yes, I wondered if they would choose you. Look after each other; neither of you knows this road yet." },
        { speaker: "fox", worldReveal: true, text: loreA },
        { speaker: "fox", worldReveal: true, text: loreB },
        { speaker: "fox", worldReveal: true, text: `Train there. Grow strong, {name}. And remember the answer you gave me: “${vowDef.quote}”` },
        { speaker: "fox", worldReveal: true, fading: true, text: "My light is almost gone. I wish I could walk the rest of this road with you. I cannot. Take what hope I have left, and do not let the Gate choose for us." },
    ];
}

export function resolveCinematicLine(text: string, playerName: string, petName: string): string {
    return text.replaceAll("{name}", playerName).replaceAll("{pet}", petName);
}

// ── Companion intro (the beat between the shrine cinematic's white-out and
// the tutorial UI): the chosen companion stands over the live village screen,
// gives its own take on the village, and asks to guide the player. Different
// angle than Shiranui's lore lines so the two beats never repeat each other.
export const COMPANION_VILLAGE_FLAVOR: Record<string, string> = {
    "Stormveil Village": "I can hear the arena bell from here. Also three people arguing about odds and one person selling soup. Loud place.",
    "Ashen Leaf Village": "That cedar wall must be the Branch Register. Everyone keeps lowering their voice when they walk past it.",
    "Frostfang Village": "Gate lanterns, rope lines, roll callers. They plan for storms here the way other villages plan supper.",
    "Moonshadow Village": "Two names on half the doors and no names on the rest. I am going to need you to explain the local rules slowly.",
};

export function buildCompanionIntroLines(village: string, petName: string, vow: AcademyVow = "unbound"): CinematicLine[] {
    const flavor = COMPANION_VILLAGE_FLAVOR[village]
        ?? "I can already tell there's more to this place than meets the eye.";
    return [
        { speaker: "fox", label: petName, text: `So this is ${village}. ${flavor}` },
        { speaker: "fox", label: petName, text: academyVowDefinition(vow).companionCallback },
        { speaker: "fox", label: petName, text: "Come on, {name}. Guide me to where new shinobi report. If we get lost, I will blame the village signs." },
    ];
}
