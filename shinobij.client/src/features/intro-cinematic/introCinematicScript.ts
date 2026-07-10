/*
 * Intro-cinematic script — pure data for the post-account-creation cinematic
 * (features/intro-cinematic/IntroCinematic.tsx). An ancient spirit fox summons
 * the newly created shinobi to a fading waterfall shrine, warns that the
 * Hollow Gate is awakening, gifts the starter companion (the pet-selection
 * beat that used to live in the tutorial's StarterPetSelect overlay), speaks a
 * few lines of village lore (replacing the retired VillageLoreScreen wall of
 * text), and sends the player off with "Please... save this land."
 *
 * Lines support two placeholders, resolved by resolveCinematicLine():
 *   {name} — the player's character name
 *   {pet}  — the chosen companion's name (post-gift lines only)
 */

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
};

// ── Beat 1-3: awakening → warning → gift offer (before pet selection) ────────
export const PRE_GIFT_LINES: CinematicLine[] = [
    { speaker: "narrator", text: "Falling water. Cold stone. Cherry-blossom petals drifting through pale spirit-light." },
    { speaker: "narrator", text: "Once they carried the breath of spring. Now they only carry the memory." },
    { speaker: "narrator", text: "You wake at the foot of an ancient shrine — in a place you never entered." },
    { speaker: "fox", label: "???", text: "Open your eyes, young one. Good. The summons held." },
    { speaker: "fox", label: "???", text: "Do not be afraid. You stand beyond the veil, in the last sanctuary of this land — and I am the one who called you." },
    { speaker: "fox", text: `I am ${FOX_NAME}, guardian of this shrine since the first torii was raised. What little of me remains, anyway.` },
    { speaker: "fox", text: "Crossing the veil to reach a soul like yours took the last of my power. I did not spend it lightly." },
    { speaker: "fox", text: "Listen well, for I may not have the strength to say this twice." },
    { speaker: "fox", vision: true, text: "Far beneath this land stands the Hollow Gate — a door that was sealed before your kind first drew breath. For a thousand years, it slept." },
    { speaker: "fox", vision: true, rumble: true, text: "It sleeps no longer. It stirs. It hungers. Something — or someone — is feeding it." },
    { speaker: "fox", text: "My kin held the seal for generations. I am the last of them, and my light is nearly spent. Alone, I cannot hold back what is coming." },
    { speaker: "fox", text: "That is why I called you. I hope — with all that remains of me — that you can help this land." },
    { speaker: "fox", text: "But I will not send you into this world alone." },
    { speaker: "fox", text: "Five young spirits shelter at this shrine — the last I have raised, each carrying one of the five natures." },
    { speaker: "fox", text: "Choose one, {name}. Let it walk beside you where I cannot." },
];

// ── Beat 4: brief village lore, spoken by the fox (2 lines per village).
// Replaces the retired VillageLoreScreen wall of text; keyed by the same
// village names data/sectors.ts `villages` uses.
export const VILLAGE_LORE_LINES: Record<string, [string, string]> = {
    "Stormveil Village": [
        "Stormveil — a village born from outcasts who answered to no lord, raised beneath skies that never stop storming. Strength there is not inherited. It is seized.",
        "Its people bow to no tradition, only to power and the will to take it. Prove yourself, and even the storm will make way for you.",
    ],
    "Ashen Leaf Village": [
        "Ashen Leaf — the oldest of the villages, raised among ember groves where the old ways still burn. Tradition there is not a chain. It is a flame passed hand to hand.",
        "Honor its clans and learn their teachings, and the village will claim you as its own blood.",
    ],
    "Frostfang Village": [
        "Frostfang — a northern hold of snow gates and stone, where winter kills the faithless and loyalty is the only warmth. A promise there is never a small thing.",
        "Stand by its people, and they will stand by you until the very ice breaks.",
    ],
    "Moonshadow Village": [
        "Moonshadow — the night village of lantern paths and hidden courts, where a quiet step is worth more than a loud blade.",
        "Its people watch everything and waste nothing. Ambition is welcome there — carry yours carefully.",
    ],
};

const FALLBACK_LORE_LINES: [string, string] = [
    "Your village waits beyond the veil — a home of hard roads and harder lessons.",
    "Earn its people's trust, and they will stand with you against what is coming.",
];

// ── Beats 5-6: post-gift thanks → lore → farewell ────────────────────────────
export function buildPostGiftLines(village: string): CinematicLine[] {
    const [loreA, loreB] = VILLAGE_LORE_LINES[village] ?? FALLBACK_LORE_LINES;
    return [
        { speaker: "fox", text: "{pet}... a fine choice. Care for each other — a bond like that grows stronger than any blade." },
        { speaker: "fox", text: "Now, you cannot linger here. The shrine is fading, and the world beyond has need of you." },
        { speaker: "fox", text: loreA },
        { speaker: "fox", text: loreB },
        { speaker: "fox", text: "Train there. Grow strong, {name}. And when the Hollow Gate calls — and it will call — be ready to answer." },
        { speaker: "fox", fading: true, text: "My light is going out, {name}. Take my hope with you." },
        { speaker: "fox", fading: true, text: "Please... save this land." },
    ];
}

export function resolveCinematicLine(text: string, playerName: string, petName: string): string {
    return text.replaceAll("{name}", playerName).replaceAll("{pet}", petName);
}
