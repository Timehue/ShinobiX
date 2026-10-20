/*
 * Intro-cinematic script — pure data for the post-account-creation cinematic
 * (features/intro-cinematic/IntroCinematic.tsx). A spirit fox draws the newly
 * created shinobi to a fading waterfall shrine, warns that the human-built
 * old machinery beneath the road is active again, gifts the starter companion (the pet-selection
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
    { speaker: "narrator", text: "You were leaving your village when something pulled you off the road. A flash of white light is the last thing you remember." },
    { speaker: "narrator", text: "A white fox sits beside your dropped pack, one paw planted on the strap." },
    { speaker: "fox", label: "???", text: "Easy. Sit up slowly. I had enough strength to bring you here, not enough to catch you twice." },
    { speaker: "fox", label: "???", text: "Check your hands. Good. Now say your name to yourself. If you still remember it, we are doing better than I feared." },
    { speaker: "fox", text: `I am ${FOX_NAME}. I keep this waterfall shrine and the old road beneath it. These days I mostly keep the roof from falling in.` },
    { speaker: "fox", text: "An old machine beneath the road tried to identify you and pull you in. When it failed, it tried again. I brought you here before it could succeed." },
    { speaker: "fox", vision: true, text: "It is called the Hollow Gate. The Sunken Court built it long ago. I have seen it examine travelers, but I still do not know why." },
    { speaker: "fox", vision: true, rumble: true, text: "It could not identify you. Its record kept going blank, and I used that delay to pull you free." },
    { speaker: "fox", text: "You are safe here for now. Have some water from the cup. Then tell me: what matters most to you?" },
];

// The player's answer is a narrative identity, not a build choice. It earns an
// immediate response here, returns after the spar, and is engraved into the
// first field seal so the choice has visible continuity without changing power.
export function buildVowResponseLines(vow: AcademyVow): CinematicLine[] {
    return [
        { speaker: "fox", text: academyVowDefinition(vow).shiranuiResponse },
        { speaker: "fox", text: "You should not travel alone. Five young companions shelter here, one for each chakra element. Choose a companion to travel and fight beside you, {name}." },
    ];
}

// ── Beat 4: brief village lore, spoken by the fox (2 lines per village).
// Replaces the retired VillageLoreScreen wall of text; keyed by the same
// village names data/sectors.ts `villages` uses.
export const VILLAGE_LORE_LINES: Record<string, [string, string]> = {
    "Stormveil Village": [
        "Stormveil settles disputes through public arena challenges. Fighters write their names and reasons on the challenge board before each bout.",
        "The challenge board keeper registers new fighters. You will meet them when you begin the village story.",
    ],
    "Ashen Leaf Village": [
        "Ashen Leaf records each shinobi's name, craft, and ambitions in a living cedar wall called the Branch Register.",
        "Its keeper will ask what you hope to become. Take your time answering; the village keeps that promise on record.",
    ],
    "Frostfang Village": [
        "Frostfang checks who is inside the village whenever a storm approaches. Give the gate guard your name and your companion's so the rescue crews know you are safe.",
        "The rope lines lead to the training yard. Keep a glove on the line and let your companion choose the pace.",
    ],
    "Moonshadow Village": [
        "Moonshadow guards its secrets carefully. Many residents use aliases, and official records are kept sealed.",
        "The canal lamps lead to the trainee desk. Ask for prices in writing before you pay anyone.",
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
        { speaker: "fox", label: petName, text: "Let's start at the Training Grounds, {name}. I'll help you train, learn a jutsu, and prepare for your first spar." },
    ];
}
